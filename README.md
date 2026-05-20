# diagramer

Local-first diagram tool. Single Go binary, vanilla SVG/JS frontend, JSON file persistence. No npm, no bundler, no framework.

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

## MVP controls

- **+ Box** — adds a box at the canvas center; prompts for text.
- **Connect** — toggles connect mode; click a source box, then a target box.
- **Delete** — deletes the selected box (and its edges).
- Click a box to select it. Drag to move. Click empty canvas to deselect.

Diagrams are persisted as JSON under `./data` (configurable via `-data`).

## MCP mode (let an AI edit your diagrams)

The same binary doubles as an [MCP](https://modelcontextprotocol.io) server over
stdio. Run it with `-mcp` and any MCP client (Claude Desktop, etc.) can list,
create, and edit diagrams via tools.

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
`delete_diagram`, `add_node`, `update_node`, `delete_node`,
`add_edge`, `update_edge`, `delete_edge`.

See [docs/PRD.md](docs/PRD.md), [docs/architecture.md](docs/architecture.md), [docs/tasks.md](docs/tasks.md).
