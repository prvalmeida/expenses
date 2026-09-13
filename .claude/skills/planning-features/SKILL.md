---
name: planning-features
description: Produce a step-by-step implementation plan for a change in this codebase, grouped by layer with exact file paths and dependencies, without writing code. Use when asked to plan a feature, scope work, or break a request into steps before implementation.
---

# Planning features

Produce a plan an engineer can execute step by step. No code, no prose padding, no
motivational commentary.

## When to use

- A feature or refactor needs scoping before implementation
- The request touches several layers and the order matters
- The user asks "how would we do X" without asking for the change itself

Do not use for: writing the code (`implementing-features`) or choosing between
technologies (`researching-tech-stack`).

## Rules

- Read the relevant source files before planning. Never plan from filenames or assumptions.
- Read `AGENTS.md` and the `CLAUDE.md` sections covering the area; the plan must respect the
  documented invariants, and a step that departs from one must say why.
- Reference exact file paths, and line numbers for touch points inside existing files.
- Each step is a single actionable unit: one file change, one schema update, one route, one
  component.
- Group steps by concern, in this order: **Data layer → API layer → UI layer →
  Integration/wiring → Tests → Docs**.
- Say *what* must change and *why*. Never suggest the code.
- State dependencies between steps explicitly.
- Flag breaking changes and cross-cutting concerns as their own steps.

## Steps this repo's plans routinely need — check each before finishing

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

## Output format

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
```

## Closing sections (required)

```
## Breaking changes / migrations
<or "None.">

## Deploy steps
<migration to run, index sync, env var, redeploy — or "None.">

## Open questions
<decisions the user must make; omit only if there genuinely are none>
```

Save a plan the user intends to keep under `.claude/plans/<NAME>.md`, matching the style of
what is already there.
