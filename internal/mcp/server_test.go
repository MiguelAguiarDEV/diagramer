package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"testing"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/MiguelAguiarDEV/diagramer/internal/diagrams"
	"github.com/MiguelAguiarDEV/diagramer/internal/storage"
)

// newTestSession wires a real SDK client to our server over the in-memory
// transport, so the test exercises the actual JSON-RPC tool plumbing (schema
// marshalling, structured output) rather than calling handlers directly.
func newTestSession(t *testing.T) *mcpsdk.ClientSession {
	t.Helper()
	repo, err := storage.NewJSONFileRepo(t.TempDir())
	if err != nil {
		t.Fatalf("repo: %v", err)
	}
	s := New(diagrams.NewService(repo), slog.New(slog.NewTextHandler(io.Discard, nil)))

	ctx := context.Background()
	clientT, serverT := mcpsdk.NewInMemoryTransports()
	serverSession, err := s.srv.Connect(ctx, serverT, nil)
	if err != nil {
		t.Fatalf("server connect: %v", err)
	}
	t.Cleanup(func() { _ = serverSession.Close() })

	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "test", Version: "1"}, nil)
	cs, err := client.Connect(ctx, clientT, nil)
	if err != nil {
		t.Fatalf("client connect: %v", err)
	}
	t.Cleanup(func() { _ = cs.Close() })
	return cs
}

func contentText(res *mcpsdk.CallToolResult) string {
	return fmt.Sprintf("%v", res.Content)
}

// callTool invokes a tool, fails the test on transport or tool error, and
// decodes the structured output into T.
func callTool[T any](t *testing.T, cs *mcpsdk.ClientSession, name string, args map[string]any) T {
	t.Helper()
	res, err := cs.CallTool(context.Background(), &mcpsdk.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("CallTool %s: %v", name, err)
	}
	if res.IsError {
		t.Fatalf("tool %s returned error: %s", name, contentText(res))
	}
	var out T
	b, err := json.Marshal(res.StructuredContent)
	if err != nil {
		t.Fatalf("marshal structured content of %s: %v", name, err)
	}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("decode %s output into %T: %v", name, out, err)
	}
	return out
}

func TestToolsAreRegistered(t *testing.T) {
	cs := newTestSession(t)
	res, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	got := map[string]bool{}
	for _, tool := range res.Tools {
		got[tool.Name] = true
	}
	want := []string{
		"list_diagrams", "get_diagram", "create_diagram", "rename_diagram",
		"delete_diagram", "add_node", "update_node", "delete_node",
		"add_edge", "update_edge", "delete_edge", "create_subdiagram",
		"auto_layout", "set_edge_style", "add_graph",
	}
	for _, w := range want {
		if !got[w] {
			t.Errorf("tool %q not registered", w)
		}
	}
	if len(res.Tools) != len(want) {
		t.Errorf("got %d tools, want %d", len(res.Tools), len(want))
	}
}

// TestCRUDLifecycle walks a full editing session: create a diagram, populate
// it with nodes and an edge, mutate them, read everything back, then delete.
func TestCRUDLifecycle(t *testing.T) {
	cs := newTestSession(t)
	ctx := context.Background()

	// Create.
	created := callTool[diagramOutput](t, cs, "create_diagram", map[string]any{"name": "Architecture"})
	if created.Diagram == nil || created.Diagram.ID == "" {
		t.Fatal("create_diagram returned no diagram/ID")
	}
	id := created.Diagram.ID
	if created.Diagram.Name != "Architecture" {
		t.Errorf("name = %q, want Architecture", created.Diagram.Name)
	}

	// It shows up in the listing.
	list := callTool[listOutput](t, cs, "list_diagrams", nil)
	if len(list.Diagrams) != 1 || list.Diagrams[0].ID != id {
		t.Fatalf("list_diagrams = %+v, want one entry with id %s", list.Diagrams, id)
	}

	// Add two nodes; the second one carries custom colors.
	n1 := callTool[idOutput](t, cs, "add_node", map[string]any{
		"diagram_id": id, "kind": "frontend", "label": "Web", "x": 0.0, "y": 0.0,
	})
	n2 := callTool[idOutput](t, cs, "add_node", map[string]any{
		"diagram_id": id, "kind": "database", "label": "DB", "x": 300.0, "y": 0.0,
		"fill": "#14432a", "stroke": "#22c55e",
	})
	if n1.ID == "" || n2.ID == "" || n1.ID == n2.ID {
		t.Fatalf("bad node IDs: %q %q", n1.ID, n2.ID)
	}

	// Connect them.
	e1 := callTool[idOutput](t, cs, "add_edge", map[string]any{
		"diagram_id": id, "source": n1.ID, "target": n2.ID, "label": "queries",
	})
	if e1.ID == "" {
		t.Fatal("add_edge returned no ID")
	}

	// Mutate a node (move + relabel) and the edge (relabel).
	callTool[okOutput](t, cs, "update_node", map[string]any{
		"diagram_id": id, "node_id": n2.ID, "label": "Postgres", "x": 320.0, "y": 40.0,
	})
	callTool[okOutput](t, cs, "update_edge", map[string]any{
		"diagram_id": id, "edge_id": e1.ID, "label": "reads/writes",
	})

	// Read back and verify the whole state.
	got := callTool[diagramOutput](t, cs, "get_diagram", map[string]any{"id": id})
	d := got.Diagram
	if d == nil {
		t.Fatal("get_diagram returned nil")
	}
	if len(d.Nodes) != 2 || len(d.Edges) != 1 {
		t.Fatalf("got %d nodes / %d edges, want 2 / 1", len(d.Nodes), len(d.Edges))
	}
	var dbNode *diagrams.Node
	for i := range d.Nodes {
		if d.Nodes[i].ID == n2.ID {
			dbNode = &d.Nodes[i]
		}
	}
	if dbNode == nil {
		t.Fatal("updated node missing")
	}
	if dbNode.Data.Label != "Postgres" || dbNode.Position.X != 320 || dbNode.Position.Y != 40 {
		t.Errorf("node not updated: %+v", dbNode)
	}
	if dbNode.Data.Fill != "#14432a" || dbNode.Data.Stroke != "#22c55e" {
		t.Errorf("node colors not persisted: fill=%q stroke=%q", dbNode.Data.Fill, dbNode.Data.Stroke)
	}
	if d.Edges[0].Label != "reads/writes" {
		t.Errorf("edge label = %q, want reads/writes", d.Edges[0].Label)
	}

	// Deleting a node also drops edges that reference it.
	callTool[okOutput](t, cs, "delete_node", map[string]any{"diagram_id": id, "node_id": n1.ID})
	got = callTool[diagramOutput](t, cs, "get_diagram", map[string]any{"id": id})
	if len(got.Diagram.Nodes) != 1 || len(got.Diagram.Edges) != 0 {
		t.Fatalf("after delete_node: %d nodes / %d edges, want 1 / 0",
			len(got.Diagram.Nodes), len(got.Diagram.Edges))
	}

	// Rename, then delete the diagram.
	renamed := callTool[diagramOutput](t, cs, "rename_diagram", map[string]any{"id": id, "name": "Backend"})
	if renamed.Diagram.Name != "Backend" {
		t.Errorf("rename: name = %q, want Backend", renamed.Diagram.Name)
	}
	del := callTool[okOutput](t, cs, "delete_diagram", map[string]any{"id": id})
	if !del.OK {
		t.Error("delete_diagram ok = false")
	}
	list = callTool[listOutput](t, cs, "list_diagrams", nil)
	if len(list.Diagrams) != 0 {
		t.Errorf("after delete: %d diagrams, want 0", len(list.Diagrams))
	}

	_ = ctx
}

func TestDeleteEdgeKeepsNodes(t *testing.T) {
	cs := newTestSession(t)
	id := callTool[diagramOutput](t, cs, "create_diagram", map[string]any{"name": "E"}).Diagram.ID
	a := callTool[idOutput](t, cs, "add_node", map[string]any{"diagram_id": id, "label": "A", "x": 0.0, "y": 0.0}).ID
	b := callTool[idOutput](t, cs, "add_node", map[string]any{"diagram_id": id, "label": "B", "x": 200.0, "y": 0.0}).ID
	e := callTool[idOutput](t, cs, "add_edge", map[string]any{"diagram_id": id, "source": a, "target": b}).ID

	callTool[okOutput](t, cs, "delete_edge", map[string]any{"diagram_id": id, "edge_id": e})

	got := callTool[diagramOutput](t, cs, "get_diagram", map[string]any{"id": id})
	if len(got.Diagram.Nodes) != 2 || len(got.Diagram.Edges) != 0 {
		t.Fatalf("after delete_edge: %d nodes / %d edges, want 2 / 0",
			len(got.Diagram.Nodes), len(got.Diagram.Edges))
	}
}

// TestAutoLayoutAndAutoPlace covers the AI ergonomics: add_node without x/y
// auto-places beside existing content, and auto_layout arranges a dependency
// chain into left-to-right columns.
func TestAutoLayoutAndAutoPlace(t *testing.T) {
	cs := newTestSession(t)
	id := callTool[diagramOutput](t, cs, "create_diagram", map[string]any{"name": "Flow"}).Diagram.ID

	// First node, no coords → origin. Second node, no coords → to its right.
	a := callTool[idOutput](t, cs, "add_node", map[string]any{"diagram_id": id, "label": "A"}).ID
	b := callTool[idOutput](t, cs, "add_node", map[string]any{"diagram_id": id, "label": "B"}).ID

	pos := func() map[string]diagrams.Position {
		g := callTool[diagramOutput](t, cs, "get_diagram", map[string]any{"id": id})
		m := map[string]diagrams.Position{}
		for _, n := range g.Diagram.Nodes {
			m[n.ID] = n.Position
		}
		return m
	}
	p := pos()
	if p[a].X != 0 || p[a].Y != 0 {
		t.Errorf("first auto-placed node = %+v, want origin", p[a])
	}
	if p[b].X <= p[a].X {
		t.Errorf("second auto-placed node x=%v, want right of first x=%v", p[b].X, p[a].X)
	}

	// A third node with explicit coords placed far away, then a chain A→B→C.
	c := callTool[idOutput](t, cs, "add_node", map[string]any{
		"diagram_id": id, "label": "C", "x": -900.0, "y": 700.0,
	}).ID
	callTool[idOutput](t, cs, "add_edge", map[string]any{"diagram_id": id, "source": a, "target": b})
	callTool[idOutput](t, cs, "add_edge", map[string]any{"diagram_id": id, "source": b, "target": c})

	// Tidy: columns must increase left-to-right with dependency depth.
	out := callTool[diagramOutput](t, cs, "auto_layout", map[string]any{"id": id})
	if out.Diagram == nil {
		t.Fatal("auto_layout returned nil diagram")
	}
	p = pos()
	if !(p[a].X < p[b].X && p[b].X < p[c].X) {
		t.Errorf("auto_layout columns not ordered: A=%v B=%v C=%v", p[a].X, p[b].X, p[c].X)
	}
}

// TestSubdiagramComposition mirrors how an AI builds nested architecture:
// create a container node, give it a subdiagram, then populate that subdiagram
// using its own ID.
func TestSubdiagramComposition(t *testing.T) {
	cs := newTestSession(t)

	parent := callTool[diagramOutput](t, cs, "create_diagram", map[string]any{"name": "System"}).Diagram.ID
	box := callTool[idOutput](t, cs, "add_node", map[string]any{
		"diagram_id": parent, "kind": "rect", "label": "Payments", "x": 0.0, "y": 0.0,
	}).ID

	// Link a fresh subdiagram to the node.
	subID := callTool[idOutput](t, cs, "create_subdiagram", map[string]any{
		"diagram_id": parent, "node_id": box, "name": "Payments internals",
	}).ID
	if subID == "" || subID == parent {
		t.Fatalf("bad subdiagram id: %q (parent %q)", subID, parent)
	}

	// The parent node now references it.
	pg := callTool[diagramOutput](t, cs, "get_diagram", map[string]any{"id": parent})
	if pg.Diagram.Nodes[0].Data.SubdiagramID != subID {
		t.Fatalf("node not linked: got %q, want %q", pg.Diagram.Nodes[0].Data.SubdiagramID, subID)
	}

	// Populate the subdiagram via its own ID, tagging interface roles so the
	// container can surface ports (in = entry, out = return).
	g := callTool[idOutput](t, cs, "add_node", map[string]any{"diagram_id": subID, "label": "Gateway", "x": 0.0, "y": 0.0, "port": "in"}).ID
	l := callTool[idOutput](t, cs, "add_node", map[string]any{"diagram_id": subID, "label": "Ledger", "x": 200.0, "y": 0.0, "port": "out"}).ID
	callTool[idOutput](t, cs, "add_edge", map[string]any{"diagram_id": subID, "source": g, "target": l})

	sg := callTool[diagramOutput](t, cs, "get_diagram", map[string]any{"id": subID})
	if len(sg.Diagram.Nodes) != 2 || len(sg.Diagram.Edges) != 1 {
		t.Fatalf("subdiagram contents: %d nodes / %d edges, want 2 / 1",
			len(sg.Diagram.Nodes), len(sg.Diagram.Edges))
	}
	ports := map[string]string{}
	for _, n := range sg.Diagram.Nodes {
		ports[n.Data.Label] = n.Data.Port
	}
	if ports["Gateway"] != "in" || ports["Ledger"] != "out" {
		t.Errorf("interface roles not persisted: %v", ports)
	}

	// Unlink via update_node (empty string clears the reference).
	callTool[okOutput](t, cs, "update_node", map[string]any{
		"diagram_id": parent, "node_id": box, "subdiagram_id": "",
	})
	pg = callTool[diagramOutput](t, cs, "get_diagram", map[string]any{"id": parent})
	if pg.Diagram.Nodes[0].Data.SubdiagramID != "" {
		t.Errorf("subdiagram link not cleared: %q", pg.Diagram.Nodes[0].Data.SubdiagramID)
	}
}

// Error paths: operations on missing entities must surface as tool errors, not
// silent successes.
func TestErrorsOnMissingEntities(t *testing.T) {
	cs := newTestSession(t)
	ctx := context.Background()

	cases := []struct {
		name string
		args map[string]any
	}{
		{"get_diagram", map[string]any{"id": "nope"}},
		{"update_node", map[string]any{"diagram_id": "nope", "node_id": "x"}},
		{"add_edge", map[string]any{"diagram_id": "nope", "source": "a", "target": "b"}},
	}
	for _, c := range cases {
		res, err := cs.CallTool(ctx, &mcpsdk.CallToolParams{Name: c.name, Arguments: c.args})
		if err != nil {
			continue // transport-level error is also an acceptable failure signal
		}
		if !res.IsError {
			t.Errorf("%s on missing entity: expected an error result, got success", c.name)
		}
	}

	// update_node on a real diagram but unknown node ID should also error.
	id := callTool[diagramOutput](t, cs, "create_diagram", map[string]any{"name": "X"}).Diagram.ID
	res, err := cs.CallTool(ctx, &mcpsdk.CallToolParams{
		Name:      "update_node",
		Arguments: map[string]any{"diagram_id": id, "node_id": "ghost", "label": "z"},
	})
	if err == nil && !res.IsError {
		t.Error("update_node with unknown node_id: expected error, got success")
	}

	// auto_layout on a missing diagram must error too.
	res, err = cs.CallTool(ctx, &mcpsdk.CallToolParams{
		Name:      "auto_layout",
		Arguments: map[string]any{"id": "nope"},
	})
	if err == nil && !res.IsError {
		t.Error("auto_layout on missing diagram: expected error, got success")
	}
}

// TestAutoLayoutToolEdges exercises the auto_layout tool on awkward inputs and
// add_node with a partial coordinate, the way a careless AI client might.
func TestAutoLayoutToolEdges(t *testing.T) {
	cs := newTestSession(t)
	id := callTool[diagramOutput](t, cs, "create_diagram", map[string]any{"name": "Cyclic"}).Diagram.ID

	// add_node with only x given (y omitted) must still place the node.
	only := callTool[idOutput](t, cs, "add_node", map[string]any{
		"diagram_id": id, "label": "Only X", "x": 123.0,
	}).ID
	b := callTool[idOutput](t, cs, "add_node", map[string]any{"diagram_id": id, "label": "B"}).ID
	g := callTool[diagramOutput](t, cs, "get_diagram", map[string]any{"id": id})
	for _, n := range g.Diagram.Nodes {
		if n.ID == only && n.Position.X != 123 {
			t.Errorf("add_node honored x=123 but got %v", n.Position.X)
		}
	}

	// A 2-cycle (a→b, b→a) — no roots. auto_layout must not hang or error.
	callTool[idOutput](t, cs, "add_edge", map[string]any{"diagram_id": id, "source": only, "target": b})
	callTool[idOutput](t, cs, "add_edge", map[string]any{"diagram_id": id, "source": b, "target": only})
	out := callTool[diagramOutput](t, cs, "auto_layout", map[string]any{"id": id})
	if out.Diagram == nil || len(out.Diagram.Nodes) != 2 {
		t.Fatalf("auto_layout on a cycle returned %+v", out.Diagram)
	}
}

// If an AI client dispatches tool calls in parallel (common with parallel tool
// use), concurrent add_node on the same diagram must not lose nodes. Each does
// Get→append→Update; if that read-modify-write isn't serialized, writes clobber
// each other.
func TestConcurrentAddNodeNoLostUpdate(t *testing.T) {
	cs := newTestSession(t)
	ctx := context.Background()
	id := callTool[diagramOutput](t, cs, "create_diagram", map[string]any{"name": "Parallel"}).Diagram.ID

	const N = 30
	var wg sync.WaitGroup
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _ = cs.CallTool(ctx, &mcpsdk.CallToolParams{
				Name:      "add_node",
				Arguments: map[string]any{"diagram_id": id, "label": fmt.Sprintf("n%d", i)},
			})
		}(i)
	}
	wg.Wait()

	g := callTool[diagramOutput](t, cs, "get_diagram", map[string]any{"id": id})
	if len(g.Diagram.Nodes) != N {
		t.Errorf("lost-update: expected %d nodes after concurrent add_node, got %d", N, len(g.Diagram.Nodes))
	}
}

func TestSetEdgeStyleTool(t *testing.T) {
	cs := newTestSession(t)
	id := callTool[diagramOutput](t, cs, "create_diagram", map[string]any{"name": "Styled"}).Diagram.ID

	out := callTool[diagramOutput](t, cs, "set_edge_style", map[string]any{"diagram_id": id, "style": "synthetic"})
	if out.Diagram == nil || out.Diagram.EdgeStyle != "synthetic" {
		t.Fatalf("set synthetic failed: %+v", out.Diagram)
	}
	// Round-trips on read.
	g := callTool[diagramOutput](t, cs, "get_diagram", map[string]any{"id": id})
	if g.Diagram.EdgeStyle != "synthetic" {
		t.Errorf("edgeStyle not persisted: %q", g.Diagram.EdgeStyle)
	}
	// "organic" normalizes back to empty (the omitempty default).
	out = callTool[diagramOutput](t, cs, "set_edge_style", map[string]any{"diagram_id": id, "style": "organic"})
	if out.Diagram.EdgeStyle != "" {
		t.Errorf("organic should clear edgeStyle, got %q", out.Diagram.EdgeStyle)
	}
	// An invalid style is a tool error, not a silent default.
	res, err := cs.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name:      "set_edge_style",
		Arguments: map[string]any{"diagram_id": id, "style": "zigzag"},
	})
	if err == nil && !res.IsError {
		t.Error("invalid style should error")
	}
}

func TestAddGraphBuildsInOneCall(t *testing.T) {
	cs := newTestSession(t)
	id := callTool[diagramOutput](t, cs, "create_diagram", map[string]any{"name": "Graph"}).Diagram.ID

	out := callTool[struct {
		Keys      map[string]string `json:"keys"`
		NodeCount int               `json:"nodeCount"`
		EdgeCount int               `json:"edgeCount"`
	}](t, cs, "add_graph", map[string]any{
		"diagram_id": id,
		"nodes": []map[string]any{
			{"key": "web", "kind": "frontend", "label": "Web"},
			{"key": "api", "kind": "backend", "label": "API"},
			{"key": "db", "kind": "database", "label": "DB"},
		},
		"edges": []map[string]any{
			{"source": "web", "target": "api", "label": "http"},
			{"source": "api", "target": "db", "label": "sql"},
		},
	})
	if out.NodeCount != 3 || out.EdgeCount != 2 {
		t.Fatalf("counts: %d nodes / %d edges", out.NodeCount, out.EdgeCount)
	}
	if len(out.Keys) != 3 || out.Keys["web"] == "" || out.Keys["db"] == "" {
		t.Fatalf("keys not mapped: %+v", out.Keys)
	}

	g := callTool[diagramOutput](t, cs, "get_diagram", map[string]any{"id": id})
	if len(g.Diagram.Nodes) != 3 || len(g.Diagram.Edges) != 2 {
		t.Fatalf("persisted %d nodes / %d edges", len(g.Diagram.Nodes), len(g.Diagram.Edges))
	}
	// Edges were remapped from keys to the created ids.
	want := map[string]bool{out.Keys["web"] + "->" + out.Keys["api"]: true, out.Keys["api"] + "->" + out.Keys["db"]: true}
	for _, e := range g.Diagram.Edges {
		if !want[e.Source+"->"+e.Target] {
			t.Errorf("unexpected edge %s -> %s", e.Source, e.Target)
		}
	}

	// An edge can also reference an existing node id (not just a key).
	out2 := callTool[struct {
		Keys      map[string]string `json:"keys"`
		EdgeCount int               `json:"edgeCount"`
	}](t, cs, "add_graph", map[string]any{
		"diagram_id": id,
		"nodes":      []map[string]any{{"key": "cache", "kind": "cache", "label": "Cache"}},
		"edges":      []map[string]any{{"source": "cache", "target": out.Keys["db"]}},
	})
	if out2.EdgeCount != 1 {
		t.Fatalf("mixed key/id edge count: %d", out2.EdgeCount)
	}
	g = callTool[diagramOutput](t, cs, "get_diagram", map[string]any{"id": id})
	if len(g.Diagram.Nodes) != 4 || len(g.Diagram.Edges) != 3 {
		t.Fatalf("after second add_graph: %d nodes / %d edges", len(g.Diagram.Nodes), len(g.Diagram.Edges))
	}

	// A dangling reference (unknown key/id) must fail the whole call.
	res, err := cs.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name: "add_graph",
		Arguments: map[string]any{
			"diagram_id": id,
			"nodes":      []map[string]any{{"key": "x", "label": "X"}},
			"edges":      []map[string]any{{"source": "x", "target": "ghost"}},
		},
	})
	if err == nil && !res.IsError {
		t.Error("add_graph with a dangling edge ref should error")
	}
}
