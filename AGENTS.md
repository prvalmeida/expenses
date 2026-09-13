# AGENTS.md

Minimal working agreement for agents in this repository. Deep architectural detail and the
reasoning behind every load-bearing rule live in `CLAUDE.md` — read the sections relevant to
what you are touching before changing code.

## What this project is

Next.js 16 (App Router) personal finance tracker, MongoDB via Mongoose, TypeScript strict,
Zod 4 at the API boundary. The UI is entirely in Brazilian Portuguese; code, comments and
internal docs are in English. Deployed as a Docker image (`ghcr.io/prvalmeida/expenses`) to
Easypanel on a single VPS.

## Commands

```bash
npm run dev                 # dev server on http://localhost:3000
npm run build               # production build (catches type errors lint does not)
npm run lint                # ESLint (CI runs `npx eslint --max-warnings=0`)
npm run test:unit           # node:test unit tests, no DB, seconds
npm run gen:openapi -- --check   # fail if public/openapi.yaml is stale (CI does this)
npm run gen:openapi         # regenerate public/openapi.yaml from the Zod schemas
npm run test:api            # Bruno API collection against localhost:3000 — WRITES to the DB it targets
npm run migrate             # apply pending data migrations (-- --dry-run / -- --status)
```

The CI `lint` job runs three steps — `npx eslint --max-warnings=0`,
`npm run gen:openapi -- --check`, `npm run test:unit` — and `build` runs `npm run build` in
parallel. Reproduce all four locally; never report a change as done without running them and
reporting the real output.

## Layout

| Path | What lives there |
|---|---|
| `app/` | pages and API routes; `app/page.tsx` is a state-driven single-page shell (no router) |
| `app/api/*` | internal, unauthenticated API — what the UI calls |
| `app/api/v1/*` | public, `API_KEY`-authenticated API for external callers |
| `lib/api/` | boundary: `respond.ts`, `auth.ts`, `validate.ts`, `schemas/` (Zod) |
| `lib/services/` | pipelines shared by both API surfaces; the only place business logic lives |
| `lib/models/` | Mongoose schemas |
| `lib/utils/` | pure helpers, each a single source of truth (`cycleUtils`, `categoryUtils`, `pluggyUtils`, `billUtils`, `receiptUtils`) |
| `lib/migrations/` | append-only, ordered data migrations |
| `components/`, `hooks/` | shared React components and hooks |
| `scripts/` | tsx CLI helpers (openapi generation, migrations, Telegram bridge, Pluggy sync) |
| `tests/` | `node:test` unit tests |
| `bruno/` | API test collection |
| `docs/` | `API.md`, `telegram-hermes-bridge.md`, `plans/` |

## Hard rules

1. **Categories are data, not code.** The `Category` collection is the single source of
   truth, read through `lib/utils/categoryUtils.ts` (server) and `hooks/useCategories.ts`
   (client). The `ExpenseSubtypes` / `IncomeTypes` constants in `types/index.ts` exist
   **only** as seed data. Never put categories in a `z.enum`.
2. **Boundary order in `/api/v1/*` is auth → Zod → category validation → service.** A
   service never inspects payload shape and never imports `next/server`; it throws
   `ApiError`.
3. **Client code never calls `/api/v1/*`** — that would ship `API_KEY` to the browser. Share
   the service instead.
4. **Read secrets inside the function that needs them, never at module scope.** CI
   `lint`/`build` run with no secrets on purpose; an unset `API_KEY` fails closed.
5. **Never hand-edit `public/openapi.yaml`.** It is generated; a stale spec fails CI.
6. **Never duplicate a single source of truth** — `computeEffectiveDate`,
   `buildExpenseDocuments`, `categoryUtils`, `pluggyUtils`, `receiptService`,
   `scripts/lib/cliEnv.ts`.
7. **Migrations are append-only history.** Never edit, rename or reorder one that has run;
   corrections are new migrations. Production applies them via
   `POST /api/admin/migrations`, never a script in the image.
8. **`$unset` to clear a Mongoose field.** Assigning `undefined` is dropped from the update.
9. **New logic and every bug fix get a unit test** in `tests/`, following the existing
   patterns.
10. **Releases are tagged on `main` only** (`vX.Y.Z`); CI's `verify-tag` rejects anything else.
11. **`npm run test:api` writes to whatever database it targets.** Check `bruno/.env` before
    running it; all records it creates are prefixed `BRUNO_TEST_*`.

## Environment

`.env.local` is required for local work. See `.env.example` for the full list —
`MONGODB_URI`, `OPENAI_API_KEY`, `PDF_KEY`, `API_KEY`, and the `PLUGGY_*` variables.
Secrets are never baked into the Docker image; they are injected at runtime.

## Skills

Task-specific instructions live in `.claude/skills/` and are loaded on demand:

| Skill | Load it when |
|---|---|
| `implementing-features` | writing, changing or fixing application code |
| `reviewing-code` | reviewing a diff, branch or PR |
| `planning-features` | producing an implementation plan, no code |
| `writing-documentation` | writing or correcting docs, including `CLAUDE.md` |
| `researching-tech-stack` | evaluating a library or architectural tradeoff |

## Ground rules for agents

- Read the files you will change, in full, before changing them.
- Smallest correct diff; prefer editing an existing file over creating a new one.
- Do not commit, push or tag unless asked.
- When you learn a new invariant or failure mode, record it in `CLAUDE.md` in the same change.
