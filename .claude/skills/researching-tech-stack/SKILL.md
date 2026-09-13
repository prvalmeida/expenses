---
name: researching-tech-stack
description: Evaluate a technology, library or architectural choice against this project's real constraints and produce a single recommendation with migration path and risks. Use when asked to compare tools, pick a library, or decide an architectural tradeoff.
---

# Researching the tech stack

Senior-architect evaluation of a technology decision. Ends in a recommendation, not a list
of options.

## When to use

- Choosing between libraries, services or patterns
- Deciding whether to adopt, replace or drop a dependency
- Weighing an architectural tradeoff (new collection vs reuse, cron vs webhook, etc.)

Do not use for: writing the implementation (`implementing-features`) or sequencing work that
is already decided (`planning-features`).

## Process

1. **Establish the constraint space.** One developer, no ops team, Docker/Easypanel on a
   single VPS, standalone mongod (no replica set, so **no multi-document transactions**),
   secrets injected at runtime, CI that runs lint/build with no secrets. Operational
   complexity is the scarcest resource here, not compute.
2. **Anchor to the current stack** (see Context). A recommendation must integrate with it or
   explicitly justify the departure and price the migration.
3. **Check what already exists before proposing anything new.** This codebase repeatedly
   chose reuse over a parallel mechanism — `BillMapping` serves both bill and Pluggy
   ingestion, the service layer is shared between `/api/*` and `/api/v1/*`, OpenAPI is
   generated from the existing Zod schemas instead of a second annotation layer. Verify the
   proposal is not a parallel copy of something already maintained, with
   `search_files` and `package.json`.
4. **Evaluate against real criteria:** operational overhead, migration cost, developer
   experience, performance characteristics for a single-user dataset, ecosystem maturity,
   lock-in risk, and the cost of reversing the decision.
5. **Verify claims about the current code.** Version numbers come from `package.json`, not
   memory; behaviour comes from the source. Do not cite a dependency's capability you have
   not confirmed for the installed version.
6. **Commit to a recommendation.** Say what you would do and why.

## Output format

```
## Problem statement
<what decision needs to be made, and what forces it now>

## Constraints that decide this
<the 2-4 project constraints that actually narrow the field>

## Options considered
| Option | Pros | Cons | Fit with current stack |
|--------|------|------|------------------------|
| ...    | ...  | ...  | ...                    |

## Recommendation
**Option:** ...
**Rationale:** ...
**Risks and mitigations:** ...
**Migration path (if applicable):** ...
**Reversibility:** <how hard is it to back out>

## What NOT to do
<options that look attractive but are wrong here, and why>
```

## Rules

- No abstract comparison without a conclusion.
- Never recommend something because it is new, popular or trending.
- Prefer the option that adds no new runtime dependency when the difference is marginal —
  every added service is something one person has to operate.
- If the honest answer is "keep what we have", say that.

## Context

Next.js 16 (App Router) · React 19 · TypeScript strict · MongoDB via Mongoose · Zod 4 ·
OpenAI SDK (GPT-4o-mini for receipt/bill parsing) · `pdfjs-dist` / `pdf-parse` · Tailwind 4 ·
tests with `node:test` + `tsx` and a Bruno API collection · Docker multi-stage with Next
standalone output · GitHub Actions → GHCR → Easypanel on a single VPS · Pluggy (Open Finance)
ingestion on a scheduled task.

Personal finance tracker, single developer, Brazilian Portuguese UI. Configuration via
`.env.local` locally and platform secrets in production. Check `package.json` for exact
versions before relying on any of the above.
