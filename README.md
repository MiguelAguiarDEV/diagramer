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

See [docs/PRD.md](docs/PRD.md), [docs/architecture.md](docs/architecture.md), [docs/tasks.md](docs/tasks.md).
