package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"

	"github.com/MiguelAguiarDEV/diagramer/internal/diagrams"
)

// idRegex guards against path traversal: only UUID-like strings allowed.
var idRegex = regexp.MustCompile(`^[0-9a-fA-F-]{36}$`)

// ErrInvalidID is returned when an id fails validation.
var ErrInvalidID = errors.New("invalid diagram id")

// JSONFileRepo persists each diagram as ./<root>/diagrams/<id>.json
// and maintains a ./<root>/index.json with the metadata of all diagrams.
type JSONFileRepo struct {
	root string
	mu   sync.Mutex
}

func NewJSONFileRepo(root string) (*JSONFileRepo, error) {
	if err := os.MkdirAll(filepath.Join(root, "diagrams"), 0o755); err != nil {
		return nil, fmt.Errorf("mkdir data: %w", err)
	}
	r := &JSONFileRepo{root: root}
	if _, err := os.Stat(r.indexPath()); errors.Is(err, fs.ErrNotExist) {
		if err := r.writeIndex([]diagrams.DiagramMeta{}); err != nil {
			return nil, err
		}
	}
	return r, nil
}

func (r *JSONFileRepo) diagramPath(id string) string {
	return filepath.Join(r.root, "diagrams", id+".json")
}

func (r *JSONFileRepo) indexPath() string {
	return filepath.Join(r.root, "index.json")
}

func (r *JSONFileRepo) List(ctx context.Context) ([]diagrams.DiagramMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.readIndex()
}

func (r *JSONFileRepo) Get(ctx context.Context, id string) (*diagrams.Diagram, error) {
	if !idRegex.MatchString(id) {
		return nil, ErrInvalidID
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.readDiagram(id)
}

func (r *JSONFileRepo) Save(ctx context.Context, d *diagrams.Diagram) error {
	if d == nil {
		return errors.New("nil diagram")
	}
	if !idRegex.MatchString(d.ID) {
		return ErrInvalidID
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.writeDiagramAtomic(d); err != nil {
		return err
	}
	return r.upsertIndex(diagrams.NewDiagramMeta(d))
}

func (r *JSONFileRepo) Delete(ctx context.Context, id string) error {
	if !idRegex.MatchString(id) {
		return ErrInvalidID
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := os.Remove(r.diagramPath(id)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove diagram: %w", err)
	}
	return r.removeFromIndex(id)
}

// --- internals ---

func (r *JSONFileRepo) readDiagram(id string) (*diagrams.Diagram, error) {
	b, err := os.ReadFile(r.diagramPath(id))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("read diagram: %w", err)
	}
	var d diagrams.Diagram
	if err := json.Unmarshal(b, &d); err != nil {
		return nil, fmt.Errorf("unmarshal diagram: %w", err)
	}
	return &d, nil
}

func (r *JSONFileRepo) writeDiagramAtomic(d *diagrams.Diagram) error {
	b, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal diagram: %w", err)
	}
	final := r.diagramPath(d.ID)
	tmp := final + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return fmt.Errorf("write tmp: %w", err)
	}
	if err := os.Rename(tmp, final); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename tmp: %w", err)
	}
	return nil
}

func (r *JSONFileRepo) readIndex() ([]diagrams.DiagramMeta, error) {
	b, err := os.ReadFile(r.indexPath())
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return []diagrams.DiagramMeta{}, nil
		}
		return nil, fmt.Errorf("read index: %w", err)
	}
	var metas []diagrams.DiagramMeta
	if len(b) == 0 {
		return []diagrams.DiagramMeta{}, nil
	}
	if err := json.Unmarshal(b, &metas); err != nil {
		return nil, fmt.Errorf("unmarshal index: %w", err)
	}
	return metas, nil
}

func (r *JSONFileRepo) writeIndex(metas []diagrams.DiagramMeta) error {
	// Sort by UpdatedAt desc for stable, useful order.
	sort.Slice(metas, func(i, j int) bool {
		return metas[i].UpdatedAt.After(metas[j].UpdatedAt)
	})
	b, err := json.MarshalIndent(metas, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal index: %w", err)
	}
	tmp := r.indexPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return fmt.Errorf("write index tmp: %w", err)
	}
	if err := os.Rename(tmp, r.indexPath()); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename index: %w", err)
	}
	return nil
}

func (r *JSONFileRepo) upsertIndex(m diagrams.DiagramMeta) error {
	metas, err := r.readIndex()
	if err != nil {
		return err
	}
	updated := false
	for i := range metas {
		if metas[i].ID == m.ID {
			metas[i] = m
			updated = true
			break
		}
	}
	if !updated {
		metas = append(metas, m)
	}
	return r.writeIndex(metas)
}

func (r *JSONFileRepo) removeFromIndex(id string) error {
	metas, err := r.readIndex()
	if err != nil {
		return err
	}
	out := metas[:0]
	for _, m := range metas {
		if m.ID != id {
			out = append(out, m)
		}
	}
	return r.writeIndex(out)
}
