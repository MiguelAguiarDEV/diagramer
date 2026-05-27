# CLAUDE.md

Guidance for AI agents (and humans) working in this repo.

## What this is

`diagramer` is a **local-first diagram tool**: a single Go binary that serves a
vanilla SVG/JS frontend and persists diagrams as JSON files. No npm, no
bundler, no framework, no database, no cloud. One command (`./diagramer`),
open `localhost:7777`, edit, close.

It is **AI-first**: the same binary runs as an MCP server (`-mcp`) exposing
tools so an AI can build and edit diagrams programmatically. The HTTP UI and
the MCP server share `./data`, so AI edits show up in the browser on refresh.

## Stack (real, current)

| Layer | Choice |
|---|---|
| Backend | Go stdlib `net/http` + `embed` |
| Frontend | Vanilla SVG + JS in `cmd/diagramer/web/` (embedded via `go:embed`) |
| Storage | JSON files under `./data` (`index.json` + `diagrams/<uuid>.json`), atomic writes |
| AI | MCP server over stdio (`github.com/modelcontextprotocol/go-sdk`) |
| Tests | Go unit/integration + Playwright E2E in `tests/` |

There is **no React/Vite** — an earlier version had it; it was replaced by the
vanilla frontend. Ignore any stale mention of `web/`, `web/dist`, or xyflow.

## Layout

```
cmd/diagramer/
  main.go        # entrypoint: flags (-addr, -data, -mcp), wiring
  embed.go       # //go:embed web → static handler
  web/           # the entire frontend
    index.html   # markup + anti-FOUC theme script
    app.js       # ALL behavior (render, interaction, undo, export, theme, …)
    style.css    # design tokens (CSS custom properties); :root dark (slate), :root[data-theme=light] warm vanilla
internal/
  server/        # HTTP layer (mux, handlers, ETag/If-Match)
  diagrams/      # domain: model.go (types) + service.go (Service interface)
  storage/       # JSONFileRepo (Repository interface), atomic save, index.json
  mcp/           # MCP server (server.go) + server_test.go — 12 tools
tests/           # Playwright: helpers.ts, layout.spec.ts, screenshots/ (gitignored)
docs/            # PRD, architecture, tasks
```

## Commands

```sh
make build      # go build -o diagramer ./cmd/diagramer
make run        # go run ./cmd/diagramer
make test       # go test ./cmd/... ./internal/...
make test-e2e   # Playwright (installs deps + chromium, builds, drives a browser)
./diagramer -mcp -data ./data   # run as MCP server over stdio
```

E2E runs a fresh `go run` against a throwaway data dir. Where the Playwright
CDN is blocked, point `PW_CHROMIUM` at a pre-installed chromium binary.

## Data model (`internal/diagrams/model.go`)

```
Diagram { id, name, nodes[], edges[], component?, viewport, createdAt, updatedAt }
Node    { id, kind?, position{x,y}, data{ label, fill?, stroke?, subdiagramId?, port? } }
Edge    { id, source, target, sourcePort?, targetPort?, label?, curvature?{ox,oy} }
Viewport{ x, y, zoom }
DiagramMeta { id, name, updatedAt, nodeCount, edgeCount, component?, subdiagrams[] }
```

- `kind`: rect (default), circle, ellipse, rhombus, tri-up, tri-down, and the
  icon stencils database/backend/frontend/queue/cache/user/cloud.
- `component`: a diagram is just a diagram; this flag only sorts it into the
  sidebar's **Subdiagrams** (library) section vs **Diagrams**. New subdiagrams
  are created `component:true`; right-click a sidebar item to Convert to/from.
  `DiagramMeta.subdiagrams` lists referenced ids so the sidebar builds an
  expandable "contains" tree (lazy per path → recursive self-reference is
  allowed and won't loop).
- `sourcePort`/`targetPort`: bind an edge endpoint to a container interface
  port (the inner node id).
- `fill`/`stroke`: optional CSS hex; empty falls back to the theme defaults.
- `subdiagramId`: makes the node a **container** referencing another diagram
  as its nested interior (see below).
- `port`: marks a node as part of its diagram's interface — `"in"` (entry),
  `"out"` (return), `"dep"` (dependency). Surfaces as a port on any container
  referencing that diagram (see below).
- `curvature`: offset of an edge's drag handle from the straight midpoint.

The JSON shape mirrors React Flow's `{nodes, edges, viewport}` for familiarity.

## Frontend conventions

- `app.js` is plain JS, no build step. `render()` is the heart: it rebuilds the
  `#nodes` / `#edges` SVG layers from `diagram` on every change. Keep it the
  single source of truth — most features hook into it.
- Colors are **CSS custom properties** (`--bg`, `--accent`, `--node-fill`, …)
  so theming and per-node overrides compose without specificity fights.
- Comments explain **why**, not what. Match the terse, purposeful style already
  in the file.

## Subdiagrams (nested containers)

A node with `data.subdiagramId` references another diagram as its inside.
Composition is **by reference**, so a subdiagram is a normal diagram (reusable,
editable, listable). Double-click a container to drill in; the title shows a
clickable breadcrumb trail (the containment path — click an ancestor to go up).
The sidebar is the containment tree (VS Code explorer style): as you navigate it
auto-expands the active drill path and highlights the single occurrence you
reached it by (`data-path` = "root/.../current"; only ancestors are expanded,
lazily per path so recursion never loops). Clicking a nested item adopts that
tree path as the drill path. Orthogonally, a chronological history powers
Back/Forward (toolbar `‹ ›` or Alt+←/→) so you can return to wherever you were
regardless of how you got there (sidebar jump, drill-in, crumb); each history
entry restores its breadcrumb. Fit (toolbar button or `F`) zooms/pans so the
whole diagram fits — the "see everything" view. Via MCP: `create_subdiagram`
links a fresh diagram to a node; populate it with `add_node`/`add_edge` using
the returned id.

A subdiagram has an **interface like a function signature**: tag inner nodes
with `data.port` = `"in"` / `"out"` / `"dep"` and the container surfaces them as
ports — `in` on the left (entry), `out` on the right (return), `dep` on the
top (a DB/API the inside relies on). The interface is **inferred from the
inside** (single source of truth): the container fetches the subdiagram's
port-tagged nodes (cached in `subPorts`) and draws a disc per port — in/dep
hollow ("plug here"), out filled. A dashed "+" bolita sits at the next slot of
the in/dep lines to add more (it scaffolds the matching interface node inside);
containers auto-grow so ports keep a fixed spacing. Edges can bind to a specific
port: drag from a port disc, or drop a connection onto one — stored as
`edge.sourcePort`/`targetPort` (the inner node id) and anchored there via
`anchorsFor`. The container also renders a scaled minimap of its inside
(`subPreview`, drawn by `drawSubPreview`) with its label as a bottom caption.
Inside a subdiagram, create interface nodes via the Add menu → Interface port,
or mark/clear any node's role from its context menu.

## MCP tools (12)

`list_diagrams`, `get_diagram`, `create_diagram`, `rename_diagram`,
`delete_diagram`, `add_node`, `update_node`, `delete_node`, `add_edge`,
`update_edge`, `delete_edge`, `create_subdiagram`. Node tools accept
`fill`/`stroke`; `update_node` also accepts `subdiagram_id`.

## Principles

KISS, single binary, local-first, no telemetry/login/cloud. Prefer extending
the existing interface (`Repository`, `Service`) over new abstractions. When
adding a frontend feature, wire it through `render()`; when adding a backend
capability, expose it on the `Service` and (if AI-relevant) as an MCP tool.
