.PHONY: dev build test clean web-build web-dev go-dev help

BINARY := diagramer
GO_PKG := ./cmd/diagramer

help:
	@echo "Targets:"
	@echo "  make dev        — run frontend (Vite) and backend (Go) for local development"
	@echo "  make build      — build frontend, embed it, produce single binary ./$(BINARY)"
	@echo "  make test       — run Go tests"
	@echo "  make clean      — remove binary, web/dist, web/node_modules"

web-build:
	cd web && npm install --silent && npm run build

go-build:
	go build -o $(BINARY) $(GO_PKG)

build: web-build go-build
	@echo "✔ Built $(BINARY) ($$(du -h $(BINARY) | cut -f1))"

go-dev:
	go run $(GO_PKG)

web-dev:
	cd web && npm run dev

dev:
	@echo "Run in two terminals:"
	@echo "  Terminal 1: make go-dev"
	@echo "  Terminal 2: make web-dev"
	@echo ""
	@echo "Frontend will proxy /api to backend on :7777"

test:
	go test ./...

clean:
	rm -f $(BINARY)
	rm -rf web/dist web/node_modules
