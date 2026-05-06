# Architecture — diagramer

## Diagrama de cajas

```
┌──────────────────────────── diagramer (binario único) ─────────────────────────────┐
│                                                                                    │
│   ┌─────────────────────────┐        ┌──────────────────────────────────────────┐  │
│   │  net/http server :7777  │ ◄────► │  embed.FS (frontend buildeado: dist/)    │  │
│   │  (cmd/diagramer)        │        │  GET /  →  index.html, /assets/*         │  │
│   └────────┬────────────────┘        └──────────────────────────────────────────┘  │
│            │                                                                       │
│            │  /api/diagrams[/:id]                                                  │
│            ▼                                                                       │
│   ┌─────────────────────────┐        ┌──────────────────────────────────────────┐  │
│   │  internal/server        │ ──►    │  internal/diagrams (Service)             │  │
│   │  (http handlers, mux)   │        │  validación + reglas de negocio          │  │
│   └─────────────────────────┘        └────────┬─────────────────────────────────┘  │
│                                               │                                    │
│                                               ▼                                    │
│                                      ┌──────────────────────────────────────────┐  │
│                                      │  internal/storage (Repository interface) │  │
│                                      │  JSONFileRepo: ./data/diagrams/*.json    │  │
│                                      └────────┬─────────────────────────────────┘  │
│                                               │ atomic write (.tmp + rename)       │
│                                               ▼                                    │
│                                      ┌──────────────────────────────────────────┐  │
│                                      │  ./data/diagrams/<uuid>.json             │  │
│                                      │  ./data/index.json (lista + metadata)    │  │
│                                      └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## Layout del repo

```
diagramer/
├── cmd/diagramer/             # punto de entrada del binario
│   └── main.go                # bootstrapping: server + embed
├── internal/
│   ├── server/                # HTTP layer
│   │   ├── server.go          # interface Server, mux, middleware
│   │   ├── handlers.go        # handlers REST
│   │   └── server_test.go
│   ├── diagrams/              # dominio
│   │   ├── service.go         # interface Service
│   │   ├── model.go           # Diagram, Node, Edge
│   │   └── service_test.go
│   ├── storage/               # persistencia
│   │   ├── repository.go      # interface Repository
│   │   ├── jsonfile.go        # JSONFileRepo
│   │   └── jsonfile_test.go
│   └── codeimport/            # FUTURO v2 — placeholder, no en v1
├── web/                       # frontend
│   ├── src/
│   │   ├── App.tsx
│   │   ├── DiagramCanvas.tsx  # React Flow
│   │   ├── DiagramList.tsx
│   │   ├── api.ts
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── web/dist/                  # output de `vite build` (gitignored, embebido por Go)
├── docs/                      # PRD, architecture, tasks
├── Makefile                   # build, dev, test
├── go.mod
└── .gitignore
```

## Interfaces clave (Go)

Cada módulo expone una interfaz pequeña. Tests usan implementación in-memory; producción usa la implementación concreta.

```go
// internal/storage/repository.go
type Repository interface {
    List(ctx context.Context) ([]DiagramMeta, error)
    Get(ctx context.Context, id string) (*Diagram, error)
    Save(ctx context.Context, d *Diagram) error
    Delete(ctx context.Context, id string) error
}

// internal/diagrams/service.go
type Service interface {
    List(ctx context.Context) ([]DiagramMeta, error)
    Get(ctx context.Context, id string) (*Diagram, error)
    Create(ctx context.Context, name string) (*Diagram, error)
    Update(ctx context.Context, d *Diagram) error
    Rename(ctx context.Context, id, newName string) error
    Delete(ctx context.Context, id string) error
}

// internal/server/server.go
type Server interface {
    Start(addr string) error
    Stop(ctx context.Context) error
}
```

Añadir un módulo nuevo (p.ej. `codeimport`) = nuevo paquete bajo `internal/`, nueva interfaz, wiring en `cmd/diagramer/main.go`. Sin tocar el resto.

## Modelo de datos

```go
// Diagram es la unidad de persistencia: un archivo JSON.
type Diagram struct {
    ID        string    `json:"id"`         // UUIDv7
    Name      string    `json:"name"`
    Nodes     []Node    `json:"nodes"`
    Edges     []Edge    `json:"edges"`
    Viewport  Viewport  `json:"viewport"`   // pan + zoom persistido
    CreatedAt time.Time `json:"createdAt"`
    UpdatedAt time.Time `json:"updatedAt"`
}

type Node struct {
    ID       string   `json:"id"`           // nanoid local
    Position Position `json:"position"`
    Data     NodeData `json:"data"`
}
type Position struct{ X, Y float64 }
type NodeData struct{ Label string `json:"label"` }

type Edge struct {
    ID     string `json:"id"`
    Source string `json:"source"`            // node id
    Target string `json:"target"`
}

type Viewport struct{ X, Y, Zoom float64 }

// DiagramMeta es la fila ligera de la lista (no carga nodes/edges).
type DiagramMeta struct {
    ID        string    `json:"id"`
    Name      string    `json:"name"`
    UpdatedAt time.Time `json:"updatedAt"`
    NodeCount int       `json:"nodeCount"`
    EdgeCount int       `json:"edgeCount"`
}
```

El JSON producido es compatible 1:1 con el shape de React Flow (`{nodes, edges, viewport}`), minimiza mapping en el frontend.

## Storage en disco

```
./data/
├── index.json                  # [{id, name, updatedAt, nodeCount, edgeCount}, ...]
└── diagrams/
    ├── <uuid>.json
    └── <uuid>.json
```

- **Escritura atómica:** `Save` escribe a `<uuid>.json.tmp` y renombra. `index.json` se reescribe completo en cada save (rápido y simple — para v1 con N<1000 diagramas es trivial).
- **Lectura:** `List` lee `index.json`. `Get(id)` lee el archivo concreto. Sin caché en v1.
- **IDs:** UUIDv7 (ordenado por tiempo, evita colisiones, debug-friendly).

## API HTTP

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/api/diagrams` | — | `[]DiagramMeta` |
| `POST` | `/api/diagrams` | `{name}` | `Diagram` (vacío, recién creado) |
| `GET` | `/api/diagrams/:id` | — | `Diagram` |
| `PUT` | `/api/diagrams/:id` | `Diagram` | `Diagram` (autosave, replace completo) |
| `PATCH` | `/api/diagrams/:id` | `{name}` | `DiagramMeta` (rename) |
| `DELETE` | `/api/diagrams/:id` | — | `204` |
| `GET` | `/*` | — | frontend (embed.FS) |

Sin auth. Localhost only — el server bindea a `127.0.0.1:7777` por defecto.

## Build pipeline

```
make build:
  cd web && npm install && npm run build      # produce web/dist/
  cd .. && go build -o diagramer ./cmd/diagramer
```

Go embebe `web/dist/` con:

```go
//go:embed all:web/dist
var frontendFS embed.FS
```

`make dev`: arranca Vite en `:5173` con proxy a Go en `:7777`. Hot reload del frontend, recompila Go a mano.

## Decisiones diferidas (no bloquean v1)

- Soporte de undo/redo — v2.
- Etiquetas en aristas — v2.
- Tipos de nodo — v2.
- Code-aware import — v2+.
- Export PNG/SVG — v2+.

## Extension hooks reconocidos

- `internal/codeimport/`: nuevo paquete, ingiere AST/tree-sitter y produce `Diagram`.
- `NodeData`: campo abierto que puede crecer (`type`, `color`, `icon`) sin migración (los archivos viejos siguen siendo válidos JSON).
- `Repository`: cambiar a SQLite o BoltDB en el futuro = nueva implementación de la interfaz, sin tocar `Service`/`Server`.
