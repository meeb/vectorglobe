# vectorglobe - common development commands
#
# Run `make help` for a summary of every target.

npm := npm
node := node

# Simplification percentage retained by mapshaper during `make sync`.
SIMPLIFY ?= 20
# Port used by `make dev` to serve the examples directory.
PORT ?= 8080


.PHONY: help
help:
		@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'


.PHONY: install
install:  ## Install all development dependencies
		$(npm) install


.PHONY: sync
sync:  ## Download and re-encode the world border data into src/data/
		$(node) scripts/sync-world.ts --simplify $(SIMPLIFY)


.PHONY: sync-check
sync-check:  ## Re-run the data sync and fail if the committed data is stale
		$(node) scripts/sync-world.ts --simplify $(SIMPLIFY) --check


.PHONY: build
build:  ## Build the distributable bundles into dist/
		$(node) scripts/build.ts


.PHONY: dev
dev:  ## Watch, rebuild and serve the examples on http://localhost:$(PORT)
		$(node) scripts/dev.ts --port $(PORT)


.PHONY: test
test:  ## Run the test suite
		$(npm) run test


.PHONY: lint
lint:  ## Check formatting and lint rules
		$(npm) run lint


.PHONY: format
format:  ## Rewrite sources with the canonical formatting
		$(npm) run format


.PHONY: typecheck
typecheck:  ## Type check without emitting output
		$(npm) run typecheck


.PHONY: size
size:  ## Report bundle sizes against the size budget
		$(node) scripts/build.ts --size-only


.PHONY: clean
clean:  ## Remove build output and caches
		rm -rf dist .cache coverage


.PHONY: release
release: lint typecheck test build  ## Run every check and preview the published package
		$(npm) pack --dry-run
