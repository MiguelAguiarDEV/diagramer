package storage

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/MiguelAguiarDEV/diagramer/internal/diagrams"
	"github.com/google/uuid"
)

func newTestRepo(t *testing.T) *JSONFileRepo {
	t.Helper()
	r, err := NewJSONFileRepo(t.TempDir())
	if err != nil {
		t.Fatalf("NewJSONFileRepo: %v", err)
	}
	return r
}

func newDiagram(name string) *diagrams.Diagram {
	now := time.Now().UTC()
	return &diagrams.Diagram{
		ID:        uuid.NewString(),
		Name:      name,
		Nodes:     []diagrams.Node{},
		Edges:     []diagrams.Edge{},
		Viewport:  diagrams.Viewport{Zoom: 1},
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func TestSaveGetRoundTrip(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()

	d := newDiagram("test")
	d.Nodes = []diagrams.Node{{
		ID:       "n1",
		Position: diagrams.Position{X: 10, Y: 20},
		Data:     diagrams.NodeData{Label: "hello"},
	}}
	d.Edges = []diagrams.Edge{{ID: "e1", Source: "n1", Target: "n1"}}

	if err := r.Save(ctx, d); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got, err := r.Get(ctx, d.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Name != d.Name {
		t.Errorf("name: got %q want %q", got.Name, d.Name)
	}
	if len(got.Nodes) != 1 || got.Nodes[0].Data.Label != "hello" {
		t.Errorf("nodes did not round-trip: %+v", got.Nodes)
	}
	if len(got.Edges) != 1 || got.Edges[0].Source != "n1" {
		t.Errorf("edges did not round-trip: %+v", got.Edges)
	}
}

func TestGetNotFound(t *testing.T) {
	r := newTestRepo(t)
	_, err := r.Get(context.Background(), uuid.NewString())
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestInvalidIDRejected(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	_, err := r.Get(ctx, "../etc/passwd")
	if !errors.Is(err, ErrInvalidID) {
		t.Errorf("expected ErrInvalidID, got %v", err)
	}
}

func TestListReturnsMetadata(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()

	d1 := newDiagram("alpha")
	d1.Nodes = make([]diagrams.Node, 3)
	d2 := newDiagram("beta")
	d2.Edges = make([]diagrams.Edge, 5)

	if err := r.Save(ctx, d1); err != nil {
		t.Fatal(err)
	}
	if err := r.Save(ctx, d2); err != nil {
		t.Fatal(err)
	}

	metas, err := r.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(metas) != 2 {
		t.Fatalf("expected 2 metas, got %d", len(metas))
	}
	byID := map[string]diagrams.DiagramMeta{}
	for _, m := range metas {
		byID[m.ID] = m
	}
	if got := byID[d1.ID]; got.NodeCount != 3 || got.Name != "alpha" {
		t.Errorf("d1 meta: %+v", got)
	}
	if got := byID[d2.ID]; got.EdgeCount != 5 || got.Name != "beta" {
		t.Errorf("d2 meta: %+v", got)
	}
}

func TestDelete(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	d := newDiagram("doomed")
	if err := r.Save(ctx, d); err != nil {
		t.Fatal(err)
	}
	if err := r.Delete(ctx, d.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	_, err := r.Get(ctx, d.ID)
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("after delete expected ErrNotFound, got %v", err)
	}
	metas, _ := r.List(ctx)
	for _, m := range metas {
		if m.ID == d.ID {
			t.Errorf("metadata for deleted diagram still present")
		}
	}
}

func TestDeleteMissingIsNoop(t *testing.T) {
	r := newTestRepo(t)
	if err := r.Delete(context.Background(), uuid.NewString()); err != nil {
		t.Errorf("Delete of missing should not error, got %v", err)
	}
}

func TestSaveUpdatesIndexInPlace(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	d := newDiagram("v1")
	if err := r.Save(ctx, d); err != nil {
		t.Fatal(err)
	}
	d.Name = "v2"
	d.UpdatedAt = time.Now().UTC().Add(time.Second)
	d.Nodes = make([]diagrams.Node, 7)
	if err := r.Save(ctx, d); err != nil {
		t.Fatal(err)
	}
	metas, _ := r.List(ctx)
	if len(metas) != 1 {
		t.Fatalf("expected single entry after re-save, got %d", len(metas))
	}
	if metas[0].Name != "v2" || metas[0].NodeCount != 7 {
		t.Errorf("index not updated: %+v", metas[0])
	}
}

func TestConcurrentSaves(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := r.Save(ctx, newDiagram("concurrent")); err != nil {
				t.Errorf("Save: %v", err)
			}
		}()
	}
	wg.Wait()
	metas, err := r.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(metas) != 20 {
		t.Errorf("expected 20 diagrams, got %d", len(metas))
	}
}
