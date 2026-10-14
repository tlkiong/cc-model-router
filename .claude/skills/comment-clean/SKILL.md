---
name: comment-clean
description: Rewrite code comments so every one states why, never what or how. Use on staged files before a commit, on files just edited, or when asked to clean, tidy or review comments. Takes file paths as arguments; with none, uses staged files, then files changed since HEAD.
---

# comment-clean

Make every comment in the given files answer "why is this here?" and nothing else.

## Scope

1. Files: `$ARGUMENTS` if given. Otherwise `git diff --cached --name-only`, and if that is empty, `git diff --name-only HEAD`. Only `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs` files.
2. Touch comments only. Never change code, blank lines, imports, or formatting outside a comment.
3. Edit in place with the Edit tool. One pass per file.

## Rules

Keep, unchanged:
- License and copyright headers.
- Pragmas and directives: `biome-ignore`, `@ts-expect-error`, `@ts-ignore`, `eslint-disable`, `/// <reference`, `chisle:` markers.
- `TODO(<ticket or name>): ...` and `FIXME(...)` with an owner.
- Public JSDoc that states intent or a contract a caller needs (what a parameter must be, what a result means).

Delete:
- Comments that narrate the code (`// increment counter`, `// loop over tiers`, `// return result`).
- Comments that restate a name (`// the config` above `const config`).
- Commented-out code.
- Section banners with no reason (`// ---- helpers ----`).

Rewrite to a reason:
- A comment that explains how something works but hides a reason: keep only the reason. `// retry once because the API rate-limits bursts` not `// loop twice and call fetch`.
- A comment that warns of a non-obvious constraint: keep it, phrased as the constraint. `// hot reload drops module state, so this lives in $.state`.

Style:
- One sentence, present tense, no trailing period for one-liners, period for multi-sentence.
- No em dash. No "this function", "this method".
- Shorter is better. A comment that cannot name a reason is deleted.

## Report

One line per file changed: `<path>: <n> removed, <m> rewritten`. Then `no changes` for files left alone. Nothing else.
