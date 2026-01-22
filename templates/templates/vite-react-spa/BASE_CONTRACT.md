# Vite React SPA Base Contract (EXPERIMENTAL)

## Goal
Generate a minimal Vite + React + TypeScript SPA that runs with `npm run dev`.

## Hard Requirements
- MUST include: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`.
- MUST include: `src/main.tsx`, `src/App.tsx`.
- MUST include root div in `index.html` with id="root".
- MUST NOT include Next.js files.
- MUST NOT use external CDNs unless explicitly requested.

## File Size & Writing Rules
- Any single file MUST be <= 32 KB.
- Keep CSS small; prefer component-level CSS.
- If file > 8 KB, use chunking with `append_file`.

## Required Dependencies (minimum)
dependencies:
- react
- react-dom

devDependencies:
- vite
- @vitejs/plugin-react
- typescript
- @types/react
- @types/react-dom

## Required Scripts
- "dev": "vite"
- "build": "vite build"
- "preview": "vite preview --host 0.0.0.0 --port ${PORT:-3000}" (or equivalent that respects PORT)

## Minimal Structure
/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
└── src/
    ├── main.tsx
    └── App.tsx

## Validation Checklist
- `npm install` succeeds.
- `npm run dev` starts.
- Page renders without runtime errors.
