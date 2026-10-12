# Conventions

Engineering
- DRY, YAGNI, boring over clever. Delete before adding.
- Booleans read as questions: `isRouting`, `hasKey`, `isFork`.
- Names lead with the noun, then the verb: `tierClassify`, `routingSet`, `stateFileWrite` (Tenants Create, not Create Tenants).
- Function declarations for everything named. Arrow functions only as callbacks.
- `async`/`await` for every promise. No `.then` chains.
- Never wrap text: long lines stay long (biome `lineWidth` 200).
- Comments explain why. Never what or how. The `comment-clean` skill enforces this on every commit.

Tooling
- Runtime and package manager: bun.
- Lint and format: biome (`make lint`).
- Types: `make typecheck` against the engine's own declarations in `.claude-plugin/types/`.
- Git hooks: husky runs lint-staged (biome, then comment-clean) before each commit.

Skills (project, `.claude/skills/`)
- `comment-clean`: rewrites comments so each states a reason.
- `git-commit`: atomic conventional commits; title and body pass through `i-have-adhd` and `no-ai-slop`.
- `git-pr`: `gh` pull request; `[TICKET-ID]` title prefix when the branch carries one; same writing pass.

Writing
- Prose a reader with ADHD can act on: the action first, numbered steps, no tangents (`i-have-adhd`).
- No AI slop: no filler, no hedging, no em dash (`no-ai-slop`).
