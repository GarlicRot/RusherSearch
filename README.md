# RusherSearch — RusherHack Plugin/Theme Search (Static Site)

[![pages-build-deployment](https://github.com/GarlicRot/RusherSearch/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/GarlicRot/RusherSearch/actions/workflows/pages/pages-build-deployment)
[![Site health](https://github.com/GarlicRot/RusherSearch/actions/workflows/site-health.yml/badge.svg)](https://github.com/GarlicRot/RusherSearch/actions/workflows/site-health.yml)

**RusherSearch** is a tiny, fast, _100% static_ site that demonstrates what you can build on top of the public **RusherHack Plugins/Themes API**. It provides instant search with suggestions, filter chips, creator avatars, and one-click links to repos, downloads, and homepages — all done with vanilla HTML/CSS/JS (no bundlers).

**Live demo:** https://garlicrot.github.io/RusherSearch

---

## Features

- **Instant search** with fuzzy-ish ranking and highlight marks  
- **Type/Class/MC version filters** (URL-shareable)  
- **Smart suggestions** (top-weighted matches; keyboard navigable)  
- **Virtualized results** for smooth scrolling on low-end devices  
- **Creator avatars** (with graceful fallbacks)  
- **Zero build step** — just static files on GitHub Pages  
- **Respectful performance** — caching, `content-visibility`, preconnects

---

## API

RusherSearch reads **public static JSON**:

- `search-index.json` — small index for fast suggestions  
- `index.json` — full entries for result cards  
- `versions.json` — list used to populate the MC version datalist

**API root:**  
`https://rusherdevelopment.github.io/rusherhack-plugins/api/v1/`

> The API is static and updates when the source repo updates.

---

## URL Parameters

Share searches/filters by URL:

- `q` – query text  
- `type` – `plugin` | `theme`  
- `core` – `regular` | `core`  
- `mc` – MC version or family (e.g. `1.21.4` or `1.21.x`)

**Examples:**

```
?q=HUD&type=plugin
?q=nightvision&core=regular
?q=elytra&mc=1.21.x
```

---

## Project Structure

```
/
├─ index.html     # Page & meta
├─ style.css      # Styles, focus states, content-visibility
└─ script.js      # Fetches API, builds index, search & filters
```

---

## Lighthouse Notes

- **Perf:** preconnect to API/avatar/raw GH domains, use `content-visibility:auto` on cards, lazy decode images, and cache JSON in `localStorage`.
- **Accessibility:** labeled controls, keyboardable suggestions, visible focus, reduced-motion friendly.
- **Best Practices/SEO:** canonical URL, `rel="noopener noreferrer"`, `theme-color`, `color-scheme`, descriptive meta.

If you’re cloning this elsewhere, keep those hints in `index.html` — they’re where most of the green bars come from.

---

## Contributing

Issues and PRs are welcome.

- Keep it **framework-free** (vanilla JS).
- Aim for **<1s TTI** on mid-range mobile (throttle and test).
- Maintain **keyboard nav** and **focus** visible at all times.
- If adding dependencies, justify the perf/UX tradeoff in the PR.
