package server

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/MiguelAguiarDEV/diagramer/internal/diagrams"
	"github.com/MiguelAguiarDEV/diagramer/internal/storage"
)

// maxBodyBytes caps request body size to protect the server from accidental
// or malicious oversized payloads. It must comfortably exceed the largest
// diagram the service accepts (MaxNodes=5000 / MaxEdges=10000, labels up to
// MaxLabelLen) — a max-size diagram serializes to ~12 MiB — otherwise a valid
// large diagram would be rejected before validation. 16 MiB leaves headroom.
const maxBodyBytes = 16 << 20

// decodeJSON reads a size-capped JSON body into dst. It distinguishes an
// over-limit body (413) from malformed JSON (400) so the client gets an honest
// error instead of a misleading "invalid json". Returns false (and writes the
// response) on failure.
func (h *apiHandlers) decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		} else {
			http.Error(w, "invalid json", http.StatusBadRequest)
		}
		return false
	}
	return true
}

func registerAPIRoutes(mux *http.ServeMux, svc diagrams.Service, logger *slog.Logger) {
	h := &apiHandlers{svc: svc, logger: logger}
	mux.HandleFunc("GET /api/health", h.health)
	mux.HandleFunc("GET /api/diagrams", h.list)
	mux.HandleFunc("POST /api/diagrams", h.create)
	mux.HandleFunc("GET /api/diagrams/{id}", h.get)
	mux.HandleFunc("PUT /api/diagrams/{id}", h.update)
	mux.HandleFunc("PATCH /api/diagrams/{id}", h.rename)
	mux.HandleFunc("DELETE /api/diagrams/{id}", h.delete)
}

type apiHandlers struct {
	svc    diagrams.Service
	logger *slog.Logger
}

func (h *apiHandlers) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *apiHandlers) list(w http.ResponseWriter, r *http.Request) {
	metas, err := h.svc.List(r.Context())
	if err != nil {
		h.writeError(w, err)
		return
	}
	if metas == nil {
		metas = []diagrams.DiagramMeta{}
	}
	writeJSON(w, http.StatusOK, metas)
}

func (h *apiHandlers) create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name      string `json:"name"`
		Component bool   `json:"component"`
	}
	if !h.decodeJSON(w, r, &body) {
		return
	}
	d, err := h.svc.Create(r.Context(), body.Name, body.Component)
	if err != nil {
		h.writeError(w, err)
		return
	}
	w.Header().Set("ETag", diagrams.ETag(d))
	writeJSON(w, http.StatusCreated, d)
}

func (h *apiHandlers) get(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	d, err := h.svc.Get(r.Context(), id)
	if err != nil {
		h.writeError(w, err)
		return
	}
	w.Header().Set("ETag", diagrams.ETag(d))
	writeJSON(w, http.StatusOK, d)
}

// updateRequest accepts only fields the client may set. Timestamps and
// CreatedAt are managed server-side and intentionally absent so clients
// can't send empty strings or wrong values.
type updateRequest struct {
	Name     string            `json:"name"`
	Nodes    []diagrams.Node   `json:"nodes"`
	Edges    []diagrams.Edge   `json:"edges"`
	Viewport diagrams.Viewport `json:"viewport"`
}

func (h *apiHandlers) update(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req updateRequest
	if !h.decodeJSON(w, r, &req) {
		return
	}
	d := &diagrams.Diagram{
		ID:       id,
		Name:     req.Name,
		Nodes:    req.Nodes,
		Edges:    req.Edges,
		Viewport: req.Viewport,
	}
	updated, err := h.svc.Update(r.Context(), d, r.Header.Get("If-Match"))
	if err != nil {
		h.writeError(w, err)
		return
	}
	w.Header().Set("ETag", diagrams.ETag(updated))
	writeJSON(w, http.StatusOK, updated)
}

// patch updates diagram metadata: rename (name) and/or library role
// (component). Both fields are optional pointers so callers can send either.
func (h *apiHandlers) rename(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Name      *string `json:"name"`
		Component *bool   `json:"component"`
	}
	if !h.decodeJSON(w, r, &body) {
		return
	}
	var d *diagrams.Diagram
	var err error
	if body.Name != nil {
		if d, err = h.svc.Rename(r.Context(), id, *body.Name); err != nil {
			h.writeError(w, err)
			return
		}
	}
	if body.Component != nil {
		if d, err = h.svc.SetComponent(r.Context(), id, *body.Component); err != nil {
			h.writeError(w, err)
			return
		}
	}
	if d == nil { // nothing to change → return current meta
		if d, err = h.svc.Get(r.Context(), id); err != nil {
			h.writeError(w, err)
			return
		}
	}
	w.Header().Set("ETag", diagrams.ETag(d))
	// Response body remains a lightweight meta so the sidebar can refresh
	// without re-fetching the full diagram.
	writeJSON(w, http.StatusOK, diagrams.NewDiagramMeta(d))
}

func (h *apiHandlers) delete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.svc.Delete(r.Context(), id); err != nil {
		h.writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiHandlers) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storage.ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
	case errors.Is(err, storage.ErrInvalidID):
		http.Error(w, "invalid id", http.StatusBadRequest)
	case errors.Is(err, diagrams.ErrInvalidName),
		errors.Is(err, diagrams.ErrNameTooLong),
		errors.Is(err, diagrams.ErrTooManyNodes),
		errors.Is(err, diagrams.ErrTooManyEdges),
		errors.Is(err, diagrams.ErrLabelTooLong),
		errors.Is(err, diagrams.ErrKindTooLong),
		errors.Is(err, diagrams.ErrEdgeRef):
		http.Error(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, diagrams.ErrConflict):
		http.Error(w, "diagram modified elsewhere", http.StatusPreconditionFailed)
	default:
		h.logger.Error("internal error", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
