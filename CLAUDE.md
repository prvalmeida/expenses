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
docker compose up --build app   # Development with hot-reload
docker compose up --build web   # Production build
```

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

### Directory structure

- `app/` — Next.js App Router pages and API routes; all UI pages are co-located here as `.tsx` files
- `app/api/expenses/` — GET all, POST, DELETE by query param `?id=`
- `app/api/expenses/[id]/` — GET by id, PUT (whitelisted fields only: `name`, `value`, `type`, `subtype`, `paymentType`, `cardBrand`, `date`, `effectiveDate`), DELETE (with optional `?all=true` for installments)
- `app/api/income/` — GET all, POST; `app/api/income/[id]/` — DELETE
- `app/api/card-cycles/` — GET/POST card billing cycle config; POST also recalculates affected expenses
- `app/api/receipts/parse/` — POST: accepts a PDF file, extracts text via `pdf-parse`, parses with GPT
- `app/api/receipts/parse-url/` — POST: accepts a SEFAZ NFC-e URL (*.gov.br only), fetches HTML, parses with GPT
- `app/api/receipts/import/` — POST: saves confirmed receipt items as expenses; upserts new `ProductMapping` entries
- `app/api/admin/sync-indexes/` — POST: calls `syncIndexes()` on `Store` and `ProductMapping` models
- `lib/mongodb.ts` — Mongoose connection with global cache (Next.js hot-reload safe)
- `lib/openai.ts` — OpenAI client singleton (same global-cache pattern as `lib/mongodb.ts`)
- `lib/models/` — Mongoose schemas: `Expense`, `Income`, `CardCycle`, `Store`, `ProductMapping`
- `lib/utils/cycleUtils.ts` — `getCycle`, `computeEffectiveDate`, `DEFAULT_SETTINGS` (single source of truth — do not duplicate)
- `lib/utils/receiptUtils.ts` — `interpretAndCrossReference`: calls GPT, upserts `Store`, cross-references `ProductMapping`
- `components/` — Shared React components (`ExpenseCharts`, `ExpenseTypeSelect`, `EditExpenseModal`)
- `types/index.ts` — All shared TypeScript types, the `ExpenseSubtypes` map (type → subtypes), `CardBrand` enum, `IncomeTypes`, `ParsedReceiptItem`, `ConfirmedReceiptItem`

### Data model highlights

- `ExpenseSubtypes` in `types/index.ts` is the single source of truth for expense categories and their subtypes — both the Mongoose schema validator and the UI `ExpenseTypeSelect` component derive from it.
- `CardBrand` enum values (`Master Santander`, `Visa Caixa`, `Elo Caixa`) are used as keys in the card-cycles default settings.
- `CardCycle` stores per-card, per-month closing/due date overrides; the API falls back to `DEFAULT_SETTINGS` from `cycleUtils.ts` when no override exists.
- `Store` stores `{ cnpj, address, name }` — upserted on every receipt parse, keyed by `(cnpj, address)`.
- `ProductMapping` stores learned `{ cnpj, address, description, type, subtype }` — keyed by `(cnpj, address, description)`. Used to auto-classify items on future imports of the same store.

### Navigation

`app/page.tsx` is a single-page shell that renders one of five views based on `currentView` state: `dashboard`, `addExpense`, `addIncome`, `cardConfig`, or `importReceipt`. There is no client-side router — view switching is purely state-driven.
