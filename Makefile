MOD_NAME := cc-model-router
MOD_LINK := $(HOME)/.claude/skills/$(MOD_NAME)

.PHONY: setup link unlink validate test lint typecheck check

setup:
	bun install
	bun src/scripts/setup-check.ts
	$(MAKE) link

link:
	mkdir -p $(dir $(MOD_LINK))
	@if [ -L "$(MOD_LINK)" ] || [ ! -e "$(MOD_LINK)" ]; then ln -sfn "$(CURDIR)" "$(MOD_LINK)"; echo "linked $(MOD_LINK) -> $(CURDIR)"; else echo "$(MOD_LINK) exists and is not a symlink; remove it first"; exit 1; fi

unlink:
	@[ -L "$(MOD_LINK)" ] && rm "$(MOD_LINK)" && echo "unlinked $(MOD_LINK)" || echo "no symlink at $(MOD_LINK)"

validate:
	claude plugin validate .

test:
	claude plugin test .

lint:
	bunx biome check .

typecheck:
	@[ -f .claude-plugin/types/claude-code/index.d.ts ] || { echo ".claude-plugin/types missing: run 'make link', then start claude once in this repo so the engine writes the mod's types"; exit 1; }
	bunx tsc -p . --noEmit
	bunx tsc -p src/scripts --noEmit

check: lint typecheck validate test
