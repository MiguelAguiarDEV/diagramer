# diagramer

Local-first, AI-first diagram tool. A single Go binary serves a vanilla SVG/JS
frontend and persists diagrams as JSON files. No npm, no bundler, no framework,
no database, no cloud.

## Build & run

```sh
make build
./diagramer
```

Open <http://127.0.0.1:7777>.

Or without building:

```sh
make run
```

Diagrams are persisted as JSON under `./data` (configurable via `-data`).

## Features

- **Nodes**: rectangles, geometric shapes (circle, ellipse, rhombus, triangles)
  and icon stencils (database, backend, frontend, queue, cache, user, cloud).
  Boxes auto-resize to fit their label.
- **Edges**: directed, bezier, with optional labels and a drag handle to bend
  them.
- **Editing**: inline label edit, multi-select (shift-click + lasso),
  multi-move, alignment, per-node colors, undo/redo (Ctrl/Cmd+Z).
- **Canvas**: infinite pan/zoom, a navigation minimap, "Tidy up" auto-layout
  into columns by edge depth.
- **Subdiagrams**: a node can contain a whole nested diagram — double-click to
  drill in, breadcrumb to come back (see below).
- **Themes**: dark and a warm "vanilla" light mode (toggle in the toolbar,
  persisted).
- **Import/Export**: JSON, plus SVG and PNG export.
- Optimistic save with ETag conflict detection; everything autosaves.

## Subdiagrams

Any node can reference another diagram as its interior, so a box can hold its
own mini-architecture (composition by reference — the subdiagram is a normal,
reusable diagram). Use **+ Add → Container (subdiagram)** (or right-click a node
→ **Create subdiagram**) to make a container; double-click a container to open
it; use the breadcrumb in the title bar to navigate back out.

A subdiagram works like a **function signature**: mark inner nodes via their
context menu → **Interface** as **Input** (left), **Output** (right) or
**Dependency** (top, e.g. a DB or API it relies on). The container shows those
as labelled ports — inputs/deps hollow ("plug here"), output filled. Hover a
container for **"+"** affordances to add an input (left) or dependency (top) in
one click (they scaffold the matching node inside); the output appears on its
own once something inside is tagged Output. Interface inferred from the inside,
so you only maintain one place. Over MCP/JSON, set `data.port` to
`"in"`/`"out"`/`"dep"` on the inner nodes.

## Tests

```sh
make test       # Go unit/integration tests
make test-e2e   # Playwright layout + behavior tests (builds the binary, drives a browser)
```

The E2E suite (`tests/`) sets diagrams up through the REST API, renders them in
a real browser, and runs geometric assertions (no overlap, labels fit their
shape, tidy-up columns, equilateral triangles, theme switch, subdiagram
navigation, …). It also writes screenshots to `tests/screenshots/`.

## MCP mode (let an AI edit your diagrams)

The same binary doubles as an [MCP](https://modelcontextprotocol.io) server over
stdio. Run it with `-mcp` and any MCP client (Claude Desktop, etc.) can build
and edit diagrams via tools.

```sh
./diagramer -mcp -data ./data
```

Add it to Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, equivalent path on Windows/Linux):

```json
{
  "mcpServers": {
    "diagramer": {
      "command": "/absolute/path/to/diagramer",
      "args": ["-mcp", "-data", "/absolute/path/to/data"]
    }
  }
}
```

The HTTP UI and the MCP server share `./data`, so after the AI creates or
modifies a diagram you can refresh the browser tab to see the result.

Exposed tools:
`list_diagrams`, `get_diagram`, `create_diagram`, `rename_diagram`,
`delete_diagram`, `add_node`, `update_node`, `delete_node`, `add_edge`,
`update_edge`, `delete_edge`, `create_subdiagram`. Node tools accept optional
`fill`/`stroke`; `update_node` also accepts `subdiagram_id`. To build nested
architecture: `add_node` a container, `create_subdiagram` to link a fresh
diagram to it, then `add_node`/`add_edge` into the returned subdiagram ID.

## Docs

See [CLAUDE.md](CLAUDE.md) for an orientation map, and
[docs/PRD.md](docs/PRD.md), [docs/architecture.md](docs/architecture.md),
[docs/tasks.md](docs/tasks.md).
