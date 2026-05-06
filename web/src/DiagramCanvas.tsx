import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type Viewport as RFViewport,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { api } from './api'

interface Props {
  id: string
  onBack: () => void
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 500

function nid() {
  return 'n_' + Math.random().toString(36).slice(2, 10)
}
function eid() {
  return 'e_' + Math.random().toString(36).slice(2, 10)
}

export function DiagramCanvas({ id, onBack }: Props) {
  const [name, setName] = useState('')
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [viewport, setViewport] = useState<RFViewport>({ x: 0, y: 0, zoom: 1 })
  const [loaded, setLoaded] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  const saveTimer = useRef<number | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Load
  useEffect(() => {
    let cancelled = false
    api
      .get(id)
      .then((d) => {
        if (cancelled) return
        setName(d.name)
        setNodes(
          d.nodes.map((n) => ({
            id: n.id,
            position: n.position,
            data: { label: n.data.label },
            type: 'default',
          })),
        )
        setEdges(
          d.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            markerEnd: { type: MarkerType.ArrowClosed },
          })),
        )
        setViewport(d.viewport ?? { x: 0, y: 0, zoom: 1 })
        setLoaded(true)
      })
      .catch((e) => setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [id])

  const persist = useCallback(async () => {
    setSaveState('saving')
    const payload = {
      id,
      name,
      nodes: nodes.map((n) => ({
        id: n.id,
        position: n.position,
        data: { label: typeof n.data?.label === 'string' ? n.data.label : '' },
      })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      viewport,
    }
    try {
      const promise = api.update(payload).then(() => {})
      inFlight.current = promise
      await promise
      setSaveState('saved')
    } catch (e) {
      setError(String(e))
      setSaveState('error')
    } finally {
      inFlight.current = null
    }
  }, [id, name, nodes, edges, viewport])

  const scheduleSave = useCallback(() => {
    setSaveState('dirty')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void persist()
    }, DEBOUNCE_MS)
  }, [persist])

  // After initial load, any state change schedules a save.
  useEffect(() => {
    if (!loaded) return
    scheduleSave()
  }, [loaded, nodes, edges, viewport, name, scheduleSave])

  // Flush on unload (tab close, navigation away).
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = null
        void persist()
      }
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      flush()
      window.removeEventListener('beforeunload', flush)
    }
  }, [persist])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  )
  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...c,
            id: eid(),
            markerEnd: { type: MarkerType.ArrowClosed },
          },
          eds,
        ),
      ),
    [],
  )

  // Add a node at a flow-coordinates position.
  const addNodeAt = useCallback((flowX: number, flowY: number, label = 'New') => {
    setNodes((nds) =>
      nds.concat({
        id: nid(),
        position: { x: flowX, y: flowY },
        data: { label },
        type: 'default',
      }),
    )
  }, [])

  // Click on the "+ Node" button → drop near the visible center of the canvas.
  const addNodeAtCenter = useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) {
      addNodeAt(0, 0)
      return
    }
    const bounds = wrapper.getBoundingClientRect()
    const cx = bounds.width / 2
    const cy = bounds.height / 2
    // Convert screen → flow coords using the current viewport.
    const x = (cx - viewport.x) / viewport.zoom
    const y = (cy - viewport.y) / viewport.zoom
    // Slight random offset so consecutive clicks don't pile up exactly.
    const jitter = () => (Math.random() - 0.5) * 30
    addNodeAt(x + jitter(), y + jitter())
  }, [viewport, addNodeAt])

  // Double-click on the pane → drop a node at the click point. Use native
  // dblclick on the wrapper because React Flow swallows synthetic events
  // inside the canvas in some setups.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || !loaded) return
    const onDbl = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      // Only fire on the empty pane, not on nodes/edges/handles/controls.
      if (!target) return
      if (
        target.closest('.react-flow__node') ||
        target.closest('.react-flow__edge') ||
        target.closest('.react-flow__handle') ||
        target.closest('.react-flow__controls') ||
        target.closest('.react-flow__minimap') ||
        target.closest('.canvas-header')
      ) {
        return
      }
      const bounds = wrapper.getBoundingClientRect()
      const mx = event.clientX - bounds.left
      const my = event.clientY - bounds.top
      const x = (mx - viewport.x) / viewport.zoom
      const y = (my - viewport.y) / viewport.zoom
      addNodeAt(x, y)
    }
    wrapper.addEventListener('dblclick', onDbl)
    return () => wrapper.removeEventListener('dblclick', onDbl)
  }, [loaded, viewport, addNodeAt])

  // Inline-rename a node label on double-click.
  const onNodeDoubleClick = useCallback((_e: React.MouseEvent, node: Node) => {
    const next = prompt(
      'Label:',
      typeof node.data?.label === 'string' ? node.data.label : '',
    )
    if (next == null) return
    setNodes((nds) =>
      nds.map((n) =>
        n.id === node.id ? { ...n, data: { ...n.data, label: next } } : n,
      ),
    )
  }, [])

  if (error) {
    return (
      <div className="canvas-page error-page">
        <button onClick={onBack}>← Back</button>
        <div className="error">{error}</div>
      </div>
    )
  }
  if (!loaded) {
    return (
      <div className="canvas-page">
        <p className="muted" style={{ padding: 20 }}>
          Loading…
        </p>
      </div>
    )
  }

  return (
    <div className="canvas-page" ref={wrapperRef}>
      <header className="canvas-header">
        <button className="back" onClick={onBack} title="Back to list">
          ←
        </button>
        <input
          className="diagram-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="add-node" onClick={addNodeAtCenter} title="Add a new node">
          + Node
        </button>
        <SaveIndicator state={saveState} />
        <span className="hint" title="Tips">
          dblclick canvas → node · dblclick node → rename · drag handle → connect · Del → remove
        </span>
      </header>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        viewport={viewport}
        onViewportChange={setViewport}
        onPaneClick={() => {}}
        onPaneContextMenu={(e) => e.preventDefault()}
        onNodeDoubleClick={onNodeDoubleClick}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Delete', 'Backspace']}
        fitView={false}
      >
        <Background gap={16} />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, { label: string; cls: string }> = {
    idle: { label: '·', cls: 'idle' },
    dirty: { label: 'unsaved', cls: 'dirty' },
    saving: { label: 'saving…', cls: 'saving' },
    saved: { label: 'saved', cls: 'saved' },
    error: { label: 'error', cls: 'error' },
  }
  const { label, cls } = map[state]
  return <span className={`save-indicator ${cls}`}>{label}</span>
}
