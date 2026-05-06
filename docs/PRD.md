# PRD — diagramer

## Qué es

`diagramer` es una herramienta local para crear diagramas que estructuran código y arquitectura: cajas etiquetadas conectadas con flechas dinámicas sobre un canvas infinito. Se distribuye como un único binario auto-contenido — sin Node, sin Docker, sin servicio externo.

Un comando: `./diagramer`. Abre `localhost:7777` en el navegador. Editas. Cierras.

## Para quién

Para mí (Miguel) y, por extensión, cualquier desarrollador que quiera bocetar arquitectura, dependencias entre módulos o flujos de datos sin pelearse con Excalidraw, Figma, Mermaid, ni servicios SaaS.

## Problema que resuelve

- Los diagramas en Mermaid/PlantUML son texto-only y poco fluidos para iterar.
- Excalidraw es genérico y no estructura datos.
- Figma/Lucid son SaaS, pesados y exigen cuenta.
- Whiteboards locales no persisten en formato consultable.

`diagramer` apunta al hueco: estructura grafo (nodos + aristas), persistencia en JSON inspectable, sin nube, sin login, sin build pipeline al usar.

## Objetivo

Que en menos de 5 segundos desde lanzar el binario el usuario esté creando nodos y conectándolos con flechas, y que el diagrama persista automáticamente sin que tenga que pulsar nada.

### Criterios de éxito v1

- Arranque del binario en <100 ms en hardware moderno.
- Crear nodo, conectarlo, mover, renombrar, borrar — sin tocar el botón "guardar".
- Listado y cambio entre múltiples diagramas.
- JSON resultante legible y diff-able en git.
- Tamaño del binario <30 MB.

## Alcance

### En v1 (este PRD)

- Multi-diagrama. Un archivo JSON por diagrama. Lista, crear, abrir, renombrar, borrar.
- Canvas infinito (pan/zoom).
- Un único tipo de nodo: caja con texto editable inline.
- Aristas dirigidas con cabeza de flecha. Estilo bezier por defecto.
- Autosave debounced (~500 ms).
- Distribución: binario único Go con frontend React/React Flow embebido.

### Fuera de v1 (extensiones reconocidas)

- Tipos de nodo predefinidos o custom (color, icono, forma).
- Etiquetas en aristas.
- Multiselect, copy-paste, undo/redo.
- Import code-aware: parsear un repo y generar nodos a partir del AST. Reservado v2+.
- Export a PNG/SVG/Mermaid.
- Multi-usuario, sync, login, nube. **No es objetivo nunca.**

## Restricciones

- **KISS.** Cada decisión se justifica por simplicidad antes que por flexibilidad anticipada.
- **Single binary.** Cero dependencias externas en runtime. Frontend buildeado y embebido vía `go:embed`.
- **Local-first.** Datos en disco del usuario, en JSON. Cero red más allá de `localhost`.
- **Modularidad.** Un archivo/paquete por módulo en Go. Cada módulo expone una interfaz pequeña, fácil de mockear y de extender.
- **No telemetría, no login, no analytics.**

## Stack

| Capa | Elección |
|---|---|
| Frontend | React + React Flow (xyflow) |
| Bundler | Vite |
| Backend | Go (stdlib `net/http` + `embed`) |
| Storage | Archivos JSON en `./data/diagrams/<id>.json` |
| Distribución | `go build` produce binario único |

## Out of scope explícito

- Cualquier feature que requiera servidor remoto.
- Cualquier feature que requiera base de datos.
- Cualquier feature que rompa el "un comando, un binario, un proceso".
