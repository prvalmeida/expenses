# IMPORT-BILL Plan

## Goal
Add an "Importar Fatura" view that parses a password-protected credit card bill PDF (Santander or Caixa) via GPT and renders an editable review table of transactions (no import/save step yet).

## Affected files
- `types/index.ts` — add `ParsedBillItem` type
- `lib/utils/billUtils.ts` — new file: GPT logic to extract transactions from bill text
- `app/api/bills/parse/route.ts` — new file: decrypt PDF with `PDF_KEY`, extract text, call billUtils
- `app/ImportBill.tsx` — new file: 2-step UI (upload + card select → editable review table)
- `app/page.tsx` — register new `importBill` view state, sidebar button, conditional render
- `CLAUDE.md` — document `PDF_KEY` env var under the Environment section

---

## Steps

### 1. [Data] Add `ParsedBillItem` to `types/index.ts`
**What:** Add a new exported type after `ConfirmedReceiptItem` (line 155):
```
ParsedBillItem {
  date: string;                              // "YYYY-MM-DD"
  description: string;
  value: number;
  installmentCurrent?: number;
  installmentTotal?: number;
  type: keyof typeof ExpenseSubtypes | null;
  subtype: string | null;
}
```
**Why:** Shared contract between the API response and the review UI, following the same pattern as `ParsedReceiptItem` (line 144). Must live in `types/index.ts` to be the single source of truth.
**Depends on:** none

---

### 2. [API] Verify `pdfjs-dist` is available as a direct dependency
**What:** Check `package.json`. `pdf-parse` (used in `/api/receipts/parse`) bundles `pdfjs-dist` internally but does not expose a `password` option on `getDocument()`. Confirm `pdfjs-dist` is listed (or add it). The API route will import from `pdfjs-dist/legacy/build/pdf.js` — the legacy build is what `pdf-parse` uses internally and is what runs in Node.js.
**Why:** Brazilian bank PDFs are password-protected. `pdf-parse` does not forward a password to `pdfjs-dist`. Direct usage of `pdfjs-dist` is the only supported way to decrypt and extract text.
**Depends on:** none

---

### 3. [API] Create `lib/utils/billUtils.ts`
**What:** Export a single function `parseBillText(rawText: string): Promise<ParsedBillItem[]>` that calls GPT-4o-mini with a structured JSON system prompt. The prompt must:
- Extract **only debit transactions** (exclude credit reversals, payments, and "AJUSTE CRED" lines)
- Handle both PDF layouts:
  - **Santander**: `[DD/MM] [MERCHANT] [PARCELA curr/total?] [R$ value]` — installment appears as a separate column (e.g. `03/03`)
  - **Caixa**: separate "COMPRAS" and "COMPRAS PARCELADAS" sections; installments shown as `DD DE NN` in the description column
- Return each item with `date` (YYYY-MM-DD, infer year from bill due date), `description`, `value`, optional `installmentCurrent`/`installmentTotal`
- Infer `type` (key of `ExpenseSubtypes`) and `subtype` for each item, returning `null` for both when uncertain
- Reuse the `openai` singleton from `lib/openai.ts`; use `response_format: { type: 'json_object' }`

**Why:** Isolated from `receiptUtils.ts` (which is supermercado-specific and touches MongoDB). Bill parsing has no DB dependency.
**Depends on:** Step 1

---

### 4. [API] Create `app/api/bills/parse/route.ts`
**What:** POST endpoint accepting `multipart/form-data` with fields `file` (PDF blob) and `cardBrand` (string). Steps:
1. Validate `cardBrand` is a valid `CardBrand` enum value; return 400 otherwise.
2. Read `process.env.PDF_KEY` for the decryption password.
3. Convert the file to a `Uint8Array`; call `pdfjs-dist`'s `getDocument({ data, password: PDF_KEY })` to load the document.
4. Iterate pages, call `.getTextContent()` on each, join all tokens into a raw string.
5. Pass raw text to `parseBillText()` from `billUtils.ts`.
6. Return `{ items: ParsedBillItem[], cardBrand }`.
7. Handle wrong-password errors (pdfjs throws `PasswordException`) with a specific Portuguese message: `"Senha do PDF incorreta"`.

**Why:** The existing `/api/receipts/parse` route uses `pdf-parse` with no password support and is NF-e specific. A separate route keeps concerns clean.
**Depends on:** Steps 2, 3

---

### 5. [UI] Create `app/ImportBill.tsx`
**What:** Two-step component `ImportBill({ onDone }: { onDone: () => void })`.

**Step 1 — Upload:**
- PDF file input (`accept=".pdf"`)
- `CardBrand` dropdown with labels "Master Santander", "Visa Caixa", "Elo Caixa"
- "Processar Fatura" button (disabled until both file and cardBrand are set)
- Loading spinner and inline error display

**Step 2 — Review table:**
- Header row: card brand + total transaction count + sum of values
- Table columns: **Data** | **Descrição** (editable `<input type="text">`) | **Parcela** (read-only, shows `curr/total` if present) | **Categoria** (dropdown of all `ExpenseSubtypes` keys) | **Subcategoria** (dropdown of subtypes for the selected category, or empty if no category) | **Valor** (editable `<input type="number">`)
- Row background: green-tinted if `type` is set, amber-tinted if `type` is null
- "Voltar" button resets to step 1; "Confirmar" button (disabled until every row has a non-null `type`) calls `console.log` with the confirmed items as placeholder for the future import step

**Why:** Follows the established step-based pattern of `ImportReceipt.tsx`. `console.log` placeholder avoids building an import API in this scope.
**Depends on:** Step 1

---

### 6. [Integration] Register view in `app/page.tsx`
**What:** Three targeted changes:
1. **Line 12** — add `'importBill'` to the `currentView` state union type.
2. **Lines 68–78 sidebar** — add a new `<button>` `💳 Importar Fatura` after the existing "📄 Importar NF" button, same styling pattern.
3. **Lines 85–101 render area** — add `{currentView === 'importBill' && <ImportBill onDone={() => setCurrentView('dashboard')} />}` and import `ImportBill` at the top.

**Why:** The app has no client-side router; every view is registered here.
**Depends on:** Step 5

---

### 7. [Docs] Document `PDF_KEY` in `CLAUDE.md`
**What:** Add `PDF_KEY=<CPF do titular, somente números>` to the `.env.local` block under the Environment section.
**Why:** Currently `CLAUDE.md` documents `MONGODB_URI` and `OPENAI_API_KEY` but not `PDF_KEY`, which is now required for bill parsing.
**Depends on:** none

---

## Cross-cutting concerns

**Caixa bill has two cards per single PDF** (last four digits 6806 = Visa Caixa, 0471 = Elo Caixa in the sample). In this MVP the user picks one `CardBrand` at upload time and all transactions inherit it. A future step can detect card-section headers in the raw text and prompt the user to assign a brand per section before parsing.

**`pdfjs-dist` Node.js compatibility:** use the `legacy` build (`pdfjs-dist/legacy/build/pdf.js`). The `getDocument` call must set `useWorkerFetch: false` and `isEvalSupported: false` to work correctly in a Next.js API route (server-side, no worker threads).

**`PDF_KEY` is sensitive:** it is the user's CPF. It must only be read server-side via `process.env.PDF_KEY` — never exposed to the client bundle.
