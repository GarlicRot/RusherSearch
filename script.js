const API_ROOT = "https://rusherdevelopment.github.io/rusherhack-plugins/api/v1";
const SEARCH_URL = `${API_ROOT}/search-index.json`;
const INDEX_URL  = `${API_ROOT}/index.json`;
const VERS_URL   = `${API_ROOT}/versions.json`;

const els = {
  search:  document.getElementById("search"),
  suggest: document.getElementById("suggest"),
  results: document.getElementById("results"),
  empty:   document.getElementById("empty"),
  status:  document.getElementById("status"),
  fType:   document.getElementById("f-type"),
  fCore:   document.getElementById("f-core"),
  fMc:     document.getElementById("f-mc"),
  mcDL:    document.getElementById("mc-versions"),
  fClear:  document.getElementById("f-clear"),
};

const params = new URLSearchParams(location.search);
const setParam = (k, v) => {
  if (v) params.set(k, v); else params.delete(k);
  const q = params.toString();
  history.replaceState(null, "", q ? `?${q}` : location.pathname);
};

let DATA = [];
let SUGGEST_SRC = [];
const SUGGEST_BY_ID = new Map();
const SUGGEST_BY_NAME = new Map();

// preindexed search
let INDEXED = [];        // [{item, hay, nameLC}]
let LAST_RESULTS = [];   // current filtered+ranked items for virtualization

// virtualization
const PAGE = 40;
let pagePointer = 0;
let sentinel;
let io;

const debounce = (fn, ms = 150) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} };
const escapeHTML = (s) => String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const tokenize = (q) => (q||"").toLowerCase().trim().split(/\s+/).filter(Boolean);
const first = (arr) => (Array.isArray(arr)&&arr.length?arr[0]:"");

const markText = (txt, tokens) => {
  if (!txt || !tokens.length) return escapeHTML(txt||"");
  let out = escapeHTML(txt);
  const sorted = tokens.slice().sort((a,b)=>b.length-a.length);
  const rx = new RegExp(`(${sorted.map(escapeRegex).join("|")})`,"ig");
  return out.replace(rx,"<mark>$1</mark>");
};

const parseOwnerRepo = (url) => {
  if (!url) return { owner:null, repo:null };
  const m = url.match(/github\.com\/([^/#?]+)\/([^/#?]+)(?:$|[/#?])/i);
  return m ? { owner:m[1], repo:m[2] } : { owner:null, repo:null };
};

const buildAvatarSources = (rawUrl, ownerLike) => {
  const user = (ownerLike||"").replace(/^https?:\/\/github\.com\//i,"").replace(/\.png.*$/i,"").replace(/[^A-Za-z0-9-]/g,"");
  let base = user ? `https://avatars.githubusercontent.com/${user}`
                  : rawUrl ? rawUrl.replace("github.com","avatars.githubusercontent.com").split("?")[0] : "";
  if (!base) return { src:"", srcset:"" };
  return {
    src: `${base}?s=128`,
    srcset: `${base}?s=128 1x, ${base}?s=256 2x, ${base}?s=384 3x`,
  };
};

const normalizeSearchEntry = (e) => {
  const rec = {
    id: e.slug || e.id || e.name || "",
    name: e.name || "Untitled",
    creator: e.creator || "",
    tags: Array.isArray(e.tags)?e.tags:[],
    versions: Array.isArray(e.versions)?e.versions:[],
  };
  if (rec.id) SUGGEST_BY_ID.set(rec.id.toLowerCase(), rec);
  SUGGEST_BY_NAME.set(rec.name.toLowerCase(), rec);
  return rec;
};

const normalizeFullItem = (raw) => {
  const cObj = typeof raw.creator==="object" ? raw.creator : null;
  const authors = Array.isArray(raw.authors)?raw.authors:(raw.author?[String(raw.author)]:[]);
  const creatorName = cObj?.name || raw.creator_slug || (typeof raw.creator==="string"?raw.creator:"") || first(authors) || "";
  const { owner, repo } = parseOwnerRepo(raw.repo || raw.repository || "");
  const repoUrl = raw.repo_url || (owner&&repo?`https://github.com/${owner}/${repo}`:raw.url||"");
  const mc = Array.isArray(raw.mc_versions)?raw.mc_versions
           : raw.mc_versions ? String(raw.mc_versions).split(/[,\s]+/).filter(Boolean)
           : Array.isArray(raw.versions_canonical)?raw.versions_canonical
           : Array.isArray(raw.versions)?raw.versions
           : raw.mc ? [String(raw.mc)] : [];
  const kind = (raw.type||raw.kind||"").toString().toLowerCase().replace(/s$/,"") || (raw.is_theme?"theme":"plugin");
  const cls  = (raw.class||raw.category||"").toString().toLowerCase() || (raw.is_core?"core":"regular");

  return {
    id: raw.id || raw.slug || raw.name || repoUrl || `${owner}/${repo}` || "",
    name: raw.name || repo || "Untitled",
    description: raw.description || raw.summary || raw.desc || "",
    repo: repoUrl,
    homepage: raw.homepage || "",
    jar: raw.jar || raw.jar_url || raw.download_url || raw.download || "",
    type: kind,
    kind, class: cls,
    authors,
    creator: creatorName,
    creatorUrl: cObj?.url || (creatorName?`https://github.com/${creatorName}`:""),
    avatar: (cObj?.avatar||"").replace(/(\?|&)size=\d+/i,"").replace("github.com","avatars.githubusercontent.com") ||
            `https://avatars.githubusercontent.com/${owner || creatorName || ""}`,
    tags: Array.isArray(raw.tags)?raw.tags:[],
    mc,
    updated: raw.updated || raw.last_updated || raw.release_date || "",
    version: raw.version || raw.latest_release_tag || raw.latest_version || "",
    owner: owner || creatorName || null,
  };
};

// tiny cache
const cacheGet = (key, maxAgeMs) => {
  try {
    const s = localStorage.getItem(key);
    if (!s) return null;
    const { t, v } = JSON.parse(s);
    if (Date.now()-t > maxAgeMs) return null;
    return v;
  } catch { return null; }
};
const cacheSet = (key, v) => {
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch {}
};
const fetchJSON = async (url, key, ttlMs=12*60*60*1000) => {
  const k = `rs_cache::${key||url}`;
  const cached = cacheGet(k, ttlMs);
  if (cached) return cached;
  const res = await fetch(url, { cache: "default" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  cacheSet(k, json);
  return json;
};

const loadVersions = async () => {
  try {
    const list = await fetchJSON(VERS_URL, "versions");
    if (Array.isArray(list) && els.mcDL) {
      els.mcDL.innerHTML = list.map((v)=>`<option value="${escapeHTML(String(v))}">`).join("");
    }
  } catch {}
};

const loadData = async () => {
  els.status.textContent = "Loading…";
  try {
    const compact = await fetchJSON(SEARCH_URL, "search-index");
    if (Array.isArray(compact)) SUGGEST_SRC = compact.map(normalizeSearchEntry);
  } catch (e) {
    console.warn("[RusherSearch] search-index:", e);
  }

  try {
    const full = await fetchJSON(INDEX_URL, "index");
    DATA = (Array.isArray(full)?full:Object.values(full).filter(Array.isArray).flat()).map(normalizeFullItem);

    if (!SUGGEST_SRC.length) {
      SUGGEST_SRC = DATA.map(d=>({ id:d.id, name:d.name, creator:d.creator||first(d.authors)||"", tags:d.tags||[], versions:d.mc||[] }));
      SUGGEST_BY_ID.clear(); SUGGEST_BY_NAME.clear();
      SUGGEST_SRC.forEach(rec => { if (rec.id) SUGGEST_BY_ID.set(rec.id.toLowerCase(),rec); SUGGEST_BY_NAME.set(rec.name.toLowerCase(),rec); });
    }

    // preindex haystack
    INDEXED = DATA.map(item => ({
      item,
      nameLC: (item.name||"").toLowerCase(),
      hay: [
        item.name, item.description,
        (item.authors||[]).join(" "),
        item.creator||"", (item.tags||[]).join(" "),
        item.repo||""
      ].join(" ").toLowerCase()
    }));

    els.status.textContent = `Loaded ${DATA.length || SUGGEST_SRC.length} items`;
  } catch (e) {
    console.error("[RusherSearch] index:", e);
    els.status.textContent = "Failed to load API data.";
  }
};

function hydrateControlsFromURL() {
  const q = params.get("q")||"", type=params.get("type")||"", core=params.get("core")||"", mc=params.get("mc")||"";
  if (els.search) els.search.value=q;
  if (els.fType)  els.fType.value=type;
  if (els.fCore)  els.fCore.value=core;
  if (els.fMc)    els.fMc.value=mc;
}

function entryMatchesFilters(entry, tokens, type, core, mc, hay) {
  if (tokens.length && !tokens.every(t=>hay.includes(t))) return false;
  if (type) { const k=(entry.kind||entry.type||"").toLowerCase(); if (k!==type.toLowerCase()) return false; }
  if (core) { const c=(entry.class||"").toLowerCase(); if (c!==core.toLowerCase()) return false; }
  if (mc) {
    const list=(entry.mc||[]).map(v=>String(v).toLowerCase());
    const want=String(mc).toLowerCase(); const family=want.replace(/x$/,"");
    if (!list.some(v=>v===want || (family && v.startsWith(family)))) return false;
  }
  return true;
}

const score = (nameLC, descLC, authorsLC, tagsLC, repoLC, creatorLC, tokens) => {
  if (!tokens.length) return 0;
  let s=0;
  for (const t of tokens) {
    if (nameLC===t) s+=30;
    else if (nameLC.startsWith(t)) s+=20;
    else if (nameLC.includes(t)) s+=14;
    if (descLC.includes(t)) s+=6;
    if (authorsLC.includes(t)) s+=5;
    if (tagsLC.includes(t)) s+=5;
    if (repoLC.includes(t)) s+=4;
    if (creatorLC.includes(t)) s+=6;
  }
  if (s>0 && tokens.length>1) s+=3;
  return s;
};

const supplementFromSuggest = (item) => {
  const key=(item.id||"").toLowerCase();
  const rec=SUGGEST_BY_ID.get(key) || SUGGEST_BY_NAME.get((item.name||"").toLowerCase());
  if (!rec) return item;
  return { ...item,
    creator: item.creator || rec.creator || "",
    owner: item.owner || rec.creator || item.creator || null,
    tags: item.tags?.length ? item.tags : rec.tags || [],
    mc: item.mc?.length ? item.mc : rec.versions || [],
  };
};

const avatarBlock = (imgUrl, fallbackText, ownerLike) => {
  const initials=(fallbackText||"??").slice(0,2).toUpperCase();
  const {src,srcset}=buildAvatarSources(imgUrl, ownerLike);
  if (!src) return `<div class="avatar fallback">${escapeHTML(initials)}</div>`;
  return `<img class="avatar" loading="lazy" src="${src}" srcset="${srcset}" sizes="64px"
    alt="${escapeHTML(fallbackText||"creator")}"
    onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar fallback',textContent:'${escapeHTML(initials)}'}))">`;
};

// virtualization helpers
const clearResults = () => { els.results.innerHTML=""; pagePointer=0; if (io){ io.disconnect(); io=null; } };
const ensureSentinel = () => {
  sentinel = document.createElement("li");
  sentinel.className = "sentinel";
  els.results.appendChild(sentinel);
  io = new IntersectionObserver((entries)=>{
    if (entries[0].isIntersecting) renderMore();
  }, { rootMargin: "600px" });
  io.observe(sentinel);
};
const renderMore = () => {
  if (pagePointer >= LAST_RESULTS.length) return;
  const end = Math.min(pagePointer + PAGE, LAST_RESULTS.length);
  const frag = document.createDocumentFragment();
  for (let i=pagePointer;i<end;i++){
    const it = LAST_RESULTS[i];
    const item = supplementFromSuggest(it);
    const creator = item.creator || first(item.authors) || "";
    const avatarHTML = avatarBlock(item.avatar, creator || item.owner || item.name, item.owner || creator);
    const creatorLine = creator
      ? (item.creatorUrl ? `<a class="creator" href="${item.creatorUrl}" target="_blank" rel="noopener">${escapeHTML(creator)}</a>` : `<div class="creator">${escapeHTML(creator)}</div>`)
      : "";
    const tagChips = (item.tags||[]).slice(0,5).map(t=>`<span class="chip">${escapeHTML(t)}</span>`).join("");
    const verChips = (item.mc||[]).slice(0,4).map(v=>`<span class="chip">${escapeHTML(v)}</span>`).join("");

    const li=document.createElement("li");
    li.className="card";
    li.innerHTML=`
      <div class="row">
        ${avatarHTML}
        <div>
          <h3>${escapeHTML(item.name)}</h3>
          ${creatorLine}
          <div class="meta">
            ${item.kind?`<span class="badge">${escapeHTML(item.kind)}</span>`:""}
            ${item.class?`<span class="badge">${escapeHTML(item.class)}</span>`:""}
            ${item.version?`<span class="badge">${escapeHTML(item.version)}</span>`:""}
            ${item.updated?`<span class="badge" title="Last updated">${escapeHTML(item.updated)}</span>`:""}
          </div>
          <p class="desc">${item.description?escapeHTML(item.description):"<span class='small'>No description</span>"}</p>
          ${tagChips?`<div class="tags">${tagChips}</div>`:""}
          ${verChips?`<div class="versions">${verChips}</div>`:""}
          <div class="links">
            ${item.repo?`<a class="button" href="${item.repo}" target="_blank" rel="noopener">Repo</a>`:""}
            ${item.jar?`<a class="button" href="${item.jar}" target="_blank" rel="noopener">Download JAR</a>`:""}
            ${item.homepage?`<a class="button" href="${item.homepage}" target="_blank" rel="noopener">Homepage</a>`:""}
          </div>
        </div>
      </div>`;
    frag.appendChild(li);
  }
  // keep sentinel at end
  els.results.insertBefore(frag, sentinel);
  pagePointer = end;
};

const render = (items, tokens) => {
  els.results.setAttribute("aria-busy","false");
  els.empty.style.display = items.length ? "none" : "";
  LAST_RESULTS = items;
  clearResults();
  if (!items.length) return;
  // first chunk immediately; defer rest to observer
  requestAnimationFrame(()=> {
    ensureSentinel();
    renderMore();
  });
};

const runSearch = () => {
  const q = (els.search?.value || "").trim();
  const tokens = tokenize(q);
  const type=(els.fType?.value||"").trim();
  const core=(els.fCore?.value||"").trim();
  const mc  =(els.fMc?.value||"").trim();

  setParam("q",q); setParam("type",type); setParam("core",core); setParam("mc",mc);

  const source = INDEXED.length
    ? INDEXED
    : (SUGGEST_SRC.map(s=>({
        item:{ id:s.id,name:s.name,description:"",authors:s.creator?[s.creator]:[],creator:s.creator||"",tags:s.tags||[],mc:s.versions||[],repo:"",homepage:"",jar:"",kind:"",class:"",version:"",updated:"",owner:s.creator||null },
        nameLC:(s.name||"").toLowerCase(),
        hay:[s.name,s.creator,(s.tags||[]).join(" ")].join(" ").toLowerCase()
      })));

  // filter by controls quickly using prebuilt hay
  const filteredIdx = source.filter(({item, hay}) => entryMatchesFilters(item, tokens, type, core, mc, hay));

  // rank only if tokens present
  let rankedItems;
  if (tokens.length) {
    rankedItems = filteredIdx.map(({item}) => {
      const descLC=(item.description||"").toLowerCase();
      const authorsLC=(item.authors||[]).join(" ").toLowerCase();
      const tagsLC=(item.tags||[]).join(" ").toLowerCase();
      const repoLC=(item.repo||"").toLowerCase();
      const creatorLC=(item.creator||"").toLowerCase();
      const s = score(item.name.toLowerCase(), descLC, authorsLC, tagsLC, repoLC, creatorLC, tokens);
      return { item, s };
    }).filter(x=>x.s>0)
      .sort((a,b)=> b.s - a.s || a.item.name.localeCompare(b.item.name))
      .map(x=>x.item);
  } else {
    rankedItems = filteredIdx.map(x=>x.item);
  }

  render(rankedItems.slice(0, 1000), tokens); // hard cap to prevent runaway DOM
};

let SUGGEST_INDEX_ACTIVE = -1;
const buildSuggestions = (q) => {
  const term=(q||"").toLowerCase();
  if (!term || !SUGGEST_SRC.length) {
    els.suggest?.classList.remove("show");
    if (els.suggest) els.suggest.innerHTML="";
    SUGGEST_INDEX_ACTIVE=-1; return;
  }
  const starts=[], contains=[];
  for (const it of SUGGEST_SRC) {
    const n=(it.name||"").toLowerCase();
    const c=(it.creator||"").toLowerCase();
    const tags=(it.tags||[]).join(" ").toLowerCase();
    if (n.startsWith(term)||c.startsWith(term)) starts.push(it);
    else if (n.includes(term)||c.includes(term)||tags.includes(term)) contains.push(it);
  }
  const list=[...starts,...contains].slice(0,8);
  els.suggest.innerHTML = list.map((it,i)=>`
    <li role="option" data-name="${escapeHTML(it.name)}" ${i===0?'class="active"':""}>
      ${escapeHTML(it.name)}${it.creator?` <span class="small">— ${escapeHTML(it.creator)}</span>`:""}
    </li>`).join("");
  SUGGEST_INDEX_ACTIVE=list.length?0:-1;
  els.suggest.classList.toggle("show", list.length>0);
};
const commitSuggestion = (idx) => {
  const items=Array.from(els.suggest.querySelectorAll("li"));
  if (idx<0||idx>=items.length) return;
  els.search.value = items[idx].getAttribute("data-name");
  els.suggest.classList.remove("show");
  runSearch();
};

const init = async () => {
  hydrateControlsFromURL();
  els.results.setAttribute("aria-busy","true");
  await Promise.all([loadVersions(), loadData()]);
  els.results.setAttribute("aria-busy","false");
  buildSuggestions(els.search.value);
  runSearch();
};

const debouncedSearch = debounce(()=>{ buildSuggestions(els.search.value); runSearch(); }, 120);

els.search.addEventListener("input", debouncedSearch, { passive:true });
els.search.addEventListener("keydown", (e)=>{
  const items=Array.from(els.suggest.querySelectorAll("li"));
  if (e.key==="ArrowDown"&&items.length){ e.preventDefault(); SUGGEST_INDEX_ACTIVE=Math.min(items.length-1,SUGGEST_INDEX_ACTIVE+1); items.forEach(li=>li.classList.remove("active")); items[SUGGEST_INDEX_ACTIVE].classList.add("active"); }
  else if (e.key==="ArrowUp"&&items.length){ e.preventDefault(); SUGGEST_INDEX_ACTIVE=Math.max(0,SUGGEST_INDEX_ACTIVE-1); items.forEach(li=>li.classList.remove("active")); items[SUGGEST_INDEX_ACTIVE].classList.add("active"); }
  else if (e.key==="Enter"&&items.length&&els.suggest.classList.contains("show")){ e.preventDefault(); commitSuggestion(SUGGEST_INDEX_ACTIVE<0?0:SUGGEST_INDEX_ACTIVE); }
  else if (e.key==="Escape"){ els.suggest.classList.remove("show"); els.search.select(); }
});
els.suggest.addEventListener("mousedown",(e)=>{ const li=e.target.closest("li"); if(!li) return; const idx=Array.from(els.suggest.children).indexOf(li); commitSuggestion(idx); });
document.addEventListener("click",(e)=>{ if(!e.target.closest(".search-wrap")) els.suggest.classList.remove("show"); }, { passive:true });

["change","input"].forEach(evt=>{
  els.fType?.addEventListener(evt, runSearch, { passive:true });
  els.fCore?.addEventListener(evt, runSearch, { passive:true });
  els.fMc?.addEventListener(evt, runSearch, { passive:true });
});

els.fClear?.addEventListener("click", ()=>{
  if (els.fType) els.fType.value="";
  if (els.fCore) els.fCore.value="";
  if (els.fMc)   els.fMc.value="";
  ["type","core","mc"].forEach(k=>params.delete(k));
  setParam("q", (els.search.value||"").trim());
  runSearch();
});

window.addEventListener("keydown",(e)=>{ if (e.key==="/" && document.activeElement!==els.search){ e.preventDefault(); els.search?.focus(); } });

init();
