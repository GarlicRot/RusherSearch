// Uses the compact search index first (fastest), with index.json fallback.

const API_ROOT = "https://rusherdevelopment.github.io/rusherhack-plugins/api/v1";
const SEARCH_URL = `${API_ROOT}/search-index.json`;
const INDEX_URL  = `${API_ROOT}/index.json`;

const els = {
  search:  document.getElementById("search"),
  suggest: document.getElementById("suggest"),
  results: document.getElementById("results"),
  empty:   document.getElementById("empty"),
  status:  document.getElementById("status"),
};

let DATA = [];           // normalized items for rendering
let SUGGEST_SRC = [];    // light records for suggestions (name, creator, tags)
let SUGGEST_INDEX = -1;

/* ---------------- utilities ---------------- */
const debounce = (fn, ms=150) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms);} };
const escH = s => String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const escR = s => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const toks = q => (q||"").toLowerCase().trim().split(/\s+/).filter(Boolean);

function mark(txt, tokens){
  if(!txt || !tokens.length) return escH(txt||"");
  let out = escH(txt);
  tokens.sort((a,b)=>b.length-a.length).forEach(x=>{
    out = out.replace(new RegExp(`(${escR(x)})`,"ig"),"<mark>$1</mark>");
  });
  return out;
}

/* ---------------- normalization ---------------- */
// For search-index.json (compact)
function normalizeSearchEntry(e){
  // expected fields per docs: name, slug, creator, tags, versions
  return {
    id: e.slug || e.id || e.name || "",
    name: e.name || "Untitled",
    creator: e.creator || "",
    tags: Array.isArray(e.tags) ? e.tags : [],
    versions: Array.isArray(e.versions) ? e.versions : [],
  };
}
// For index.json (full items)
function normalizeFullItem(raw){
  return {
    id: raw.id || raw.slug || raw.name || "",
    name: raw.name || "Untitled",
    description: raw.description || raw.summary || "",
    repo: raw.repo || raw.repository || raw.url || "",
    homepage: raw.homepage || "",
    jar: raw.jar || raw.download_url || raw.download || "",
    type: (raw.type || raw.kind || "plugin").toLowerCase(),
    authors: Array.isArray(raw.authors) ? raw.authors : (raw.author ? [String(raw.author)] : []),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    mc: Array.isArray(raw.mc_versions) ? raw.mc_versions : (raw.mc ? [String(raw.mc)] : []),
    updated: raw.updated || raw.last_updated || raw.release_date || "",
    version: raw.version || raw.latest_version || "",
  };
}

/* ---------------- data load ---------------- */
async function fetchJSON(url){
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function loadData(){
  // 1) Try compact search-index.json for suggestions + fast search
  try{
    const compact = await fetchJSON(SEARCH_URL);
    if (Array.isArray(compact) && compact.length){
      SUGGEST_SRC = compact.map(normalizeSearchEntry);
      els.status.textContent = `Loaded ${SUGGEST_SRC.length} items`;
    } else {
      throw new Error("search-index.json not an array");
    }
  }catch(e){
    console.warn("[RusherSearch] search-index.json failed:", e);
    els.status.textContent = "Search index not available; trying full index…";
  }

  // 2) Always try to fetch the full index for rendering richness.
  try{
    const full = await fetchJSON(INDEX_URL);
    const flat = Array.isArray(full) ? full : (
      full && typeof full === "object"
        ? Object.values(full).filter(Array.isArray).flat()
        : []
    );
    DATA = flat.map(normalizeFullItem);
    if (!SUGGEST_SRC.length){
      // fallback: build a lightweight source from full data
      SUGGEST_SRC = DATA.map(d => ({
        id: d.id, name: d.name, creator: (d.authors && d.authors[0]) || "", tags: d.tags || []
      }));
    }
    els.status.textContent = `Loaded ${DATA.length} items`;
  }catch(e){
    console.error("[RusherSearch] index.json failed:", e);
    if (!SUGGEST_SRC.length){
      els.status.textContent = "Failed to load API data.";
    }
  }
}

/* ---------------- search ---------------- */
function scoreFull(item, tokens){
  if(!tokens.length) return 0;
  const name=item.name.toLowerCase(), desc=(item.description||"").toLowerCase(),
        authors=(item.authors||[]).join(" ").toLowerCase(),
        tags=(item.tags||[]).join(" ").toLowerCase(),
        repo=(item.repo||"").toLowerCase();
  let s=0;
  for(const t of tokens){
    if(name===t) s+=30; else if(name.startsWith(t)) s+=20; else if(name.includes(t)) s+=14;
    if(desc.includes(t)) s+=6; if(authors.includes(t)) s+=5; if(tags.includes(t)) s+=5; if(repo.includes(t)) s+=4;
  }
  if(s>0 && tokens.length>1) s+=3;
  return s;
}

function render(items, tokens){
  els.results.innerHTML = "";
  els.results.setAttribute("aria-busy","false");

  if(!items.length){ els.empty.style.display=""; return; }
  els.empty.style.display="none";

  const frag=document.createDocumentFragment();
  for(const it of items){
    const li=document.createElement("li");
    li.className="card";
    li.innerHTML = `
      <h3>${mark(it.name,tokens)}</h3>
      <div class="meta">
        ${it.type ? `<span class="badge">${escH(it.type)}</span>` : ""}
        ${it.version ? `<span class="badge">v${escH(it.version)}</span>` : ""}
        ${(it.authors && it.authors.length) ? `<span class="badge">${escH(it.authors.join(", "))}</span>` : ""}
        ${(it.mc && it.mc.length) ? `<span class="badge">${escH(it.mc.join(", "))}</span>` : ""}
      </div>
      <p class="desc">${it.description ? mark(it.description,tokens) : "<span class='small'>No description</span>"}</p>
      <div class="links">
        ${it.repo ? `<a class="button" href="${it.repo}" target="_blank" rel="noopener">Repo</a>` : ""}
        ${it.jar ? `<a class="button" href="${it.jar}" target="_blank" rel="noopener">Download JAR</a>` : ""}
        ${it.homepage ? `<a class="button" href="${it.homepage}" target="_blank" rel="noopener">Homepage</a>` : ""}
      </div>
    `;
    frag.appendChild(li);
  }
  els.results.appendChild(frag);
}

function runSearch(){
  const q = els.search.value.trim();
  const tokens = toks(q);

  // nothing typed -> keep empty state
  if (!tokens.length){ render([], []); return; }

  // If full data is available, use it for better ranking/display
  const source = DATA.length ? DATA : SUGGEST_SRC.map(s => ({
    name: s.name, description:"", authors: s.creator?[s.creator]:[], tags: s.tags||[], repo:"", homepage:"", jar:"", type:"", mc:[], version:""
  }));

  const ranked = source
    .map(item => ({ item, score: scoreFull(item, tokens) }))
    .filter(x => x.score > 0)
    .sort((a,b)=> b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, 200)
    .map(x=>x.item);

  render(ranked, tokens);
}

/* ---------------- suggestions ---------------- */
let SUGGEST_INDEX_ACTIVE = -1;

function buildSuggestions(q){
  const term = q.toLowerCase();
  if(!term || !SUGGEST_SRC.length){
    els.suggest.classList.remove("show"); els.suggest.innerHTML=""; SUGGEST_INDEX_ACTIVE=-1; return;
  }
  const starts=[], contains=[];
  for(const it of SUGGEST_SRC){
    const n = (it.name||"").toLowerCase();
    const c = (it.creator||"").toLowerCase();
    const tags = (it.tags||[]).join(" ").toLowerCase();
    if(n.startsWith(term) || c.startsWith(term)) starts.push(it);
    else if(n.includes(term) || c.includes(term) || tags.includes(term)) contains.push(it);
  }
  const list = [...starts, ...contains].slice(0,8);
  els.suggest.innerHTML = list
    .map((it,i)=>`<li role="option" data-name="${escH(it.name)}" ${i===0?'class="active"':''}>
      ${escH(it.name)}${it.creator ? ` <span class="small">— ${escH(it.creator)}</span>`:""}
    </li>`).join("");
  SUGGEST_INDEX_ACTIVE = list.length ? 0 : -1;
  els.suggest.classList.toggle("show", list.length>0);
}

function commitSuggestion(idx){
  const items = Array.from(els.suggest.querySelectorAll("li"));
  if(idx<0 || idx>=items.length) return;
  const name = items[idx].getAttribute("data-name");
  els.search.value = name;
  els.suggest.classList.remove("show");
  runSearch();
}

/* ---------------- init & events ---------------- */
async function init(){
  els.status.textContent = "Loading…";
  await loadData();
  els.results.setAttribute("aria-busy","false");
  if (DATA.length || SUGGEST_SRC.length){
    els.status.textContent = `Loaded ${DATA.length || SUGGEST_SRC.length} items`;
  } else {
    els.status.textContent = "Failed to load API data.";
  }
}

const debouncedSearch = debounce(()=>{
  buildSuggestions(els.search.value);
  runSearch();
},120);

els.search.addEventListener("input", debouncedSearch);
els.search.addEventListener("keydown",(e)=>{
  const items = Array.from(els.suggest.querySelectorAll("li"));
  if(e.key==="ArrowDown" && items.length){ e.preventDefault(); SUGGEST_INDEX_ACTIVE=Math.min(items.length-1,(SUGGEST_INDEX_ACTIVE+1)); items.forEach(li=>li.classList.remove("active")); items[SUGGEST_INDEX_ACTIVE].classList.add("active"); }
  else if(e.key==="ArrowUp" && items.length){ e.preventDefault(); SUGGEST_INDEX_ACTIVE=Math.max(0,(SUGGEST_INDEX_ACTIVE-1)); items.forEach(li=>li.classList.remove("active")); items[SUGGEST_INDEX_ACTIVE].classList.add("active"); }
  else if(e.key==="Enter" && items.length && els.suggest.classList.contains("show")){ e.preventDefault(); commitSuggestion(SUGGEST_INDEX_ACTIVE<0?0:SUGGEST_INDEX_ACTIVE); }
  else if(e.key==="Escape"){ els.suggest.classList.remove("show"); els.search.select(); }
});
els.suggest.addEventListener("mousedown",(e)=>{
  const li = e.target.closest("li"); if(!li) return;
  const idx = Array.from(els.suggest.children).indexOf(li);
  commitSuggestion(idx);
});
document.addEventListener("click",(e)=>{
  if(!e.target.closest(".search-wrap")) els.suggest.classList.remove("show");
});

init();
