---
name: reviewing-code
description: Review a diff, branch or PR in this codebase and report findings classified BLOCKING / WARNING / SUGGESTION with file:line references and a verdict. Use when asked to review code, check a change before committing, or assess a pull request.
---

# Reviewing code

Find real problems. Do not praise the work, do not pad the report, do not restate the diff.

## When to use

- Reviewing a branch, PR or uncommitted diff
- A pre-commit check before pushing
- Assessing whether a change is safe to release

Do not use for: writing the fix (`implementing-features`) — review first, then hand the
findings over. For a change that does not exist yet, use `planning-and-architecture`.

## Process

1. Establish the change set for real:
   ```bash
   git status --porcelain
   git fetch origin main
   git diff origin/main...HEAD --stat
   git diff origin/main...HEAD
   ```
   Diff against `origin/main`, never a local `main` — a stale local branch silently yields
   the wrong change set, with no error to tell you the review missed commits.
2. Read every changed file **in full**, not just the hunks. Most blocking findings in this
   repo come from what the diff did *not* touch (a sibling route left inconsistent, a
   cascade not extended, a stale generated file).
3. Read `AGENTS.md` and the `CLAUDE.md` sections covering the touched areas. A change that
   contradicts a documented invariant is BLOCKING even when it works.
4. Classify every finding at exactly one severity. Never merge two severities into one item.

## Severity definitions

| Level | Meaning |
|---|---|
| **BLOCKING** | Must be fixed before merge. Correctness bug, security hole, data-loss or double-counting risk, broken API contract, type error, or a violation of a documented project invariant. |
| **WARNING** | Should be fixed. Performance problem, maintainability issue, inconsistency with an established pattern, missing validation at a boundary. |
| **SUGGESTION** | Optional. Naming, style, a minor abstraction, a note for later. |

## What to check

General:
- Correctness against the stated intent.
- TypeScript: no unsafe `any`, no suppressed errors, honest return types.
- Security: unvalidated external input, injection, exposed secrets, auth/authz gaps,
  SSRF on any URL-fetching path.
- Data integrity: schema correctness, missing indexes, required fields, `$unset` vs
  assigning `undefined`.
- React/Next: Server vs Client component boundaries, no server-only logic leaked to the
  client, no needless re-renders.
- Dead code, unused imports, copy-pasted logic that a shared helper already covers.

Project-specific — the recurring failure classes in this codebase:
- **Duplicated single sources of truth.** Logic re-inlined instead of calling
  `computeEffectiveDate`, `categoryUtils`, `buildExpenseDocuments`, `pluggyUtils`,
  `receiptService` or `scripts/lib/cliEnv.ts`.
- **Categories treated as static.** A `z.enum` of categories, or consuming
  `ExpenseSubtypes`/`IncomeTypes` from `types/index.ts` as runtime truth instead of the
  `Category` collection.
- **Boundary order broken** in `/api/v1/*`: auth → Zod → category validation → service.
  A service inspecting payload shape or importing `next/server` is a finding.
- **Client code calling `/api/v1/*`**, which requires shipping `API_KEY` to the browser.
- **Secrets read at module scope** — CI `lint`/`build` run without secrets deliberately.
- **A changed Zod schema with no regenerated `public/openapi.yaml`** (`npm run gen:openapi -- --check`).
- **Double-counting risk on ingestion paths** (Pluggy ignore rules, bill/receipt import):
  anything that could book one real transaction twice, or as both expense and income.
- **A category rename/delete path that misses one of the cascades** in `categoryUtils.ts`.
- **An edited or renamed migration** under `lib/migrations/` that has already run, or a
  data rewrite added outside the migration registry.
- **A broken v1 response contract.** Every v1 handler answers `{ data }` or
  `{ error: { code, message, details } }`, with the `ApiErrorCode` → status map in
  `lib/api/respond.ts` as the only mapping. A bare object, an ad-hoc status, or a
  well-formed payload naming an unknown category mapped to `VALIDATION_FAILED` instead of
  `INVALID_CATEGORY`, are each findings — that distinction is deliberate.
- **Pure logic with no unit test.** New or fixed behaviour in `lib/utils/`, `lib/services/`
  or `scripts/lib/` should come with a `tests/*.test.ts` case; a bug fix there without one
  is a finding. Do not raise this for code a `node:test` run cannot reach (React components,
  route wiring, styling) — the repo has no test runner for those.
- **A new `scripts/telegram-*` command not documented in `docs/telegram-hermes-bridge.md`** —
  undocumented means never invoked.

## Verify, don't assume

Run the gates yourself and report actual output; a review that assumes the author ran them
is worth little:

```bash
npx eslint --max-warnings=0
npm run test:unit
npm run gen:openapi -- --check
npm run build
```

## Output format

```
## Summary
<one paragraph: what the change does and your overall assessment>

## BLOCKING
- `path/file.ts:42` — The problem, and why it must be fixed.

## WARNING
- `path/file.ts:17` — Description.

## SUGGESTION
- `path/file.ts:88` — Description.

## Verification
<commands run and their real results>

## Verdict
APPROVE | REQUEST CHANGES | NEEDS DISCUSSION
```

If a section has no findings, write `None.` — never omit the section. A review with zero
BLOCKING findings and clean gates is an APPROVE; say so plainly rather than
inventing concerns.
