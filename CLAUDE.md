# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start development server (http://localhost:3000)
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
npm run gen:openapi        # Regenerate public/openapi.yaml from the Zod schemas
npm run test:api           # Run the Bruno API collection against localhost:3000
npm run test:api:external  # Only the requests tagged `external` (real fixtures + OpenAI)
npm run migrate:payment-types -- --dry-run  # One-off paymentType data migration (see scripts/)
```

`test:api` writes to whatever database the server it targets is using — see the `bruno/` notes below before pointing it at anything real.

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
api-test (workflow_dispatch / tags only, no needs)
```

`lint` and `build` are separate parallel jobs (no `needs`) so a lint error and a type error surface in the same run. `lint` also runs `npm run gen:openapi -- --check`: the generator's premise is that a stale spec is a diff rather than a code-review catch, which only holds if something enforces it. Neither receives secrets: `MONGODB_URI` and `OPENAI_API_KEY` are read inside `connectToDatabase()` / `getOpenAI()`, never at module load, so `next build` needs no env. Do not add placeholders — they would mask a regression where something *does* connect at build time.

The last three jobs are tag-only (`refs/tags/v*`). **Releases must be tagged on `main`**: Actions has no native "tag on branch X" filter, so `verify-tag` checks out with `fetch-depth: 0` (a shallow checkout makes the check silently unreliable) and fails if the tagged commit is not an ancestor of `origin/main`.

`api-test` stands apart from that graph on purpose. It starts the compose `prod` profile, seeds categories and runs the Bruno collection, so it needs `MONGODB_URI` and `API_KEY` — which is exactly why it cannot inherit `lint`/`build`'s triggers, and why it generates a throwaway key against the bundled `mongodb` container instead of taking real secrets. Gating `release` on it would make every release depend on a live database being reachable from the runner.

Images publish to **`ghcr.io/prvalmeida/expenses`** authenticated with the built-in `GITHUB_TOKEN` — no registry secrets. A `vX.Y.Z` tag yields `X.Y.Z`, `X.Y`, `X`, and `sha-<short>`; `latest` moves only when the tag has no hyphen, so prereleases (`v2.0.0-rc.1`) never claim it. The build sets **no** `target` — the Dockerfile's final stage is `runner`, and naming a target would ship the hot-reload `dev` stage. `release` gates on `docker` so no release ever points at a version with no image.

All third-party actions are pinned to full commit SHAs: the `docker` and `release` jobs hold `packages: write` / `contents: write`, and a mutable tag there is a supply-chain hole.

## Environment

Requires a `.env.local` file with:
```
MONGODB_URI=<your MongoDB connection string>
OPENAI_API_KEY=<OpenAI API key — required for receipt parsing>
PDF_KEY=<CPF do titular, somente números>
API_KEY=<static credential for the public API; unset means every /api/v1 route returns 401>
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

**Category cache revalidation:** `useCategories` keeps a module-level cache shared by all mounted consumers, so a category created in `CategoryConfig` is only seen elsewhere after a reload. Because `app/page.tsx` unmounts the current view when switching screens, a user with unsaved work (the bill-review table) has to create the category in a **second tab/window** — where no in-page `refetch` can fire. The hook therefore revalidates on `window` `focus` and on `visibilitychange` (when visible), broadcasting to every listener, so returning to the tab refreshes the selects in place.

Three entry points with deliberately different guarantees — do not collapse them into one `load(force)`:
- `ensureCategories()` (mount) — cache, else the in-flight request, else a fetch.
- `refreshCategories()` (`refetch`, after a mutation) — **always** issues a request started after the call, so it can never resolve with a response predating the mutation. Reusing an in-flight request here is unsafe even if that request was itself forced: `CategoryConfig`'s rename flows use `window.prompt`, and dismissing the prompt fires `focus`, so a revalidation is routinely in flight at the moment the PUT resolves. Same-tick calls (one per mounted consumer) coalesce through a microtask-queued `queuedRefresh`.
- `revalidateCategories()` (focus/visibility) — best-effort: reuses an in-flight request and skips entirely within `REVALIDATE_INTERVAL_MS`, since `focus` and `visibilitychange` both fire on a tab return and `focus` also fires on file-picker/prompt dismissal.

Every request carries a `requestId` checked against `latestRequestId` before it writes `cache` or broadcasts, and only clears `inflight` if it is still the current request — responses can settle out of order, and a superseded one must not clobber newer data. A non-OK response **throws** rather than falling back to `[]`: the success branch writes the shared cache and broadcasts, so with revalidation on every focus a single 500 would otherwise blank categories app-wide and make every expense look orphaned. For the same reason `cachedCategories()` treats an empty list as "not loaded" (`Category` is seeded on first boot), so a bad load cannot stick.

**Orphan detection:** There is NO schema flag for orphans. The Dashboard and DashboardDetails compare each expense's `type`/`subtype` against the live category list (`useCategories`) at read time and render a ⚠ marker when the category/subtype no longer exists; `ExpenseTypeSelect` (used by both add and edit flows) shows an inline warning and forces re-selection when the current value is invalid. The two import review screens do the same through local `effectiveType`/`effectiveSubtype` helpers: a value the category list no longer contains reads as unselected, blanks the `<select>`, and counts toward the "sem categoria válida" banner. This is not cosmetic — `/api/bills/import` skips an unknown type and `/api/receipts/import` rejects the whole batch, so an orphaned selection that still *looks* chosen is a silent data drop. Two rules follow from the helpers short-circuiting to "valid" while `loading` (so a not-yet-loaded list doesn't flag every row): the confirm buttons are disabled while `categoriesLoading`, and the submit payload is built from the **same** resolved values the gate checked — never from the raw state, or the screen would post a pair it already knows is invalid.

`newMappings` (both screens) compares the resolved values against the *effective* parsed ones. Comparing against the raw parsed subtype makes an orphaned subtype the user never touched look edited, and upserts `{ type, subtype: null }` over a `BillMapping`/`ProductMapping` the category rename cascade had already fixed.

`/api/bills/import` returns `{ imported, skippedInvalid, skippedExisting }` — the two skip reasons stay separate, with no combined total. Only `skippedInvalid` is actionable: `ImportBill` keeps those rows in the table with a notice so they can be classified and retried, and drops the rows that did import so a retry cannot duplicate them. `skippedExisting` is the expected result of overlapping bills and must never gate `onDone()`.

**Category validation at import boundaries:** Besides the expense/income POST/PUT routes, the bulk import routes validate against `Category` too: `/api/receipts/import` rejects the whole batch (400) if any item/mapping has an invalid `(type, subtype)` pair; `/api/bills/import` skips items whose type no longer exists and drops subtypes not valid for the type (the schema no longer enum-validates, so this is the only guard).

**Public API (`/api/v1/*`):** The authenticated, versioned surface for external callers. It is additive — the internal `/api/*` routes keep their current contract and stay unauthenticated, because they are what the UI calls and a browser has no safe way to hold `API_KEY`. Every v1 handler is `auth → Zod → category validation → service → envelope`, and returns `{ data }` / `{ error: { code, message, details } }` (see `docs/API.md` for the caller-facing contract).

Two rules follow from where the two surfaces differ:

- **Never point client code at `/api/v1/*`.** Doing so requires shipping the key to the browser. When the UI needs behaviour the v1 route has, the *service* is what gets shared — that is what `POST /api/expenses` does with `createExpenses`.
- **`expenseService.buildExpenseDocuments` is the single source of truth for installment expansion** — shared `transactionId`, per-installment `date` via `addMonthsClamped`, per-installment `effectiveDate` via `computeEffectiveDate`. `AddExpense.tsx` used to re-implement it in the browser, fetching `/api/card-cycles` twice per installment; do not reintroduce a client-side or per-route copy. `valueIsTotal` is an explicit schema field because the two callers disagree about what `value` means: a form submits the purchase total, a bill row is already one installment's amount.

**Service layer (`lib/services/`):** The pipelines shared between the internal `/api/*` routes and the `/api/v1/*` namespace live here, not in route bodies — `expenseService` (update/delete, including the credit→non-credit `$unset`), `incomeService`, `billService` (PDF→text→`ParsedBillItem[]`), `receiptService` (PDF/URL→`ParseResponse`, plus the import loop). Routes are reduced to request decoding, category validation and error mapping. A service never inspects payload shape (that is the boundary's job) and never imports `next/server`: it signals failure by throwing `ApiError` from `lib/api/respond.ts`, which the route maps to a status.

**API boundary helpers (`lib/api/`):** `respond.ts` (success/error envelope, `ApiErrorCode`, `ApiError`), `auth.ts` (`requireApiKey`), `validate.ts` (Zod adapter), `schemas/` (per-payload Zod schemas). Two rules:

- **Read `API_KEY` inside the guard, never at module scope** — the CI `lint`/`build` jobs deliberately run with no secrets, and a module-scope read makes the build depend on one. An unset key **fails closed**; unset-means-open would turn a misconfigured deploy into an open database.
- **Dynamic-category validation never moves into Zod.** The boundary order is auth → Zod → `validateExpensePair`/`validateIncomeType` → service. Category validity is a database question against a collection users edit at runtime; freezing the list into a `z.enum` at module load breaks the moment a user adds a category — the same staleness class as the `useCategories` cache problem above. `VALIDATION_FAILED` (malformed payload) and `INVALID_CATEGORY` (well-formed, unknown category) stay distinct for the same reason.

Query schemas use `z.coerce` because every query value arrives as a string; JSON body schemas must **not** coerce, or `{"value": "abc"}` becomes an expense with a `NaN` amount.

**Every installment count on the wire goes through `installmentCount` (`schemas/common.ts`, max `MAX_INSTALLMENTS` = 72)** — `createExpenseSchema.installments`, `importReceiptSchema.installments`, and the bill row's `installmentCurrent`/`installmentTotal`. The bound is not cosmetic: `buildExpenseDocuments` awaits a `CardCycle` lookup and an insert per installment, so an unbounded count is an event-loop stall and a flooded collection from one request — and `installmentTotal` is a *guessed* token on Caixa rows. For the same reason the internal `POST /api/bills/import` Zod-validates with `importBillSchema` rather than casting the body: a service never inspects payload shape, so a route that skips the schema has no guard at all.

**The credit ↔ `cardBrand` pairing is enforced on every write path.** `createExpenseSchema` and the receipt import use a discriminated union / refinement; the edit path cannot use a union because `patchExpenseSchema` needs `.partial()`, so `updateExpensePayloadSchema` carries the refinement instead. PATCH validates it against the **merged** payload (`resolveExpensePatch`, then re-validate), never against the patch alone — `{ paymentType: 'credit' }` is only invalid once resolved against a record with no `cardBrand`. Without this the API mints a `paymentType: 'credit'` document with no `cardBrand`, which `CreditExpense` says cannot exist and `updateExpense` would silently skip the `effectiveDate` derivation for.

**Mongoose drops `undefined` keys from an update, so assigning one is not a clear.** `updateExpense` `$unset`s the fields an edit may drop (`subtype`, plus `cardBrand`/`installment`/`totalInstallments` on the credit → non-credit switch) instead of `$set`ting them to `undefined` — otherwise a PUT that moves a record to another type keeps the old `subtype` and orphans it. `$unset` must be omitted entirely when empty; Mongo rejects `{$unset: {}}`. PUT means replace (an omitted `subtype` is a clear); PATCH merges, so it preserves what it does not mention.

**`effectiveDate` is re-derived on every edit, never carried over.** For credit it comes from `computeEffectiveDate`; for any other payment type it falls back to `date`, and `resolveExpensePatch` drops the stored value when the patch moves `date` — the two dates must agree off the card, or the record sits in one month under "DATA DA COMPRA" and another under "FLUXO DE CAIXA".

Schema ↔ `types/index.ts` direction is fixed and must not be mixed per file: wire-only request types (`ConfirmedBillItem`, `NewBillMapping`, `ConfirmedReceiptItem`) are `z.infer`red from their schema, while types describing DB documents (`Expense`, `Income`) stay hand-written and the schema carries a `satisfies z.ZodType<…>` assertion. `ParsedBillItem`/`ParsedReceiptItem` are *response* shapes with no schema and stay hand-written.

**API contract (`docs/API.md`, `public/openapi.yaml`):** the YAML is **generated** from the Zod schemas by `npm run gen:openapi` (`scripts/gen-openapi.ts`, Zod 4's native JSON-Schema export — no `zod-to-openapi` dependency). Never hand-edit it; `npm run gen:openapi -- --check` fails when it is stale.

**API tests (`bruno/`, `npm run test:api`):** a Bruno collection of `.bru` files versioned alongside the routes. It covers what unit tests cannot see because the behaviour spans requests: installment expansion, the credit→non-credit `$unset`, `VALIDATION_FAILED` vs `INVALID_CATEGORY`. Three rules:

- The auth header is declared **once** in `collection.bru`; `API_KEY` comes from a gitignored `bruno/.env`, never a committed environment file.
- Every written record is named `BRUNO_TEST_*` and the `Cleanup` folder sweeps the prefix. The collection writes to whatever `baseUrl` points at, which during development is the real personal-finance database — the marker is what makes debris from an aborted run removable.
- The `external` tag is **per request, not per folder**: it marks the requests that need a real financial document as a fixture and call OpenAI, which `npm run test:api` excludes and `npm run test:api:external` runs (CI's `api-test`, `workflow_dispatch`/tags only, runs the default set). Most of `Bills`/`Receipts` is tagged; the requests in those folders that are rejected at the boundary — the SSRF allowlist, the `installmentTotal` bound — reach neither the network nor a fixture, so they stay untagged and keep running in CI. Tagging one of those would silently remove it from every run that matters.

### Directory structure

- `app/` — Next.js App Router pages and API routes; all UI pages are co-located here as `.tsx` files
- `app/api/v1/` — the public API. `expenses/` (GET filtered+paginated, POST one purchase → N installments), `expenses/[id]/` (GET/PUT/PATCH/DELETE), `expenses/transactions/[transactionId]/` (GET/DELETE the whole installment group), `incomes/` + `incomes/[id]/`, `bills/{parse,import}/`, `receipts/{parse,import}/` (one parse endpoint takes multipart **or** `{ url }`), and read-only `categories/` + `card-cycles/`
- `app/api/expenses/` — GET all, POST (one purchase, installments expanded server-side via `createExpenses`), DELETE by query param `?id=`
- `app/api/expenses/[id]/` — GET by id, PUT (whitelisted fields only: `name`, `value`, `type`, `subtype`, `paymentType`, `cardBrand`, `date`, `effectiveDate`), DELETE (with optional `?all=true` for installments)
- `app/api/income/` — GET all, POST; `app/api/income/[id]/` — DELETE
- `app/api/card-cycles/` — GET/POST card billing cycle config; POST also recalculates affected expenses
- `app/api/receipts/parse/` — POST: accepts a PDF file, extracts text via `pdf-parse`, parses with GPT
- `app/api/receipts/parse-url/` — POST: accepts a SEFAZ NFC-e URL (*.gov.br only), fetches HTML, parses with GPT
- `app/api/receipts/import/` — POST: saves confirmed receipt items as expenses; upserts new `ProductMapping` entries
- `app/api/admin/sync-indexes/` — POST: calls `syncIndexes()` on `Store`, `ProductMapping`, `Category`, `Expense` and `Income`. The `Expense`/`Income` indexes back the v1 list filters; existing deploys must run this once after they ship
- `app/api/categories/` — GET (list, filter by `?kind=`), POST (create type, or add subtype via `{ subtype }`), PUT (`action: 'renameType' | 'renameSubtype' | 'reorder'`), DELETE (guarded; `?reassignTo=` or `?force=true`)
- `app/api/categories/seed/` — POST: forced reseed; thin wrapper over `seedCategories()` in `categoryUtils.ts`
- `instrumentation.ts` — Next.js boot hook (`register()`); in the Node runtime it auto-runs `seedCategories()` **only when the `Category` collection is empty** (first-run seeding). Guarded by an empty-count check so cloud instances don't re-seed on every cold start; wrapped in try/catch so a DB hiccup never crashes boot. Forced reseed still goes through the POST route.
- `lib/api/` — public-API boundary: `respond.ts`, `auth.ts`, `validate.ts`, `schemas/{common,expense,income,bill,receipt,support}.ts`
- `lib/services/` — `expenseService` (build/create/list/update/delete), `incomeService`, `billService` (parse + import), `receiptService` (single source of truth — do not re-inline into routes)
- `scripts/gen-openapi.ts` — generates `public/openapi.yaml` from the Zod schemas
- `bruno/` — the API test collection (`npm run test:api`); `bruno/.env` and `bruno/fixtures/` are gitignored
- `lib/mongodb.ts` — Mongoose connection with global cache (Next.js hot-reload safe)
- `lib/openai.ts` — OpenAI client singleton (same global-cache pattern as `lib/mongodb.ts`)
- `lib/models/` — Mongoose schemas: `Expense`, `Income`, `CardCycle`, `Store`, `ProductMapping`, `BillMapping`, `Category`
- `lib/utils/cycleUtils.ts` — `getCycle`, `computeEffectiveDate`, `DEFAULT_SETTINGS` (single source of truth — do not duplicate)
- `lib/utils/categoryUtils.ts` — category fetch/cache, `validateExpensePair`, `validateIncomeType`, `count*` and `cascadeRename*` helpers (single source of truth — do not duplicate). `getCategories()` calls `connectToDatabase()` itself: it is the first DB read on every route that validates a category before reaching a service, and `instrumentation.ts` swallows a failed boot connect, so without it the first request buffers for `bufferTimeoutMS` and 500s instead of failing immediately
- `scripts/migrate-payment-types.ts` (`npm run migrate:payment-types`, `-- --dry-run` to count only) — one-off data migration for the payment-type option-value fix (`cash`→`pix`, then `other`→`cash`, in that order). Not idempotent: a second run would re-map genuine Dinheiro records to PIX
- `lib/utils/receiptUtils.ts` — `interpretAndCrossReference`: calls GPT, upserts `Store`, cross-references `ProductMapping`; supermercado subtypes come from `Category` via `categoryUtils`
- `hooks/useCategories.ts` — client hook exposing `expenseTypes`, `incomeTypes`, `subtypesFor`, `isValidType`, `isValidPair`, `refetch`; revalidates the shared cache on window `focus`/`visibilitychange` (see below)
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
