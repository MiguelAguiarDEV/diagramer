package diagrams

import (
	"fmt"
	"math"
	"testing"
)

// assertFinite fails if any node landed on a NaN/Inf coordinate.
func assertFinite(t *testing.T, d *Diagram) {
	t.Helper()
	for i := range d.Nodes {
		p := d.Nodes[i].Position
		if math.IsNaN(p.X) || math.IsInf(p.X, 0) || math.IsNaN(p.Y) || math.IsInf(p.Y, 0) {
			t.Fatalf("node %q has non-finite position %+v", d.Nodes[i].ID, p)
		}
	}
}

func TestAutoLayoutEdgeCases(t *testing.T) {
	cases := []struct {
		name  string
		nodes []Node
		edges []Edge
	}{
		{"empty", nil, nil},
		{"single", []Node{node("a", "A")}, nil},
		{
			"self-loop",
			[]Node{node("a", "A")},
			[]Edge{{ID: "1", Source: "a", Target: "a"}},
		},
		{
			"pure-cycle",
			[]Node{node("a", "A"), node("b", "B"), node("c", "C")},
			[]Edge{
				{ID: "1", Source: "a", Target: "b"},
				{ID: "2", Source: "b", Target: "c"},
				{ID: "3", Source: "c", Target: "a"},
			},
		},
		{
			"all-orphans",
			[]Node{node("a", "A"), node("b", "B"), node("c", "C")},
			nil,
		},
		{
			"duplicate-edges",
			[]Node{node("a", "A"), node("b", "B")},
			[]Edge{
				{ID: "1", Source: "a", Target: "b"},
				{ID: "2", Source: "a", Target: "b"},
				{ID: "3", Source: "a", Target: "b"},
			},
		},
		{
			"dangling-mixed-in",
			[]Node{node("a", "A"), node("b", "B")},
			[]Edge{
				{ID: "1", Source: "a", Target: "b"},
				{ID: "2", Source: "a", Target: "ghost"},
				{ID: "3", Source: "ghost", Target: "b"},
			},
		},
		{
			"empty-labels-and-container",
			[]Node{
				{ID: "a", Data: NodeData{Label: ""}},
				{ID: "b", Kind: "database", Data: NodeData{Label: ""}},
				{ID: "c", Data: NodeData{Label: "x", SubdiagramID: "sub"}},
			},
			[]Edge{{ID: "1", Source: "a", Target: "b"}, {ID: "2", Source: "b", Target: "c"}},
		},
		{
			"diamond",
			[]Node{node("a", "A"), node("b", "B"), node("c", "C"), node("d", "D")},
			[]Edge{
				{ID: "1", Source: "a", Target: "b"},
				{ID: "2", Source: "a", Target: "c"},
				{ID: "3", Source: "b", Target: "d"},
				{ID: "4", Source: "c", Target: "d"},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := &Diagram{Nodes: tc.nodes, Edges: tc.edges}
			// Must not panic.
			AutoLayout(d)
			assertFinite(t, d)
			assertNoOverlap(t, d)

			// Idempotent: a second pass changes nothing.
			before := make([]Position, len(d.Nodes))
			for i := range d.Nodes {
				before[i] = d.Nodes[i].Position
			}
			AutoLayout(d)
			for i := range d.Nodes {
				if d.Nodes[i].Position != before[i] {
					t.Errorf("not idempotent: node %q moved %v → %v",
						d.Nodes[i].ID, before[i], d.Nodes[i].Position)
				}
			}
		})
	}
}

// TestAutoLayoutLargeGraph throws a wide, deep, branchy graph at the layout to
// shake out pathological slowdowns or overlaps.
func TestAutoLayoutLargeGraph(t *testing.T) {
	const n = 600
	d := &Diagram{}
	for i := 0; i < n; i++ {
		d.Nodes = append(d.Nodes, node(fmt.Sprintf("n%d", i), fmt.Sprintf("node %d", i)))
	}
	// Chain + cross-links a few columns ahead to create fan-out and crossings.
	for i := 0; i < n-1; i++ {
		d.Edges = append(d.Edges, Edge{ID: fmt.Sprintf("e%d", i), Source: fmt.Sprintf("n%d", i), Target: fmt.Sprintf("n%d", i+1)})
		if i+7 < n {
			d.Edges = append(d.Edges, Edge{ID: fmt.Sprintf("x%d", i), Source: fmt.Sprintf("n%d", i), Target: fmt.Sprintf("n%d", i+7)})
		}
	}
	AutoLayout(d)
	assertFinite(t, d)
	assertNoOverlap(t, d)
}

func TestPruneDanglingEdgeShapes(t *testing.T) {
	d := &Diagram{
		Nodes: []Node{{ID: "a"}, {ID: "b"}},
		Edges: []Edge{
			{ID: "ok", Source: "a", Target: "b"},
			{ID: "src-missing", Source: "ghost", Target: "b"},
			{ID: "tgt-missing", Source: "a", Target: "ghost"},
			{ID: "both-missing", Source: "x", Target: "y"},
			{ID: "self-missing", Source: "z", Target: "z"},
		},
	}
	pruneDanglingEdges(d)
	if len(d.Edges) != 1 || d.Edges[0].ID != "ok" {
		t.Fatalf("expected only the valid edge, got %+v", d.Edges)
	}

	// No dangling → slice untouched (same backing array, no needless alloc).
	clean := &Diagram{Nodes: []Node{{ID: "a"}}, Edges: []Edge{{ID: "ok", Source: "a", Target: "a"}}}
	orig := clean.Edges
	pruneDanglingEdges(clean)
	if &orig[0] != &clean.Edges[0] {
		t.Error("prune reallocated a clean edge slice")
	}
}
