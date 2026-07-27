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

The production `runner` image uses Next.js **standalone output** (`output: 'standalone'` in `next.config.ts`): it copies only `.next/standalone`, `.next/static`, and `public`, runs as a non-root user, binds `0.0.0.0:$PORT`, and starts via `node server.js`. Secrets are **never baked into the image** — `MONGODB_URI`, `OPENAI_API_KEY`, and `PDF_KEY` are injected at runtime (compose `env_file`, or the cloud platform's secret manager). Packages in `serverExternalPackages` (`pdf-parse`, `pdfjs-dist`) are copied to `.next/standalone/node_modules`; all other deps (e.g. `openai`) are bundled into the compiled server chunks. See `README_DOCKER.md` and `.env.example`.

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
- `app/api/categories/seed/` — POST: idempotent upsert of `Category` docs from the `ExpenseSubtypes`/`IncomeTypes` seed constants
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

- The `Category` collection is the single source of truth for expense/income categories and expense subtypes. Model schemas no longer enum-validate `type`/`subtype`; validation happens at API boundaries via `categoryUtils`. `Category` docs must be seeded (`POST /api/categories/seed`) before the UI can read categories.
- `CardBrand` enum values (`Master Santander`, `Visa Caixa`, `Elo Caixa`) are used as keys in the card-cycles default settings.
- `CardCycle` stores per-card, per-month closing/due date overrides; the API falls back to `DEFAULT_SETTINGS` from `cycleUtils.ts` when no override exists.
- `Store` stores `{ cnpj, address, name }` — upserted on every receipt parse, keyed by `(cnpj, address)`.
- `ProductMapping` stores learned `{ cnpj, address, description, type, subtype }` — keyed by `(cnpj, address, description)`. Used to auto-classify items on future imports of the same store.

### Navigation

`app/page.tsx` is a single-page shell that renders one view based on `currentView` state: `dashboard`, `dashboardDetails`, `addExpense`, `addIncome`, `cardConfig`, `categoryConfig`, `importReceipt`, or `importBill`. There is no client-side router — view switching is purely state-driven.
