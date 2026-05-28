package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/MiguelAguiarDEV/diagramer/internal/diagrams"
)

// memRepo for handler tests.
type memRepo struct {
	mu sync.Mutex
	m  map[string]*diagrams.Diagram
}

func (r *memRepo) List(ctx context.Context) ([]diagrams.DiagramMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]diagrams.DiagramMeta, 0, len(r.m))
	for _, d := range r.m {
		out = append(out, diagrams.NewDiagramMeta(d))
	}
	return out, nil
}
func (r *memRepo) Get(ctx context.Context, id string) (*diagrams.Diagram, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	d, ok := r.m[id]
	if !ok {
		return nil, &notFound{}
	}
	cp := *d
	return &cp, nil
}
func (r *memRepo) Save(ctx context.Context, d *diagrams.Diagram) error {
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

type notFound struct{}

func (n *notFound) Error() string { return "not found" }

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	repo := &memRepo{m: map[string]*diagrams.Diagram{}}
	svc := diagrams.NewService(repo)
	mux := http.NewServeMux()
	registerAPIRoutes(mux, svc, nil)
	return httptest.NewServer(mux)
}

func TestHealth(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("status: %d", resp.StatusCode)
	}
}

func TestListEmpty(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	resp, _ := http.Get(srv.URL + "/api/diagrams")
	body, _ := io.ReadAll(resp.Body)
	if !strings.HasPrefix(strings.TrimSpace(string(body)), "[") {
		t.Errorf("expected JSON array, got %q", body)
	}
}

func TestCreateGetDelete(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	// Create
	createBody := bytes.NewBufferString(`{"name":"hello"}`)
	resp, err := http.Post(srv.URL+"/api/diagrams", "application/json", createBody)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Fatalf("create status: %d", resp.StatusCode)
	}
	var created diagrams.Diagram
	json.NewDecoder(resp.Body).Decode(&created)
	if created.ID == "" || created.Name != "hello" {
		t.Errorf("unexpected created: %+v", created)
	}

	// Get
	resp, _ = http.Get(srv.URL + "/api/diagrams/" + created.ID)
	if resp.StatusCode != 200 {
		t.Errorf("get status: %d", resp.StatusCode)
	}

	// Delete
	req, _ := http.NewRequest("DELETE", srv.URL+"/api/diagrams/"+created.ID, nil)
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != 204 {
		t.Errorf("delete status: %d", resp.StatusCode)
	}
}

func TestCreateInvalidName(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	resp, _ := http.Post(srv.URL+"/api/diagrams", "application/json", bytes.NewBufferString(`{"name":""}`))
	if resp.StatusCode != 400 {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestUpdateAndRename(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	// create
	resp, _ := http.Post(srv.URL+"/api/diagrams", "application/json", bytes.NewBufferString(`{"name":"orig"}`))
	var d diagrams.Diagram
	json.NewDecoder(resp.Body).Decode(&d)

	// rename
	patch, _ := http.NewRequest("PATCH", srv.URL+"/api/diagrams/"+d.ID,
		bytes.NewBufferString(`{"name":"renamed"}`))
	patch.Header.Set("Content-Type", "application/json")
	resp, _ = http.DefaultClient.Do(patch)
	if resp.StatusCode != 200 {
		t.Errorf("patch status: %d", resp.StatusCode)
	}

	// update with nodes
	body := `{"id":"` + d.ID + `","name":"renamed","nodes":[{"id":"n1","position":{"x":1,"y":2},"data":{"label":"L"}}],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}`
	put, _ := http.NewRequest("PUT", srv.URL+"/api/diagrams/"+d.ID, bytes.NewBufferString(body))
	put.Header.Set("Content-Type", "application/json")
	resp, _ = http.DefaultClient.Do(put)
	if resp.StatusCode != 200 {
		t.Errorf("put status: %d", resp.StatusCode)
	}
	var got diagrams.Diagram
	json.NewDecoder(resp.Body).Decode(&got)
	if len(got.Nodes) != 1 || got.Nodes[0].Data.Label != "L" {
		t.Errorf("update did not persist nodes: %+v", got.Nodes)
	}
}

// A diagram at the domain's node cap (5000) with moderate labels exceeds 1 MiB
// of JSON. The body limit must accommodate what the service accepts, otherwise
// a perfectly valid large diagram is rejected (and with a misleading "invalid
// json" to boot). Reproduces the layer-limit mismatch.
func TestUpdateLargeValidDiagramIsAccepted(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	resp, _ := http.Post(srv.URL+"/api/diagrams", "application/json", bytes.NewBufferString(`{"name":"big"}`))
	var d diagrams.Diagram
	json.NewDecoder(resp.Body).Decode(&d)

	label := strings.Repeat("x", 200) // well under MaxLabelLen (500)
	nodes := make([]diagrams.Node, diagrams.MaxNodes)
	for i := range nodes {
		nodes[i] = diagrams.Node{
			ID:       fmt.Sprintf("n%06d", i),
			Position: diagrams.Position{X: float64(i), Y: float64(i)},
			Data:     diagrams.NodeData{Label: label},
		}
	}
	payload, _ := json.Marshal(updateRequest{
		Name:     "big",
		Nodes:    nodes,
		Edges:    []diagrams.Edge{},
		Viewport: diagrams.Viewport{Zoom: 1},
	})
	t.Logf("payload size: %d bytes (body limit %d)", len(payload), maxBodyBytes)

	put, _ := http.NewRequest("PUT", srv.URL+"/api/diagrams/"+d.ID, bytes.NewReader(payload))
	put.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(put)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("valid %d-node diagram rejected: status %d, body %q", diagrams.MaxNodes, resp.StatusCode, body)
	}
}

// A body that genuinely exceeds the cap must return 413, not a misleading 400.
func TestOversizedBodyReturns413(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	// Valid JSON whose string value alone exceeds the 16 MiB cap, so the limit
	// trips mid-token (MaxBytesError) rather than a JSON syntax error.
	huge := strings.Repeat("a", (16<<20)+1024)
	body := `{"name":"` + huge + `"}`
	resp, err := http.Post(srv.URL+"/api/diagrams", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized body: got %d, want 413", resp.StatusCode)
	}
}
