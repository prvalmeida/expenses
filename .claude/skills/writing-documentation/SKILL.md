---
name: writing-documentation
description: Write or correct documentation for this project by reading the source first, documenting exact names, contracts and gotchas, never templates or speculation. Use when asked to document, update README/CLAUDE.md/docs, or fix docs that drifted from the code.
---

# Writing documentation

Documentation that precisely reflects the implementation. Read the code, then write.

## When to use

- Documenting a feature, module, endpoint or workflow
- Updating `CLAUDE.md`, `README.md`, `README_DOCKER.md`, or anything under `docs/`
- Reconciling documentation that contradicts the code

Do not use for: `public/openapi.yaml`, which is **generated** — see Generated artifacts.

## Non-negotiable rules

1. **Read before you write.** Read every source file relevant to the topic. Never infer
   behaviour from a filename, a test name or an existing doc.
2. **No templates.** Do not fill boilerplate sections with placeholders. A section that does
   not apply is omitted.
3. **No speculation.** If you are unsure of a behaviour, read deeper or state the
   uncertainty explicitly. Never guess.
4. **Be exact.** Real field names, types, enum values, route paths, query parameters, status
   codes and error codes, copied from the code.
5. **Correct what you find broken.** If existing documentation contradicts the source, fix
   it in the same change and say what was wrong.

## What good documentation covers

- **What** it does — the contract, not the implementation detail
- **How** to use it — inputs, outputs, side effects, errors
- **Why** a key decision was made, when the code, `CLAUDE.md` or git history gives evidence
- **Constraints and gotchas** a caller cannot infer from the signature

## What it must not contain

- Restatements of the code ("this function takes a name and returns a greeting")
- Future tense ("will support", "can be extended to")
- Boilerplate copied from another doc
- Outdated statements left standing

## Where each thing belongs in this repo

| Content | File |
|---|---|
| Architecture invariants, load-bearing decisions, failure modes for future sessions | `CLAUDE.md` |
| Minimal working agreement: commands, layout, hard rules | `AGENTS.md` |
| Caller-facing `/api/v1` contract | `docs/API.md` |
| Docker, deploy, Easypanel, scheduled tasks | `README_DOCKER.md` |
| Telegram/Hermes bridge standing instructions | `docs/telegram-hermes-bridge.md` |
| Design of a non-trivial feature before/while building | `docs/plans/*.md` |
| New env var | `.env.example` |

`CLAUDE.md` is the highest-value target and has a specific voice: each entry states a rule
plus the failure it prevents ("X must be Y, because otherwise Z fails silently"). Write new
entries that way — a rule with no consequence attached gets ignored. Add the rule where the
concept it governs already lives; do not append a second section on the same topic.

## Generated artifacts — never hand-edit

`public/openapi.yaml` is generated from the Zod schemas by `npm run gen:openapi`, and
`npm run gen:openapi -- --check` fails CI when it is stale. Change the schema, regenerate,
and document the contract in `docs/API.md`.

## Output

Markdown. Headers, tables and code blocks where they aid clarity. No emojis, no decorative
elements. The UI language of the app is Brazilian Portuguese; internal documentation is in
English unless the file you are editing is already in Portuguese — match the file.

When updating an existing doc, edit in place rather than rewriting the file, and report
which sections changed.

## Verification

- Every name, path and value in the doc appears in the source (grep each one you did not
  copy directly).
- If a Zod schema changed alongside the doc, `npm run gen:openapi -- --check` passes.
