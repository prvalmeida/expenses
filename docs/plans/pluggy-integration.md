# Plan — Pluggy (Open Finance) ingestion

Status: **proposed**
Created: 2026-09-06
Revised: 2026-09-06 — reviewed against the codebase; see the changelog at the end.

Pulls bank and credit-card transactions from Pluggy on a schedule, stages them, auto-imports
the ones whose merchant is already classified, and queues the rest for review. Replaces the
fatura-PDF import as the primary path for the three cards; the PDF parsers stay as the fallback.

Decisions taken before writing this (they are the reason several steps look the way they do):

- **Runtime:** VPS managed by Easypanel. The scheduler is an Easypanel scheduled task hitting
  an authenticated route over the internal Docker network — not an in-process timer.
- **Ingestion shape:** staging collection → auto-import on a `BillMapping` hit → review screen
  for the rest.
- **Cards:** Pluggy is the primary source for all three cards; PDF import becomes fallback.
- **Scope:** expenses *and* incomes; **no backfill** — only transactions dated on or after the
  moment an account is linked.

---

## 0. What must be verified before writing code

This plan is written from research notes, not from a live account. **Step 1 is a spike**, and
every field name below is a hypothesis until it passes:

| Assumption | Where it bites if wrong |
|---|---|
| Connector 200 + Meu Pluggy credentials yields an item whose `/accounts` lists every bank the user connected there | Steps 3, 6 — the whole multi-account model |
| `transaction.type` is `'DEBIT' \| 'CREDIT'` and the `amount` sign agrees with it | Step 8 — direction detection |
| `transaction.paymentData.paymentMethod` carries `'PIX'` | Step 8 — the `pix` payment type |
| `transaction.creditCardMetadata.{installmentNumber,totalInstallments}` exists on card rows | Step 9 — installment expansion |
| `transaction.id` is stable across syncs and across a `PENDING → POSTED` transition | Step 5 — the entire idempotency story |
| `GET /transactions` accepts `accountId`, `from`, `to`, `page`, `pageSize` | Step 4 — the fetch loop |
| A card installment row's `date` is the **posting** date of that installment, not the original purchase date | Step 11 — the anchor date of the expanded group |
| `transaction.status` distinguishes `PENDING` from `POSTED`, and a `PENDING` row can change amount or disappear | Steps 5 and 11 — what may be auto-imported |
| An item can be created from a Connect token in the browser, so raw Meu Pluggy credentials never reach our server | Steps 2 and 3 — how a connection is established |

Run the spike against one real account, dump one raw transaction of each kind (card purchase,
card installment, PIX out, PIX in, debit, salary, card-bill payment) into
`docs/plans/pluggy-samples.md` **with values redacted**, and correct this plan before step 2.
If `transaction.id` is *not* stable across `PENDING → POSTED`, stop and re-plan: the fallback
key is `(accountId, date, amount, descriptionRaw)` and it is materially weaker.

---

## 1. Architecture

```
Meu Pluggy (each family member consents to their banks there)
        |
        |  connector 200, their Meu Pluggy credentials
        v
   PluggyItem  -->  PluggyAccount[]  (BANK | CREDIT, one link row each)
        |
        |  POST /api/v1/pluggy/sync   (Easypanel cron, every 6h)
        v
   PluggyTransaction  (staging, unique on pluggyId)
        |
        +-- BillMapping hit + category still valid --> Expense / Income  (status: imported)
        +-- no mapping / orphaned category          --> review screen    (status: pending)
        +-- ignore rule (card payment, own transfer)--> nothing          (status: ignored)
```

Three properties the design is built around:

- **The staging collection is the only thing that knows about Pluggy.** `Expense` gains no new
  field, no data migration is needed, and `expenseService`/`incomeService` stay unaware of the
  source. The link back (`PluggyTransaction.importedExpenseIds`) lives on the staging side.
- **Nothing is inserted twice**, because `pluggyId` is uniquely indexed and the staging row's
  own status is the record of what happened to it.
- **Staged rows are deliberately outside the category cascade.** `suggestedType`/`suggestedSubtype`
  on a `pending` row are hints, not stored classifications: `cascadeRename*` and
  `countAssociatedFor*` (`categoryUtils.ts:124-180`) are not extended to `PluggyTransaction`, and a
  rename simply makes a suggestion stale. Step 11 already re-validates every pair at import time and
  keeps a failing one pending, so a stale hint degrades to "needs review" — which is the correct
  outcome, and the reason this collection may stay out of the four cascades that `BillMapping`
  cannot.
- **Mapped-and-imported is the fast path, not the only path.** Every transaction lands in
  staging first; auto-import is a second phase over staged rows, so a bad mapping produces a
  reversible import, not a lost transaction.

### Why `BillMapping` is reused rather than a new `PluggyMapping`

`BillMapping` already *is* "normalized merchant description → (type, subtype)", and
`cascadeRenameExpenseType` / `cascadeRenameExpenseSubtype` / `cascadeReassignExpenseType` in
`categoryUtils.ts` already update it, as do the delete-guard counts. A parallel collection would
have to be threaded into all four cascades plus `countAssociatedFor*`, and forgetting one
silently orphans mappings — the exact failure CLAUDE.md documents for the category cascade.
Keys go through the existing `billMappingKey()`. A Pluggy description colliding with a bill
description is harmless when it happens — it is the same merchant — but do not plan on it: Pluggy's
`description`/`merchantName` and the text the Santander/Caixa PDF parsers recover are different
strings for the same store, so the two sources will mostly build **disjoint key sets** inside one
collection. The reuse is justified by the cascades, not by shared keys.

Incomes get **no** mapping table (see step 13).

---

## 2. Data model

Three new collections in `lib/models/`, all `strict: true`, matching the house style.

### `PluggyItem` — one connection (one family member's Meu Pluggy account)

```ts
{
  itemId: string,               // Pluggy item UUID — unique index
  connectorId: number,          // 200 for Meu Pluggy
  label: string,                // "Pedro", "Carol" — shown in the UI
  status: string,               // UPDATED | UPDATING | LOGIN_ERROR | WAITING_USER_ACTION | OUTDATED
  statusDetail?: string,
  lastPluggyUpdatedAt?: Date,   // item.lastUpdatedAt as reported by Pluggy
  lastCheckedAt?: Date,         // when *we* last polled it
  createdAt: Date,
}
```

### `PluggyAccount` — one account inside an item; the link row

```ts
{
  accountId: string,          // Pluggy account UUID — unique index
  itemId: string,             // -> PluggyItem.itemId, indexed
  kind: 'BANK' | 'CREDIT',
  name: string,               // Pluggy's marketingName/name, display only
  number?: string,            // masked tail, display only
  enabled: boolean,           // false = fetched into staging but never imported
  // CREDIT only. Must be one of the CardBrand enum values — see the constraint below.
  cardBrand?: string,
  // BANK only. Used when the ladder in step 8 cannot narrow further.
  defaultPaymentType?: string,   // 'debit'
  // BANK only, optional. Set it and inflows on this account auto-import as Income with
  // this type; leave it unset and every inflow goes to review.
  defaultIncomeType?: string,
  connectedAt: string,        // YYYY-MM-DD. No transaction dated before this is ever fetched.
  lastSyncedAt?: Date,        // high-water mark for the fetch window
}
```

> **Constraint — `cardBrand` is enum-locked.** `Expense.cardBrand`, `CardCycle.cardBrand` and
> `DEFAULT_SETTINGS` in `cycleUtils.ts` all key off the three `CardBrand` values
> (`Master Santander`, `Visa Caixa`, `Elo Caixa`). A Pluggy CREDIT account must map onto one of
> them, and the link row is validated against `Object.values(CardBrand)` at the boundary.
> Connecting a *fourth* card is a separate change touching the enum, `DEFAULT_SETTINGS`, both
> model enums and the card-config UI — deliberately out of scope. The link row's validation is
> what turns that into a clear 400 instead of a document Mongoose rejects at insert time.

### `PluggyTransaction` — staging

```ts
{
  pluggyId: string,           // unique index — the idempotency key
  accountId: string,          // indexed
  itemId: string,
  // --- raw, as returned; never edited after import (step 5) ---
  date: string,               // YYYY-MM-DD
  amount: number,             // as returned, sign included
  currencyCode: string,
  descriptionRaw: string,
  description: string,        // whitespace-normalized
  merchantName?: string,
  pluggyCategory?: string,
  pluggyStatus: string,       // POSTED | PENDING
  installmentCurrent?: number,
  installmentTotal?: number,
  paymentMethod?: string,     // PIX | TED | BOLETO | ...
  raw: unknown,               // Schema.Types.Mixed — `strict: true` drops an untyped object
                              // outright; kept for debugging a bad derivation
  // --- derived (step 8) ---
  direction: 'outflow' | 'inflow',
  paymentType?: string,       // credit | debit | pix | ...
  cardBrand?: string,
  // --- our state ---
  status: 'pending' | 'imported' | 'ignored' | 'skipped_existing' | 'anomaly',
  statusReason?: string,
  suggestedType?: string,
  suggestedSubtype?: string,
  importedExpenseIds?: string[],
  importedIncomeId?: string,
  firstSeenAt: Date,
  lastSeenAt: Date,
}
```

Indexes: `{ pluggyId: 1 }` unique, `{ status: 1, date: -1 }` (the review screen's only query),
`{ accountId: 1, date: -1 }`.

---

## 3. Steps

One commit per step, in this order. Steps 1–14 are the backend and are independently useful;
15–19 are the UI; 20–24 are ops, tests and docs.

### Phase A — client and connection

**1. Spike: confirm the API shape.** Throwaway script under the scratchpad (not committed), run
against one real account. Produce `docs/plans/pluggy-samples.md` (redacted) and amend the table
in §0. **Do not proceed on an unverified field name.**

**2. `lib/pluggy/client.ts` — the HTTP client.** Same global-cache singleton shape as
`lib/openai.ts`.

- `getApiKey()`: `POST /auth` with `{ clientId, clientSecret }`, caches the 2h key with a
  5-minute safety margin, single-flight so concurrent callers share one request.
- `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` are read **inside** `getApiKey()`, never at module
  scope — the CI `lint`/`build` jobs run with no secrets, and a module-scope read makes the
  build depend on one (the same rule as `requireApiKey` and `connectToDatabase`).
- Thin typed wrappers: `listAccounts(itemId)`, `getItem(itemId)`, `listTransactions({ accountId,
  from, to, page, pageSize })`, `createConnectToken()`, `patchItem(itemId)` (the manual refresh of
  §5). **No `createItem(connectorId, credentials)`** — see step 3.
- Hand-rolled over `fetch`, **no `pluggy-sdk` dependency**. Everything needed is four endpoints, and
  a new runtime dependency has to be reasoned about against `serverExternalPackages` and the
  standalone-output tracing rules in CLAUDE.md for no gain.
- Non-2xx throws `ApiError('UPSTREAM_FAILED', …)` carrying Pluggy's own message. A 5xx or a
  network error retries twice with backoff; a 4xx never retries.
- No `next/server` import — it sits below the service layer.

**3. `lib/services/pluggyService.ts` — `registerItem` / `refreshAccounts`.**

**Credentials never transit this app.** The item is created in the browser by Pluggy Connect,
which our server authorizes with a short-lived connect token (`POST /api/pluggy/connect-token`,
returning `createConnectToken()`'s value and nothing else); the widget hands back an `itemId` that
step 3 then registers. Accepting Meu Pluggy username/password on our own route would put a bank
credential through a Next.js server whose internal `/api/*` surface is unauthenticated — the
opposite direction from the LGPD plan already on file, and unnecessary. `PluggyItem` stores an
`itemId` and never a secret.

`registerItem({ itemId, label })` calls `getItem`, upserts `PluggyItem`, then `listAccounts` and
upserts one **disabled** `PluggyAccount` per account with `connectedAt = today`. Accounts start
disabled on purpose: enabling one is the act that says "I have picked its `cardBrand` /
`defaultPaymentType`", and a half-configured CREDIT account would otherwise import expenses with
no `cardBrand` — a document `CreditExpense` says cannot exist.

### Phase B — fetch into staging

**4. `syncAccount(accountId, { dryRun })`.** For one enabled account:

- Window: `from = max(connectedAt, lastSyncedAt − OVERLAP_DAYS)`, `to = today`.
  `PLUGGY_SYNC_OVERLAP_DAYS` defaults to **5**. The overlap is not optional: card transactions
  post late, and `PENDING` rows change after we first see them.
- Page through `listTransactions` until a short page. Hard-cap the page count (say 50) so a
  pagination bug cannot loop forever.
- Upsert each row by `pluggyId` (step 5), then set `lastSyncedAt = now` **only after** the whole
  account succeeded — a partial page must be re-fetched, and the overlap alone is not a
  guarantee if the failure outlasted it.
- `dryRun: true` fetches and reports counts, writing nothing (the same contract a migration's
  dry run has).

**5. Upsert semantics — the idempotency rule.** `findOneAndUpdate({ pluggyId }, …, { upsert: true })`:

- **New** → insert with `status: 'pending'`, `firstSeenAt = lastSeenAt = now`.
- **Exists, still `pending`/`ignored`** → refresh the raw fields, re-derive, bump `lastSeenAt`.
- **Exists and `imported`** → **never touch the raw fields.** If `amount` or `date` changed since
  import, set `status: 'anomaly'` with a reason and leave the `Expense` alone. Editing an already
  posted expense is a decision for a human, not for the poller.

**6. `syncAll({ dryRun })` + the advisory lock.** Iterates enabled accounts, refreshes each item's
status first, and continues past a single failing account (collecting errors) so one `LOGIN_ERROR`
bank does not stop the others. Wrap the whole run in a Mongo lock using the same trick as the
migration ledger: insert a `PluggySyncLock` doc with a unique `_id` **before** any work, delete it
after, take over a lock older than 30 minutes. Two overlapping cron firings must not both page the
same account. Returns
`{ accounts: [{ accountId, fetched, created, updated, anomalies, error? }], items: [{ itemId, status }] }`.

### Phase C — derivation

**7. `lib/utils/pluggyUtils.ts` — pure functions, no DB, no network.** This is where the
`test:unit` coverage lives; keeping it pure is the point.

**8. `derivePaymentType(tx, account)` — the ladder.** In order, first match wins:

| Condition | Result |
|---|---|
| `account.kind === 'CREDIT'` | `paymentType: 'credit'`, `cardBrand: account.cardBrand` |
| `paymentData.paymentMethod === 'PIX'` | `'pix'` |
| `paymentData.paymentMethod` in `TED` / `DOC` / `TRANSFER` | `'debit'` (the app has no transfer type) |
| `paymentData.paymentMethod === 'BOLETO'` | `'debit'` |
| otherwise | `account.defaultPaymentType ?? 'debit'` |

Voucher types (`food-voucher`, `meal-voucher`, `fuel-voucher`) are **not** derivable from Pluggy
and are only ever set by hand in the review screen.

**Direction** uses `tx.type` as primary with the sign of `amount` as a cross-check. When the two
disagree the row is written `status: 'anomaly'` rather than guessed — a sign error turns an income
into an expense, and there is no cheap way to notice that later.

**9. `deriveInstallments(tx)`.** Reads `creditCardMetadata.installmentNumber` / `totalInstallments`,
then applies the same plausibility guard the Caixa bill parser uses (`isPlausibleInstallment`:
`total > 1 && 1 <= current <= total`) and the `MAX_INSTALLMENTS` (72) bound from
`schemas/common.ts`. That guard is currently module-private (`lib/utils/billUtils.ts:220`), so this
step **exports it** and leaves the Caixa parser calling the same symbol — re-implementing it in
`pluggyUtils.ts` would be exactly the duplication CLAUDE.md forbids for `computeEffectiveDate` and
`billMappingKey`. Pluggy's metadata is far more trustworthy than a regex guess, but the bound is
what stops one bad row from expanding into thousands of documents.

**10. `shouldIgnore(tx, account)` — the double-counting guard.** The highest-risk correctness item
in the plan. Each rule exists because without it the ledger silently inflates:

- **Inflow on a CREDIT account** (a bill payment or a refund posting as a credit) → `ignored`.
  Importing it as Income would book the card payment as household income.
- **Outflow on a BANK account matching a card-bill payment** (`PAGAMENTO FATURA`, `PAGTO CARTAO`,
  …) → `ignored`. The purchases on that bill already came in from the CREDIT account; the payment
  is the same money a second time.
- **Own transfer**: `paymentData.payer`/`receiver` document in a configured own-CPF list
  (`PLUGGY_OWN_DOCUMENTS`, comma-separated), or the counterparty being another linked
  `PluggyAccount` → `ignored`, both legs.

Rules are a plain exported array of `{ id, test, reason }`, so `statusReason` names the rule that
fired and the review screen can show ignored rows with a one-click un-ignore.

### Phase D — import

**11. `autoImportStaged()` — expenses.** Over `status: 'pending'` outflows **whose `pluggyStatus`
is `POSTED`**:

A `PENDING` row is fetched and staged but never auto-imported. Its amount can change and it can
disappear entirely — and a row that disappears is never re-fetched, so step 5's anomaly check (which
only fires on a row we *see* again) would not catch it, leaving a phantom `Expense` nothing points
at. Pending rows are visible in the review screen, flagged, and importable by hand (step 14).


1. `BillMapping.findOne({ description: billMappingKey(tx.description) })`. Miss → stays pending.
2. Hit → `validateExpensePair(type, subtype)`. **Fail → stays pending**, carrying the mapping's
   values as `suggestedType`/`suggestedSubtype`. A mapping pointing at a renamed-away category must
   surface in review, never import an orphan — the rule both existing import screens follow.
3. Pass → build documents via `buildExpenseDocuments`, insert, set `status: 'imported'` and
   `importedExpenseIds`.

**Installment expansion matches the bill import**: a credit row with `installmentTotal = 6` expands
into six documents sharing one `transactionId`, with `valueIsTotal: false` (the row is already one
installment's amount). When Pluggy later delivers installment 2 of the same purchase, step 12 skips
it. The alternative — one document per Pluggy row as it posts — was rejected because the Dashboard's
"FLUXO DE CAIXA" view would then show no future installments, a regression against today's PDF flow.

**The anchor date is not the row's date.** `buildExpenseDocuments` treats `input.date` as
installment 1 and walks forward with `addMonthsClamped(date, i - 1)`
(`lib/services/expenseService.ts:56-73`). The bill import can pass the row date straight through
(`billService.ts:213`) because a fatura row carries the original purchase date; a Pluggy row carries
the date *that installment* posted. Passing it unchanged would file a `04/06` purchase seen at
installment 3 as a purchase made in August and push its last installment two months past reality.
So the caller derives `purchaseDate = addMonthsClamped(row.date, -(installmentCurrent - 1))`
(`addMonthsClamped` handles negative months correctly — `dateUtils.ts:6-13`) and passes that.
`installmentCurrent` is therefore **required** to expand: a row with a `total` but no plausible
`current` stays `pending` with a reason rather than being expanded from an unknown offset. This is
the one place the Pluggy path must not copy `billService` verbatim, and a `test:unit` case belongs
on it (step 22).

**12. The `skipped_existing` check.** Two overlaps to defend against, and they need different
answers — the earlier draft of this step conflated them.

*Within Pluggy* (installment 2 of a group installment 1 already expanded): reuse `billService`'s
guard **exactly as written** (`billService.ts:227-236`) — an exact match on
`{ name, value, date, cardBrand, installment, totalInstallments }`, applied only to expanded
installment rows. It works there because both sides of the comparison were produced by
`buildExpenseDocuments` from the same anchor date, which is only true once step 11's anchor
correction is in place.

*Across sources* (a purchase already imported from a fatura PDF): **do not attempt a fuzzy match.**
`Expense.name` from the PDF is the parser's recovered text and `name` from Pluggy is Pluggy's
description — different strings for the same merchant (the same reason the `BillMapping` keys stay
disjoint, §1). A `value` + `date ±3d` match without a reliable name comparison would silently
suppress two genuinely distinct same-price purchases, which is a *worse* failure than a duplicate,
because a missing row is invisible. The real guard is the **cutover date** already in the model:
`connectedAt` bounds the fetch window (step 4), so nothing predating the link is ever imported. Add
the matching operational rule to step 20's notes and §5 — once a card's Pluggy account is enabled,
stop importing that card's fatura PDFs for periods on or after `connectedAt`.

`skipped_existing` is not an error and never gates anything — the same rule that keeps
`skippedExisting` out of the bill import's failure path.

**13. `autoImportStaged()` — incomes.** Over `status: 'pending'` inflows on BANK accounts:
`account.defaultIncomeType` set and `validateIncomeType` passing → create the `Income` and mark
imported; otherwise stay pending for review.

There is deliberately **no** income mapping collection. Inflows are low-volume and repetitive
(salary, a handful of PIX), and a new mapping table would have to be threaded into
`cascadeRenameIncomeType` and the delete-guard counts — cost with no matching benefit. The
per-account default covers the salary case; everything else is two clicks a month.

**14. `importStaged(items)` — the manual path.** Takes explicit `{ pluggyId, kind: 'expense' |
'income', type, subtype?, paymentType, cardBrand?, newMapping?: boolean }` rows from the review
screen, validates each pair, imports, and upserts a `BillMapping` when `newMapping` — so the next
occurrence of that merchant auto-imports. Returns `{ imported, skippedInvalid, skippedExisting }`,
the same three-count envelope as the bill import, with the same rule that only `skippedInvalid` is
actionable.

### Phase E — routes

**15. Public surface `app/api/v1/pluggy/`** — every handler `auth → Zod → category validation →
service → envelope`:

- `POST /api/v1/pluggy/sync` — `?dryRun=true`, `?accountId=`. **This is the cron target.**
- `GET /api/v1/pluggy/items` — item health, for monitoring.
- `POST /api/v1/pluggy/items` — register an item.
- `GET /api/v1/pluggy/transactions` — staged rows, filterable by `status`/`accountId`, keyset
  paginated like `listExpenses`.
- `POST /api/v1/pluggy/connect-token` — mints the short-lived widget token of step 3.

**16. Internal surface `app/api/pluggy/`** — unauthenticated, for the UI only, per the rule that
client code never points at `/api/v1/*`: `GET /transactions?status=pending`, `POST /import`,
`GET|PUT /accounts` (the link rows), `POST /sync` (a "sincronizar agora" button). Every one of them
delegates to `pluggyService` — the *service* is what gets shared, never the route.

**17. `lib/api/schemas/pluggy.ts`.** Query schemas use `z.coerce`; body schemas do not. Every
primitive is **imported from `schemas/common.ts`, not redeclared**: `installmentCount` for the
installment fields, `cardBrand` (already `z.enum(CardBrand)` there — the repo is on Zod 4, where
`z.nativeEnum` is deprecated, so do not introduce it), `paymentType` for the derived/overridden
payment type, `isoDate`, `brlAmount`, `objectId`, and `paginationQuery` for the staged-row listing.
The link-row PUT refines `kind === 'CREDIT' → cardBrand required`, mirroring the credit ↔ `cardBrand`
pairing enforced on every other write path — and note `defaultPaymentType` must be constrained to
the non-credit members of `PAYMENT_TYPES`, since a BANK account defaulting to `'credit'` would mint
the `cardBrand`-less credit document that refinement exists to prevent.

### Phase F — UI

**18. `app/PluggySync.tsx` — the review screen.** Modeled directly on `ImportBill.tsx`:

- `hidden md:table` table plus `md:hidden` card list, with the `indeterminate` callback ref applied
  to **both** inputs.
- `effectiveType`/`effectiveSubtype` helpers that short-circuit to valid while `categoriesLoading`,
  blank the `<select>` on an orphaned value, and feed the "sem categoria válida" banner.
- Confirm disabled while `categoriesLoading`; the payload built from the **same resolved values**
  the gate checked, never from raw state.
- `newMappings` compares resolved values against the *effective* suggested ones.
- Sections: pending expenses, pending incomes, ignored (collapsible, un-ignorable), anomalies.

**19. `app/PluggyConfig.tsx` + `app/page.tsx` wiring.** Two new views, `pluggySync` and
`pluggyConfig`, added to the `currentView` union and the nav. Config lists items with a status badge
(`LOGIN_ERROR` → "reconecte no Meu Pluggy") and accounts with enable / `cardBrand` /
`defaultPaymentType` / `defaultIncomeType` controls, plus the Pluggy Connect entry point of step 3.

Disconnecting is **disable, not delete**: unchecking `enabled` stops the fetch and the import while
leaving the item, the link row and every staged row in place. Deleting the item (and Pluggy-side
consent revocation) is out of scope here — a delete would have to decide what happens to already
imported `Expense` documents, and the answer is "nothing", which is exactly what disabling gives.

### Phase G — ops, tests, docs

**20. Easypanel scheduled task.** A scheduled task on the existing service running:

```sh
curl -fsS -X POST -H "x-api-key: $API_KEY" http://<service>:3000/api/v1/pluggy/sync
```

Cron `0 */6 * * *`. Notes:

- It targets the **internal** service name over the Docker network, so the sync route needs no
  public exposure and the key never leaves the VPS.
- `-f` makes a non-2xx a non-zero exit, so a failing sync shows as a failed task rather than a
  green run with an error body.
- If the installed Easypanel version has no scheduled-task feature, the fallback is a second tiny
  Compose service (`curlimages/curl`) running a `sleep`/`curl` loop on the same network — **not** a
  timer inside the Next.js process, which would multiply with replicas and repeat the mistake
  CLAUDE.md already forbids for migrations.
- Document both in `README_DOCKER.md`.
- Document the **cutover rule** from step 12 alongside it: enabling a CREDIT account retires that
  card's fatura-PDF import for periods on or after `connectedAt`. Nothing enforces it in code (the
  PDF import has no knowledge of Pluggy), so it is an operational rule or it is nothing.

**21. `npm run pluggy:sync` (`scripts/pluggy-sync.ts`).** For a checkout, sharing the service with
the route exactly as `scripts/migrate.ts` does — the `runner` image ships only `.next/standalone`
and cannot run a tsx script, so production uses the route and the CLI is a development convenience.
Flags through `parseFlags` from `scripts/lib/cliEnv.ts` (`--dry-run`, `--account`), errors through
`describeApiError`.

**22. `test:unit` for `pluggyUtils.ts`.** A new `tests/pluggy-utils.test.ts` (the `test:unit` glob
is `tests/**/*.test.ts`). The derivation ladder, the direction cross-check, installment
plausibility, the **anchor-date back-off of step 11** (a 3-of-6 row must yield the purchase month,
including across a year boundary and from a day-31 date), and every ignore rule — table-driven off
the redacted samples from step 1. No DB, so it runs on the every-push CI path.

**23. Bruno requests under `bruno/Pluggy/`.** Untagged (they must keep running in CI): auth
rejection, `VALIDATION_FAILED` on a bad link row, `INVALID_CATEGORY` on an import naming a dead
category, the `cardBrand`-required refinement, `installmentTotal` over the bound. Tagged `external`:
a real `POST /sync` against a live account. Records named `BRUNO_TEST_*`, swept by `Cleanup`.

**24. Wiring and docs.**

- Add the three models to `POST /api/admin/sync-indexes` — existing deploys must run it once.
- `npm run gen:openapi` (CI's `lint` job fails on a stale spec).
- `docs/API.md`: the `/api/v1/pluggy/*` contract.
- `.env.example` and the Environment section of `CLAUDE.md`: `PLUGGY_CLIENT_ID`,
  `PLUGGY_CLIENT_SECRET`, `PLUGGY_SYNC_OVERLAP_DAYS`, `PLUGGY_OWN_DOCUMENTS`.
- A CLAUDE.md Architecture section covering staging-owns-the-link, the ignore rules, the
  `BillMapping` reuse, the `cardBrand` enum constraint, why `PluggyTransaction` is deliberately
  *outside* the category cascades, and why the Pluggy installment anchor date differs from the bill
  import's.
- **No data migration is needed** — nothing existing is rewritten.

---

## 4. Sequencing

| Milestone | Steps | Outcome |
|---|---|---|
| Spike | 1 | The plan is confirmed or corrected |
| Backend, no UI | 2–14 | `npm run pluggy:sync` fills staging and auto-imports; verify against the DB |
| Reachable | 15–17 | Cron can run it; spec and docs current |
| Usable | 18–19 | Review screen — the integration is done from a user's point of view |
| Hardened | 20–24 | Scheduled, tested, documented |

Ship 2–14 behind no flag: with every account starting **disabled**, an unconfigured deploy syncs
nothing.

---

## 5. Risks, stated plainly

- **Double counting is the failure that matters.** Card purchases arrive from Pluggy *and* from any
  fatura PDF imported for an overlapping period, and the card-bill payment on the checking account
  is the same money a third time. Step 10 guards the third; step 12 guards the second only *within*
  Pluggy, and the PDF overlap is closed by the `connectedAt` cutover and the operational rule that
  goes with it (stop importing a card's PDFs once its Pluggy account is enabled) — not by a fuzzy
  match, which would suppress real purchases. Before enabling a CREDIT account, run one sync with
  `--dry-run` and reconcile a single closed month by hand against the PDF.
- **The sync cadence is Pluggy's, not ours.** Auto-sync on the personal tier is roughly daily and is
  not configurable without an account manager. A 6h cron mostly re-reads the same data — that is
  fine (it is cheap and idempotent) but it does **not** make ingestion 6-hourly. `PATCH /items/:id`
  can force a refresh; use it from the "sincronizar agora" button only, never from the cron.
- **Consent expires (~12 months) and logins break.** Item status is polled every run and shown in
  `PluggyConfig`; a Telegram or push nudge on `LOGIN_ERROR` / `WAITING_USER_ACTION` is a worthwhile
  follow-up but is not in this plan.
- **Meu Pluggy is personal-use only.** Every linked account must be a nominal account belonging to
  the household; commercial use requires a paid plan.
- **This puts full bank transaction history into a database whose internal `/api/*` surface has no
  authentication.** That materially raises the stakes of the gaps in the LGPD plan already on file —
  worth revisiting before enabling a second family member's accounts.

## 6. Explicit non-goals

Telegram inline-keyboard categorization; iOS Shortcuts / Wallet ingestion; server-side email
ingestion; a unified `/ingest` endpoint with a `source` field; a `pending`/`confirmed`/`orphan`
reconciliation state machine across sources; GPT classification of Pluggy rows (the mapping table
plus `pluggyCategory` hints should cover it — revisit only if the review queue stays noisy);
retiring the fatura-PDF parsers; a fourth card brand.

---

## 7. Review changelog (2026-09-06)

Verified against the codebase; the plan's structural claims held (the `BillMapping` cascade
argument, the `cardBrand` enum lock, the `UPSTREAM_FAILED` code, the boundary and service-layer
rules). Substantive corrections made:

1. **Installment anchor date** (step 11) — `buildExpenseDocuments` walks forward from `input.date`,
   so a mid-series Pluggy row must be backed off by `installmentCurrent - 1` months. Previously the
   plan said "matches the bill import", which would have filed every installment purchase in the
   wrong month. Highest-impact fix in this pass.
2. **`PENDING` rows are never auto-imported** (step 11) — a pending row can vanish, and step 5's
   anomaly check only fires on rows seen again.
3. **Cross-source dedupe rewritten** (step 12) — the proposed `value` + `date ±3d` + name match
   would suppress distinct same-price purchases; replaced with the exact `billService` guard inside
   Pluggy plus the `connectedAt` cutover across sources, and the cutover written down as an
   operational rule (step 20, §5).
4. **No bank credentials through this app** (steps 2, 3, 15) — `createItem(connectorId, credentials)`
   replaced by a Connect token minted server-side and an item created in the browser.
5. **`isPlausibleInstallment` must be exported** (step 9) — it is module-private at
   `billUtils.ts:220`, and duplicating it is what CLAUDE.md forbids.
6. **Schema primitives are imported, not redeclared** (step 17) — `schemas/common.ts` already
   exports `cardBrand` as `z.enum(CardBrand)` (Zod 4; `z.nativeEnum` is deprecated), plus
   `paymentType`, `installmentCount`, `isoDate`, `brlAmount`, `paginationQuery`. Added the
   `defaultPaymentType` ≠ `'credit'` constraint.
7. **Staged rows stay outside the category cascades** (§1, step 24) — stated explicitly, with the
   reason it is safe, so a later reader does not "fix" it by threading `PluggyTransaction` into
   `cascadeRename*`.
8. Smaller: `raw` needs `Schema.Types.Mixed` under `strict: true`; no `pluggy-sdk` dependency; the
   `BillMapping` key-collision benefit is largely illusory (the reuse still stands on the cascades);
   test file path `tests/pluggy-utils.test.ts` plus anchor-date cases; disconnect = disable, not
   delete; three new rows in the §0 spike table.

Unchanged and still correct: the staging-first shape, the advisory lock modelled on the migration
ledger, accounts-start-disabled, the ignore-rule set, the three-count import envelope, the
Easypanel cron over the internal network, and the non-goals.
