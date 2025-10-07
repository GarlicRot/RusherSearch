const API_ROOT = "https://rusherdevelopment.github.io/rusherhack-plugins/api/v1";
const SEARCH_URL = `${API_ROOT}/search-index.json`;
const INDEX_URL = `${API_ROOT}/index.json`;

// DOM elements cache
const els = {
  search: document.getElementById("search"),
  suggest: document.getElementById("suggest"),
  results: document.getElementById("results"),
  empty: document.getElementById("empty"),
  status: document.getElementById("status"),
};

// Data stores
let DATA = []; // Full items (rich)
let SUGGEST_SRC = []; // Light items (suggestions)
const SUGGEST_BY_ID = new Map();
const SUGGEST_BY_NAME = new Map();

/* ------------- Utilities ------------- */
const debounce = (fn, ms = 150) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};
const escapeHTML = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokenize = (q) => (q || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
const markText = (txt, tokens) => {
  if (!txt || !tokens.length) return escapeHTML(txt || "");
  let out = escapeHTML(txt);
  tokens.sort((a, b) => b.length - a.length).forEach((x) => {
    out = out.replace(new RegExp(`(${escapeRegex(x)})`, "ig"), "<mark>$1</mark>");
  });
  return out;
};
const first = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : "");

/* Parse GitHub URL → {owner, repo} */
const parseOwnerRepo = (url) => {
  if (!url) return { owner: null, repo: null };
  const m = url.match(/github\.com\/([^/#?]+)\/([^/#?]+)(?:$|[/#?])/i);
  return m ? { owner: m[1], repo: m[2] } : { owner: null, repo: null };
};

/* Build avatar sources for 1x/2x/3x */
const buildAvatarSources = (rawUrl, ownerLike) => {
  const user = (ownerLike || "").replace(/^https?:\/\/github\.com\//i, "").replace(/\.png.*$/i, "").replace(/[^A-Za-z0-9-]/g, "");
  let base = user
    ? `https://avatars.githubusercontent.com/${user}`
    : rawUrl
    ? rawUrl.replace("github.com", "avatars.githubusercontent.com").split("?")[0]
    : "";
  if (!base) return { src: "", srcset: "" };
  const sizes = { s1: 128, s2: 256, s3: 384 };
  return {
    src: `${base}?s=${sizes.s1}`,
    srcset: `${base}?s=${sizes.s1} 1x, ${base}?s=${sizes.s2} 2x, ${base}?s=${sizes.s3} 3x`,
  };
};

/* ------------- Normalization ------------- */
const normalizeSearchEntry = (e) => {
  const rec = {
    id: e.slug || e.id || e.name || "",
    name: e.name || "Untitled",
    creator: e.creator || "",
    tags: Array.isArray(e.tags) ? e.tags : [],
    versions: Array.isArray(e.versions) ? e.versions : [],
  };
  if (rec.id) SUGGEST_BY_ID.set(rec.id.toLowerCase(), rec);
  SUGGEST_BY_NAME.set(rec.name.toLowerCase(), rec);
  return rec;
};

const normalizeFullItem = (raw) => {
  const cObj = typeof raw.creator === "object" ? raw.creator : null;
  const authors = Array.isArray(raw.authors) ? raw.authors : raw.author ? [String(raw.author)] : [];
  const creatorName = cObj?.name || raw.creator_slug || (typeof raw.creator === "string" ? raw.creator : "") || first(authors) || "";
  const { owner, repo } = parseOwnerRepo(raw.repo || raw.repository || "");
  const repoUrl = raw.repo_url || (owner && repo ? `https://github.com/${owner}/${repo}` : raw.url || "");
  const mc = Array.isArray(raw.mc_versions)
    ? raw.mc_versions
    : raw.mc_versions
    ? String(raw.mc_versions).split(/[,\s]+/).filter(Boolean)
    : Array.isArray(raw.versions_canonical)
    ? raw.versions_canonical
    : Array.isArray(raw.versions)
    ? raw.versions
    : raw.mc
    ? [String(raw.mc)]
    : [];
  return {
    id: raw.id || raw.slug || raw.name || repoUrl || `${owner}/${repo}` || "",
    name: raw.name || repo || "Untitled",
    description: raw.description || raw.summary || raw.desc || "",
    repo: repoUrl,
    homepage: raw.homepage || "",
    jar: raw.jar || raw.jar_url || raw.download_url || raw.download || "",
    type: (raw.type || raw.kind || (raw.is_core ? "core" : "plugin")).toLowerCase(),
    authors,
    creator: creatorName,
    creatorUrl: cObj?.url || (creatorName ? `https://github.com/${creatorName}` : ""),
    avatar: cObj?.avatar?.replace(/(\?|&)size=\d+/i, "").replace("github.com", "avatars.githubusercontent.com") || `https://avatars.githubusercontent.com/${owner || creatorName || ""}`,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    mc,
    updated: raw.updated || raw.last_updated || raw.release_date || "",
    version: raw.version || raw.latest_release_tag || raw.latest_version || "",
    owner: owner || creatorName || null,
  };
};

/* ------------- Data Load ------------- */
const fetchJSON = async (url) => {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(`Failed to fetch ${url}: ${e.message}`);
  }
};

const loadData = async () => {
  els.status.textContent = "Loading…";
  try {
    // Load compact suggestions
    const compact = await fetchJSON(SEARCH_URL);
    if (Array.isArray(compact)) {
      SUGGEST_SRC = compact.map(normalizeSearchEntry);
    }
  } catch (e) {
    console.warn("[RusherSearch] Failed to load search-index:", e);
  }

  try {
    // Load full items
    const full = await fetchJSON(INDEX_URL);
    DATA = (Array.isArray(full) ? full : Object.values(full).filter(Array.isArray).flat()).map(normalizeFullItem);

    // Fallback to full data for suggestions if needed
    if (!SUGGEST_SRC.length) {
      SUGGEST_SRC = DATA.map((d) => ({
        id: d.id,
        name: d.name,
        creator: d.creator || first(d.authors) || "",
        tags: d.tags || [],
        versions: d.mc || [],
      }));
      SUGGEST_BY_ID.clear();
      SUGGEST_BY_NAME.clear();
      SUGGEST_SRC.forEach((rec) => {
        if (rec.id) SUGGEST_BY_ID.set(rec.id.toLowerCase(), rec);
        SUGGEST_BY_NAME.set(rec.name.toLowerCase(), rec);
      });
    }
    els.status.textContent = `Loaded ${DATA.length || SUGGEST_SRC.length} items`;
  } catch (e) {
    console.error("[RusherSearch] Failed to load index:", e);
    els.status.textContent = "Failed to load API data.";
  }
};

/* ------------- Search & Render ------------- */
const score = (item, tokens) => {
  if (!tokens.length) return 0;
  const fields = {
    name: item.name.toLowerCase(),
    desc: (item.description || "").toLowerCase(),
    authors: (item.authors || []).join(" ").toLowerCase(),
    tags: (item.tags || []).join(" ").toLowerCase(),
    repo: (item.repo || "").toLowerCase(),
    creator: (item.creator || "").toLowerCase(),
  };
  let s = 0;
  for (const t of tokens) {
    if (fields.name === t) s += 30;
    else if (fields.name.startsWith(t)) s += 20;
    else if (fields.name.includes(t)) s += 14;
    if (fields.desc.includes(t)) s += 6;
    if (fields.authors.includes(t)) s += 5;
    if (fields.tags.includes(t)) s += 5;
    if (fields.repo.includes(t)) s += 4;
    if (fields.creator.includes(t)) s += 6;
  }
  if (s > 0 && tokens.length > 1) s += 3;
  return s;
};

const supplementFromSuggest = (item) => {
  const key = (item.id || "").toLowerCase();
  const rec = SUGGEST_BY_ID.get(key) || SUGGEST_BY_NAME.get((item.name || "").toLowerCase());
  if (!rec) return item;
  return {
    ...item,
    creator: item.creator || rec.creator || "",
    owner: item.owner || rec.creator || item.creator || null,
    tags: item.tags?.length ? item.tags : rec.tags || [],
    mc: item.mc?.length ? item.mc : rec.versions || [],
  };
};

const avatarBlock = (imgUrl, fallbackText, ownerLike) => {
  const initials = (fallbackText || "??").slice(0, 2).toUpperCase();
  const { src, srcset } = buildAvatarSources(imgUrl, ownerLike);
  if (!src) return `<div class="avatar fallback">${escapeHTML(initials)}</div>`;
  return `<img class="avatar" loading="lazy" src="${src}" srcset="${srcset}" sizes="64px"
               alt="${escapeHTML(fallbackText || "creator")}"
               onerror="this.replaceWith(document.createElement('div')).className='avatar fallback'; this.textContent='${escapeHTML(initials)}'">`;
};

const render = (items, tokens) => {
  els.results.innerHTML = "";
  els.results.setAttribute("aria-busy", "false");
  els.empty.style.display = items.length ? "none" : "";

  if (!items.length) return;

  const frag = document.createDocumentFragment();
  for (const it of items) {
    const item = supplementFromSuggest(it);
    const creator = item.creator || first(item.authors) || "";
    const avatarHTML = avatarBlock(item.avatar, creator || item.owner || item.name, item.owner || creator);
    const creatorLine = creator
      ? item.creatorUrl
        ? `<a class="creator" href="${item.creatorUrl}" target="_blank" rel="noopener">${escapeHTML(creator)}</a>`
        : `<div class="creator">${escapeHTML(creator)}</div>`
      : "";
    const tagChips = (item.tags || []).slice(0, 5).map((t) => `<span class="chip">${escapeHTML(t)}</span>`).join("");
    const verChips = (item.mc || []).slice(0, 4).map((v) => `<span class="chip">${escapeHTML(v)}</span>`).join("");

    const li = document.createElement("li");
    li.className = "card";
    li.innerHTML = `
      <div class="row">
        ${avatarHTML}
        <div>
          <h3>${markText(item.name, tokens)}</h3>
          ${creatorLine}
          <div class="meta">
            ${item.type ? `<span class="badge">${escapeHTML(item.type)}</span>` : ""}
            ${item.version ? `<span class="badge">${escapeHTML(item.version)}</span>` : ""}
            ${item.updated ? `<span class="badge" title="Last updated">${escapeHTML(item.updated)}</span>` : ""}
          </div>
          <p class="desc">${item.description ? markText(item.description, tokens) : "<span class='small'>No description</span>"}</p>
          ${tagChips ? `<div class="tags">${tagChips}</div>` : ""}
          ${verChips ? `<div class="versions">${verChips}</div>` : ""}
          <div class="links">
            ${item.repo ? `<a class="button" href="${item.repo}" target="_blank" rel="noopener">Repo</a>` : ""}
            ${item.jar ? `<a class="button" href="${item.jar}" target="_blank" rel="noopener">Download JAR</a>` : ""}
            ${item.homepage ? `<a class="button" href="${item.homepage}" target="_blank" rel="noopener">Homepage</a>` : ""}
          </div>
        </div>
      </div>
    `;
    frag.appendChild(li);
  }
  els.results.appendChild(frag);
};

const runSearch = () => {
  const q = els.search.value.trim();
  const tokens = tokenize(q);
  if (!tokens.length) return render([], []);

  const source = DATA.length
    ? DATA
    : SUGGEST_SRC.map((s) => ({
        id: s.id,
        name: s.name,
        description: "",
        authors: s.creator ? [s.creator] : [],
        creator: s.creator || "",
        tags: s.tags || [],
        mc: s.versions || [],
        repo: "",
        homepage: "",
        jar: "",
        type: "",
        version: "",
        updated: "",
        owner: s.creator || null,
      }));

  const ranked = source
    .map((item) => ({ item, score: score(item, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, 200)
    .map((x) => x.item);

  render(ranked, tokens);
};

/* ------------- Suggestions ------------- */
let SUGGEST_INDEX_ACTIVE = -1;

const buildSuggestions = (q) => {
  const term = q.toLowerCase();
  if (!term || !SUGGEST_SRC.length) {
    els.suggest?.classList.remove("show");
    if (els.suggest) els.suggest.innerHTML = "";
    SUGGEST_INDEX_ACTIVE = -1;
    return;
  }
  const starts = [];
  const contains = [];
  for (const it of SUGGEST_SRC) {
    const n = (it.name || "").toLowerCase();
    const c = (it.creator || "").toLowerCase();
    const tags = (it.tags || []).join(" ").toLowerCase();
    if (n.startsWith(term) || c.startsWith(term)) starts.push(it);
    else if (n.includes(term) || c.includes(term) || tags.includes(term)) contains.push(it);
  }
  const list = [...starts, ...contains].slice(0, 8);
  els.suggest.innerHTML = list
    .map((it, i) => `<li role="option" data-name="${escapeHTML(it.name)}" ${i === 0 ? 'class="active"' : ""}>
      ${escapeHTML(it.name)}${it.creator ? ` <span class="small">— ${escapeHTML(it.creator)}</span>` : ""}
    </li>`).join("");
  SUGGEST_INDEX_ACTIVE = list.length ? 0 : -1;
  els.suggest.classList.toggle("show", list.length > 0);
};

const commitSuggestion = (idx) => {
  const items = Array.from(els.suggest.querySelectorAll("li"));
  if (idx < 0 || idx >= items.length) return;
  els.search.value = items[idx].getAttribute("data-name");
  els.suggest.classList.remove("show");
  runSearch();
};

/* ------------- Init & Events ------------- */
const init = async () => {
  els.results.setAttribute("aria-busy", "true");
  await loadData();
  els.results.setAttribute("aria-busy", "false");
};

const debouncedSearch = debounce(() => {
  buildSuggestions(els.search.value);
  runSearch();
}, 120);

els.search.addEventListener("input", debouncedSearch);
els.search.addEventListener("keydown", (e) => {
  const items = Array.from(els.suggest.querySelectorAll("li"));
  if (e.key === "ArrowDown" && items.length) {
    e.preventDefault();
    SUGGEST_INDEX_ACTIVE = Math.min(items.length - 1, SUGGEST_INDEX_ACTIVE + 1);
    items.forEach((li) => li.classList.remove("active"));
    items[SUGGEST_INDEX_ACTIVE].classList.add("active");
  } else if (e.key === "ArrowUp" && items.length) {
    e.preventDefault();
    SUGGEST_INDEX_ACTIVE = Math.max(0, SUGGEST_INDEX_ACTIVE - 1);
    items.forEach((li) => li.classList.remove("active"));
    items[SUGGEST_INDEX_ACTIVE].classList.add("active");
  } else if (e.key === "Enter" && items.length && els.suggest.classList.contains("show")) {
    e.preventDefault();
    commitSuggestion(SUGGEST_INDEX_ACTIVE < 0 ? 0 : SUGGEST_INDEX_ACTIVE);
  } else if (e.key === "Escape") {
    els.suggest.classList.remove("show");
    els.search.select();
  }
});
els.suggest.addEventListener("mousedown", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  const idx = Array.from(els.suggest.children).indexOf(li);
  commitSuggestion(idx);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) els.suggest.classList.remove("show");
});

init();
