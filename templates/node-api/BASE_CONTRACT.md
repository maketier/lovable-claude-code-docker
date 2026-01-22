# Node.js API Base Contract (EXPERIMENTAL)

## Goal
Generate a minimal Express API server suitable for container preview and basic production deployment.

## Hard Requirements
- MUST include `package.json`.
- MUST listen on `process.env.PORT || 3000`.
- MUST expose `GET /health` returning JSON: `{ "status": "ok" }`.
- SHOULD expose `GET /` returning a short JSON message (to avoid "Cannot GET /" confusion).
- MUST log a single line on startup: `Listening on <port>` (for debugging).
- MUST NOT require a database.
- MUST NOT use TypeScript unless explicitly requested.

## File Size & Writing Rules
- Any single file MUST be <= 32 KB.
- Prefer small files; keep `index.js` or `server.js` <= 8 KB if possible.
- Avoid huge dependencies.

## Minimal Structure
/
├── package.json
└── server.js

(Optionally `/routes` if needed, but keep it small.)

## Required Scripts
`package.json` scripts MUST include:
- "start": "node server.js"

Optional:
- "dev": "nodemon server.js" (only if nodemon is included)

## Validation Checklist
- `npm install` succeeds.
- `npm start` starts server.
- `GET /health` returns `{ "status": "ok" }`.
- `GET /` returns a non-error response (JSON or simple text).
