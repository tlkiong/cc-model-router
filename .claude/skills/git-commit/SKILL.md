---
name: git-commit
description: Make atomic conventional commits from the working tree. Stages everything by default, or only the paths given as arguments. Splits unrelated changes into separate commits. Commit title and body are written for an ADHD reader with no AI slop. Use when asked to commit, save work, or check in changes.
---

# git-commit

Produce one or more atomic conventional commits.

## Steps

1. Stage: `git add -A` when `$ARGUMENTS` is empty, else `git add -- $ARGUMENTS`. Never stage `.env*`, keys, or files matching `.gitignore`.
2. Inspect: `git diff --cached --stat` and `git diff --cached`. Group hunks by concern (a feature, a fix, tooling, docs). One concern per commit. If the staged diff holds more than one concern, commit them one at a time with `git reset` and `git add -- <paths>` between commits, or `git add -p` where a file mixes concerns.
3. For each commit, draft a title and body (format below).
4. Run the draft through the writing pass (below). Rewrite until it passes.
5. Commit with a heredoc so the body keeps its line breaks:

```sh
git commit -m "$(cat <<'MSG'
<title>

<body>

<attribution trailer>
MSG
)"
```

6. Report: one line per commit, `<short sha> <title>`.

## Format

Title: `type(scope): subject`. Types: feat, fix, refactor, docs, test, chore, build, ci, perf, style. Scope is the area touched (`routing`, `picker`, `skills`, `tooling`); drop it when the change is repo-wide. Subject in the imperative, lowercase, no period, title under 72 characters.

Body: why the change exists and what it changes for the reader, two to five lines. Reference tickets or issues on their own line (`Refs: ABC-123`). Skip the body when the title says it all.

Trailer: end every commit message with the attribution lines the session's system reminder gives for git commits. If none is given, add nothing.

## Writing pass

Apply `no-ai-slop` (invoke it with the Skill tool on the drafted title and body): no filler, no hedging, no "this commit", no em dash, concrete verbs.

Apply `i-have-adhd`: Read its SKILL.md first (Glob `~/.claude/plugins/**/i-have-adhd/SKILL.md`; it is user-invoked only, so read the file rather than invoking it). If the file is absent, apply its core: lead with the action, one idea per line, numbered steps for sequences, no tangents, concrete sizes and names.

## Rules

- Never `--amend`, never `--no-verify`, never force anything. Pre-commit hooks run; if one fails, fix the cause and commit again.
- Never include secrets in a message.
