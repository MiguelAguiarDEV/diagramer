package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCLILifecycle(t *testing.T) {
	dir := t.TempDir()
	run := func(cmd string, args ...string) (string, error) {
		var buf bytes.Buffer
		err := runCLI(&buf, cmd, append([]string{"-data", dir}, args...))
		return buf.String(), err
	}

	// create → prints an id
	out, err := run("create", "My Diagram")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := strings.TrimSpace(out)
	if id == "" {
		t.Fatal("create printed no id")
	}

	// list → shows it
	out, err = run("list")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if !strings.Contains(out, id) || !strings.Contains(out, "My Diagram") {
		t.Fatalf("list missing entry: %q", out)
	}

	// get → valid JSON with the id
	out, err = run("get", id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	var d map[string]any
	if err := json.Unmarshal([]byte(out), &d); err != nil {
		t.Fatalf("get output not JSON: %v", err)
	}
	if d["id"] != id {
		t.Errorf("get id = %v, want %s", d["id"], id)
	}

	// layout (no nodes) → ok
	if _, err := run("layout", id); err != nil {
		t.Fatalf("layout: %v", err)
	}

	// export to a file
	path := filepath.Join(dir, "out.json")
	if _, err := run("export", id, path); err != nil {
		t.Fatalf("export: %v", err)
	}
	b, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(b), id) {
		t.Fatalf("export file bad: err=%v", err)
	}

	// import round-trip: a JSON file (with one dangling edge) → new diagram,
	// dangling edge dropped, the valid one kept.
	src := filepath.Join(dir, "in.json")
	os.WriteFile(src, []byte(`{
		"name": "Imported One",
		"nodes": [{"id":"a","position":{"x":0,"y":0},"data":{"label":"A"}},
		          {"id":"b","position":{"x":200,"y":0},"data":{"label":"B"}}],
		"edges": [{"id":"e1","source":"a","target":"b"},
		          {"id":"bad","source":"a","target":"ghost"}],
		"viewport": {"x":0,"y":0,"zoom":1}
	}`), 0o644)
	out, err = run("import", src)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	impID := strings.TrimSpace(out)
	out, _ = run("get", impID)
	var imp struct {
		Name  string `json:"name"`
		Nodes []any  `json:"nodes"`
		Edges []any  `json:"edges"`
	}
	json.Unmarshal([]byte(out), &imp)
	if imp.Name != "Imported One" || len(imp.Nodes) != 2 || len(imp.Edges) != 1 {
		t.Fatalf("import result: name=%q %d nodes / %d edges (dangling not pruned?)",
			imp.Name, len(imp.Nodes), len(imp.Edges))
	}

	// delete → gone from list
	if _, err := run("delete", id); err != nil {
		t.Fatalf("delete: %v", err)
	}
	out, _ = run("list")
	if strings.Contains(out, id) {
		t.Errorf("diagram still listed after delete: %q", out)
	}

	// missing argument → error, not panic
	if _, err := run("get"); err == nil {
		t.Error("get with no id should error")
	}
}
