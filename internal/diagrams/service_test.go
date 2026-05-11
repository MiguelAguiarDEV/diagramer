package diagrams

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// memRepo is an in-memory Repository for service tests.
type memRepo struct {
	mu sync.Mutex
	m  map[string]*Diagram
}

func newMemRepo() *memRepo { return &memRepo{m: map[string]*Diagram{}} }

var errNotFound = errors.New("not found")

func (r *memRepo) List(ctx context.Context) ([]DiagramMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]DiagramMeta, 0, len(r.m))
	for _, d := range r.m {
		out = append(out, NewDiagramMeta(d))
	}
	return out, nil
}
func (r *memRepo) Get(ctx context.Context, id string) (*Diagram, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	d, ok := r.m[id]
	if !ok {
		return nil, errNotFound
	}
	cp := *d
	return &cp, nil
}
func (r *memRepo) Save(ctx context.Context, d *Diagram) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := *d
	r.m[d.ID] = &cp
	return nil
}
func (r *memRepo) Delete(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.m, id)
	return nil
}

func TestCreate(t *testing.T) {
	s := NewService(newMemRepo())
	d, err := s.Create(context.Background(), "  hello  ")
	if err != nil {
		t.Fatal(err)
	}
	if d.Name != "hello" {
		t.Errorf("name not trimmed: %q", d.Name)
	}
	if d.ID == "" {
		t.Error("missing id")
	}
	if d.Nodes == nil || d.Edges == nil {
		t.Error("nil slices")
	}
	if d.Viewport.Zoom != 1 {
		t.Errorf("zoom default not 1: %v", d.Viewport.Zoom)
	}
	if d.CreatedAt.IsZero() || d.UpdatedAt.IsZero() {
		t.Error("missing timestamps")
	}
}

func TestCreateRejectsEmpty(t *testing.T) {
	s := NewService(newMemRepo())
	if _, err := s.Create(context.Background(), "   "); !errors.Is(err, ErrInvalidName) {
		t.Errorf("expected ErrInvalidName, got %v", err)
	}
}

func TestUpdatePreservesCreatedAtAndRefreshesUpdatedAt(t *testing.T) {
	r := newMemRepo()
	s := NewService(r)
	ctx := context.Background()
	d, _ := s.Create(ctx, "x")
	origCreated := d.CreatedAt
	origUpdated := d.UpdatedAt

	time.Sleep(2 * time.Millisecond)
	d.Nodes = []Node{{ID: "n1", Data: NodeData{Label: "hi"}}}
	updated, err := s.Update(ctx, d, "")
	if err != nil {
		t.Fatal(err)
	}
	if !updated.CreatedAt.Equal(origCreated) {
		t.Error("CreatedAt was modified")
	}
	if !updated.UpdatedAt.After(origUpdated) {
		t.Errorf("UpdatedAt did not advance: orig=%v new=%v", origUpdated, updated.UpdatedAt)
	}
	if len(updated.Nodes) != 1 {
		t.Error("node not persisted")
	}
}

func TestUpdateNilSlicesNormalized(t *testing.T) {
	r := newMemRepo()
	s := NewService(r)
	d, _ := s.Create(context.Background(), "x")
	d.Nodes = nil
	d.Edges = nil
	got, err := s.Update(context.Background(), d, "")
	if err != nil {
		t.Fatal(err)
	}
	if got.Nodes == nil || got.Edges == nil {
		t.Error("nil slices not normalized")
	}
}

func TestRename(t *testing.T) {
	s := NewService(newMemRepo())
	ctx := context.Background()
	d, _ := s.Create(ctx, "old")
	renamed, err := s.Rename(ctx, d.ID, "  new name  ")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Name != "new name" {
		t.Errorf("name: %q", renamed.Name)
	}
}

func TestUpdateETagMismatch(t *testing.T) {
	s := NewService(newMemRepo())
	ctx := context.Background()
	d, _ := s.Create(ctx, "x")
	if _, err := s.Update(ctx, d, `"999"`); !errors.Is(err, ErrConflict) {
		t.Errorf("expected ErrConflict, got %v", err)
	}
}

func TestUpdateETagMatch(t *testing.T) {
	s := NewService(newMemRepo())
	ctx := context.Background()
	d, _ := s.Create(ctx, "x")
	if _, err := s.Update(ctx, d, ETag(d)); err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
}

func TestRenameRejectsEmpty(t *testing.T) {
	s := NewService(newMemRepo())
	ctx := context.Background()
	d, _ := s.Create(ctx, "old")
	if _, err := s.Rename(ctx, d.ID, ""); !errors.Is(err, ErrInvalidName) {
		t.Errorf("expected ErrInvalidName, got %v", err)
	}
}

func TestUpdateRejectsBadEdgeRef(t *testing.T) {
	s := NewService(newMemRepo())
	ctx := context.Background()
	d, _ := s.Create(ctx, "x")
	d.Nodes = []Node{{ID: "n1"}}
	d.Edges = []Edge{{ID: "e1", Source: "n1", Target: "ghost"}}
	if _, err := s.Update(ctx, d, ""); !errors.Is(err, ErrEdgeRef) {
		t.Errorf("expected ErrEdgeRef, got %v", err)
	}
}

func TestUpdateRejectsLongLabel(t *testing.T) {
	s := NewService(newMemRepo())
	ctx := context.Background()
	d, _ := s.Create(ctx, "x")
	long := make([]byte, MaxLabelLen+1)
	for i := range long {
		long[i] = 'a'
	}
	d.Nodes = []Node{{ID: "n1", Data: NodeData{Label: string(long)}}}
	if _, err := s.Update(ctx, d, ""); !errors.Is(err, ErrLabelTooLong) {
		t.Errorf("expected ErrLabelTooLong, got %v", err)
	}
}

func TestUpdateRejectsTooManyNodes(t *testing.T) {
	s := NewService(newMemRepo())
	ctx := context.Background()
	d, _ := s.Create(ctx, "x")
	d.Nodes = make([]Node, MaxNodes+1)
	for i := range d.Nodes {
		d.Nodes[i] = Node{ID: "n"}
	}
	if _, err := s.Update(ctx, d, ""); !errors.Is(err, ErrTooManyNodes) {
		t.Errorf("expected ErrTooManyNodes, got %v", err)
	}
}

func TestDelete(t *testing.T) {
	s := NewService(newMemRepo())
	ctx := context.Background()
	d, _ := s.Create(ctx, "x")
	if err := s.Delete(ctx, d.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, d.ID); err == nil {
		t.Error("expected get to fail after delete")
	}
}
