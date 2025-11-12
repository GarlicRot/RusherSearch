# RusherSearch – RusherHack Plugin/Theme Search (Static Site)

[![pages-build-deployment](https://github.com/GarlicRot/RusherSearch/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/GarlicRot/RusherSearch/actions/workflows/pages/pages-build-deployment) [![Site health](https://github.com/GarlicRot/RusherSearch/actions/workflows/site-health.yml/badge.svg)](https://github.com/GarlicRot/RusherSearch/actions/workflows/site-health.yml)

A tiny, fast, **static** site that showcases what you can build on top of the
[RusherHacks Plugin/Theme API](https://rusherdevelopment.github.io/rusherhack-plugins/api/v1/).
It provides instant search with suggestions, rich result cards, creator avatars,
and links to repos / downloads - all with plain HTML/CSS/JS (no build step).

**Live demo:** https://garlicrot.github.io/RusherSearch

---

## API Endpoints Used

This site reads only public, static JSON from the API:

- `search-index.json` — lightweight list used for fast suggestions  
- `index.json` — full entries used for rich result cards

API root: `https://rusherdevelopment.github.io/rusherhack-plugins/api/v1/`

> The API is static. It updates whenever the source repo is updated.
