# Next.js Fullstack Base Contract (EXPERIMENTAL)

## Goal
Generate a minimal but valid Next.js App Router project that runs with `npm run dev`.

## Hard Requirements
- MUST use App Router (`app/` directory).
- MUST include: `package.json`, `next.config.js`, `tsconfig.json`.
- MUST include: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`.
- MUST NOT include a `pages/` directory.
- MUST NOT use external CDNs unless explicitly requested.
- MUST listen on `process.env.PORT` when running in production mode (`next start` will do this automatically).

## File Size & Writing Rules (Reliability)
- Any single file MUST be <= 32 KB.
- Prefer multiple small files over one huge file.
- If a file might exceed 8 KB:
  - Write the first chunk with `write_file`.
  - Append the rest with `append_file` in <= 8 KB chunks.
- Avoid giant CSS frameworks or huge inline JSON blobs.

## Required Scripts
`package.json` scripts MUST include:
- "dev": "next dev"
- "build": "next build"
- "start": "next start"

## Minimal Structure
/
├── package.json
├── next.config.js
├── tsconfig.json
└── app/
    ├── layout.tsx
    ├── page.tsx
    └── globals.css

## Validation Checklist
- `npm install` succeeds.
- `npm run dev` starts without error.
- Home page renders at `/`.
