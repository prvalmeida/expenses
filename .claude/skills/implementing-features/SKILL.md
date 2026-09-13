---
name: implementing-features
description: Implement a feature, change or bug fix in this codebase following its clean-architecture conventions, boundary rules and verification gates. Use when asked to write, change or fix application code (routes, services, models, components, scripts).
---

# Implementing features

Senior full-stack engineering discipline for this repo: smallest correct diff, matching
existing patterns, verified before it is reported as done.

## When to use

- Writing a new feature, endpoint, service, component or script
- Fixing a bug or regression
- Refactoring existing code

Do not use for: producing a plan without code (`planning-features`), reviewing someone
else's diff (`reviewing-code`), or choosing a library/technology (`researching-tech-stack`).

## Before writing any code

1. Read `AGENTS.md` (architecture invariants and commands) and the relevant sections of
   `CLAUDE.md`. The load-bearing rules there were each learned from a failure — a diff
   that contradicts one is wrong even if it compiles.
2. Read every file you will touch, in full. Never edit from a grep hit alone.
3. Identify the existing pattern for what you are adding (a sibling route, a sibling
   service, a sibling test) and match it. Departing from it needs a stated reason.
4. Identify the minimal diff. Prefer editing existing files over creating new ones.

## Principles

- **Single Responsibility** — one module, function or component does one thing.
- **Dependency Inversion at boundaries** — API route ↔ service ↔ model.
- **DRY** — extract shared logic; never copy-paste. This repo has explicit
  single-source-of-truth helpers (`cycleUtils`, `categoryUtils`, `expenseService`,
  `pluggyUtils`, `scripts/lib/cliEnv.ts`); re-inlining any of them is a defect.
- **No accidental complexity** — solve the stated problem, nothing more. No speculative
  abstraction, no extra features, no "while I'm here" changes.

## Code standards

- TypeScript strict mode. No `any` without a written justification, no `@ts-expect-error`
  to silence a real error.
- Comments explain *why*, never *what*, and only when non-obvious.
- No unused variables, imports or dead branches.
- Validate at system boundaries only — API route handlers and form submissions. Internal
  code trusts its types.
- Match the naming conventions of the file you are editing.

## Boundary rules that are easy to violate

The full list is in `CLAUDE.md`; these are the ones most code changes brush against:

- Route order in `/api/v1/*` is **auth → Zod → category validation → service**. A service
  never inspects payload shape and never imports `next/server`; it throws `ApiError`.
- Category validity is a **runtime database question** (`Category` collection via
  `lib/utils/categoryUtils.ts`). Never freeze categories into a `z.enum`, and never treat
  the `ExpenseSubtypes`/`IncomeTypes` constants in `types/index.ts` as the source of truth —
  they exist only as seed data for `seedCategories()`.
- Never point client code at `/api/v1/*` — that ships `API_KEY` to the browser. Share the
  *service* instead.
- Read secrets (`API_KEY`, `MONGODB_URI`, `OPENAI_API_KEY`) inside the function that needs
  them, never at module scope: CI `lint`/`build` run with no secrets on purpose.
- Query schemas use `z.coerce`; JSON body schemas must not.
- Clearing a field in Mongoose needs `$unset`, not `= undefined` (and `$unset` must be
  omitted when empty).
- Changing a Zod schema under `lib/api/schemas/` means `public/openapi.yaml` is stale —
  regenerate it (see Verification).
- Data rewrites go in `lib/migrations/` as a **new, append-only** migration. Never edit or
  rename one that has run.

## Tests

Write unit tests for new logic and for every bug fix, following the existing patterns in
`tests/*.test.ts` (`node:test` + `tsx`, no database, no network). Pure helpers under
`lib/utils/` and `scripts/lib/` are the natural home for testable logic — if a behaviour is
hard to unit test, that usually means it belongs in a helper rather than inline in a route.

Behaviour that spans requests (installment expansion, `$unset` on a credit → non-credit
edit, `VALIDATION_FAILED` vs `INVALID_CATEGORY`) belongs in the Bruno collection under
`bruno/`, where every written record is named `BRUNO_TEST_*`.

## Verification (required before reporting done)

Run, and report real output:

```bash
npx eslint --max-warnings=0       # exactly what CI's lint job runs
npm run test:unit                 # node:test, no DB — the fast loop
npm run gen:openapi -- --check    # fails if public/openapi.yaml is stale
npm run build                     # catches type errors ESLint does not
```

If you changed a Zod schema under `lib/api/schemas/`, run `npm run gen:openapi` first and
commit the regenerated `public/openapi.yaml`.

Never report a change as finished on the strength of reading the diff. If a command cannot
be run, say so explicitly instead of implying it passed.

## Output

- Implement exactly what was asked.
- Then state: every file changed with a one-line description of the change, the
  verification commands you ran and their result, and any follow-up the user must handle
  (migration to apply, new env var, index sync, Easypanel redeploy).
- If you established a new pattern or discovered a new failure mode, add it to `CLAUDE.md`
  in the same change — that file is how the next session inherits it.
