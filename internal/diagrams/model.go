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
	// Optional per-node colors. Empty → fall back to the CSS defaults.
	Fill   string `json:"fill,omitempty"`
	Stroke string `json:"stroke,omitempty"`
	// SubdiagramID, when set, makes this node a container: it references
	// another Diagram (by ID) whose contents are the node's "inside". The
	// referenced diagram is a normal diagram, editable and reusable on its own.
	SubdiagramID string `json:"subdiagramId,omitempty"`
	// Port marks a node as part of its diagram's interface, the way a function
	// signature is defined by its params/return. When this diagram is used as a
	// subdiagram, each interface node surfaces as a port on the container:
	//   "in"  → entry,      drawn on the container's left
	//   "out" → return,     drawn on the right
	//   "dep" → dependency, drawn on the top (a DB/API the inside relies on)
	Port string `json:"port,omitempty"`
}

type Edge struct {
	ID        string     `json:"id"`
	Source    string     `json:"source"`
	Target    string     `json:"target"`
	Label     string     `json:"label,omitempty"`
	Curvature *Curvature `json:"curvature,omitempty"`
}

// Curvature is an offset (in model coords) from the straight midpoint
// between the two edge anchors. When set the edge is drawn as a quadratic
// bezier passing through midpoint + (Ox, Oy) at t=0.5.
type Curvature struct {
	Ox float64 `json:"ox"`
	Oy float64 `json:"oy"`
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
