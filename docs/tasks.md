# Tasks — diagramer v1

Cada fase es entregable y testeable por separado. No empezar la siguiente sin que la anterior compile y pase tests.

## Fase 0 — Bootstrapping

- [ ] `go mod init github.com/MiguelAguiarDEV/diagramer`
- [ ] `web/`: `npm create vite@latest . -- --template react-ts`
- [ ] `npm install reactflow @xyflow/react` en `web/`
- [ ] `.gitignore`: `web/node_modules/`, `web/dist/`, `data/`, `diagramer` (binario), `*.tmp`
- [ ] `Makefile` con targets: `dev`, `build`, `test`, `clean`
- [ ] `cmd/diagramer/main.go` "Hello World" — sirve un `index.html` estático en `:7777`
- [ ] `go build` produce un binario que arranca y responde en `localhost:7777`

**DoD:** `make build && ./diagramer` sirve una página vacía en el navegador.

## Fase 1 — Backend dominio + storage

- [ ] `internal/diagrams/model.go`: `Diagram`, `Node`, `Edge`, `Viewport`, `DiagramMeta`
- [ ] `internal/storage/repository.go`: interfaz `Repository`
- [ ] `internal/storage/jsonfile.go`: implementación `JSONFileRepo`
  - [ ] `Save` escribe atómicamente (`.tmp` + rename)
  - [ ] `Save` actualiza `index.json`
  - [ ] `List` lee `index.json`
  - [ ] `Get(id)` lee el archivo concreto, error `ErrNotFound` si falta
  - [ ] `Delete` borra archivo + actualiza `index.json`
- [ ] `internal/storage/jsonfile_test.go`: tests con `t.TempDir()`
  - [ ] save→get round-trip preserva datos
  - [ ] list devuelve metadata correcta
  - [ ] save concurrente no corrompe (sync.Mutex en el repo)
  - [ ] delete no rompe si no existe

**DoD:** `go test ./internal/storage/...` verde.

## Fase 2 — Service + HTTP handlers

- [ ] `internal/diagrams/service.go`: interfaz + impl que envuelve `Repository`
  - [ ] `Create(name)` genera UUIDv7, timestamps, persiste vacío
  - [ ] `Update` valida que el ID existe, refresca `UpdatedAt`
  - [ ] `Rename` solo cambia `Name` + `UpdatedAt`
- [ ] `internal/server/server.go`: mux + middleware (logging, CORS para dev)
- [ ] `internal/server/handlers.go`: handlers para las 6 rutas del API
- [ ] `internal/server/server_test.go`: tests con `httptest.NewServer` y un `Repository` in-memory
- [ ] Wiring en `cmd/diagramer/main.go`: instancia repo, service, server

**DoD:** `curl localhost:7777/api/diagrams` devuelve `[]`. `curl -X POST -d '{"name":"test"}'` crea uno. `curl /api/diagrams/:id` lo recupera.

## Fase 3 — Frontend skeleton

- [ ] `web/src/api.ts`: cliente tipado para las 6 rutas
- [ ] `web/src/DiagramList.tsx`: lista de diagramas, botón "Nuevo", click abre uno
- [ ] `web/src/DiagramCanvas.tsx`: React Flow básico
  - [ ] Carga `Diagram` desde el API
  - [ ] Renderiza nodos como `default` node con label editable inline
  - [ ] Pan/zoom infinito
  - [ ] Doble click en canvas crea nodo nuevo
  - [ ] Drag desde un handle a otro nodo crea edge
  - [ ] Botón "Borrar" en nodo seleccionado
- [ ] `web/src/App.tsx`: routing simple (lista ↔ canvas), state con URL hash
- [ ] Estilos mínimos. Sin Tailwind ni component lib en v1.

**DoD:** `npm run dev` (con backend Go corriendo): puedes crear, listar, abrir, editar (sin guardar todavía).

## Fase 4 — Autosave

- [ ] `useDebouncedCallback(saveFn, 500)` en `DiagramCanvas`
- [ ] Llama `PUT /api/diagrams/:id` con el estado completo cuando hay cambios
- [ ] Indicador minúsculo de estado: idle / saving / saved (no bloqueante)
- [ ] Persistir viewport (`onMoveEnd` también dispara save)
- [ ] Test manual: editar, esperar 1s, recargar página, los cambios persisten
- [ ] Test manual: cerrar sin esperar 500ms — el `flush` en `beforeunload` salva pendientes

**DoD:** Cualquier edición persiste sin tocar botón.

## Fase 5 — Operaciones de diagrama (rename + delete)

- [ ] Botón "Rename" en `DiagramList` y en header del canvas — input modal o inline
- [ ] Botón "Delete" en `DiagramList` con confirmación
- [ ] Backend: `PATCH` y `DELETE` ya están — wire del frontend

**DoD:** Crear, renombrar, borrar un diagrama desde la UI funciona end-to-end.

## Fase 6 — Embed + binario único

- [ ] Configurar `vite.config.ts` con `base: "./"` para rutas relativas en build
- [ ] `npm run build` produce `web/dist/`
- [ ] `cmd/diagramer/main.go`:
  - [ ] `//go:embed all:web/dist`
  - [ ] Sirve `web/dist/` con `http.FileServer(http.FS(distSubFS))`
  - [ ] Fallback a `index.html` para rutas SPA
- [ ] `Makefile target build`: `npm ci --prefix web && npm run build --prefix web && go build -o diagramer ./cmd/diagramer`
- [ ] Verificar: `./diagramer` sin Node instalado, sin `web/` accesible al binario, funciona

**DoD:** Mover el binario a `/tmp/`, ejecutarlo, abrir el navegador, todo funciona. `ls /tmp/diagramer` = único archivo necesario.

## Fase 7 — Hardening mínimo

- [ ] `127.0.0.1:7777` por defecto (no `0.0.0.0`)
- [ ] Flag `-port` para cambiar puerto
- [ ] Flag `-data` para cambiar el directorio de datos (default: `./data`)
- [ ] Logs estructurados con `slog` (stdlib)
- [ ] Error handling consistente: 404 para `ErrNotFound`, 400 para body inválido, 500 con mensaje genérico
- [ ] README con `make build && ./diagramer`

**DoD:** Listo para usar día a día.

---

## Backlog v2+ (no tocar en v1)

- Tipos de nodo (color, icono, forma)
- Etiquetas en aristas
- Multiselect / copy-paste / undo-redo
- Export a PNG/SVG/Mermaid
- Code-aware import (`internal/codeimport/`)
- Diagrama embebible (compartir vía link estático)
- Dark mode
- Buscar/filtrar en la lista de diagramas

## Riesgos durante la implementación

- **Build orchestration.** Si alguien hace `go build` sin haber hecho `npm run build` primero, falla el `go:embed`. Mitigación: el `Makefile` siempre encadena ambos, y `go:embed` con un `dist/` vacío rompe en compilación, no en runtime.
- **React Flow versionado.** xyflow renombró el paquete recientemente. Fijar versión en `package.json` y no usar `^` en v1.
- **Path traversal en `id`.** Aunque generemos UUIDv7, validar el ID en el server (regex `^[0-9a-f-]{36}$`) antes de tocar el filesystem.
- **JSON gigante.** Diagramas con 10k nodos serializan lento. Aceptable para v1; medir y aliviar (delta updates) en v2 si pasa.
