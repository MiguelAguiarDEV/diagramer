import { useEffect, useState } from 'react'
import { DiagramList } from './DiagramList'
import { DiagramCanvas } from './DiagramCanvas'

type Route =
  | { kind: 'list' }
  | { kind: 'canvas'; id: string }

function parseHash(): Route {
  const h = window.location.hash.replace(/^#/, '')
  if (h.startsWith('/d/')) {
    const id = h.slice(3)
    if (id) return { kind: 'canvas', id }
  }
  return { kind: 'list' }
}

function App() {
  const [route, setRoute] = useState<Route>(() => parseHash())

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const goCanvas = (id: string) => {
    window.location.hash = `/d/${id}`
  }
  const goList = () => {
    window.location.hash = ''
  }

  if (route.kind === 'canvas') {
    return <DiagramCanvas id={route.id} onBack={goList} />
  }
  return <DiagramList onOpen={goCanvas} />
}

export default App
