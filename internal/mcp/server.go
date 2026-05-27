package mcpserver

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/MiguelAguiarDEV/diagramer/internal/diagrams"
)

// Server wraps the MCP SDK server with our diagram service.
type Server struct {
	srv    *mcpsdk.Server
	svc    diagrams.Service
	logger *slog.Logger
}

// New builds an MCP server backed by svc and registers all tools.
func New(svc diagrams.Service, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Server{
		svc:    svc,
		logger: logger,
		srv: mcpsdk.NewServer(&mcpsdk.Implementation{
			Name:    "diagramer",
			Version: "0.1.0",
		}, nil),
	}
	s.registerTools()
	return s
}

// Run blocks until the stdio transport closes or ctx is cancelled.
func (s *Server) Run(ctx context.Context) error {
	return s.srv.Run(ctx, &mcpsdk.StdioTransport{})
}

// ---------- tool I/O types ----------

type emptyInput struct{}

type okOutput struct {
	OK bool `json:"ok"`
}

type listOutput struct {
	Diagrams []diagrams.DiagramMeta `json:"diagrams"`
}

type idInput struct {
	ID string `json:"id" jsonschema:"diagram ID"`
}

type diagramOutput struct {
	Diagram *diagrams.Diagram `json:"diagram"`
}

type createInput struct {
	Name string `json:"name" jsonschema:"name for the new diagram"`
}

type renameInput struct {
	ID   string `json:"id" jsonschema:"diagram ID"`
	Name string `json:"name" jsonschema:"new name"`
}

type addNodeInput struct {
	DiagramID string  `json:"diagram_id" jsonschema:"diagram ID"`
	Kind      string  `json:"kind,omitempty" jsonschema:"shape kind: rect, circle, ellipse, rhombus, tri-up, tri-down, database, backend, frontend, queue, cache, user, cloud. Empty = rect."`
	Label     string  `json:"label,omitempty" jsonschema:"label text (optional)"`
	X         float64 `json:"x" jsonschema:"x position in model coords"`
	Y         float64 `json:"y" jsonschema:"y position in model coords"`
	Fill      string  `json:"fill,omitempty" jsonschema:"fill color as a CSS hex like #13315c (optional)"`
	Stroke    string  `json:"stroke,omitempty" jsonschema:"border color as a CSS hex like #3b82f6 (optional)"`
	Port      string  `json:"port,omitempty" jsonschema:"mark as this diagram's interface so it surfaces as a port on a container: 'in' (entry/left), 'out' (return/right), or 'dep' (dependency/bottom, e.g. a DB or API). Optional."`
}

type idOutput struct {
	ID string `json:"id"`
}

type updateNodeInput struct {
	DiagramID string   `json:"diagram_id" jsonschema:"diagram ID"`
	NodeID    string   `json:"node_id" jsonschema:"node ID"`
	Kind      *string  `json:"kind,omitempty" jsonschema:"new kind (omit to keep)"`
	Label     *string  `json:"label,omitempty" jsonschema:"new label (omit to keep)"`
	X         *float64 `json:"x,omitempty" jsonschema:"new x (omit to keep)"`
	Y         *float64 `json:"y,omitempty" jsonschema:"new y (omit to keep)"`
	Fill         *string `json:"fill,omitempty" jsonschema:"new fill hex; empty string clears it (omit to keep)"`
	Stroke       *string `json:"stroke,omitempty" jsonschema:"new border hex; empty string clears it (omit to keep)"`
	SubdiagramID *string `json:"subdiagram_id,omitempty" jsonschema:"link this node to a subdiagram by ID; empty string unlinks (omit to keep)"`
	Port         *string `json:"port,omitempty" jsonschema:"interface role: 'in', 'out', or 'dep'; empty string clears it (omit to keep)"`
}

type createSubdiagramInput struct {
	DiagramID string `json:"diagram_id" jsonschema:"ID of the parent diagram"`
	NodeID    string `json:"node_id" jsonschema:"ID of the node to turn into a container"`
	Name      string `json:"name,omitempty" jsonschema:"name for the new subdiagram (optional)"`
}

type deleteNodeInput struct {
	DiagramID string `json:"diagram_id" jsonschema:"diagram ID"`
	NodeID    string `json:"node_id" jsonschema:"node ID"`
}

type addEdgeInput struct {
	DiagramID string `json:"diagram_id" jsonschema:"diagram ID"`
	Source    string `json:"source" jsonschema:"source node ID"`
	Target    string `json:"target" jsonschema:"target node ID"`
	Label     string `json:"label,omitempty" jsonschema:"edge label (optional)"`
}

type updateEdgeInput struct {
	DiagramID string  `json:"diagram_id" jsonschema:"diagram ID"`
	EdgeID    string  `json:"edge_id" jsonschema:"edge ID"`
	Label     *string `json:"label,omitempty" jsonschema:"new label (omit to keep)"`
}

type deleteEdgeInput struct {
	DiagramID string `json:"diagram_id" jsonschema:"diagram ID"`
	EdgeID    string `json:"edge_id" jsonschema:"edge ID"`
}

// ---------- tool registration ----------

func (s *Server) registerTools() {
	mcpsdk.AddTool(s.srv, &mcpsdk.Tool{
		Name:        "list_diagrams",
		Description: "List every diagram (id, name, updatedAt, counts).",
	}, s.listDiagrams)

	mcpsdk.AddTool(s.srv, &mcpsdk.Tool{
		Name:        "get_diagram",
		Description: "Fetch a full diagram (nodes, edges, viewport) by ID.",
	}, s.getDiagram)

	mcpsdk.AddTool(s.srv, &mcpsdk.Tool{
		Name:        "create_diagram",
		Description: "Create a new empty diagram. Returns the created diagram including its new ID.",
	}, s.createDiagram)

	mcpsdk.AddTool(s.srv, &mcpsdk.Tool{
		Name:        "rename_diagram",
		Description: "Rename an existing diagram.",
	}, s.renameDiagram)

	mcpsdk.AddTool(s.srv, &mcpsdk.Tool{
		Name:        "delete_diagram",
		Description: "Delete a diagram permanently.",
	}, s.deleteDiagram)

	mcpsdk.AddTool(s.srv, &mcpsdk.Tool{
		Name:        "add_node",
		Description: "Add a node to a diagram. Returns the new node's ID.",
	}, s.addNode)

	mcpsdk.AddTool(s.srv, &mcpsdk.Tool{
		Name:        "update_node",
		Description: "Update fields of an existing node. Omitted fields are left untouched.",
	}, s.updateNode)

	mcpsdk.AddTool(s.srv, &mcpsdk.Tool{
		Name:        "delete_node",
		Description: "Delete a node and any edges that reference it.",
	}, s.deleteNode)

	mcpsdk.AddTool(s.srv, &mcpsdk.Tool{
		Name:        "create_subdiagram",
		Description: "Create a new diagram and link it as the subdiagram of an existing node, making that node a navigable container. Returns the new subdiagram's ID; populate it with add_node/add_edge using that ID to build a nested architecture.",
	}, s.createSubdiagram)

	mcpsdk.AddTool(s.srv, &mcpsdk.Tool{
		Name:        "add_edge",
		Description: "Connect two nodes with a directed edge. Returns the new edge's ID.",
	}, s.addEdge)

	mcpsdk.AddTool(s.srv, &mcpsdk.Tool{
		Name:        "update_edge",
		Description: "Update fields of an existing edge. Omitted fields are left untouched.",
	}, s.updateEdge)

	mcpsdk.AddTool(s.srv, &mcpsdk.Tool{
		Name:        "delete_edge",
		Description: "Delete an edge from a diagram.",
	}, s.deleteEdge)
}

// ---------- handlers ----------

func (s *Server) listDiagrams(ctx context.Context, _ *mcpsdk.CallToolRequest, _ emptyInput) (*mcpsdk.CallToolResult, listOutput, error) {
	metas, err := s.svc.List(ctx)
	if err != nil {
		return nil, listOutput{}, err
	}
	if metas == nil {
		metas = []diagrams.DiagramMeta{}
	}
	return nil, listOutput{Diagrams: metas}, nil
}

func (s *Server) getDiagram(ctx context.Context, _ *mcpsdk.CallToolRequest, in idInput) (*mcpsdk.CallToolResult, diagramOutput, error) {
	d, err := s.svc.Get(ctx, in.ID)
	if err != nil {
		return nil, diagramOutput{}, err
	}
	return nil, diagramOutput{Diagram: d}, nil
}

func (s *Server) createDiagram(ctx context.Context, _ *mcpsdk.CallToolRequest, in createInput) (*mcpsdk.CallToolResult, diagramOutput, error) {
	d, err := s.svc.Create(ctx, in.Name)
	if err != nil {
		return nil, diagramOutput{}, err
	}
	return nil, diagramOutput{Diagram: d}, nil
}

func (s *Server) renameDiagram(ctx context.Context, _ *mcpsdk.CallToolRequest, in renameInput) (*mcpsdk.CallToolResult, diagramOutput, error) {
	d, err := s.svc.Rename(ctx, in.ID, in.Name)
	if err != nil {
		return nil, diagramOutput{}, err
	}
	return nil, diagramOutput{Diagram: d}, nil
}

func (s *Server) deleteDiagram(ctx context.Context, _ *mcpsdk.CallToolRequest, in idInput) (*mcpsdk.CallToolResult, okOutput, error) {
	if err := s.svc.Delete(ctx, in.ID); err != nil {
		return nil, okOutput{}, err
	}
	return nil, okOutput{OK: true}, nil
}

func (s *Server) addNode(ctx context.Context, _ *mcpsdk.CallToolRequest, in addNodeInput) (*mcpsdk.CallToolResult, idOutput, error) {
	d, err := s.svc.Get(ctx, in.DiagramID)
	if err != nil {
		return nil, idOutput{}, err
	}
	node := diagrams.Node{
		ID:       uuid.NewString(),
		Kind:     in.Kind,
		Position: diagrams.Position{X: in.X, Y: in.Y},
		Data:     diagrams.NodeData{Label: in.Label, Fill: in.Fill, Stroke: in.Stroke, Port: in.Port},
	}
	d.Nodes = append(d.Nodes, node)
	if _, err := s.svc.Update(ctx, d, ""); err != nil {
		return nil, idOutput{}, err
	}
	return nil, idOutput{ID: node.ID}, nil
}

func (s *Server) updateNode(ctx context.Context, _ *mcpsdk.CallToolRequest, in updateNodeInput) (*mcpsdk.CallToolResult, okOutput, error) {
	d, err := s.svc.Get(ctx, in.DiagramID)
	if err != nil {
		return nil, okOutput{}, err
	}
	found := false
	for i := range d.Nodes {
		if d.Nodes[i].ID == in.NodeID {
			if in.Kind != nil {
				d.Nodes[i].Kind = *in.Kind
			}
			if in.Label != nil {
				d.Nodes[i].Data.Label = *in.Label
			}
			if in.X != nil {
				d.Nodes[i].Position.X = *in.X
			}
			if in.Y != nil {
				d.Nodes[i].Position.Y = *in.Y
			}
			if in.Fill != nil {
				d.Nodes[i].Data.Fill = *in.Fill
			}
			if in.Stroke != nil {
				d.Nodes[i].Data.Stroke = *in.Stroke
			}
			if in.SubdiagramID != nil {
				d.Nodes[i].Data.SubdiagramID = *in.SubdiagramID
			}
			if in.Port != nil {
				d.Nodes[i].Data.Port = *in.Port
			}
			found = true
			break
		}
	}
	if !found {
		return nil, okOutput{}, fmt.Errorf("node %q not found in diagram %q", in.NodeID, in.DiagramID)
	}
	if _, err := s.svc.Update(ctx, d, ""); err != nil {
		return nil, okOutput{}, err
	}
	return nil, okOutput{OK: true}, nil
}

func (s *Server) deleteNode(ctx context.Context, _ *mcpsdk.CallToolRequest, in deleteNodeInput) (*mcpsdk.CallToolResult, okOutput, error) {
	d, err := s.svc.Get(ctx, in.DiagramID)
	if err != nil {
		return nil, okOutput{}, err
	}
	kept := d.Nodes[:0]
	for _, n := range d.Nodes {
		if n.ID != in.NodeID {
			kept = append(kept, n)
		}
	}
	d.Nodes = kept
	keptEdges := d.Edges[:0]
	for _, e := range d.Edges {
		if e.Source != in.NodeID && e.Target != in.NodeID {
			keptEdges = append(keptEdges, e)
		}
	}
	d.Edges = keptEdges
	if _, err := s.svc.Update(ctx, d, ""); err != nil {
		return nil, okOutput{}, err
	}
	return nil, okOutput{OK: true}, nil
}

func (s *Server) createSubdiagram(ctx context.Context, _ *mcpsdk.CallToolRequest, in createSubdiagramInput) (*mcpsdk.CallToolResult, idOutput, error) {
	parent, err := s.svc.Get(ctx, in.DiagramID)
	if err != nil {
		return nil, idOutput{}, err
	}
	idx := -1
	for i := range parent.Nodes {
		if parent.Nodes[i].ID == in.NodeID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil, idOutput{}, fmt.Errorf("node %q not found in diagram %q", in.NodeID, in.DiagramID)
	}
	name := in.Name
	if name == "" {
		label := parent.Nodes[idx].Data.Label
		if label == "" {
			label = "Container"
		}
		name = label + " — inside"
	}
	sub, err := s.svc.Create(ctx, name)
	if err != nil {
		return nil, idOutput{}, err
	}
	parent.Nodes[idx].Data.SubdiagramID = sub.ID
	if _, err := s.svc.Update(ctx, parent, ""); err != nil {
		return nil, idOutput{}, err
	}
	return nil, idOutput{ID: sub.ID}, nil
}

func (s *Server) addEdge(ctx context.Context, _ *mcpsdk.CallToolRequest, in addEdgeInput) (*mcpsdk.CallToolResult, idOutput, error) {
	d, err := s.svc.Get(ctx, in.DiagramID)
	if err != nil {
		return nil, idOutput{}, err
	}
	edge := diagrams.Edge{
		ID:     uuid.NewString(),
		Source: in.Source,
		Target: in.Target,
		Label:  in.Label,
	}
	d.Edges = append(d.Edges, edge)
	if _, err := s.svc.Update(ctx, d, ""); err != nil {
		return nil, idOutput{}, err
	}
	return nil, idOutput{ID: edge.ID}, nil
}

func (s *Server) updateEdge(ctx context.Context, _ *mcpsdk.CallToolRequest, in updateEdgeInput) (*mcpsdk.CallToolResult, okOutput, error) {
	d, err := s.svc.Get(ctx, in.DiagramID)
	if err != nil {
		return nil, okOutput{}, err
	}
	found := false
	for i := range d.Edges {
		if d.Edges[i].ID == in.EdgeID {
			if in.Label != nil {
				d.Edges[i].Label = *in.Label
			}
			found = true
			break
		}
	}
	if !found {
		return nil, okOutput{}, fmt.Errorf("edge %q not found in diagram %q", in.EdgeID, in.DiagramID)
	}
	if _, err := s.svc.Update(ctx, d, ""); err != nil {
		return nil, okOutput{}, err
	}
	return nil, okOutput{OK: true}, nil
}

func (s *Server) deleteEdge(ctx context.Context, _ *mcpsdk.CallToolRequest, in deleteEdgeInput) (*mcpsdk.CallToolResult, okOutput, error) {
	d, err := s.svc.Get(ctx, in.DiagramID)
	if err != nil {
		return nil, okOutput{}, err
	}
	kept := d.Edges[:0]
	for _, e := range d.Edges {
		if e.ID != in.EdgeID {
			kept = append(kept, e)
		}
	}
	d.Edges = kept
	if _, err := s.svc.Update(ctx, d, ""); err != nil {
		return nil, okOutput{}, err
	}
	return nil, okOutput{OK: true}, nil
}
