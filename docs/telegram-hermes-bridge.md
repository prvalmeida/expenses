# Telegram + Hermes bridge for expenses

This repo now has a Telegram-friendly write route:

- `POST /api/v1/telegram/expenses`

It accepts a human-friendly text block and translates it server-side into the
canonical `/api/v1/expenses` payload.

## Accepted text format

Use one field per line, or separate fields with `;`:

```text
nome: almoço no shopping
valor: 42,90
categoria: comida
subcategoria: Restaurante
pagamento: pix
data: 2026-08-29
```

Credit purchases must also include card + installments:

```text
nome: notebook
valor: 5000,46
categoria: compras / Eletrônicos
pagamento: crédito
cartão: Visa Caixa
parcelas: 6
data: 31/03/2026
```

Supported aliases:
- `descrição`, `descricao`, `desc` → `nome`
- `tipo` → `categoria`
- `subtipo` → `subcategoria`
- `pagto`, `forma`, `forma de pagamento` → `pagamento`
- `cartao`, `bandeira` → `cartão`
- payment aliases: `crédito`, `débito`, `dinheiro`, `pix`, `vale alimentação`, `vale refeição`, `vale combustível`
- card aliases: `master`, `visa`, `elo`
- date aliases: `hoje`, `ontem`, `DD/MM/YYYY`, `YYYY-MM-DD`

The endpoint resolves category/subcategory casing against the live category list,
so `restaurante` is accepted and normalized to `Restaurante` when the pair exists.

## Dry-run

```bash
curl -sS -X POST http://localhost:3000/api/v1/telegram/expenses \
  -H 'content-type: application/json' \
  -H 'x-api-key: ...' \
  -d '{"text":"nome: almoço; valor: 42,90; categoria: comida; subcategoria: Restaurante; pagamento: pix","dryRun":true}'
```

## Create for real

```bash
curl -sS -X POST http://localhost:3000/api/v1/telegram/expenses \
  -H 'content-type: application/json' \
  -H 'x-api-key: ...' \
  -d '{"text":"nome: almoço; valor: 42,90; categoria: comida; subcategoria: Restaurante; pagamento: pix"}'
```

## Hermes flow

For Hermes, this repo also ships a helper command:

```bash
npm run telegram:record -- --text "nome: almoço; valor: 42,90; categoria: comida; subcategoria: Restaurante; pagamento: pix"
```

Or preview without writing:

```bash
npm run telegram:record -- --dry-run --text "nome: almoço; valor: 42,90; categoria: comida; subcategoria: Restaurante; pagamento: pix"
```

Environment used by the helper:
- `EXPENSES_API_BASE_URL` (default `http://localhost:3000/api/v1`)
- `EXPENSES_API_KEY` (falls back to `API_KEY`)

## Suggested Hermes instruction

In Hermes (especially the Telegram gateway), give it a standing instruction like:

```text
Quando eu pedir para registrar um gasto, colete nome, valor, categoria,
subcategoria, pagamento e data. Se for crédito, também cartão e parcelas.
Quando tiver dados suficientes, execute no repositório expenses:

npm run telegram:record -- --text "nome: ...; valor: ...; categoria: ...; subcategoria: ...; pagamento: ...; data: ..."

Se faltar algum campo obrigatório, pergunte apenas pelo que falta.
Se eu pedir conferência antes de gravar, use --dry-run.
```
