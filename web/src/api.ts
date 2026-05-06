import type { Diagram, DiagramEdge, DiagramMeta, DiagramNode, Viewport } from './types'

export interface UpdatePayload {
  id: string
  name: string
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  viewport: Viewport
}

const BASE = '/api'

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  list: () => jsonRequest<DiagramMeta[]>('/diagrams'),
  create: (name: string) =>
    jsonRequest<Diagram>('/diagrams', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  get: (id: string) => jsonRequest<Diagram>(`/diagrams/${id}`),
  update: (d: UpdatePayload) =>
    jsonRequest<Diagram>(`/diagrams/${d.id}`, {
      method: 'PUT',
      body: JSON.stringify(d),
    }),
  rename: (id: string, name: string) =>
    jsonRequest<DiagramMeta>(`/diagrams/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  delete: (id: string) =>
    jsonRequest<void>(`/diagrams/${id}`, { method: 'DELETE' }),
}
