const API_ROOT = "https://rusherdevelopment.github.io/rusherhack-plugins/api/v1";
const INDEX_URL = `${API_ROOT}/index.json`;
const PLUGINS_URL = `${API_ROOT}/plugins.json`;
const THEMES_URL = `${API_ROOT}/themes.json`;
const CORE_URL = `${API_ROOT}/core.json`;

const els = {
  search:  document.getElementById("search"),
  suggest: document.getElementById("suggest"),
  results: document.getElementById("results"),
  empty:   document.getElementById("empty"),
};

let DATA = [];
let SUGGEST_INDEX = -1;

/* ---------------- utils ---------------- */
const debounce = (fn, ms=150) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms);} };
const normArr = v => !v ? [] : Array.isArray(v) ? v.filter(Boolean).map(String) : String(v).split(/[,\s]+/).filter(Boolean);

function normalizeItem(raw){
  const type = (raw.type || raw.kind || "").toLowerCase();
  return {
    id: raw.id || raw.slug || raw.name || "",
    name: raw.name || "Untitled",
    description: raw.description || raw.summary || "",
    repo: raw.repo || raw.repository || raw.url || "",
    homepage: raw.homepage || "",
    jar: raw.jar || raw.download_url || raw.download || "",
    type: ["plugin","theme","core"].includes(type) ? type : (raw.core ? "core" : (raw.theme ? "theme" : "plugin")),
    authors: normArr(raw.authors || raw.author || []),
    tags: normArr(raw.tags || []),
    mc: normArr(raw.mc_versions || raw.mc || []),
    updated: raw.updated || raw.last_updated || raw.release_date || "",
    version: raw.version || raw.latest_version || "",
  };
}

const toks = q => (q||"").toLowerCase().trim().split(/\s+/).filter(Boolean);
const escH = s => String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const escR = s => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
function mark(txt, t){
  if(!txt || !t.length) return escH(txt||"");
  let out = escH(txt);
  t.sort((a,b)=>b.length-a.length).forEach(x=>{
    out = out.replace(new RegExp(`(${escR(x)})`,"ig"),"<mark>$1</mark>");
  });
  return out;
}

/* --------------- fetch & shape handling --------------- */
async function fetchJson(url){
  const r = await fetch(url, { cache: "no-store", mode: "cors" });
  if(!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`);
  return r.json();
}

/** Accepts:
 * - Array of items
 * - Object with arrays (plugins/themes/core or similar)
 */
function flattenIndex(raw){
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    // Collect all array values from the object
    const arrays = Object.values(raw).filter(v => Array.isArray(v));
    if (arrays.length) return arrays.flat();
  }
  return [];
}

/** Robust loader:
 * 1) Try index.json
 * 2) If that isn't an array or is empty, try plugins.json/themes.json/core.json
 */
async function loadData(){
  try {
    const idx = await fetchJson(INDEX_URL);
    let flat = flattenIndex(idx);
    if (flat.length) return flat;

    // Fallback to individual endpoints
    const [plugins, themes, core] = await Promise.allSettled([
      fetchJson(PLUGINS_URL),
      fetchJson(THEMES_URL),
      fetchJson(CORE_URL),
    ]);

    flat = []
      .concat(plugins.status === "fulfilled" ? plugins.value : [])
      .concat(themes.status === "fulfilled" ? themes.value : [])
      .concat(core.status === "fulfilled" ? core.value : []);

    if (!flat.length) throw new Error("Empty dataset after all fallbacks.");
    return flat;
  } catch (e) {
    console.error("[RusherSearch] Load error:", e);
    throw e;
  }
}

/* --------------- search & render --------------- */
function scoreItem(item, tokens){
  if(!tokens.length) return 0;
  const name=item.name.toLowerCase(), desc=(item.description||"").toLowerCase(),
        authors=item.authors.join(" ").toLowerCase(), tags=item.tags.join(" ").toLowerCase(),
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
    const typeClass = it.type==="core" ? "badge core" : it.type==="theme" ? "badge theme" : "badge plugin";
    li.innerHTML = `
      <h3>${mark(it.name,tokens)}</h3>
      <div class="meta">
        <span class="${typeClass}">${it.type}</span>
        ${it.version ? `<span class="badge">v${escH(it.version)}</span>` : ""}
        ${it.mc.length ? `<span class="badge" title="MC versions">${escH(it.mc.join(", "))}</span>` : ""}
        ${it.authors.length ? `<span class="badge" title="Author(s)">${escH(it.authors.join(", "))}</span>` : ""}
      </div>
      <p class="desc">${it.description ? mark(it.description,tokens) : "<span class='small'>No description</span>"}</p>
      <div class="links">
        ${it.repo ? `<a class="button" href="${it.repo}" target="_blank" rel="noopener">Repo</a>` : ""}
        ${it.jar ? `<a class="button" href="${it.jar}" target="_blank" rel="noopener">Download JAR</a>` : ""}
        ${it.homepage ? `<a class="button" href="${it.homepage}" target="_blank" rel="noopener">Homepage</a>` : ""}
      </div>
      ${it.updated ? `<div class="small" style="margin-top:8px">Updated: ${escH(it.updated)}</div>` : ""}
    `;
    frag.appendChild(li);
  }
  els.results.appendChild(frag);
}

function runSearch(){
  const q = els.search.value.trim();
  const tokens = toks(q);

  const ranked = DATA
    .map(item => ({ item, score: tokens.length ? scoreItem(item, tokens) : 0 }))
    .filter(x => tokens.length ? x.score > 0 : false)
    .sort((a,b)=> b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0,200)
    .map(x=>x.item);

  render(ranked, tokens);
}

/* --------------- suggestions --------------- */
function buildSuggestions(q){
  const term = q.toLowerCase();
  if(!term){ els.suggest.classList.remove("show"); els.suggest.innerHTML=""; SUGGEST_INDEX=-1; return; }

  const starts=[], contains=[];
  for(const it of DATA){
    const n = it.name.toLowerCase();
    if(n.startsWith(term)) starts.push(it);
    else if(n.includes(term)) contains.push(it);
  }
  const list = [...starts, ...contains].slice(0,8);

  els.suggest.innerHTML = list.map((it,i)=>`<li role="option" data-name="${escH(it.name)}" ${i===0?'class="active"':''}>${escH(it.name)}</li>`).join("");
  SUGGEST_INDEX = list.length ? 0 : -1;
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

/* --------------- init & events --------------- */
async function init(){
  try{
    const raw = await loadData();
    DATA = raw.map(normalizeItem);
    els.results.setAttribute("aria-busy","false");
    console.log(`[RusherSearch] Loaded ${DATA.length} items.`);
  }catch(err){
    els.results.setAttribute("aria-busy","false");
    els.empty.textContent = "Failed to load API data.";
  }
}

const debouncedSearch = debounce(()=>{
  buildSuggestions(els.search.value);
  runSearch();
},120);

els.search?.addEventListener("input", debouncedSearch);
els.search?.addEventListener("keydown",(e)=>{
  const items = Array.from(els.suggest.querySelectorAll("li"));
  if(e.key==="ArrowDown" && items.length){ e.preventDefault(); SUGGEST_INDEX=Math.min(items.length-1,SUGGEST_INDEX+1); items.forEach(li=>li.classList.remove("active")); items[SUGGEST_INDEX].classList.add("active"); }
  else if(e.key==="ArrowUp" && items.length){ e.preventDefault(); SUGGEST_INDEX=Math.max(0,SUGGEST_INDEX-1); items.forEach(li=>li.classList.remove("active")); items[SUGGEST_INDEX].classList.add("active"); }
  else if(e.key==="Enter" && items.length && els.suggest.classList.contains("show")){ e.preventDefault(); commitSuggestion(SUGGEST_INDEX<0?0:SUGGEST_INDEX); }
  else if(e.key==="Escape"){ els.suggest.classList.remove("show"); els.search.select(); }
});

els.suggest?.addEventListener("mousedown",(e)=>{
  const li = e.target.closest("li"); if(!li) return;
  const idx = Array.from(els.suggest.children).indexOf(li);
  commitSuggestion(idx);
});

document.addEventListener("click",(e)=>{
  if(!e.target.closest(".search-wrap")) els.suggest.classList.remove("show");
});

if(!els.search){ console.error("[RusherSearch] #search input not found. Check HTML id and script load."); }
init();
