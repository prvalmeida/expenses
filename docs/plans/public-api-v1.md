# Plan — Public API v1 (external integrations)

Status: **implemented** on `feat/public-api-v1` — all 30 steps landed, one commit per step.
Created: 2026-08-11
Completed: 2026-08-16

## Implementation notes

Three places where the shipped code deviates from the plan as written:

- **Step 22 does not point `AddExpense.tsx` at `/api/v1/expenses`.** That guard requires an
  `API_KEY`, and a browser has no safe way to hold one. The internal `POST /api/expenses` (which
  step 44 of *Affected files* already flagged as a raw `new Expense(body)` passthrough) now
  delegates to `createExpenses` instead, and the form submits once. The duplication the step
  targeted is gone; the client never sees the key. This is now a rule in CLAUDE.md: when the UI
  needs v1 behaviour, the **service** is what gets shared, never the route.
- **Step 23 generates the spec with Zod 4's native JSON-Schema export**, not `zod-to-openapi`.
  `tsx` and `yaml` are the only new devDependencies (plus `@usebruno/cli` from step 24).
  `npm run gen:openapi -- --check` fails on a stale file.
- **Step 28 commits no fixture PDF.** A synthetic statement convincing enough to exercise the
  Santander/Caixa parsers is not something to fabricate blind, and a real one is exactly the
  disclosure the step warns about. `bruno/fixtures/` is gitignored with a README stating what to
  drop in; the `Bills`/`Receipts` requests are written and tagged `external`, so they run as soon
  as a fixture exists.

Two things the schema work surfaced that were not in the plan:

- Both payment-type selects (`AddExpense.tsx`, `EditExpenseModal.tsx`) offered `value="other"` —
  absent from both `PAYMENT_TYPES` and the `Expense` union — and labelled `cash` as "PIX". Zod
  rejects `other`, so both now match `ImportReceipt`'s mapping (`pix` → PIX, `cash` → Dinheiro).
  **Records already stored as `cash` now read as "Dinheiro"**; if any of those were really PIX,
  that is a data question, not a code one.
- `listIncomes` had to return `{ items, nextCursor }` for the v1 route. The internal
  `/api/income` route passes no `limit` and still gets the whole list, which the Dashboard needs
  to total client-side.

### Outstanding

- **Migration:** existing deploys must `POST /api/admin/sync-indexes` once. The new `Expense` /
  `Income` indexes back every v1 list filter (step 10).
- **The Bruno collection has never been executed against a running server.** It parses and orders
  correctly, but running it writes `BRUNO_TEST_` records to whatever `baseUrl` points at — which
  during development is the real personal-finance database. Run `npm run test:api` deliberately;
  the `Cleanup` folder sweeps the marker afterwards.
- The out-of-scope gaps below (no per-caller attribution, no rate limiting, no audit trail) are
  unchanged and now materially larger, since the write endpoints exist.

## Goal

Expose expense CRUD, income CRUD, bill-PDF parsing and invoice (NF-e) parsing as an authenticated, versioned public API (`/api/v1/*`) that lets an external tool reproduce every flow the web UI performs today, with a git-versioned Bruno collection to exercise it.

## Decisions taken

| Question | Decision |
| --- | --- |
| Auth | Static API key in a header, checked against an `API_KEY` env var |
| Route shape | New `/api/v1/*` namespace; existing `/api/*` keeps its current contract |
| Installments | Expanded **server-side** — one POST creates N records |
| Parse → import | Stateless; the caller echoes the parse payload back to the import endpoint |
| Validation | `zod` (new runtime dependency) |
| API testing | Bruno collection committed to the repo, run via `@usebruno/cli` |

## Affected files

**New**

- `lib/api/auth.ts` — API-key guard shared by all v1 routes
- `lib/api/respond.ts` — single success/error envelope + error codes
- `lib/api/validate.ts` — Zod adapter (JSON body + query string)
- `lib/api/schemas/{common,expense,income,bill,receipt}.ts` — request/response schemas
- `lib/services/expenseService.ts` — installment expansion + effectiveDate + list/update/delete, currently split between `app/api/expenses/**` and `app/AddExpense.tsx`
- `lib/services/incomeService.ts`
- `lib/services/billService.ts` — PDF→text→`ParsedBillItem[]` and the import loop, currently inline in the two bill routes
- `lib/services/receiptService.ts` — file/URL→`ParseResponse` and the import loop, currently inline in the two receipt routes
- `app/api/v1/expenses/route.ts`, `app/api/v1/expenses/[id]/route.ts`, `app/api/v1/expenses/transactions/[transactionId]/route.ts`
- `app/api/v1/incomes/route.ts`, `app/api/v1/incomes/[id]/route.ts`
- `app/api/v1/bills/parse/route.ts`, `app/api/v1/bills/import/route.ts`
- `app/api/v1/receipts/parse/route.ts`, `app/api/v1/receipts/import/route.ts`
- `app/api/v1/categories/route.ts`, `app/api/v1/card-cycles/route.ts` — read-only support endpoints
- `scripts/gen-openapi.ts` — generates `public/openapi.yaml` from the Zod schemas
- `docs/API.md`, `public/openapi.yaml`
- `bruno/bruno.json`, `bruno/collection.bru`, `bruno/environments/{local,docker}.bru`, `bruno/{Expenses,Incomes,Bills,Receipts,Categories,Cleanup}/*.bru`, `bruno/.env.example`

**Modified**

- `app/api/expenses/route.ts:16-31` — POST is a raw passthrough (`new Expense(body)`), no field whitelist; must delegate to the service
- `app/api/expenses/[id]/route.ts:31-56` — PUT logic moves to the service
- `app/api/income/[id]/route.ts:22-43` — PUT has **no** `validateIncomeType` call, unlike POST (`app/api/income/route.ts:21`)
- `app/AddExpense.tsx:27-110` — client-side installment loop + cycle fetching is a second implementation of `computeEffectiveDate` (`lib/utils/cycleUtils.ts:31`), violating the single-source-of-truth rule in CLAUDE.md; replaced by one call to the new endpoint
- `app/ImportBill.tsx:68,167` and `app/ImportReceipt.tsx:86,88,230` — repoint at the shared services' routes
- `lib/models/Expense.ts`, `lib/models/Income.ts` — no index declarations today
- `app/api/admin/sync-indexes/route.ts` — syncs only `Store`, `ProductMapping`, `Category`
- `types/index.ts` — wire-only types become Zod-inferred (see step 4)
- `package.json` — `zod` (runtime), `@usebruno/cli` (dev), `test:api` script
- `.gitignore` — `bruno/.env`, `bruno/fixtures/*`
- `.env.example`, `README_DOCKER.md`, `docker-compose.yml`, `CLAUDE.md`
- `.github/workflows/ci.yml` — new opt-in `api-test` job

---

## Steps

### 1. [Cross-cutting] Add `zod` as a dependency

**What:** `npm install zod` (v4). Runtime dependency, not a devDependency.
**Why:** Schemas are imported by route handlers at request time, so a devDependency would be dropped by the `deps` stage's production install and break the `runner` image at runtime, not at build time.
**Depends on:** none

Docker note: `zod` is pure JS with no native bindings and no runtime `createRequire`, so Next's output tracing follows it normally. It must **not** be added to `serverExternalPackages` in `next.config.ts` — it belongs bundled into the compiled server chunks, like `openai`. The `@napi-rs/canvas` / `pdf.worker.mjs` hand-copy problems in CLAUDE.md do not apply.

### 2. [Cross-cutting] Build the Zod adapter in `lib/api/validate.ts`

**What:** Export two helpers — one that parses a JSON body against a schema, one that parses `URLSearchParams` — each returning a discriminated result rather than throwing. On failure, map `ZodError.issues` into the `details` field of the step-7 error envelope, keyed by `path.join('.')`.
**Why:** Every v1 route needs identical failure handling, and a raw `ZodError` serialized straight to the client leaks the internal schema shape. Query strings need their own path because every value arrives as a string — `z.coerce.number()` / `z.coerce.date()` handle the step-9 filters (`limit`, `from`, `to`), while the JSON path must **not** coerce, or `{"value": "abc"}` silently becomes an expense with a `NaN` amount.
**Depends on:** steps 1, 7

### 3. [Cross-cutting] Define the shared schema module

**What:** `lib/api/schemas/*.ts`, one schema per v1 payload:

- `common.ts` — `brlAmount` (positive, ≤2 decimal places), `isoDate` (`YYYY-MM-DD` string, **not** `z.date()`), `cardBrand` (`z.nativeEnum(CardBrand)`), `paymentType`, `objectId`, `paginationQuery`
- `expense.ts` — `createExpenseSchema` (discriminated union on `paymentType`: the `credit` branch requires `cardBrand` and allows `installments`; the other branch forbids `cardBrand`/`installment`/`totalInstallments`), `updateExpenseSchema` (the eight whitelisted fields), `patchExpenseSchema` (the same, `.partial()`), `listExpensesQuerySchema`
- `income.ts`, `bill.ts` (`confirmedBillItemSchema`, `importBillSchema`), `receipt.ts` (`parseReceiptSchema` as a union of `{url}` and the multipart marker, `importReceiptSchema`)

**Why:** Three things here are load-bearing.

*`isoDate` as a string, not `z.date()`* — `Expense.date`/`effectiveDate` are `String` in the schema (`lib/models/Expense.ts:10-11`) and the entire codebase compares them lexically (`cycleUtils.ts:41`, `AddExpense.tsx:56`). Coercing to `Date` at the boundary would force a re-serialization on every write and invite a timezone shift.

*The discriminated union* is what makes the `CreditExpense`/`OtherExpense` split in `types/index.ts:95-107` actually enforced. Today it is compile-time only — `POST /api/expenses` accepts a `pix` expense carrying a `cardBrand` because the route does `new Expense(body)` (`app/api/expenses/route.ts:24`) and the model marks `cardBrand` optional (`lib/models/Expense.ts:15`). Mongoose `strict: true` drops unknown keys but not known-yet-invalid combinations.

*`brlAmount` must reject >2 decimals rather than round.* The installment split at `AddExpense.tsx:92` and `receipts/import/route.ts:81` already rounds to 2 places; accepting a 4-decimal input means the sum of installments silently ≠ the submitted total.

**Depends on:** step 1

### 4. [Cross-cutting] Reconcile schemas with `types/index.ts`

**What:** For each schema mirroring an existing exported type, pick one direction and record it: either the type stays hand-written and the schema is asserted against it (`satisfies z.ZodType<ConfirmedBillItem>`), or the type is replaced by `z.infer<typeof schema>`.
**Why:** Without this the two drift silently — a schema that omits `installmentTotal` still type-checks against a route that reads `item.installmentTotal`. Recommendation: **infer** for the wire-only types (`ConfirmedBillItem:180`, `NewBillMapping:174`, `ConfirmedReceiptItem:153`), which exist purely to describe request bodies; **keep hand-written and `satisfies`-check** for `Expense`/`Income`, which describe DB documents the UI also constructs directly and that must not be reshaped by an API concern.

Sequencing constraint: `ParsedBillItem:162`/`ParsedReceiptItem:141` are *response* types read by `ImportBill.tsx`/`ImportReceipt.tsx` — leave both alone in this pass. Only the `Confirmed*` request types are safe to invert now.

**Depends on:** step 3

### 5. [Cross-cutting] Add the `API_KEY` secret

**What:** Add `API_KEY` to `.env.example`, the compose `env_file` path, and the README env table. Do **not** add it to `web.environment` in `docker-compose.yml`.
**Why:** Per CLAUDE.md, `environment` outranks `env_file` and secrets stay out of the image.
**Depends on:** none

### 6. [Cross-cutting] Build the API-key guard

**What:** `lib/api/auth.ts` reads a bearer/`x-api-key` header, compares it against `process.env.API_KEY` with a **timing-safe** comparison, and returns a 401 envelope on mismatch. Read the env var **inside** the function, never at module scope.
**Why:** Module-scope env reads would break `next build` in CI, which deliberately runs with no secrets (CLAUDE.md, CI/CD section). Also: if `API_KEY` is unset the guard must **fail closed** — an unset-means-open guard turns a misconfigured deploy into an open database.
**Depends on:** step 5

### 7. [Cross-cutting] Define the response envelope and error codes

**What:** `lib/api/respond.ts` exports success/error builders producing a stable shape (`{ data }` / `{ error: { code, message, details } }`) with machine-readable codes: `UNAUTHORIZED`, `VALIDATION_FAILED`, `INVALID_CATEGORY`, `NOT_FOUND`, `PDF_PASSWORD_REQUIRED`, … `details` is typed as the flattened `ZodError` issue map from step 2.
**Why:** Current errors are string-interpolated exception dumps (`app/api/expenses/route.ts:12`, `app/api/bills/parse/route.ts:134`), which no external caller can branch on and which leak internal stack/driver detail to a third party.

`VALIDATION_FAILED` and `INVALID_CATEGORY` are deliberately distinct: the first means the payload is malformed (a caller bug), the second means it is well-formed but names a category that does not exist (recoverable by re-reading `/api/v1/categories`).

**Depends on:** none

---

### 8. [Data/service] Extract the expense write path into `expenseService.ts`

**What:** `createExpenses(input)` accepts one logical purchase (`name, value, type, subtype, paymentType, cardBrand, date, installments`) and returns the N documents to insert — shared `transactionId`, per-installment `date` via `addMonthsClamped`, per-installment `effectiveDate` via `computeEffectiveDate`, value split with the existing 2-decimal rounding, `installment`/`totalInstallments` set only for credit. Input arrives already Zod-parsed, so the service performs no shape checking.
**Why:** This logic exists three times — the client loop at `app/AddExpense.tsx:27-110` (which re-derives the cycle by hand-fetching `/api/card-cycles` twice, lines 46 and 62), and the server loop in `app/api/bills/import/route.ts:104-146`. One service kills the duplication and is the only way an external caller gets correct `effectiveDate` values.
**Depends on:** step 3

**Discrepancy to resolve while extracting:** `AddExpense.tsx:92` **divides** `value` by the installment count, while `bills/import/route.ts:137` treats `item.value` as the **per-installment** amount. Model this as an explicit schema field (`valueIsTotal`, with a documented default) rather than an implicit service argument — it changes the meaning of `value` and an external caller must see it in the OpenAPI output.

### 9. [Data/service] Add the expense read path with filtering

**What:** `listExpenses({ from, to, dateField, type, subtype, paymentType, cardBrand, transactionId, limit, cursor })` — `dateField` selects `date` vs `effectiveDate`, mirroring the Dashboard's "DATA DA COMPRA"/"FLUXO DE CAIXA" toggle. `limit` has a default **and a max**.
**Why:** `GET /api/expenses` is an unbounded `Expense.find({})` (`app/api/expenses/route.ts:9`) — fine for a single-page UI that filters client-side, unusable as a public API, and it ships the entire financial history on every call. An unbounded `limit` would re-create the same problem.
**Depends on:** step 3

### 10. [Data] Add indexes for the new query patterns

**What:** Compound indexes on `Expense` for `(date)`, `(effectiveDate)`, `(transactionId)`, `(type, subtype)`; on `Income` for `(date)`, `(type)`. Register both models in `app/api/admin/sync-indexes/route.ts`.
**Why:** Every filter in step 9 is a collection scan today; `Expense` has no index declarations at all (`lib/models/Expense.ts:4-22`).
**Migration:** existing deploys must run `sync-indexes` once after this ships.
**Depends on:** step 9

### 11. [Data/service] Extract the expense update/delete path

**What:** Move the PUT body of `app/api/expenses/[id]/route.ts:31-56` into `updateExpense(id, patch)` — keeping the eight-field whitelist, the `computeEffectiveDate` recompute, and the `$unset` of `cardBrand`/`installment`/`totalInstallments` on a credit→non-credit switch. Move the `?all=true` installment-group delete (lines 74-82) into `deleteExpense(id, { allInstallments })`.
**Why:** The v1 route must not re-implement the `$unset` rule; missing it leaves an `OtherExpense` carrying `cardBrand` — exactly the inconsistency CLAUDE.md calls out.
**Depends on:** none

### 12. [Data/service] Extract the income service

**What:** `incomeService.ts` with `listIncomes(filter)`, `createIncome`, `updateIncome`, `deleteIncome`, all routed through `validateIncomeType`.
**Why:** Closes the validation hole at `app/api/income/[id]/route.ts:26-33`, where PUT spreads the whole body into `findByIdAndUpdate` with no category check — a caller can currently write an income whose `type` matches no `Category`, producing an orphan the Dashboard flags but the API accepted.
**Depends on:** none

### 13. [Data/service] Extract the bill parse pipeline

**What:** `billService.parseBill({ buffer, cardBrand, password })` — the pdfjs load, `reconstructPageText`, `parseBillText`, `extractClosingDate`, `extractFullDueDate`, and the duplicate-detection pass, currently all inline in `app/api/bills/parse/route.ts:51-132`. `password` defaults to `process.env.PDF_KEY` when omitted.
**Why:** The route body is the whole implementation; v1 needs it without copying 80 lines. Making `password` a parameter matters — an external tool's bill may not be locked with the operator's CPF, which is hardcoded at line 70.
**Depends on:** none

### 14. [Data/service] Extract the bill import pipeline

**What:** `billService.importBillItems(body)` — the mapping upserts, `CardCycle` upsert, category validation and per-item installment expansion from `app/api/bills/import/route.ts:32-147`, reusing step 8's builder.
**Why:** Same duplication argument. The `{ imported, skippedInvalid, skippedExisting }` contract (line 149) must be preserved verbatim — CLAUDE.md is explicit that the two skip reasons never collapse into one total.
**Depends on:** step 8

### 15. [Data/service] Extract the receipt parse + import pipelines

**What:** `receiptService.parseReceiptFromPdf(buffer)` and `parseReceiptFromUrl(url)` (keeping the `isAllowedSefazUrl` allowlist and the retry loop from `app/api/receipts/parse-url/route.ts:8-19,79-92`), plus `importReceiptItems(body)` from `app/api/receipts/import/route.ts:26-107`.
**Why:** The SEFAZ allowlist is an SSRF guard — it must stay on the path an external, authenticated caller can reach, not be re-approximated in a new route.
**Depends on:** none

---

### Boundary order for every v1 write handler

**auth (step 6) → Zod (step 2) → `validateExpensePair`/`validateIncomeType` → service.**

Zod does **not** replace `validateExpensePair`. Category validity is a database question (`lib/utils/categoryUtils.ts:87`) against a collection users edit at runtime; it cannot live in a static schema. Encoding the category list into a `z.enum` at module load would freeze it at process start and break the moment a user adds a category — the same staleness class as the `useCategories` cache problem CLAUDE.md documents at length.

### 16. [API] Add `/api/v1/expenses`

**What:** `GET` (filters + pagination from step 9) and `POST` (step 8's builder; accepts `installments: N`, returns all created records plus the shared `transactionId`).
**Why:** The headline requirement — one call creates a full installment purchase, which no current endpoint does.
**Depends on:** steps 2, 6, 7, 8, 9

### 17. [API] Add `/api/v1/expenses/[id]` and `/api/v1/expenses/transactions/[transactionId]`

**What:** `GET`/`PUT`/`PATCH`/`DELETE` on a single record; `GET`/`DELETE` on a whole installment group.
**Why:** `?all=true` on a record id (`app/api/expenses/[id]/route.ts:67`) is awkward for a client that thinks in terms of "the purchase". A `transactionId` resource makes the installment group addressable, which is how the data is actually modelled.
**Depends on:** steps 2, 6, 7, 11

### 18. [API] Add `/api/v1/incomes` and `/api/v1/incomes/[id]`

**What:** Full CRUD over `incomeService`. Note the plural rename vs. the existing `/api/income`.
**Why:** The rename is deliberate — leaving `/api/income` untouched avoids touching `Dashboard.tsx:95` and `AddIncome.tsx:20`.
**Depends on:** steps 2, 6, 7, 12

### 19. [API] Add `/api/v1/bills/parse` and `/api/v1/bills/import`

**What:** `parse` accepts multipart (`file`, `cardBrand`, optional `password`) and returns `{ items, cardBrand, closingDate, dueDate }`, items carrying `type`/`subtype`/`recognized`/`isPossibleDuplicate` exactly as `ImportBill.tsx` receives them. `import` accepts the caller's edited `ConfirmedBillItem[]` plus `newMappings` and returns the three-way counter.
**Why:** The response must be directly re-postable, so the round-trip shape has to match what the review table posts today (`app/ImportBill.tsx:167`).
**Open decision:** multipart only, or also a base64 JSON variant. Multipart is what the UI uses and avoids a ~33% size penalty; base64 is friendlier to no-code callers (Zapier, n8n). Recommendation: multipart, adding JSON only if the intended caller cannot do multipart.
**Depends on:** steps 2, 6, 7, 13, 14

### 20. [API] Add `/api/v1/receipts/parse` and `/api/v1/receipts/import`

**What:** One `parse` endpoint taking **either** a multipart `file` **or** a JSON `{ url }`, dispatching to the two service functions; `import` takes the confirmed items + `newMappings` + `storeDefaultType` + `installments`.
**Why:** Merging today's `receipts/parse` and `receipts/parse-url` behind one v1 endpoint is safe because the response shape (`ParseResponse`) is already identical.
**Depends on:** steps 2, 6, 7, 15

### 21. [API] Add read-only `/api/v1/categories` and `/api/v1/card-cycles`

**What:** `GET` the category list (types + subtypes, filterable by `kind`) and `GET` the resolved cycle for a `(brand, month, year)`.
**Why:** Not in the original request, but the four requested APIs are unusable without it: every write validates `(type, subtype)` against the `Category` collection and returns 400 on a miss (`app/api/expenses/route.ts:21`), and categories are DB-driven and user-editable. An external caller has no way to discover valid values otherwise.
**Depends on:** steps 6, 7

---

### 22. [Integration] Refactor `AddExpense.tsx` onto the new create endpoint

**What:** Delete `generateExpenseData` (`app/AddExpense.tsx:27-110`) and the two `/api/card-cycles` fetches; submit the form once and let the server expand installments.
**Why:** Removes the duplicated cycle logic and makes the UI the first consumer of the public contract — the fastest way to prove the endpoint covers the real flow.
**Breaking-change risk:** the one step that can regress a working screen. Optional for shipping the API; can land as a separate PR. If deferred, client and server will disagree about the step-8 value-splitting rule in the meantime. Safest after the step-26 Bruno chain is passing, since that chain is what catches the discrepancy.
**Depends on:** step 16

### 23. [Integration] Publish the API contract

**What:** `docs/API.md` (auth header, error codes, the parse→edit→import round-trip for both bills and invoices) plus `public/openapi.yaml` **generated** by `scripts/gen-openapi.ts` from the Zod schemas (`zod-to-openapi`, or Zod 4's native JSON-Schema export), wired as an npm script. Consider a CI check that regenerates and diffs, failing on a stale spec.
**Why:** The round-trip is not guessable from endpoint names — a caller must know that `type: null` items are skipped, that subtypes are dropped when invalid for the type, and that `skippedExisting` is normal rather than an error. Generating the spec turns "the docs drifted" from a code-review catch into a build failure.
**Depends on:** steps 3, 16-21

---

### 24. [Tooling] Scaffold the Bruno collection

**What:** Create `bruno/` with `bruno.json` and a `collection.bru` declaring the auth header once at collection level (`x-api-key: {{process.env.API_KEY}}`) plus a `Content-Type` default. Add `@usebruno/cli` as a devDependency and a `test:api` npm script wrapping `bru run`.
**Why:** Bruno stores every request as a plain-text `.bru` file in the repo, so the collection versions alongside the routes it exercises — the reason to pick it over Postman. Declaring auth at collection level means the step-6 header is defined once; per-request copies would drift the moment the header name changes.
**Depends on:** step 6

### 25. [Tooling] Wire secrets and environments without committing them

**What:** `environments/local.bru` and `environments/docker.bru` carry only `baseUrl`. `API_KEY` comes from a gitignored `bruno/.env`, which Bruno auto-loads and exposes as `process.env.API_KEY`. Commit a `bruno/.env.example`.
**Why:** Bruno's `vars:secret` block still writes the variable *name* into the committed environment file and stores the value out-of-band, which is easy to misconfigure; the `.env` path is unambiguous and matches how the app reads secrets. Committing the key would put a credential to a live financial database into git history — a hard blocker, not a preference.
**Depends on:** steps 5, 24

### 26. [Tooling] Build the expense and income CRUD request chains

**What:** One folder per resource, `seq` ordering the requests into a lifecycle: create → capture id → read → update → delete → verify 404. Use `vars:post-response` to lift `_id` and `transactionId` out of the create response into runtime vars later requests interpolate. Add `assert` blocks on status and key fields, plus `tests` scripts for derived logic.

Cover specifically — these are the behaviours a unit test would miss:

- `POST` with `installments: 6` returns 6 records sharing one `transactionId`, `effectiveDate` advancing one cycle per installment
- `DELETE /expenses/transactions/{transactionId}` removes all 6; a single-record `DELETE` removes exactly one
- `PUT` switching `paymentType` from `credit` to `pix` returns a record with **no** `cardBrand`/`installment`/`totalInstallments` (the step-11 `$unset` rule)
- `POST` with a `pix` payment type *plus* a `cardBrand` returns 400 `VALIDATION_FAILED` (the step-3 discriminated union)
- `POST` with a nonexistent `type` returns 400 `INVALID_CATEGORY`, not `VALIDATION_FAILED`
- `PUT /incomes/{id}` with an invalid `type` returns 400 — the hole at `app/api/income/[id]/route.ts:26-33`

**Why:** The installment expansion and the `$unset` cascade are the two rules most likely to regress silently, and both are only observable across multiple requests.
**Depends on:** steps 16, 17, 18, 24. Write after step 23 so bodies are copied from the generated spec rather than invented alongside it.

### 27. [Tooling] Make the collection self-cleaning

**What:** Every chain ends by deleting what it created, and creates records with a recognizable marker (e.g. a `name` prefix `BRUNO_TEST_`). Add a `Cleanup` folder that lists and deletes anything carrying the marker.
**Why:** The genuinely risky part of this plan. The collection writes to whatever `baseUrl` points at, and the natural target during development is the real MongoDB holding real personal finances. A run that aborts mid-chain leaves orphan expenses in the user's dashboard totals. The marker makes the debris identifiable and removable; without it, cleanup means hand-picking rows out of the Dashboard.
**Depends on:** step 26

### 28. [Tooling] Add the bill and receipt request folders, excluded from the default run

**What:** `body:multipart-form` requests posting a fixture PDF via `@file(...)` to `/v1/bills/parse` and `/v1/receipts/parse`, then a follow-up `import` request echoing the parse response back. Commit **one** synthetic, redacted sample PDF; gitignore the rest of `bruno/fixtures/`. Tag these requests so they are skipped unless explicitly selected.

**Why** three separate reasons make these unfit for the default run:

- A real card statement or NF-e is personal financial data — committing one is a disclosure, and it is exactly the class of data the saved LGPD plan covers
- Both endpoints call OpenAI on every invocation, so an automated run is a recurring bill; `receipts/parse-url` additionally hits a live SEFAZ portal, which is someone else's infrastructure
- The bill PDF is password-protected with the operator's CPF (`PDF_KEY`, `app/api/bills/parse/route.ts:70`), so a committed fixture would need a committed CPF

They are still worth having: these are the hardest flows to exercise by hand, and a redacted fixture makes the deterministic Santander/Caixa parsers testable without touching real data.

**Depends on:** steps 19, 20, 24

### 29. [CI] Add an opt-in `api-test` job

**What:** A job that starts `mongodb` + the app via the compose `prod` profile, waits for readiness, seeds categories, then runs `bru run bruno --env docker -r --reporter-junit`. Trigger on `workflow_dispatch` and tag pushes only. Skip the step-28 folders.
**Why:** The existing `lint` and `build` jobs deliberately receive **no** secrets (CLAUDE.md, CI/CD section) so a regression where something connects at build time stays visible. `api-test` needs `MONGODB_URI` and `API_KEY` at minimum, so it must be a separate job and must not inherit their triggers. Keeping it off the every-push path also avoids adding a container start to every branch build.

It cannot simply be appended to the `lint ∥ build ∥ verify-tag → docker → release` graph: it needs the built image, so it belongs after `docker`, but gating `release` on it would make every release depend on a live database being reachable from the runner.

**Depends on:** steps 26, 27

---

### 30. [Cross-cutting] Update `CLAUDE.md`

**What:** Document the `/api/v1` namespace, the auth guard, the `lib/services/` layer, `API_KEY` in the Environment section, the four-stage boundary order, and the rule that dynamic-category validation never moves into Zod. Document `bruno/` and `npm run test:api`.
**Why:** CLAUDE.md currently documents `app/api/**` as the API surface and `types/index.ts`/`lib/utils` as the only shared logic. A new service layer that becomes the single source of truth for installment expansion has to be recorded there, or the next change will re-duplicate it. The "no category enums in Zod" rule is the one most likely to be "simplified" away by a future change.
**Depends on:** steps 8, 16-21, 24

---

## Out of scope — flagged deliberately

A static `API_KEY` gives authentication but no per-caller attribution, no rate limiting and no audit trail — the gaps the saved LGPD plan (2026-05-20) already tracks. Exposing write endpoints to the internet makes those gaps materially larger than they are with a UI-only app. Rate limiting matters most on `bills/parse` and `receipts/parse`, which call OpenAI on every request and are therefore a direct cost-amplification vector.
