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
// or malicious oversized payloads. 1 MiB comfortably fits diagrams up to the
// service-level node/edge caps.
const maxBodyBytes = 1 << 20

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
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	d, err := h.svc.Create(r.Context(), body.Name)
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
	Name     string             `json:"name"`
	Nodes    []diagrams.Node    `json:"nodes"`
	Edges    []diagrams.Edge    `json:"edges"`
	Viewport diagrams.Viewport  `json:"viewport"`
}

func (h *apiHandlers) update(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	var req updateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
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

func (h *apiHandlers) rename(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	d, err := h.svc.Rename(r.Context(), id, body.Name)
	if err != nil {
		h.writeError(w, err)
		return
	}
	w.Header().Set("ETag", diagrams.ETag(d))
	// Response body remains a lightweight meta so the sidebar can refresh
	// without re-fetching the full diagram.
	m := diagrams.NewDiagramMeta(d)
	writeJSON(w, http.StatusOK, m)
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
