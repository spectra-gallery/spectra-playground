# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [1.0.1] - 2025-09-21
### Fixed
- Prevented raw JS rendering and "Unexpected end of input" error by escaping closing `</script>` tags when embedding the iframe template into the page script. This ensures the outer script block is not prematurely terminated by the HTML parser.
  - Change: Read `views/iframe.html` and replace `</script>` with `<\\/script>` before passing to the EJS view.
  - File: `server.js`

### Verification
- Restart server and load the playground.
- Confirm no syntax error in console; iframe preview renders.
- Test "Generate Hash" and "Save" flows.

## [1.0.0] - 2024-09-14
### Added
- Initial release of Spectra Playground server with Express, EJS views, autosave endpoint, and lab service forwarding.

[1.0.1]: https://example.com/compare/v1.0.0...v1.0.1
[1.1.0] - 2025-09-22
### Added
- Docker deployment: Dockerfile, docker-compose.yml, .env.example, DEPLOY.md.
- Licensor UI with full license stack (software/hardware/data/art) and yugen-style licensed download.
- JWT auth, user layout persistence; per-sketch layout persistence and APIs.
- Playground free layout: drag/scale/close toolboxes, grid overlay, snap lines, server sync.
- Popout editors with two-way postMessage sync; external live preview.
- Seed + traits injection in preview and gallery; traits toolbox.
- Art Book: filters, tag cloud, inline edits, append-only infinite scroll; per-card palettes and Itten contrasts via k-means.
- Automatic palette-derived tags (e.g., warm-cool, high-saturation) surfaced into sketch tags.

### Changed
- Playground and gallery upgraded to Bootstrap UI and dark theme.
- Safer template embedding using JSON.stringify; fix for Unexpected end of input.

### Security
- Passwords hashed with scrypt; JWT secret configurable via env.
## [1.1.1] - 2025-09-22
### Added
- Server-side palette-derived tags blended into sketch tags during autosave (from CSS/HTML colors).
- Art Book: "Suggest tags" action per card, using k-means palette analysis; persists for owners.
 - Metrics dashboard `/metrics/:id` with FPS, frames, DOM size, code sizes, SHA-256, regex rule checks, and palette display.
 - Proxy endpoint `/proxy` for proxied API requests from sketches; default rules file at `/rules.json`.
