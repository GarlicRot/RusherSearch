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

let DATA = [];         // full items (rich)
let SUGGEST_SRC = [];  // light items (for suggestions)
let SUGGEST_BY_ID = new Map();
let SUGGEST_BY_NAME = new Map();

/* ------------- utils ------------- */
const debounce = (fn, ms=150) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms);} };
const escH = s => String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const escR = s => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const toks = q => (q||"").toLowerCase().trim().split(/\s+/).filter(Boolean);
function mark(txt, tokens){ if(!txt||!tokens.length) return escH(txt||""); let out=escH(txt); tokens.sort((a,b)=>b.length-a.length).forEach(x=>{ out=out.replace(new RegExp(`(${escR(x)})`,"ig"),"<mark>$1</mark>"); }); return out; }
const first = (arr)=>Array.isArray(arr)&&arr.length?arr[0]:"";

/* Parse "https://github.com/<owner>/<repo>" → {owner, repo} */
function parseOwnerRepo(url){
  if(!url) return {owner:null, repo:null};
  const m = url.match(/github\.com\/([^\/#?]+)\/([^\/#?]+)(?:$|[\/#?])/i);
  return m ? {owner:m[1], repo:m[2]} : {owner:null, repo:null};
}
const avatarFromOwner = (owner)=> owner ? `https://avatars.githubusercontent.com/${owner}?s=96` : "";

/* ------------- normalization ------------- */
function normalizeSearchEntry(e){
  const rec = {
    id: e.slug || e.id || e.name || "",
    name: e.name || "Untitled",
    creator: e.creator || "",
    tags: Array.isArray(e.tags)?e.tags:[],
    versions: Array.isArray(e.versions)?e.versions:[]
  };
  if(rec.id) SUGGEST_BY_ID.set(rec.id.toLowerCase(), rec);
  SUGGEST_BY_NAME.set(rec.name.toLowerCase(), rec);
  return rec;
}

// Handles the v1 API item shape (creator object, repo owner/repo, jar_url, mc_versions string, etc.)
function normalizeFullItem(raw){
  // creator: support object or string
  const cObj = (raw.creator && typeof raw.creator === "object") ? raw.creator : null;
  const authors = Array.isArray(raw.authors) ? raw.authors
                 : raw.author ? [String(raw.author)]
                 : [];
  const creatorName = cObj?.name || raw.creator_slug || (typeof raw.creator === "string" ? raw.creator : "") || first(authors) || "";

  // owner/repo bits
  const owner = raw.owner || (raw.repo && String(raw.repo).includes("/") ? String(raw.repo).split("/")[0] : "") || creatorName || "";
  const repoName = raw.repo_name || (raw.repo && String(raw.repo).includes("/") ? String(raw.repo).split("/")[1] : "") || "";

  // repo URL preference: explicit repo_url > full github URL in repo > build from owner/repoName
  const repoUrl =
    raw.repo_url ? raw.repo_url :
    (raw.repo && String(raw.repo).startsWith("http")) ? raw.repo :
    (owner && repoName ? `https://github.com/${owner}/${repoName}` : (raw.url || raw.repository || ""));

  // versions: array or comma/space-separated string; fall back to canonical
  const mc = Array.isArray(raw.mc_versions) ? raw.mc_versions
           : raw.mc_versions ? String(raw.mc_versions).split(/[,\s]+/).filter(Boolean)
           : Array.isArray(raw.versions_canonical) ? raw.versions_canonical
           : Array.isArray(raw.versions) ? raw.versions
           : (raw.mc ? [String(raw.mc)] : []);

  return {
    id: raw.id || raw.slug || raw.name || repoUrl || `${owner}/${repoName}` || "",
    name: raw.name || repoName || "Untitled",
    description: raw.description || raw.summary || raw.desc || "",
    repo: repoUrl,
    homepage: raw.homepage || "",
    jar: raw.jar || raw.jar_url || raw.download_url || raw.download || "",
    type: (raw.type || raw.kind || (raw.is_core ? "core" : "plugin")).toLowerCase(),
    authors,
    creator: creatorName,
    creatorUrl: cObj?.url || (creatorName ? `https://github.com/${creatorName}` : ""),
    avatar: cObj?.avatar || avatarFromOwner(owner),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    mc,
    updated: raw.updated || raw.last_updated || raw.release_date || "",
    version: raw.version || raw.latest_release_tag || raw.latest_version || "",
    owner: owner || null,
  };
}

/* ------------- data load ------------- */
async function fetchJSON(url){
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}
async function loadData(){
  // suggestions (compact)
  try{
    const compact = await fetchJSON(SEARCH_URL);
    if(Array.isArray(compact) && compact.length){
      SUGGEST_SRC = compact.map(normalizeSearchEntry);
      els.status.textContent = `Loaded ${compact.length} items`;
    }
  }catch(e){ console.warn("[RusherSearch] search-index failed:", e); }

  // full items (rich)
  try{
    const full = await fetchJSON(INDEX_URL);
    const flat = Array.isArray(full) ? full :
      (full && typeof full==="object" ? Object.values(full).filter(Array.isArray).flat() : []);
    DATA = flat.map(normalizeFullItem);

    // build suggestions from full when needed
    if(!SUGGEST_SRC.length){
      SUGGEST_SRC = DATA.map(d => ({
        id:d.id, name:d.name, creator:d.creator||first(d.authors)||"", tags:d.tags||[], versions:d.mc||[]
      }));
      SUGGEST_BY_ID.clear(); SUGGEST_BY_NAME.clear();
      SUGGEST_SRC.forEach(rec=>{
        if(rec.id) SUGGEST_BY_ID.set(rec.id.toLowerCase(),rec);
        SUGGEST_BY_NAME.set(rec.name.toLowerCase(),rec);
      });
    }
    els.status.textContent = `Loaded ${DATA.length} items`;
  }catch(e){
    console.error("[RusherSearch] index.json failed:", e);
    if(!SUGGEST_SRC.length) els.status.textContent = "Failed to load API data.";
  }
}

/* ------------- search & render ------------- */
function score(item, tokens){
  if(!tokens.length) return 0;
  const name=item.name.toLowerCase(), desc=(item.description||"").toLowerCase(),
        authors=(item.authors||[]).join(" ").toLowerCase(),
        tags=(item.tags||[]).join(" ").toLowerCase(),
        repo=(item.repo||"").toLowerCase(),
        creator=(item.creator||"").toLowerCase();
  let s=0;
  for(const t of tokens){
    if(name===t) s+=30; else if(name.startsWith(t)) s+=20; else if(name.includes(t)) s+=14;
    if(desc.includes(t)) s+=6; if(authors.includes(t)) s+=5; if(tags.includes(t)) s+=5; if(repo.includes(t)) s+=4; if(creator.includes(t)) s+=6;
  }
  if(s>0 && tokens.length>1) s+=3;
  return s;
}

function supplementFromSuggest(item){
  // Use search-index to fill gaps (creator, tags, versions)
  const key = (item.id||"").toLowerCase();
  const rec = SUGGEST_BY_ID.get(key) || SUGGEST_BY_NAME.get((item.name||"").toLowerCase());
  if(!rec) return item;
  return {
    ...item,
    creator: item.creator || rec.creator || "",
    owner: item.owner || rec.creator || item.creator || null,
    tags: (item.tags && item.tags.length) ? item.tags : (rec.tags || []),
    mc: (item.mc && item.mc.length) ? item.mc : (rec.versions || []),
  };
}

function avatarBlock(imgUrl, fallbackText){
  const initials = (fallbackText || "??").slice(0,2).toUpperCase();
  if (!imgUrl) return `<div class="avatar fallback">${escH(initials)}</div>`;
  return `<img class="avatar" loading="lazy" src="${imgUrl}" alt="${escH(fallbackText||'creator')}"
            onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar fallback',textContent:'${escH(initials)}'}))">`;
}

function render(items, tokens){
  els.results.innerHTML = "";
  els.results.setAttribute("aria-busy","false");
  if(!items.length){ els.empty.style.display=""; return; }
  els.empty.style.display="none";

  const frag=document.createDocumentFragment();
  for(let it of items){
    it = supplementFromSuggest(it);

    const creator = it.creator || first(it.authors) || "";
    const avatarHTML = avatarBlock(it.avatar, creator || it.owner || it.name);
    const creatorLine = creator
      ? (it.creatorUrl ? `<a class="creator" href="${it.creatorUrl}" target="_blank" rel="noopener">${escH(creator)}</a>`
                       : `<div class="creator">${escH(creator)}</div>`)
      : "";

    const tagChips = (it.tags||[]).slice(0,5).map(t=>`<span class="chip">${escH(t)}</span>`).join("");
    const verChips = (it.mc||[]).slice(0,4).map(v=>`<span class="chip">${escH(v)}</span>`).join("");

    const li=document.createElement("li");
    li.className="card";
    li.innerHTML = `
      <div class="row">
        ${avatarHTML}
        <div>
          <h3>${mark(it.name,tokens)}</h3>
          ${creatorLine}
          <div class="meta">
            ${it.type ? `<span class="badge">${escH(it.type)}</span>` : ""}
            ${it.version ? `<span class="badge">${escH(it.version)}</span>` : ""}
            ${it.updated ? `<span class="badge" title="Last updated">${escH(it.updated)}</span>` : ""}
          </div>

          <p class="desc">${it.description ? mark(it.description,tokens) : "<span class='small'>No description</span>"}</p>

          ${tagChips ? `<div class="tags">${tagChips}</div>` : ""}
          ${verChips ? `<div class="versions">${verChips}</div>` : ""}

          <div class="links">
            ${it.repo ? `<a class="button" href="${it.repo}" target="_blank" rel="noopener">Repo</a>` : ""}
            ${it.jar ? `<a class="button" href="${it.jar}" target="_blank" rel="noopener">Download JAR</a>` : ""}
            ${it.homepage ? `<a class="button" href="${it.homepage}" target="_blank" rel="noopener">Homepage</a>` : ""}
          </div>
        </div>
      </div>
    `;
    frag.appendChild(li);
  }
  els.results.appendChild(frag);
}

function runSearch(){
  const q = els.search.value.trim();
  const tokens = toks(q);
  if(!tokens.length){ render([], []); return; }

  const source = DATA.length ? DATA : SUGGEST_SRC.map(s => ({
    id:s.id, name:s.name, description:"", authors:s.creator?[s.creator]:[], creator:s.creator||"",
    tags:s.tags||[], mc:s.versions||[], repo:"", homepage:"", jar:"", type:"", version:"", updated:"", owner:s.creator||null
  }));

  const ranked = source
    .map(item => ({ item, score: score(item, tokens) }))
    .filter(x => x.score > 0)
    .sort((a,b)=> b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, 200)
    .map(x=>x.item);

  render(ranked, tokens);
}

/* ------------- suggestions ------------- */
let SUGGEST_INDEX_ACTIVE = -1;
function buildSuggestions(q){
  const term = q.toLowerCase();
  if(!term || !SUGGEST_SRC.length){
    els.suggest?.classList.remove("show"); if(els.suggest) els.suggest.innerHTML=""; SUGGEST_INDEX_ACTIVE=-1; return;
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

/* ------------- init & events ------------- */
async function init(){
  els.status.textContent = "Loading…";
  await loadData();
  els.results.setAttribute("aria-busy","false");
  els.status.textContent = (DATA.length || SUGGEST_SRC.length) ? `Loaded ${DATA.length || SUGGEST_SRC.length} items` : "Failed to load API data.";
}

const debouncedSearch = debounce(()=>{ buildSuggestions(els.search.value); runSearch(); },120);

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
document.addEventListener("click",(e)=>{ if(!e.target.closest(".search-wrap")) els.suggest.classList.remove("show"); });

init();
