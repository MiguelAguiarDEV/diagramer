# diagramer

Local-first diagram tool. React Flow canvas, Go single binary, JSON file persistence.

> Status: **Phase 0 — bootstrapping**.

## Build

```sh
make build
./diagramer
```

Open <http://127.0.0.1:7777>.

## Develop

```sh
# Terminal 1 — backend
make go-dev

# Terminal 2 — frontend (Vite, hot reload, proxies /api to :7777)
make web-dev
```

See [docs/PRD.md](docs/PRD.md), [docs/architecture.md](docs/architecture.md), [docs/tasks.md](docs/tasks.md).
