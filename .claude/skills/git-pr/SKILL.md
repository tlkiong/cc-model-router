---
name: git-pr
description: Open a GitHub pull request for the current branch with the gh CLI. Prefixes the title with [TICKET-ID] when the branch name carries one. Title and body are written for an ADHD reader with no AI slop. Use when asked to open, create, raise or submit a PR.
---

# git-pr

Create a pull request for the current branch.

## Steps

1. Branch: `git branch --show-current`. Refuse on the default branch (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`); say which branch to create first.
2. Push: `git push -u origin HEAD` when the branch has no upstream (`git rev-parse --abbrev-ref @{u}` fails), else `git push`.
3. Ticket id: first match of `[A-Z][A-Z0-9]+-[0-9]+` in the branch name. Found: title starts with `[<id>] `.
4. Base: the default branch unless `$ARGUMENTS` names another with `--base <name>`.
5. Draft title and body from `git log --oneline <base>..HEAD` and `git diff --stat <base>...HEAD` (format below).
6. Run the writing pass (below).
7. Create:

```sh
gh pr create --base <base> --title "<title>" --body "$(cat <<'BODY'
<body>

<attribution line>
BODY
)"
```

Add `--draft` when `$ARGUMENTS` contains `draft`.

8. Print the PR URL on its own line.

## Format

Title: under 72 characters, imperative, what the branch delivers. With a ticket: `[ABC-123] add tier config file`.

Body:
```
## What
<one to three lines: the change, from the reader's side>

## Why
<one to three lines: the problem or need>

## How to test
1. <step>
2. <step>

Refs: <ticket id or issue link, when any>
```

Attribution: end the body with the pull request attribution line the session's system reminder gives. If none is given, add nothing.

## Writing pass

Apply `no-ai-slop` (invoke it with the Skill tool on the drafted title and body): no filler, no hedging, no em dash, concrete verbs.

Apply `i-have-adhd`: Read its SKILL.md first (Glob `~/.claude/plugins/**/i-have-adhd/SKILL.md`; it is user-invoked only, so read the file rather than invoking it). If the file is absent, apply its core: lead with the action, one idea per line, numbered steps for sequences, no tangents.

## Rules

- Never force-push. Never edit an existing PR unless asked; if one exists for the branch (`gh pr view` succeeds), print its URL and stop.
- Never include secrets in title or body.
