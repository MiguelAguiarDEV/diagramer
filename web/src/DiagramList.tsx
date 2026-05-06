import { useEffect, useState } from 'react'
import { api } from './api'
import type { DiagramMeta } from './types'

interface Props {
  onOpen: (id: string) => void
}

export function DiagramList({ onOpen }: Props) {
  const [items, setItems] = useState<DiagramMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const load = async () => {
    try {
      setItems(await api.list())
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    load()
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const d = await api.create(name)
      setNewName('')
      onOpen(d.id)
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    try {
      await api.delete(id)
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  const rename = async (id: string, current: string) => {
    const next = prompt('New name:', current)
    if (next == null) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === current) return
    try {
      await api.rename(id, trimmed)
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="list-page">
      <header className="list-header">
        <h1>diagramer</h1>
        <form onSubmit={create} className="new-form">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New diagram name…"
            disabled={creating}
            autoFocus
          />
          <button type="submit" disabled={creating || !newName.trim()}>
            Create
          </button>
        </form>
      </header>

      {error && <div className="error">{error}</div>}

      {items === null ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">No diagrams yet. Create one above.</p>
      ) : (
        <ul className="diagram-list">
          {items.map((d) => (
            <li key={d.id}>
              <button className="open" onClick={() => onOpen(d.id)} title={d.id}>
                <span className="name">{d.name}</span>
                <span className="meta">
                  {d.nodeCount} nodes · {d.edgeCount} edges ·{' '}
                  {new Date(d.updatedAt).toLocaleString()}
                </span>
              </button>
              <div className="actions">
                <button onClick={() => rename(d.id, d.name)}>Rename</button>
                <button className="danger" onClick={() => remove(d.id, d.name)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
