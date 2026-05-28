package diagrams

import "testing"

func node(id, label string) Node {
	return Node{ID: id, Data: NodeData{Label: label}}
}

func nodeByID(d *Diagram, id string) *Node {
	for i := range d.Nodes {
		if d.Nodes[i].ID == id {
			return &d.Nodes[i]
		}
	}
	return nil
}

func overlaps(a, b *Node) bool {
	aw, ah := estimateNodeSize(*a)
	bw, bh := estimateNodeSize(*b)
	return a.Position.X < b.Position.X+bw &&
		a.Position.X+aw > b.Position.X &&
		a.Position.Y < b.Position.Y+bh &&
		a.Position.Y+ah > b.Position.Y
}

func assertNoOverlap(t *testing.T, d *Diagram) {
	t.Helper()
	for i := 0; i < len(d.Nodes); i++ {
		for j := i + 1; j < len(d.Nodes); j++ {
			if overlaps(&d.Nodes[i], &d.Nodes[j]) {
				t.Errorf("nodes %q and %q overlap: %+v vs %+v",
					d.Nodes[i].ID, d.Nodes[j].ID, d.Nodes[i].Position, d.Nodes[j].Position)
			}
		}
	}
}

func TestAutoLayoutColumnsByDepth(t *testing.T) {
	d := &Diagram{
		Nodes: []Node{node("a", "A"), node("b", "B"), node("c", "C")},
		Edges: []Edge{{ID: "1", Source: "a", Target: "b"}, {ID: "2", Source: "b", Target: "c"}},
	}
	// Scatter so layout has to actually move them.
	d.Nodes[2].Position = Position{X: -900, Y: 700}
	AutoLayout(d)

	a, b, c := nodeByID(d, "a"), nodeByID(d, "b"), nodeByID(d, "c")
	if !(a.Position.X < b.Position.X && b.Position.X < c.Position.X) {
		t.Errorf("columns not ordered by depth: a=%v b=%v c=%v", a.Position.X, b.Position.X, c.Position.X)
	}
	assertNoOverlap(t, d)
}

func TestAutoLayoutParksOrphansBelow(t *testing.T) {
	d := &Diagram{
		Nodes: []Node{node("a", "A"), node("b", "B"), node("lonely", "Lonely")},
		Edges: []Edge{{ID: "1", Source: "a", Target: "b"}},
	}
	AutoLayout(d)

	a, b, lonely := nodeByID(d, "a"), nodeByID(d, "b"), nodeByID(d, "lonely")
	_, ah := estimateNodeSize(*a)
	_, bh := estimateNodeSize(*b)
	connectedBottom := a.Position.Y + ah
	if b.Position.Y+bh > connectedBottom {
		connectedBottom = b.Position.Y + bh
	}
	if lonely.Position.Y < connectedBottom {
		t.Errorf("orphan not parked below connected nodes: orphanY=%v, connectedBottom=%v",
			lonely.Position.Y, connectedBottom)
	}
	assertNoOverlap(t, d)
}

// TestAutoLayoutReducesCrossings builds the canonical crossing case (a→y, b→x
// with initial order x,y) and asserts the median sweep flips column 1 so the
// edges no longer cross.
func TestAutoLayoutReducesCrossings(t *testing.T) {
	d := &Diagram{
		Nodes: []Node{node("a", "A"), node("b", "B"), node("x", "X"), node("y", "Y")},
		Edges: []Edge{
			{ID: "1", Source: "a", Target: "y"},
			{ID: "2", Source: "b", Target: "x"},
		},
	}
	AutoLayout(d)

	a, b := nodeByID(d, "a"), nodeByID(d, "b")
	x, y := nodeByID(d, "x"), nodeByID(d, "y")
	// a is above b in column 0; to avoid a crossing, y (a's target) must end up
	// above x (b's target) in column 1.
	if !(a.Position.Y < b.Position.Y) {
		t.Fatalf("expected a above b: a=%v b=%v", a.Position.Y, b.Position.Y)
	}
	if !(y.Position.Y < x.Position.Y) {
		t.Errorf("crossing not reduced: expected y above x, got y=%v x=%v", y.Position.Y, x.Position.Y)
	}
	assertNoOverlap(t, d)
}

func TestAutoLayoutLabelWidensGap(t *testing.T) {
	long := &Diagram{
		Nodes: []Node{node("a", "A"), node("b", "B")},
		Edges: []Edge{{ID: "1", Source: "a", Target: "b", Label: "a very long edge label that needs room"}},
	}
	short := &Diagram{
		Nodes: []Node{node("a", "A"), node("b", "B")},
		Edges: []Edge{{ID: "1", Source: "a", Target: "b", Label: "x"}},
	}
	AutoLayout(long)
	AutoLayout(short)

	gapLong := nodeByID(long, "b").Position.X - nodeByID(long, "a").Position.X
	gapShort := nodeByID(short, "b").Position.X - nodeByID(short, "a").Position.X
	if gapLong <= gapShort {
		t.Errorf("long label did not widen the column gap: long=%v short=%v", gapLong, gapShort)
	}
}
