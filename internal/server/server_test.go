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
	"github.com/MiguelAguiarDEV/diagramer/internal/storage"
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

// Optimistic concurrency: when N clients PUT with the SAME If-Match, exactly
// one must win (200) and the rest must get 412 — otherwise the ETag check is a
// no-op and concurrent writers silently clobber each other (lost update).
func TestConcurrentIfMatchSingleWinner(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	resp, _ := http.Post(srv.URL+"/api/diagrams", "application/json", bytes.NewBufferString(`{"name":"race"}`))
	var d diagrams.Diagram
	json.NewDecoder(resp.Body).Decode(&d)
	etag := resp.Header.Get("ETag")

	const N = 40
	var wg sync.WaitGroup
	codes := make([]int, N)
	start := make(chan struct{})
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body := fmt.Sprintf(`{"id":%q,"name":"race","nodes":[{"id":"n%d","position":{"x":%d,"y":0},"data":{"label":"L"}}],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}`, d.ID, i, i)
			req, _ := http.NewRequest("PUT", srv.URL+"/api/diagrams/"+d.ID, strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("If-Match", etag)
			<-start
			r, err := http.DefaultClient.Do(req)
			if err != nil {
				codes[i] = -1
				return
			}
			codes[i] = r.StatusCode
			r.Body.Close()
		}(i)
	}
	close(start)
	wg.Wait()

	wins, conflicts := 0, 0
	for _, c := range codes {
		switch c {
		case 200:
			wins++
		case http.StatusPreconditionFailed:
			conflicts++
		}
	}
	if wins != 1 {
		t.Errorf("expected exactly 1 winner, got %d wins / %d conflicts (lost-update race)", wins, conflicts)
	}
}

// Same race but against the real file repo, whose disk IO between the service's
// Get and Save widens the TOCTOU window enough to expose the lost-update bug.
func TestConcurrentIfMatchSingleWinnerFileRepo(t *testing.T) {
	repo, err := storage.NewJSONFileRepo(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := diagrams.NewService(repo)
	mux := http.NewServeMux()
	registerAPIRoutes(mux, svc, nil)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, _ := http.Post(srv.URL+"/api/diagrams", "application/json", bytes.NewBufferString(`{"name":"race"}`))
	var d diagrams.Diagram
	json.NewDecoder(resp.Body).Decode(&d)
	etag := resp.Header.Get("ETag")

	const N = 40
	var wg sync.WaitGroup
	codes := make([]int, N)
	start := make(chan struct{})
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body := fmt.Sprintf(`{"id":%q,"name":"race","nodes":[{"id":"n%d","position":{"x":%d,"y":0},"data":{"label":"L"}}],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}`, d.ID, i, i)
			req, _ := http.NewRequest("PUT", srv.URL+"/api/diagrams/"+d.ID, strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("If-Match", etag)
			<-start
			r, e := http.DefaultClient.Do(req)
			if e != nil {
				codes[i] = -1
				return
			}
			codes[i] = r.StatusCode
			r.Body.Close()
		}(i)
	}
	close(start)
	wg.Wait()

	wins := 0
	for _, c := range codes {
		if c == 200 {
			wins++
		}
	}
	if wins != 1 {
		t.Errorf("expected exactly 1 winner, got %d (lost-update race via TOCTOU)", wins)
	}
}

// Fuzz-ish: no malformed/hostile PUT body should ever 500 or crash the server;
// only client-error or success codes are acceptable.
func TestUpdateMalformedBodiesNeverErrorServer(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()
	resp, _ := http.Post(srv.URL+"/api/diagrams", "application/json", bytes.NewBufferString(`{"name":"f"}`))
	var d diagrams.Diagram
	json.NewDecoder(resp.Body).Decode(&d)
	url := srv.URL + "/api/diagrams/" + d.ID

	bodies := []string{
		``,                       // empty
		`null`,                   // null
		`[]`,                     // wrong top-level type
		`{`,                      // truncated
		`{"nodes":"notarray"}`,   // wrong field type
		`{"nodes":[{"id":123}]}`, // wrong node id type
		`{"nodes":[{}]}`,         // node missing everything
		`{"nodes":[{"id":"","position":{"x":"NaN"}}]}`,         // bad position type
		`{"edges":[{"id":"e","source":"ghost","target":"x"}]}`, // dangling refs
		`{"viewport":{"zoom":"big"}}`,                          // wrong viewport type
		`{"name":` + `"` + strings.Repeat("ñ", 300) + `"}`,     // overlong unicode name
		`{"nodes":[` + strings.Repeat(`{"id":"x","position":{"x":0,"y":0},"data":{"label":"a"}},`, 3) + `{"id":"x","position":{"x":0,"y":0},"data":{"label":"a"}}]}`, // duplicate ids
		strings.Repeat(`{"a":`, 2000) + `1` + strings.Repeat(`}`, 2000),                                                                                              // deeply nested
	}
	allowed := map[int]bool{200: true, 400: true, 404: true, 412: true, 413: true}
	for i, b := range bodies {
		req, _ := http.NewRequest("PUT", url, strings.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Errorf("case %d: request error %v", i, err)
			continue
		}
		if !allowed[r.StatusCode] {
			t.Errorf("case %d (%.40q): unexpected status %d", i, b, r.StatusCode)
		}
		r.Body.Close()
	}

	// Server must still be alive and serving after the barrage.
	hr, err := http.Get(srv.URL + "/api/health")
	if err != nil || hr.StatusCode != 200 {
		t.Fatalf("server unhealthy after fuzz: err=%v", err)
	}
}
