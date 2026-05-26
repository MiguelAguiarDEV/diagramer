.PHONY: build run test test-e2e clean help

BINARY := diagramer
GO_PKG := ./cmd/diagramer

help:
	@echo "Targets:"
	@echo "  make build     — build single static binary ./$(BINARY)"
	@echo "  make run       — run from source (go run)"
	@echo "  make test      — run Go tests"
	@echo "  make test-e2e  — run Playwright layout tests (installs deps first)"
	@echo "  make clean     — remove binary"

build:
	go build -o $(BINARY) $(GO_PKG)
	@echo "✔ Built $(BINARY) ($$(du -h $(BINARY) | cut -f1))"

run:
	go run $(GO_PKG)

test:
	go test ./cmd/... ./internal/...

test-e2e:
	cd tests && npm install && npx playwright install chromium && npx playwright test

clean:
	rm -f $(BINARY)
