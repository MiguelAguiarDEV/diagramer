package diagrams

import "time"

// Diagram is the unit of persistence. One file per Diagram.
// Shape is compatible 1:1 with React Flow's {nodes, edges, viewport}.
type Diagram struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Nodes     []Node    `json:"nodes"`
	Edges     []Edge    `json:"edges"`
	Viewport  Viewport  `json:"viewport"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Node struct {
	ID       string   `json:"id"`
	Kind     string   `json:"kind,omitempty"`
	Position Position `json:"position"`
	Data     NodeData `json:"data"`
}

type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type NodeData struct {
	Label string `json:"label"`
}

type Edge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
	Label  string `json:"label,omitempty"`
}

type Viewport struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Zoom float64 `json:"zoom"`
}

// DiagramMeta is the lightweight row used in list views.
// Does not carry nodes/edges to keep listings cheap.
type DiagramMeta struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	UpdatedAt time.Time `json:"updatedAt"`
	NodeCount int       `json:"nodeCount"`
	EdgeCount int       `json:"edgeCount"`
}

func NewDiagramMeta(d *Diagram) DiagramMeta {
	return DiagramMeta{
		ID:        d.ID,
		Name:      d.Name,
		UpdatedAt: d.UpdatedAt,
		NodeCount: len(d.Nodes),
		EdgeCount: len(d.Edges),
	}
}
