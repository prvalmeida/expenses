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

### Directory structure

- `app/` — Next.js App Router pages and API routes; all UI pages are co-located here as `.tsx` files
- `app/api/expenses/` — GET all, POST, DELETE by query param `?id=`
- `app/api/expenses/[id]/` — GET by id, PUT (whitelisted fields only: `name`, `value`, `type`, `subtype`, `paymentType`, `cardBrand`, `date`, `effectiveDate`), DELETE (with optional `?all=true` for installments)
- `app/api/income/` — GET all, POST; `app/api/income/[id]/` — DELETE
- `app/api/card-cycles/` — GET/POST card billing cycle config (closing/due dates per card brand per month)
- `lib/mongodb.ts` — Mongoose connection with global cache (Next.js hot-reload safe)
- `lib/models/` — Mongoose schemas: `Expense`, `Income`, `CardCycle`
- `components/` — Shared React components (`ExpenseCharts`, `ExpenseTypeSelect`, `EditExpenseModal`)
- `types/index.ts` — All shared TypeScript types, the `ExpenseSubtypes` map (type → subtypes), `CardBrand` enum, and `IncomeTypes`

### Data model highlights

- `ExpenseSubtypes` in `types/index.ts` is the single source of truth for expense categories and their subtypes — both the Mongoose schema validator and the UI `ExpenseTypeSelect` component derive from it.
- `CardBrand` enum values (`Master Santander`, `Visa Caixa`, `Elo Caixa`) are used as keys in the card-cycles default settings.
- `CardCycle` stores per-card, per-month closing/due date overrides; the API falls back to hardcoded defaults when no override exists.

### Navigation

`app/page.tsx` is a single-page shell that renders one of four views based on `currentView` state: `dashboard`, `addExpense`, `addIncome`, or `cardConfig`. There is no client-side router — view switching is purely state-driven.
