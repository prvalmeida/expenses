# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start development server (http://localhost:3000)
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

### Docker

```bash
docker compose --profile dev up --build    # Development with hot-reload (app)
docker compose --profile prod up --build   # Production standalone build (web)
```

The `app` (dev) and `web` (prod) services are in mutually exclusive Compose profiles (`dev`/`prod`) since both publish host port 3000 — run one at a time. A bare `docker compose up` starts only `mongodb`. Tear down with `docker compose down --remove-orphans` (a bare `down` leaves the profiled container up and fails network removal with "has active endpoints").

The Dockerfile has three stages: `deps` (locked `npm ci`, **no** `NODE_ENV` — npm derives `omit=dev` from `NODE_ENV=production` and would drop tailwind/typescript, breaking `next build`), `dev` (hot-reload target, no production build), and `builder` → `runner`. Set `NODE_ENV=production` only in `runner`.

Compose env precedence matters here: `environment` outranks `env_file`, so `MONGODB_URI` is deliberately absent from `web.environment` and comes from `.env.local`. Conversely, `${MONGO_USER}` / `${MONGO_PASSWORD}` interpolation is resolved from the host env or a root `.env` — Compose never reads `.env.local` for interpolation, so those two must not live there.

The production `runner` image uses Next.js **standalone output** (`output: 'standalone'` in `next.config.ts`): it copies only `.next/standalone`, `.next/static`, and `public`, runs as a non-root user, binds `0.0.0.0:$PORT`, and starts via `node server.js`. Secrets are **never baked into the image** — `MONGODB_URI`, `OPENAI_API_KEY`, and `PDF_KEY` are injected at runtime (compose `env_file`, or the cloud platform's secret manager). Packages in `serverExternalPackages` (`pdf-parse`, `pdfjs-dist`) are copied to `.next/standalone/node_modules`; all other deps (e.g. `openai`) are bundled into the compiled server chunks.

**`@napi-rs/canvas` must be copied into the `runner` image by hand.** `pdfjs-dist` runs `const SCALE_MATRIX = new DOMMatrix()` at module scope and takes `DOMMatrix`/`ImageData`/`Path2D` from that optional package; its `node_utils.js` loads it via a runtime `createRequire` inside a `try/catch`, which Next's output tracing cannot follow, so it never lands in `.next/standalone`. Without it the process still boots (with `Cannot polyfill DOMMatrix` warnings) but **every bill upload fails** with `Failed to load external module .../pdf.mjs: ReferenceError: DOMMatrix is not defined`. Only the newer of the two installed copies is shipped, placed at the hoisted `node_modules/@napi-rs` where upward resolution reaches it from both `pdfjs-dist` and `pdf-parse`'s nested `pdfjs-dist` (~64 MB). Do not "fix" the warnings by deleting the COPY. See `README_DOCKER.md` and `.env.example`.

**`pdf.worker.mjs` must be copied too.** In Node, `pdf.mjs` has no real worker, so it sets one up by importing `./pdf.worker.mjs` at runtime — again a path tracing cannot follow, so standalone ships `pdf.mjs` alone and uploads fail with `Setting up fake worker failed: "Cannot find module '/app/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'"`. The Dockerfile copies that single file next to `pdf.mjs` (`standard_fonts/` *is* traced, so it needs no COPY). Loading a standard-font PDF still logs `Unable to load font data at file:///...LiberationSans-Regular.ttf` — Node's `fetch` rejects `file://` URLs — which is cosmetic here: text and glyph geometry come from the content stream, not the font file.

### CI/CD

`.github/workflows/ci.yml` runs on every push, any branch. There is deliberately **no** `pull_request` trigger — it would double every run for branches with an open PR (a concurrency group cannot dedupe them: the two events produce different `github.ref` values, `refs/heads/<branch>` vs `refs/pull/N/merge`). The cost is that fork branches go unchecked. Job graph:

```
lint ∥ build ∥ verify-tag → docker → release
```

`lint` and `build` are separate parallel jobs (no `needs`) so a lint error and a type error surface in the same run. Neither receives secrets: `MONGODB_URI` and `OPENAI_API_KEY` are read inside `connectToDatabase()` / `getOpenAI()`, never at module load, so `next build` needs no env. Do not add placeholders — they would mask a regression where something *does* connect at build time.

The last three jobs are tag-only (`refs/tags/v*`). **Releases must be tagged on `main`**: Actions has no native "tag on branch X" filter, so `verify-tag` checks out with `fetch-depth: 0` (a shallow checkout makes the check silently unreliable) and fails if the tagged commit is not an ancestor of `origin/main`.

Images publish to **`ghcr.io/prvalmeida/expenses`** authenticated with the built-in `GITHUB_TOKEN` — no registry secrets. A `vX.Y.Z` tag yields `X.Y.Z`, `X.Y`, `X`, and `sha-<short>`; `latest` moves only when the tag has no hyphen, so prereleases (`v2.0.0-rc.1`) never claim it. The build sets **no** `target` — the Dockerfile's final stage is `runner`, and naming a target would ship the hot-reload `dev` stage. `release` gates on `docker` so no release ever points at a version with no image.

All third-party actions are pinned to full commit SHAs: the `docker` and `release` jobs hold `packages: write` / `contents: write`, and a mutable tag there is a supply-chain hole.

## Environment

Requires a `.env.local` file with:
```
MONGODB_URI=<your MongoDB connection string>
OPENAI_API_KEY=<OpenAI API key — required for receipt parsing>
PDF_KEY=<CPF do titular, somente números>
```

## Architecture

This is a **Next.js 16 App Router** personal finance tracker backed by **MongoDB via Mongoose**. The UI is entirely in Portuguese (Brazilian).

### Key concepts

**Two date fields per expense:**
- `date` — the purchase date (when you decided to spend)
- `effectiveDate` — the cash-flow date (when money leaves your account, e.g. credit card due date)

The Dashboard lets users toggle between "DATA DA COMPRA" (purchase view) and "FLUXO DE CAIXA" (cash flow view), filtering on `date` vs `effectiveDate` respectively.

**Installment grouping:** Credit card purchases split into installments share a `transactionId`. Deleting with `?all=true` removes all installments with the same `transactionId`; omitting it deletes only the single record.

**Editing expenses:** The edit flow (`EditExpenseModal`) operates on a single record regardless of whether it is part of an installment group. The PUT endpoint accepts only the eight whitelisted fields listed above — `transactionId`, `installment`, and `totalInstallments` are never overwritten by an edit. When `paymentType` is changed from `credit` to any other type, the API explicitly `$unset`s `cardBrand`, `installment`, and `totalInstallments` to keep the record consistent with the `OtherExpense` type.

**`effectiveDate` computation:** The shared helper `computeEffectiveDate(purchaseDate, cardBrand, paymentType)` in `lib/utils/cycleUtils.ts` is the single source of truth for this logic. Both the expense PUT route and the card-cycle POST route call it — never duplicate this logic inline.

**Card cycle recalculation:** When a card's closing or due date is updated via `POST /api/card-cycles`, the API automatically recalculates `effectiveDate` for all affected credit expenses of that card in the relevant two-month window and bulk-updates them. The response returns `{ config, updatedExpenses: N }`.

**Receipt import (NF-e):** The `importReceipt` view lets users import a grocery receipt as individual expenses. Parsing uses OpenAI GPT-4o-mini (`lib/openai.ts`). After parsing, the app cross-references product descriptions against the `ProductMapping` collection to auto-classify subtypes; confirmed new classifications are saved back as new mappings. All imported items are hard-coded to `type: 'supermercado'`.

**Bill import (fatura PDF):** `app/api/bills/parse` extracts text with `pdfjs-dist` (`reconstructPageText` rebuilds lines from glyph geometry), then `lib/utils/billUtils.ts` turns it into transactions. Santander and Caixa (Visa/Elo) have deterministic parsers — a per-bank line-by-line state machine (cardholder → subsection) plus row regexes; any other card falls back to GPT extraction (`parseBillTextLegacy`), as does a deterministic parser that returns 0 transactions. GPT is used only to *classify* deterministically-extracted rows, never to extract them.

**Bill row parsing — whitespace is not structure:** Row regexes must anchor on the leading `DD/MM` date and the trailing amount (`1.234,56` for Santander, `1.234,56D` for Caixa), with `\s+` between fields. Never split rows on `\s{2,}` or rely on column counts: the same statement renders with multi-space column gaps or single spaces depending on the PDF, and the single-space rendering silently yielded 0 transactions. Interior tokens (Caixa `NN DE NN`, Santander `NN/NN` installments) are located by searching the segment between the anchors. Descriptions go through `normalizeDescription` so `BillMapping` keys stay stable across both renderings; for Caixa `COMPRAS` rows the merchant/city boundary is unrecoverable, so the city stays part of the description.

All amounts match the single shared `BRL_AMOUNT` pattern (`1.234,56`) — never widen it to something like `[\d.,]+`, since `parseBRLAmount` strips every dot and would read a dot-decimal `12.00` as **1200**.

**Caixa installment tokens are guessed, so they are validated:** because the city stays in the description, a free `NN DE NN` search can hit a merchant or address (`POSTO 24 DE 05 CANOAS`) and fabricate an installment — and `/api/bills/import` expands `installmentTotal` into that many expense rows. `isPlausibleInstallment` therefore requires `total > 1 && 1 <= current <= total`, and `COMPRAS_PARCELADAS` prefers the end-anchored `C_INSTALL_TAIL` before falling back to the free search.

**`BillMapping` keys go through `billMappingKey()`** (`normalizeDescription` + lowercase), on both the lookup and the upsert side. Keying on `.toLowerCase().trim()` alone breaks against mappings learned before descriptions were whitespace-normalized. `POST /api/admin/normalize-bill-mappings` is the one-off migration that collapses pre-existing keys; `description` is uniquely indexed, so it resolves collisions by keeping the newest doc and reporting what it discarded.

**Dashboard table:** Supports column sorting (date/name/type/value, click headers to toggle asc/desc) and category filtering via a dropdown above the table. Both are purely client-side — no extra API calls.

**Dynamic categories (DB-driven):** Expense/income categories and expense subtypes live in the `Category` collection (`{ kind: 'expense' | 'income', name, subtypes[], order? }`, unique on `(kind, name)`), NOT in `types/index.ts`. `lib/utils/categoryUtils.ts` is the server-side single source of truth (fetch with a short per-request cache, validate `(type, subtype)` pairs, count associated data, and run rename/reassign cascades). Client code reads categories through the `hooks/useCategories.ts` hook (shared module-level cache + `refetch`). The `ExpenseSubtypes`/`IncomeTypes` constants in `types/index.ts` are retained ONLY as seed data for `POST /api/categories/seed`; do not consume them elsewhere. All `type`/`subtype` fields are plain `string`, validated at API boundaries.

**Category cascade & delete-guard:** Renaming a type/subtype cascades via `updateMany` to `Expense` (+ `Income` for income kind), `ProductMapping`, `BillMapping`, and `Store.defaultType` (subtype renames are scoped to their parent type) — subtypes travel with the renamed category, so no orphaning occurs. Renaming a subtype rejects with 409 if the target name already exists on the category. Deleting a category/subtype that still has associated records returns HTTP 409 `{ hasAssociated: true, count }` (no delete). The UI (`CategoryConfig`) then offers two distinct paths: reassign (`?reassignTo=`) or force (`?force=true`, deletes and leaves records orphaned). Reassigning a **type** merges into a *different* target via `cascadeReassignExpenseType`, which also `$unset`s any subtype not present on the target (a plain rename cannot orphan subtypes, but a merge can) — never use `cascadeRenameExpenseType` for the merge path.

**Orphan detection:** There is NO schema flag for orphans. The Dashboard and DashboardDetails compare each expense's `type`/`subtype` against the live category list (`useCategories`) at read time and render a ⚠ marker when the category/subtype no longer exists; `ExpenseTypeSelect` (used by both add and edit flows) shows an inline warning and forces re-selection when the current value is invalid.

**Category validation at import boundaries:** Besides the expense/income POST/PUT routes, the bulk import routes validate against `Category` too: `/api/receipts/import` rejects the whole batch (400) if any item/mapping has an invalid `(type, subtype)` pair; `/api/bills/import` skips items whose type no longer exists and drops subtypes not valid for the type (the schema no longer enum-validates, so this is the only guard).

### Directory structure

- `app/` — Next.js App Router pages and API routes; all UI pages are co-located here as `.tsx` files
- `app/api/expenses/` — GET all, POST, DELETE by query param `?id=`
- `app/api/expenses/[id]/` — GET by id, PUT (whitelisted fields only: `name`, `value`, `type`, `subtype`, `paymentType`, `cardBrand`, `date`, `effectiveDate`), DELETE (with optional `?all=true` for installments)
- `app/api/income/` — GET all, POST; `app/api/income/[id]/` — DELETE
- `app/api/card-cycles/` — GET/POST card billing cycle config; POST also recalculates affected expenses
- `app/api/receipts/parse/` — POST: accepts a PDF file, extracts text via `pdf-parse`, parses with GPT
- `app/api/receipts/parse-url/` — POST: accepts a SEFAZ NFC-e URL (*.gov.br only), fetches HTML, parses with GPT
- `app/api/receipts/import/` — POST: saves confirmed receipt items as expenses; upserts new `ProductMapping` entries
- `app/api/admin/sync-indexes/` — POST: calls `syncIndexes()` on `Store`, `ProductMapping`, and `Category` models
- `app/api/categories/` — GET (list, filter by `?kind=`), POST (create type, or add subtype via `{ subtype }`), PUT (`action: 'renameType' | 'renameSubtype' | 'reorder'`), DELETE (guarded; `?reassignTo=` or `?force=true`)
- `app/api/categories/seed/` — POST: forced reseed; thin wrapper over `seedCategories()` in `categoryUtils.ts`
- `instrumentation.ts` — Next.js boot hook (`register()`); in the Node runtime it auto-runs `seedCategories()` **only when the `Category` collection is empty** (first-run seeding). Guarded by an empty-count check so cloud instances don't re-seed on every cold start; wrapped in try/catch so a DB hiccup never crashes boot. Forced reseed still goes through the POST route.
- `lib/mongodb.ts` — Mongoose connection with global cache (Next.js hot-reload safe)
- `lib/openai.ts` — OpenAI client singleton (same global-cache pattern as `lib/mongodb.ts`)
- `lib/models/` — Mongoose schemas: `Expense`, `Income`, `CardCycle`, `Store`, `ProductMapping`, `BillMapping`, `Category`
- `lib/utils/cycleUtils.ts` — `getCycle`, `computeEffectiveDate`, `DEFAULT_SETTINGS` (single source of truth — do not duplicate)
- `lib/utils/categoryUtils.ts` — category fetch/cache, `validateExpensePair`, `validateIncomeType`, `count*` and `cascadeRename*` helpers (single source of truth — do not duplicate)
- `lib/utils/receiptUtils.ts` — `interpretAndCrossReference`: calls GPT, upserts `Store`, cross-references `ProductMapping`; supermercado subtypes come from `Category` via `categoryUtils`
- `hooks/useCategories.ts` — client hook exposing `expenseTypes`, `incomeTypes`, `subtypesFor`, `isValidType`, `isValidPair`, `refetch`
- `components/` — Shared React components (`ExpenseCharts`, `ExpenseTypeSelect`, `EditExpenseModal`)
- `types/index.ts` — All shared TypeScript types; `ExpenseSubtypes`/`IncomeTypes` remain ONLY as seed data for the seed route (not the runtime source of truth), plus `CardBrand` enum and parsed/confirmed item types

### Data model highlights

- The `Category` collection is the single source of truth for expense/income categories and expense subtypes. Model schemas no longer enum-validate `type`/`subtype`; validation happens at API boundaries via `categoryUtils`. `Category` docs must be seeded before the UI can read categories; this now happens automatically on first server boot via `instrumentation.ts` (empty-collection guard), with `POST /api/categories/seed` available for a forced reseed. Shared logic lives in `seedCategories()` in `categoryUtils.ts` — the only sanctioned consumer of the `ExpenseSubtypes`/`IncomeTypes` seed constants.
- `CardBrand` enum values (`Master Santander`, `Visa Caixa`, `Elo Caixa`) are used as keys in the card-cycles default settings.
- `CardCycle` stores per-card, per-month closing/due date overrides; the API falls back to `DEFAULT_SETTINGS` from `cycleUtils.ts` when no override exists.
- `Store` stores `{ cnpj, address, name }` — upserted on every receipt parse, keyed by `(cnpj, address)`.
- `ProductMapping` stores learned `{ cnpj, address, description, type, subtype }` — keyed by `(cnpj, address, description)`. Used to auto-classify items on future imports of the same store.

### Navigation

`app/page.tsx` is a single-page shell that renders one view based on `currentView` state: `dashboard`, `dashboardDetails`, `addExpense`, `addIncome`, `cardConfig`, `categoryConfig`, `importReceipt`, or `importBill`. There is no client-side router — view switching is purely state-driven.
