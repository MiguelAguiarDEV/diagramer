package storage

import (
	"context"
	"errors"

	"github.com/MiguelAguiarDEV/diagramer/internal/diagrams"
)

// ErrNotFound is returned when a diagram with the given id does not exist.
var ErrNotFound = errors.New("diagram not found")

// Repository persists diagrams. Implementations must be safe for concurrent use.
type Repository interface {
	List(ctx context.Context) ([]diagrams.DiagramMeta, error)
	Get(ctx context.Context, id string) (*diagrams.Diagram, error)
	Save(ctx context.Context, d *diagrams.Diagram) error
	Delete(ctx context.Context, id string) error
}
