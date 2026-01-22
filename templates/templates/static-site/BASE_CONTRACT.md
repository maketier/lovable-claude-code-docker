# Static Site Base Contract (STABLE)

## Goal
Generate a static HTML website that can be served by a plain static server (no build step).

## Hard Requirements
- MUST include `index.html` at repository root.
- MAY include `styles.css` and `script.js` at root.
- MUST NOT include `package.json`.
- All assets MUST use relative paths.
- MUST NOT use external CDN dependencies unless explicitly requested.
- MUST be valid HTML5.

## File Size & Writing Rules
- Any single file MUST be <= 32 KB.
- If CSS would be large, keep it simple; prefer minimal styles.
- If needed, split CSS into multiple files in `/assets/css/` (still no build step).

## Minimal Structure
/
├── index.html
├── styles.css (optional)
├── script.js (optional)
└── assets/ (optional)

## Validation Checklist
- Opening `index.html` works without build.
- No missing referenced files.
