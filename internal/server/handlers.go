package server

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/MiguelAguiarDEV/diagramer/internal/diagrams"
	"github.com/MiguelAguiarDEV/diagramer/internal/storage"
)

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
	writeJSON(w, http.StatusCreated, d)
}

func (h *apiHandlers) get(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	d, err := h.svc.Get(r.Context(), id)
	if err != nil {
		h.writeError(w, err)
		return
	}
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
	updated, err := h.svc.Update(r.Context(), d)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *apiHandlers) rename(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	m, err := h.svc.Rename(r.Context(), id, body.Name)
	if err != nil {
		h.writeError(w, err)
		return
	}
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
	case errors.Is(err, diagrams.ErrInvalidName):
		http.Error(w, "invalid name", http.StatusBadRequest)
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
