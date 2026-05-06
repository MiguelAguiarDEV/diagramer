// Wire types — must match Go internal/diagrams.
// Shape is React-Flow compatible by design.

export interface Position {
  x: number
  y: number
}

export interface NodeData {
  label: string
}

export interface DiagramNode {
  id: string
  position: Position
  data: NodeData
}

export interface DiagramEdge {
  id: string
  source: string
  target: string
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface Diagram {
  id: string
  name: string
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  viewport: Viewport
  createdAt: string
  updatedAt: string
}

export interface DiagramMeta {
  id: string
  name: string
  updatedAt: string
  nodeCount: number
  edgeCount: number
}
