---
name: planning-and-architecture
description: Decide how a change should be built in this codebase — evaluate the technical tradeoff when one is open, then produce a step-by-step plan with exact file paths and dependencies. No code. Use when asked to plan a feature, scope work, compare libraries, or decide an architectural tradeoff.
---

# Planning and architecture

Decide *what* to build and in *what order*, before any code exists. Ends in a committed
recommendation and an executable plan — never a list of options with no conclusion, never
prose padding.

## When to use

- A feature or refactor needs scoping before implementation
- The change touches several layers and the order matters
- Choosing between libraries, services or patterns; deciding whether to adopt or drop a
  dependency
- Weighing an architectural tradeoff (new collection vs reuse, cron vs webhook, new route
  vs shared service)

Do not use for: writing the code (`implementing-features`) or reviewing a finished diff
(`reviewing-code`).

## Two modes

Most requests need only mode B. Run **mode A first** when the request leaves a genuine
technical choice open — a new dependency, a new mechanism, or two defensible designs.
When the approach is already settled, skip straight to B and say so in one line.

---

## Mode A — decide the approach

1. **Establish the constraint space.** One developer, no ops team, Docker/Easypanel on a
   single VPS, standalone `mongod` (so **no multi-document transactions**), secrets injected
   at runtime, CI that runs lint/build with no secrets. Operational complexity is the
   scarcest resource here, not compute.
2. **Check what already exists before proposing anything new.** This codebase repeatedly
   chose reuse over a parallel mechanism — `BillMapping` serves both bill and Pluggy
   ingestion, the service layer is shared between `/api/*` and `/api/v1/*`, OpenAPI is
   generated from the existing Zod schemas instead of a second annotation layer. Verify with
   `search_files` and `package.json` that the proposal is not a copy of something already
   maintained.
3. **Verify every claim about the current code.** Versions come from `package.json`, not
   memory; behaviour comes from the source. Never cite a capability you have not confirmed
   for the installed version.
4. **Evaluate against real criteria:** operational overhead, migration cost, developer
   experience, performance for a single-user dataset, ecosystem maturity, lock-in, and the
   cost of reversing the decision.
5. **Commit to one option.** If the honest answer is "keep what we have", say that.

Rules: never recommend something because it is new or popular; prefer the option adding no
new runtime dependency when the difference is marginal — every added service is something
one person has to operate.

### Mode A output

```
## Problem statement
<what decision needs to be made, and what forces it now>

## Constraints that decide this
<the 2-4 project constraints that actually narrow the field>

## Options considered
| Option | Pros | Cons | Fit with current stack |
|--------|------|------|------------------------|

## Recommendation
**Option:** ...
**Rationale:** ...
**Risks and mitigations:** ...
**Reversibility:** <how hard is it to back out>

## What NOT to do
<options that look attractive but are wrong here, and why>
```

---

## Mode B — plan the work

- Read the relevant source files before planning. Never plan from filenames or assumptions.
- Read `AGENTS.md` and the `CLAUDE.md` sections covering the area. The plan must respect the
  documented invariants; a step that departs from one must say why.
- Reference exact file paths, and line numbers for touch points inside existing files.
- Each step is a single actionable unit: one file change, one schema update, one route, one
  component.
- Group steps by concern, in this order: **Data layer → API layer → UI layer →
  Integration/wiring → Tests → Docs**.
- Say *what* must change and *why*. Never suggest the code.
- State dependencies between steps explicitly, and flag breaking changes as their own steps.

### Steps this repo's plans routinely need — check each before finishing

- **Migration** — any change that rewrites stored data needs a new, append-only entry in
  `lib/migrations/` plus its registry line. Never a rewrite of an existing migration.
- **Index sync** — a new query filter usually needs an index and a
  `POST /api/admin/sync-indexes` run on existing deploys.
- **Category cascades** — a new collection storing a `type`/`subtype` must be threaded into
  every `cascadeRename*` / `cascadeReassignExpenseType` path in `lib/utils/categoryUtils.ts`,
  or renames silently orphan it.
- **OpenAPI regeneration** — a changed Zod schema under `lib/api/schemas/` means
  `npm run gen:openapi` (CI fails on a stale spec).
- **Both API surfaces** — decide deliberately whether the change lands on internal `/api/*`,
  public `/api/v1/*`, or the shared service both call. Client code must never call `/api/v1/*`.
- **Navigation** — a new view is registered in *two* places: the `ViewId` union and the nav
  entries, both in `components/NavMenu.tsx`, plus the switch in `app/page.tsx`.
- **Tests** — which `tests/*.test.ts` unit tests, and which Bruno requests under `bruno/`
  for cross-request behaviour.
- **Docs** — `CLAUDE.md` for a new invariant, `docs/API.md` for a contract change,
  `docs/telegram-hermes-bridge.md` for a new bridge command.
- **Env vars** — new configuration must appear in `.env.example` and be listed as a deploy
  step (Easypanel secrets), never baked into the image.

### Mode B output

```
## Goal
<one sentence>

## Affected files
- path/to/file.ts — reason

## Steps

### 1. [Data] Title
What: ...
Why: ...
Depends on: (step N, or "none")

### 2. [API] ...

## Breaking changes / migrations
<or "None.">

## Deploy steps
<migration to run, index sync, env var, redeploy — or "None.">

## Open questions
<decisions the user must make; omit only if there genuinely are none>
```

## Saving a plan

A plan the user intends to keep goes in `docs/plans/<name>.md`, matching the style of
`docs/plans/pluggy-integration.md`. Once implemented, the file stays as a historical record —
do not retro-edit it to match what shipped; new decisions are new entries in `CLAUDE.md`.
