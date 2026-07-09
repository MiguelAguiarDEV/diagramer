# AGENTS.md — contexto de diagramer para agentes

> Lee también `CLAUDE.md` antes de tocar el repo: contiene reglas de arquitectura y producto más detalladas.

## Qué es

`diagramer` es una herramienta local-first y AI-first para crear diagramas: un único binario Go sirve la UI SVG/JS y también puede correr como servidor MCP sobre los mismos datos JSON.

## Arquitectura

- Stack: Go 1.25 (`net/http`, `embed`), frontend vanilla JS/SVG/CSS, almacenamiento en JSON bajo `./data`, MCP con `github.com/modelcontextprotocol/go-sdk`, E2E con Playwright en `tests/`.
- Estructura:
  - `cmd/diagramer/`: entrypoint (`main.go`), CLI y `go:embed` de la web.
  - `cmd/diagramer/web/`: toda la UI (`index.html`, `app.js`, `style.css`).
  - `internal/server/`: HTTP API y handlers.
  - `internal/diagrams/`: modelo, servicio y layout.
  - `internal/storage/`: repositorio JSON y escrituras atómicas.
  - `internal/mcp/`: servidor MCP y tests.
  - `tests/`: suite Playwright; aquí vive el único `package.json` del repo.
  - `docs/`, `.github/workflows/`: documentación y CI/release.
- Puntos de entrada: `./cmd/diagramer`; comandos principales `make run`, `make build`, `./diagramer -mcp -data ./data`.

## Comandos (interfaz estándar)

```sh
make dev        # no existe; usa `make run`
make test       # `go test ./cmd/... ./internal/...`
make build      # compila `./diagramer` desde `./cmd/diagramer`
make deploy-pre # no existe en este repo
make deploy     # no existe en este repo
```

Comandos reales adicionales:

```sh
make run        # arranca el servidor HTTP local en 127.0.0.1:7777
make test-e2e   # `cd tests && npm install && npx playwright install chromium && npx playwright test`
cd tests && npm run test   # Playwright E2E
cd tests && npm run report # abre el reporte de Playwright
```

## Convenciones

- Sigue `CLAUDE.md`: cambios pequeños, sin sobre-ingeniería y respetando el diseño local-first/single-binary.
- No hay React/Vite: la UI está en `cmd/diagramer/web/` y `app.js` es la fuente de verdad; `render()` es el centro de la UI.
- Comentarios cortos y útiles: explican el porqué, no el qué.
- Mantén el estilo existente en Go y en JS vanilla; no introduzcas tooling nuevo sin necesidad.
- Ramas: trabajar SIEMPRE en `feat/*` o `fix/*`; PR a `main`; nunca commitear a `main` directo.
- Si añades capacidad de backend, cuélgala del `Service`; si afecta a agentes, expón también la herramienta MCP si aplica.

## Cómo validar un cambio

1. `make test` en verde.
2. `make build` en verde.
3. Si tocas la UI o flujos completos, ejecutar `make test-e2e` o, como mínimo, `cd tests && npm run test`.
4. Validación manual local: `make run`, abrir `http://127.0.0.1:7777` y probar el flujo afectado.

## Peligros / zonas sensibles

- `cmd/diagramer/web/app.js`: concentra gran parte del comportamiento; evita cambios colaterales.
- `internal/storage/` y `./data`: persistencia JSON e índices; cuidado con compatibilidad y escrituras atómicas.
- `internal/mcp/` y `internal/server/`: la UI HTTP y MCP comparten motor y datos; un cambio aquí impacta ambos modos.
- `.github/workflows/` y `.goreleaser.yaml`: CI y releases; no tocar sin motivo claro.
- NUNCA commitear secretos. Variables de entorno en `.env` local (gitignored) y, si alguna vez hacen falta, documentarlas aparte; este repo no trae `.env.example` ni configuración de despliegue.

## Entornos

- PRE: no hay entorno de preconfigurado en este repo; el uso normal es local en `127.0.0.1:7777`.
- PROD: no hay despliegue gestionado por `make deploy`; la distribución real se hace por releases de GitHub con GoReleaser (`.github/workflows/release.yml`).
