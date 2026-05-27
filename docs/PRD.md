# PRD — diagramer

## Qué es

`diagramer` es una herramienta **local-first y AI-first** para crear diagramas
que estructuran código y arquitectura: nodos etiquetados (cajas, formas, y
stencils con icono) conectados con flechas sobre un canvas infinito. Se
distribuye como un **único binario auto-contenido** — sin Node, sin Docker, sin
base de datos, sin servicio externo.

Un comando: `./diagramer`. Abre `localhost:7777`. Editas. Cierras. El mismo
binario corre como servidor MCP (`-mcp`) para que una IA construya y edite los
diagramas con herramientas.

## Para quién

Para Miguel y cualquier desarrollador que quiera bocetar arquitectura,
dependencias o flujos de datos sin pelearse con Excalidraw, Figma o Mermaid, ni
con servicios SaaS — y que quiera que una IA pueda generar y manipular esos
diagramas directamente.

## Problema que resuelve

- Mermaid/PlantUML son texto-only y poco fluidos para iterar visualmente.
- Excalidraw es genérico y no estructura datos (grafo consultable).
- Figma/Lucid son SaaS, pesados y exigen cuenta.
- Ninguno está pensado para que una IA edite el diagrama de forma nativa.

`diagramer` ocupa ese hueco: grafo estructurado (nodos + aristas), persistencia
en JSON inspectable y diff-able, sin nube ni login, y una superficie MCP para IA.

## Objetivos

- En <5 s desde lanzar el binario, crear nodos y conectarlos; autosave sin
  pulsar nada.
- Que una IA, vía MCP, pueda crear un diagrama completo (incl. arquitectura
  anidada) que el usuario vea al refrescar el navegador.
- JSON resultante legible y versionable en git. Binario <30 MB.

## Alcance

### Implementado

- Multi-diagrama: listar, crear, abrir, renombrar, borrar (un JSON por diagrama).
- Canvas infinito (pan/zoom) + minimapa de navegación.
- Tipos de nodo: rectángulo, formas geométricas (círculo, elipse, rombo,
  triángulos) e iconos (database, backend, frontend, queue, cache, user, cloud).
  Auto-resize al texto.
- Aristas dirigidas bezier, con etiqueta opcional y handle para curvarlas.
- Edición inline, multiselección (shift + lazo), multi-move, alineación,
  colores por nodo, undo/redo.
- "Tidy up" (auto-layout por profundidad de aristas).
- **Subdiagramas**: un nodo contenedor referencia otro diagrama como interior,
  navegable con breadcrumb. Interfaz tipo función: nodos internos marcados
  `in`/`out`/`dep` afloran como puertos en la caja (izquierda/derecha/abajo).
- Temas claro (vainilla) / oscuro, persistidos.
- Import/Export JSON, export SVG/PNG.
- Autosave con detección de conflicto por ETag.
- **MCP**: 12 herramientas para edición por IA.

### Futuro reconocido

- Mapeo fino arista↔puerto: que una arista del padre se conecte a un puerto
  concreto de la caja y se vincule al nodo interno correspondiente (hoy los
  puertos son visuales y las aristas conectan a la caja entera).
- Code-aware import (parsear un repo → diagrama).
- Ocultar subdiagramas referenciados de la lista raíz.

### Out of scope (nunca)

- Multi-usuario, sync, login, nube.
- Cualquier feature que requiera servidor remoto o base de datos.
- Telemetría / analytics.
- Cualquier cosa que rompa "un comando, un binario, un proceso".

## Restricciones

- **KISS.** Simplicidad antes que flexibilidad anticipada.
- **Single binary.** Cero dependencias en runtime; frontend embebido vía `go:embed`.
- **Local-first.** Datos en disco del usuario, en JSON. Cero red más allá de `localhost`.
- **AI-first.** La superficie MCP es ciudadana de primera clase, no un añadido.

## Stack

| Capa | Elección |
|---|---|
| Frontend | Vanilla SVG + JS (sin framework ni bundler) |
| Backend | Go (stdlib `net/http` + `embed`) |
| AI | Servidor MCP sobre stdio (MCP Go SDK) |
| Storage | Archivos JSON en `./data/diagrams/<id>.json` + `index.json` |
| Distribución | `go build` produce un binario único |
