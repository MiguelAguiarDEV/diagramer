package diagrams

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ErrInvalidName is returned when a diagram name is empty or whitespace-only.
var ErrInvalidName = errors.New("invalid diagram name")

// Validation limits.
const (
	MaxNameLen  = 200
	MaxLabelLen = 500
	MaxNodes    = 5000
	MaxEdges    = 10000
)

var (
	ErrNameTooLong  = errors.New("diagram name too long")
	ErrTooManyNodes = errors.New("too many nodes")
	ErrTooManyEdges = errors.New("too many edges")
	ErrLabelTooLong = errors.New("node label too long")
	ErrEdgeRef      = errors.New("edge references unknown node")
)

// Repository is the storage abstraction the Service depends on.
// Defined here (consumer side) per Go convention so storage stays decoupled.
type Repository interface {
	List(ctx context.Context) ([]DiagramMeta, error)
	Get(ctx context.Context, id string) (*Diagram, error)
	Save(ctx context.Context, d *Diagram) error
	Delete(ctx context.Context, id string) error
}

// Service is the diagram domain.
type Service interface {
	List(ctx context.Context) ([]DiagramMeta, error)
	Get(ctx context.Context, id string) (*Diagram, error)
	Create(ctx context.Context, name string) (*Diagram, error)
	Update(ctx context.Context, d *Diagram) (*Diagram, error)
	Rename(ctx context.Context, id, newName string) (*DiagramMeta, error)
	Delete(ctx context.Context, id string) error
}

type service struct {
	repo Repository
	now  func() time.Time
}

func NewService(repo Repository) Service {
	return &service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

func (s *service) List(ctx context.Context) ([]DiagramMeta, error) {
	return s.repo.List(ctx)
}

func (s *service) Get(ctx context.Context, id string) (*Diagram, error) {
	return s.repo.Get(ctx, id)
}

func (s *service) Create(ctx context.Context, name string) (*Diagram, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, ErrInvalidName
	}
	if len(name) > MaxNameLen {
		return nil, ErrNameTooLong
	}
	now := s.now()
	d := &Diagram{
		ID:        uuid.NewString(),
		Name:      name,
		Nodes:     []Node{},
		Edges:     []Edge{},
		Viewport:  Viewport{Zoom: 1},
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.repo.Save(ctx, d); err != nil {
		return nil, fmt.Errorf("save: %w", err)
	}
	return d, nil
}

func (s *service) Update(ctx context.Context, d *Diagram) (*Diagram, error) {
	if d == nil {
		return nil, errors.New("nil diagram")
	}
	existing, err := s.repo.Get(ctx, d.ID)
	if err != nil {
		return nil, err
	}
	// Preserve immutable fields, accept new content.
	d.CreatedAt = existing.CreatedAt
	if strings.TrimSpace(d.Name) == "" {
		d.Name = existing.Name
	}
	if d.Nodes == nil {
		d.Nodes = []Node{}
	}
	if d.Edges == nil {
		d.Edges = []Edge{}
	}
	if err := validate(d); err != nil {
		return nil, err
	}
	d.UpdatedAt = s.now()
	if err := s.repo.Save(ctx, d); err != nil {
		return nil, fmt.Errorf("save: %w", err)
	}
	return d, nil
}

func (s *service) Rename(ctx context.Context, id, newName string) (*DiagramMeta, error) {
	newName = strings.TrimSpace(newName)
	if newName == "" {
		return nil, ErrInvalidName
	}
	if len(newName) > MaxNameLen {
		return nil, ErrNameTooLong
	}
	d, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	d.Name = newName
	d.UpdatedAt = s.now()
	if err := s.repo.Save(ctx, d); err != nil {
		return nil, fmt.Errorf("save: %w", err)
	}
	m := NewDiagramMeta(d)
	return &m, nil
}

func (s *service) Delete(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, id)
}

func validate(d *Diagram) error {
	if len(d.Name) > MaxNameLen {
		return ErrNameTooLong
	}
	if len(d.Nodes) > MaxNodes {
		return ErrTooManyNodes
	}
	if len(d.Edges) > MaxEdges {
		return ErrTooManyEdges
	}
	ids := make(map[string]struct{}, len(d.Nodes))
	for i := range d.Nodes {
		if len(d.Nodes[i].Data.Label) > MaxLabelLen {
			return ErrLabelTooLong
		}
		ids[d.Nodes[i].ID] = struct{}{}
	}
	for i := range d.Edges {
		if _, ok := ids[d.Edges[i].Source]; !ok {
			return ErrEdgeRef
		}
		if _, ok := ids[d.Edges[i].Target]; !ok {
			return ErrEdgeRef
		}
		if len(d.Edges[i].Label) > MaxLabelLen {
			return ErrLabelTooLong
		}
	}
	return nil
}
