# Expenses

A personal finance tracker built with Next.js 16 App Router and MongoDB. The UI is in Brazilian Portuguese.

## Prerequisites

- Node.js 18+
- A MongoDB instance (local or Atlas)
- A `.env.local` file at the project root:

```
MONGODB_URI=<your MongoDB connection string>
```

## Running

```bash
npm install
npm run dev      # http://localhost:3000
```

### Docker

```bash
docker compose up --build app   # Development with hot-reload
docker compose up --build web   # Production build
```

### Other commands

```bash
npm run build    # Production build
npm run start    # Start production server
npm run lint     # ESLint
```

## Features

- **Dashboard** — monthly summary of expenses and income, toggling between purchase date view ("Data da Compra") and cash-flow view ("Fluxo de Caixa"). Expense rows support inline edit and delete.
- **Add expense** — supports cash, debit, PIX, food/meal/fuel vouchers, and credit card with automatic installment splitting across months. Effective dates are calculated from card billing cycles.
- **Add income** — records income entries by date and type.
- **Card config** — per-card, per-month closing and due date overrides used when calculating effective dates for credit purchases.

## Architecture

See [CLAUDE.md](./CLAUDE.md) for the full architecture reference, directory structure, and data model details.
