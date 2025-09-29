const API_URL = "https://rusherdevelopment.github.io/rusherhack-plugins/api/v1/index.json";

const els = {
  search: document.getElementById("search"),
  results: document.getElementById("results"),
  empty: document.getElementById("empty"),
  chips: Array.from(document.querySelectorAll(".chip")),
};

let DATA = [];
let ACTIVE_FILTER = "all";

/* ---------- utilities ---------- */

const debounce = (fn, ms = 150) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

function normalizeItem(raw) {
  // Be defensive about field names; API may evolve.
  const type = (raw.type || raw.kind || "").toLowerCase(); // "plugin" | "theme" | "core"
  return {
    id: raw.id || raw.slug || raw.name || "",
    name: raw.name || "Untitled",
    description: raw.description || raw.summary || "",
    repo: raw.repo || raw.repository || raw.url || "",
    homepage: raw.homepage || "",
    jar: raw.jar || raw.download_url || raw.download || "",
    type: ["plugin", "theme", "core"].includes(type) ? type : (raw.core ? "core" : (raw.theme ? "theme" : "plugin")),
    authors: normalizeArray(raw.authors || raw.author || []),
    tags: normalizeArray(raw.tags || []),
    mc: normalizeArray(raw.mc_versions || raw.mc || []),
    updated: raw.updated || raw.last_updated || raw.release_date || "",
    version: raw.version || raw.latest_version || "",
  };
}

function normalizeArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  return String(v).split(/[,\s]+/).filter(Boolean);
}

function tokenize(q) {
  return (q || "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function includes(hay, needle) {
  return hay.toLowerCase().includes(needle);
}

function startsWith(hay, needle) {
  return hay.toLowerCase().startsWith(needle);
}

function highlight(text, tokens) {
  if (!text || !tokens.length) return escapeHtml(text || "");
  // naive but effective: wrap any token occurrences; avoid nested tags
  let out = escapeHtml(text);
  tokens
    .sort((a, b) => b.length - a.length)
    .forEach(tok => {
      const re = new RegExp(`(${escapeRegExp(tok)})`, "ig");
      out = out.replace(re, "<mark>$1</mark>");
    });
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ---------- scoring & filtering ---------- */

function scoreItem(item, tokens) {
  if (!tokens.length) return 0;

  // fields to search
  const name = item.name.toLowerCase();
  const desc = (item.description || "").toLowerCase();
  const authors = item.authors.join(" ").toLowerCase();
  const tags = item.tags.join(" ").toLowerCase();
  const repo = (item.repo || "").toLowerCase();

  let score = 0;

  for (const t of tokens) {
    // hierarchy: exact name > startsWith(name) > includes in name > others
    if (name === t) score += 30;
    else if (startsWith(name, t)) score += 20;
    else if (includes(name, t)) score += 14;

    if (includes(desc, t)) score += 6;
    if (includes(authors, t)) score += 5;
    if (includes(tags, t)) score += 5;
    if (includes(repo, t)) score += 4;
  }

  // small bump if multiple tokens all matched somewhere
  if (score > 0 && tokens.length > 1) score += 3;

  return score;
}

function passTypeFilter(item) {
  if (ACTIVE_FILTER === "all") return true;
  if (ACTIVE_FILTER === "core") return item.type === "core";
  if (ACTIVE_FILTER === "plugin") return item.type === "plugin";
  if (ACTIVE_FILTER === "theme") return item.type === "theme";
  return true;
}

/* ---------- rendering ---------- */

function render(items, tokens) {
  els.results.innerHTML = "";
  els.results.setAttribute("aria-busy", "false");

  if (!items.length) {
    els.empty.style.display = "";
    return;
  }
  els.empty.style.display = "none";

  const frag = document.createDocumentFragment();

  for (const it of items) {
    const li = document.createElement("li");
    li.className = "card";

    const typeBadgeClass =
      it.type === "core" ? "badge core" :
      it.type === "theme" ? "badge theme" : "badge plugin";

    const nameHtml = highlight(it.name, tokens);
    const descHtml = highlight(it.description || "", tokens);

    li.innerHTML = `
      <h3>${nameHtml}</h3>
      <div class="meta">
        <span class="${typeBadgeClass}">${it.type}</span>
        ${it.version ? `<span class="badge">v${escapeHtml(it.version)}</span>` : ""}
        ${it.mc.length ? `<span class="badge" title="MC versions">${escapeHtml(it.mc.join(", "))}</span>` : ""}
        ${it.authors.length ? `<span class="badge" title="Author(s)">${escapeHtml(it.authors.join(", "))}</span>` : ""}
      </div>
      <p class="desc">${descHtml || "<span class='small'>No description</span>"}</p>
      <div class="links">
        ${it.repo ? `<a class="button" href="${it.repo}" target="_blank" rel="noopener">Repo</a>` : ""}
        ${it.jar ? `<a class="button" href="${it.jar}" target="_blank" rel="noopener">Download JAR</a>` : ""}
        ${it.homepage ? `<a class="button" href="${it.homepage}" target="_blank" rel="noopener">Homepage</a>` : ""}
      </div>
      ${it.updated ? `<div class="small" style="margin-top:8px">Updated: ${escapeHtml(it.updated)}</div>` : ""}
    `;

    frag.appendChild(li);
  }

  els.results.appendChild(frag);
}

/* ---------- search pipeline ---------- */

function runSearch() {
  const q = els.search.value.trim();
  const tokens = tokenize(q);

  const filtered = DATA
    .filter(passTypeFilter)
    .map(item => ({ item, score: scoreItem(item, tokens) }))
    .filter(x => tokens.length ? x.score > 0 : true)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, 200) // safety cap

  render(filtered.map(x => x.item), tokens);
}

/* ---------- init ---------- */

async function init() {
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    const raw = await res.json();

    // The API returns an array (plugins + themes). Normalize each entry.
    DATA = Array.isArray(raw) ? raw.map(normalizeItem) : [];

    els.results.setAttribute("aria-busy", "false");
    // Initial render (empty or full). Keep empty by default until user types:
    render([], []);
  } catch (e) {
    els.results.setAttribute("aria-busy", "false");
    els.empty.textContent = "Failed to load API data.";
  }
}

const debouncedSearch = debounce(runSearch, 120);

els.search.addEventListener("input", debouncedSearch);
els.search.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    els.search.value = "";
    debouncedSearch();
  }
});

els.chips.forEach(btn => {
  btn.addEventListener("click", () => {
    els.chips.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    ACTIVE_FILTER = btn.dataset.filter;
    runSearch();
  });
});

// Quick hint for keyboard users
els.search.setAttribute("title", "Tip: Press Esc to clear");
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    els.search.focus();
    els.search.select();
  }
});

init();
