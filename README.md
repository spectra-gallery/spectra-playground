# Spectra Playground Server

Express + EJS playground to sketch HTML/CSS/JS, preview live, and persist to MongoDB. Includes a Bootstrap Art Book gallery, licensing tools, JWT auth, and deployment with Docker.

## Quick Start

Development
- `npm install`
- `node server.js` (http://localhost:6002)

Docker
- Copy `.env.example` → `.env` and set `JWT_SECRET`.
- `docker compose up --build -d`
- See `DEPLOY.md` for details.

## Features

- Three Ace editors (HTML/JS/CSS) with live preview and external preview window
- Seed and Traits toolboxes; deterministically reproduce renders
- Free Layout: draggable/scale/close toolboxes with grid and magnetic snap lines
- Layout persistence per-user and per-sketch
- Popout editors with two-way postMessage sync
- Auth: register/login with scrypt-hashed passwords and JWT
- Licensor: full license stack (software/hardware/data/art) + yugen-style licensed HTML export
- Art Book: filter/sort, “My Sketches”, tag cloud, inline edits, append-only infinite scroll
- Palette analysis: k-means palettes + Itten contrasts; automatic palette-derived tags surfaced to the sketch
  - Client-side: from preview (canvas sampling + k-means)
  - Server-side: from CSS/HTML during autosave to keep tags in sync
- Metrics dashboard: `/metrics/:id` shows FPS, frames, DOM size, code sizes, SHA-256 digest, palette metrics, and applies regex-based error rules (loaded from `/rules.json`)
- Proxy endpoint: `/proxy?url=` allows same-origin fetch to external APIs for sketches (use responsibly)
  - Whitelist domains via `PROXY_WHITELIST` (comma-separated). Optional CORS via `PROXY_CORS_ORIGINS`.

## API (selected)

- `POST /autosave` — Save/update sketch: `{ id?, title?, html, css, javascript, hash?, seed?, tags?, attrs? }`
- `GET /sketch/:id` — Fetch a sketch JSON
- `GET /sketch/:id/download?format=yugen` — Licensed, seeded HTML
- `GET/POST /user/layout` — Persist per-user layout
- `GET/POST /sketch/:id/layout` — Persist per-sketch layout (owner only for write)
- `POST /sketch/:id/tags` — Update tags (owner)
- `POST /sketch/:id/attrs` — Update attributes (owner)
- `GET /api/sketches` — List sketches (supports `q, tag, sort, mine, skip, limit`)
- `GET /api/tags` — Tag counts (supports `mine`)
- `GET /metrics/:id` — Metrics and quality checks for a sketch
- `ALL /proxy?url=` — Proxy external requests for sketches (GET/POST)
  - Env: `PROXY_WHITELIST=api.example.com,another.com`; `PROXY_CORS_ORIGINS=*`

## Hotkeys

- Ctrl+S Save, Ctrl+P Preview, Ctrl+D Download, F Free Layout, Alt+R Reset Layout, T Toolboxes, G Grid, L Snap Lines, O Open Preview, 1/2/3 Popouts, Alt+1/2/3 Focus editors, ? Help

## License Tooling

- `/licensor/:id` — Set license stack, namespace, authority, properties; download yugen-style export
- `/licensor-tools/` — Static licensor toolkit (from `spectra-licensor/`)

## Security

- Use a strong `JWT_SECRET` in production; consider private networking for Mongo and a reverse proxy for TLS.
