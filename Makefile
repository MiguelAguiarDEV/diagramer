.PHONY: dev build test clean web-build go-build web-dev go-dev help embed-stage

BINARY := diagramer
GO_PKG := ./cmd/diagramer
EMBED_DIR := cmd/diagramer/web-dist

help:
	@echo "Targets:"
	@echo "  make dev        — instructions for running frontend + backend in dev"
	@echo "  make build      — build frontend, stage for embed, produce single binary ./$(BINARY)"
	@echo "  make test       — run Go tests"
	@echo "  make clean      — remove binary, web/dist, web/node_modules, embed stage"

web-build:
	cd web && npm install --silent && npm run build

embed-stage: web-build
	rm -rf $(EMBED_DIR)
	cp -r web/dist $(EMBED_DIR)

go-build:
	go build -o $(BINARY) $(GO_PKG)

build: embed-stage go-build
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
	@echo "Frontend (Vite, :5173) proxies /api to backend on :7777"

test:
	go test ./cmd/... ./internal/...

clean:
	rm -f $(BINARY)
	rm -rf web/dist web/node_modules $(EMBED_DIR)
