# CC Model Router

A Claude Code mod that sends each turn, and each subagent, to the cheapest Claude model whose tier fits the prompt. A typo fix runs on Haiku at low effort. An architecture question runs on Opus at xhigh, and Fable only gets work that already failed once. You keep one session and stop paying top-tier prices for trivial turns.

## Install

In a Claude Code session:

```
/plugin install cc-model-router --marketplace tlkiong/cc-model-router
```

Answer `y` to add the marketplace, pick the user scope, done. On the next start an onboarding pane explains the tiers and offers to turn the router on.

## Use

`/model` now opens the router's picker:

```
1  Default
2  CC Model Router        default  selected
3  claude-haiku-5-5
4  claude-sonnet-5-5
5  claude-opus-5-5
6  claude-fable-5-1
```

- Option 2 turns routing on and makes it the default for new sessions.
- Any other option sets that session model and turns routing off, as does `/model <name>` typed with a name.
- `/cc-model-router on | off | status | config | update-config [--force] | onboard` does the same from the prompt and prints the live route, the classifier in use, and the tier table.

`/cc-model-router status` shows the live route. The status line recipe below shows the router's name in place of the model.

## Tiers and the config file

Tiers live in `~/.claude/cc-model-router/config.json`, written with these defaults on first start. Edit it freely: any number of tiers, in the order the classifier sees them, cheapest first. Edits apply on the next turn, no restart. After a plugin update, `/cc-model-router update-config` adds any key the file lacks with its default and keeps your tiers and values. `--force` replaces the whole file with the defaults. Both keep the old file as `config.json.bak`.

```json
{
  "tiers": [
    { "name": "trivial",  "model": "claude-haiku-5-5",  "effort": "low",    "criteria": "one-line answers, typo or rename, reading a file, formatting, simple factual question" },
    { "name": "moderate", "model": "claude-sonnet-5-5", "effort": "high",   "criteria": "single-file edit, small feature, straightforward bug, tests for existing code" },
    { "name": "complex",  "model": "claude-opus-5-5",   "effort": "medium", "criteria": "multi-file change, debugging across modules, refactor, design decision with known constraints" },
    { "name": "hardest",  "model": "claude-opus-5-5",   "effort": "xhigh",  "criteria": "architecture, ambiguous spec, security-sensitive work, long autonomous multi-step task" },
    { "name": "escalate", "model": "claude-fable-5-1",  "effort": "high",   "criteria": "retry of a fix that already failed, still broken after repeated attempts, flagship-quality writing" }
  ],
  "subagents": { "general-purpose": "moderate" },
  "newTask": { "isAsking": true, "minTokens": 20000 },
  "classifier": { "kind": "auto", "model": "" }
}
```

| Field | Values |
|---|---|
| `tiers[].name` | unique label, also the classifier's answer |
| `tiers[].model` | any Claude model id or alias (`haiku`, `sonnet`, `opus`, `fable`), `[1m]` suffix allowed |
| `tiers[].effort` | `low`, `medium`, `high`, `xhigh`, `max` |
| `tiers[].criteria` | one line of what the tier covers; the classifier reads it verbatim |
| `subagents` | agent type to tier name: the highest tier a spawn of that type runs on. `{}` turns ceilings off |
| `newTask.isAsking` | `true` offers a `/clear` when a prompt starts a new task, `false` never asks |
| `newTask.minTokens` | conversation tokens below which the new-task check is skipped |
| `classifier.kind` | `auto` (Jev when `TYPESAFE_API_KEY` is set, else Claude), `jev`, `claude` |
| `classifier.model` | Jev model id (default `jev-latest`) or a Claude alias/id for the Claude classifier; empty for the provider default |

A file with errors keeps the last good config in use and `/cc-model-router config` lists each error.

Price per million tokens, input/output, as shown in the picker: Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20, Fable 5.1 $10/$50.

## Classifier

Each prompt is classified once per turn, and once per subagent spawn.

- **Jev** (typesafe.ai): set `TYPESAFE_API_KEY` in your shell, or in the `env` block of `~/.claude/settings.json`. One `choice` question with your tier criteria, one retry on 429 or 529, then fallback to Claude.
- **Claude**: the engine's small fast model through `$.model.classify`, no key needed.

## Subagents

A spawn with no explicit `model` parameter is classified on its prompt and runs on the tier's model and effort. A caller's explicit model wins. Forks always inherit the parent. Workflow agents keep their own model, since the engine ignores a model change on them.

A ceiling in `subagents` caps the pick for that agent type. By default a `general-purpose` agent runs on `moderate` (Sonnet 5.5, high) at most, and on `moderate` when the classifier fails. A cheaper pick stays cheaper, so a one-line brief still runs on Haiku.

## New task, fresh context

When a prompt you type starts an unrelated task, the router offers to clear the old context first:

```
New task detected. Clearing 182k tokens of old context saves about $0.07 per request, $0.91 when the router changes model. Clear first?
  1. Clear, then run it
  2. Keep context
```

- **Clear, then run it** runs `/clear`, keeps routing on, and sends your prompt as your own message in the fresh conversation.
- **Keep context**, Esc, or a typed answer sends the prompt as usual.
- The check runs only while routing is on, on a prompt typed into an idle session, once the conversation holds `newTask.minTokens` tokens. The token count is local, so a short conversation never costs a classifier call.
- Prompts with attachments, `@` mentions, or a leading `/` or `!` are skipped, since a resent prompt would lose them.
- The classifier (Jev or Claude) reads your prompt and the last six messages, and answers same task or new task. When unsure it answers same task.
- The savings are estimates for the conversation's tokens at the last routed model's price: a cache read on every request, and a full cache write when the router moves the next turn to another model.

## Status line scripts

The mod writes `~/.claude/cc-model-router/sessions/<session_id>.json` on every route change:

```json
{ "isRouting": true, "label": "CC Model Router", "tier": "trivial", "model": "claude-haiku-5-5", "effort": "low", "updatedAt": 1760000000000 }
```

A status line command gets `session_id` on stdin, so it can show the router instead of the session model:

```sh
input=$(cat)
sid=$(printf '%s' "$input" | jq -r .session_id)
state="$HOME/.claude/cc-model-router/sessions/$sid.json"
if [ -f "$state" ] && [ "$(jq -r .isRouting "$state")" = true ]; then
  model="$(jq -r '"\(.label) -> \(.model // "?")"' "$state")"
else
  model=$(printf '%s' "$input" | jq -r '.model.display_name // .model.id')
fi
printf '%s' "$model"
```

## Develop

```sh
git clone git@github.com:tlkiong/cc-model-router.git
cd cc-model-router
make setup
```

`make setup` installs dependencies, husky hooks, checks for `bun`, `claude`, `gh` and the `i-have-adhd` and `no-ai-slop` skills, and symlinks the repo into `~/.claude/skills/cc-model-router` so a session in any folder hot-reloads it on save.

| Target | Does |
|---|---|
| `make check` | lint, typecheck, `claude plugin validate .`, `claude plugin test .` |
| `make lint` | biome |
| `make typecheck` | `tsc` against the engine's own declarations in `.claude-plugin/types/` (written by the engine on first load) |
| `make validate` | what the engine will hook, call and refuse |
| `make test` | `src/*.test.ts` through the plugin test kit |
| `make unlink` | remove the symlink |

Layout: `src/hooks.ts` owns every call on `$` (the engine follows `$` only inside the file that declares a hook); `config.ts`, `tiers.ts`, `jev.ts`, `classify.ts`, `clear.ts`, `routing.ts`, `model-picker.tsx` and `onboarding.tsx` are pure. `types/index.d.ts` declares the mod's state contract. Conventions in `.aos/conventions.md`.

Project skills in `.claude/skills/`: `comment-clean` (runs on every commit through lint-staged), `git-commit`, `git-pr`.

## Not in scope

Non-Claude models (they need a routing proxy), a status line shim, a fixed model per agent type (ceilings only), and a Jev confidence threshold.
