# Architecture — diagramer

## Box diagram

```
┌──────────────────────────── diagramer (single binary) ─────────────────────────────┐
│                                                                                     │
│  HTTP mode (default)                          MCP mode (-mcp)                        │
│  ┌─────────────────────────┐                  ┌──────────────────────────────────┐  │
│  │ net/http server :7777   │                  │ internal/mcp (stdio JSON-RPC)    │  │
│  │ internal/server         │                  │ 12 tools over the MCP Go SDK     │  │
│  │ + embedded web/ (SVG/JS)│                  └────────────────┬─────────────────┘  │
│  └────────────┬────────────┘                                   │                    │
│               │  /api/diagrams[/{id}]                          │                    │
│               ▼                                                ▼                    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐ │
│  │ internal/diagrams (Service): validation, ETag/If-Match, business rules         │ │
│  └────────────────────────────────────┬───────────────────────────────────────────┘ │
│                                        ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────────┐ │
│  │ internal/storage (Repository): JSONFileRepo, atomic writes, index.json         │ │
│  └────────────────────────────────────┬───────────────────────────────────────────┘ │
│                                        ▼                                             │
│             ./data/index.json  +  ./data/diagrams/<uuid>.json                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

Both entrypoints (HTTP and MCP) sit on top of the same `Service` → `Repository`
stack and the same `./data` directory, so an AI editing over MCP and a human
editing in the browser see the same diagrams.

## Repo layout

```
diagramer/
├── cmd/diagramer/
│   ├── main.go            # flags (-addr, -data, -mcp), wiring of repo/service/server|mcp
│   ├── embed.go           # //go:embed web → http static handler
│   └── web/               # the entire frontend (embedded at compile time)
│       ├── index.html     # markup + anti-FOUC theme bootstrap
│       ├── app.js         # all behavior: render(), interaction, undo, export, theme
│       └── style.css      # CSS custom properties; dark base + light (vanilla) theme
├── internal/
│   ├── server/            # HTTP: server.go (mux, middleware), handlers.go
│   ├── diagrams/          # domain: model.go, service.go, service_test.go
│   ├── storage/           # jsonfile.go (JSONFileRepo), repository.go, tests
│   └── mcp/               # server.go (MCP tools) + server_test.go
├── tests/                 # Playwright E2E (helpers.ts, layout.spec.ts)
├── docs/                  # PRD, architecture, tasks
├── CLAUDE.md              # agent orientation
├── Makefile               # build, run, test, test-e2e, clean
└── go.mod
```

Frontend is vanilla SVG/JS — no React, no Vite, no bundler. (An earlier
version used React Flow; it was replaced.) Adding a backend module = a new
package under `internal/` with a small interface, wired in `main.go`.

## Key interfaces (Go)

```go
// internal/storage/repository.go
type Repository interface {
    List(ctx context.Context) ([]diagrams.DiagramMeta, error)
    Get(ctx context.Context, id string) (*diagrams.Diagram, error)
    Save(ctx context.Context, d *diagrams.Diagram) error
    Delete(ctx context.Context, id string) error
}

// internal/diagrams/service.go
type Service interface {
    List(ctx context.Context) ([]DiagramMeta, error)
    Get(ctx context.Context, id string) (*Diagram, error)
    Create(ctx context.Context, name string) (*Diagram, error)
    // Update writes d. When ifMatch is non-empty it must equal the current
    // server-side ETag or ErrConflict is returned; pass "" to bypass.
    Update(ctx context.Context, d *Diagram, ifMatch string) (*Diagram, error)
    Rename(ctx context.Context, id, newName string) (*Diagram, error)
    Delete(ctx context.Context, id string) error
}
```

## Data model

```go
type Diagram struct {
    ID        string    `json:"id"`
    Name      string    `json:"name"`
    Nodes     []Node    `json:"nodes"`
    Edges     []Edge    `json:"edges"`
    Viewport  Viewport  `json:"viewport"`
    CreatedAt time.Time `json:"createdAt"`
    UpdatedAt time.Time `json:"updatedAt"`
}

type Node struct {
    ID       string   `json:"id"`
    Kind     string   `json:"kind,omitempty"` // rect|circle|ellipse|rhombus|tri-up|tri-down|database|backend|frontend|queue|cache|user|cloud
    Position Position `json:"position"`
    Data     NodeData `json:"data"`
}

type NodeData struct {
    Label        string `json:"label"`
    Fill         string `json:"fill,omitempty"`         // CSS hex; empty → theme default
    Stroke       string `json:"stroke,omitempty"`
    SubdiagramID string `json:"subdiagramId,omitempty"` // container → another diagram
    Port         string `json:"port,omitempty"`         // interface role: in|out|dep
}

type Edge struct {
    ID        string     `json:"id"`
    Source    string     `json:"source"`
    Target    string     `json:"target"`
    Label     string     `json:"label,omitempty"`
    Curvature *Curvature `json:"curvature,omitempty"` // drag-handle offset from midpoint
}

type Viewport struct{ X, Y, Zoom float64 }
```

The JSON mirrors React Flow's `{nodes, edges, viewport}` shape. `NodeData` is
an open struct that grows without migrations — old JSON stays valid.

### Subdiagrams (composition by reference)

A node with `SubdiagramID` is a **container**: it points at another diagram
(by ID) that is its nested interior. The subdiagram is a normal diagram —
persisted, listed, and editable like any other, and reusable from multiple
containers. The frontend renders a badge, drills in on double-click, and shows
a breadcrumb. Over MCP, `create_subdiagram` creates+links one.

**Interface ports (function metaphor).** A subdiagram declares its interface the
way a function signature does: inner nodes tagged with `data.port` =
`in`/`out`/`dep` become ports on any container referencing that diagram —
`in` left (entry), `out` right (return), `dep` top (a DB/API the inside
relies on). The interface is **inferred from the inside** (one source of truth):
the container fetches the subdiagram's port-tagged nodes (cached frontend-side
in `subPorts`) and draws a disc per port (in/dep hollow, out filled); inner
interface nodes carry an in/out/dep badge. Containers expose "+" affordances
(add input on the left, add dependency on top) that create the matching
interface node inside the subdiagram. v1 is visual — binding a parent edge to a
*specific* inner port is **future work**; today edges connect to the container
as a whole.

## Storage on disk

```
./data/
├── index.json                  # [{id, name, updatedAt, nodeCount, edgeCount}, ...]
└── diagrams/
    └── <uuid>.json
```

- **Atomic write:** `Save` writes `<uuid>.json.tmp` then renames; `index.json`
  is rewritten whole each save (trivial for N<1000).
- **Concurrency:** `Service.Update` supports optimistic concurrency via ETag.
  `PUT` with a stale `If-Match` returns `412`; the frontend offers reload.

## HTTP API

| Method | Route | Body | Response |
|---|---|---|---|
| `GET` | `/api/health` | — | ok |
| `GET` | `/api/diagrams` | — | `[]DiagramMeta` |
| `POST` | `/api/diagrams` | `{name}` | `Diagram` (new, empty) |
| `GET` | `/api/diagrams/{id}` | — | `Diagram` (+ `ETag`) |
| `PUT` | `/api/diagrams/{id}` | `Diagram` | `Diagram` (autosave; honors `If-Match`) |
| `PATCH` | `/api/diagrams/{id}` | `{name}` | `Diagram` (rename) |
| `DELETE` | `/api/diagrams/{id}` | — | `204` |
| `GET` | `/*` | — | embedded frontend |

No auth. Binds `127.0.0.1:7777` by default.

## MCP server

`internal/mcp` wraps the same `Service` and exposes 12 tools over stdio using
the official MCP Go SDK: `list_diagrams`, `get_diagram`, `create_diagram`,
`rename_diagram`, `delete_diagram`, `add_node`, `update_node`, `delete_node`,
`add_edge`, `update_edge`, `delete_edge`, `create_subdiagram`. Run with
`./diagramer -mcp`. See `internal/mcp/server_test.go` for the exercised flows.

## Build

```
make build   # go build -o diagramer ./cmd/diagramer   (frontend is embedded, no JS build)
make test    # go test ./cmd/... ./internal/...
make test-e2e# Playwright against a fresh go-run instance
```

## Future / deferred

- Subdiagram input/output ports with explicit inner-node mapping.
- Hiding referenced subdiagrams from the root list.
- Code-aware import (parse a repo → diagram).
- Alternate storage backend (SQLite/Bolt) = new `Repository` impl only.
