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
