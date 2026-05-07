.PHONY: build run test clean help

BINARY := diagramer
GO_PKG := ./cmd/diagramer

help:
	@echo "Targets:"
	@echo "  make build  — build single static binary ./$(BINARY)"
	@echo "  make run    — run from source (go run)"
	@echo "  make test   — run Go tests"
	@echo "  make clean  — remove binary"

build:
	go build -o $(BINARY) $(GO_PKG)
	@echo "✔ Built $(BINARY) ($$(du -h $(BINARY) | cut -f1))"

run:
	go run $(GO_PKG)

test:
	go test ./cmd/... ./internal/...

clean:
	rm -f $(BINARY)
