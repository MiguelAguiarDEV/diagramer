package server

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/MiguelAguiarDEV/diagramer/internal/diagrams"
)

// Server wraps an http.Server with lifecycle methods.
type Server interface {
	Start() error
	Stop(ctx context.Context) error
}

type httpServer struct {
	srv    *http.Server
	logger *slog.Logger
}

// New constructs an HTTP server bound to addr that serves the diagram API
// and (optionally) embedded frontend assets via assets.
//
// assets may be nil during early phases; the server then renders a minimal
// placeholder page at "/".
func New(addr string, svc diagrams.Service, assets http.Handler, logger *slog.Logger) Server {
	if logger == nil {
		logger = slog.Default()
	}

	mux := http.NewServeMux()
	registerAPIRoutes(mux, svc, logger)

	if assets != nil {
		mux.Handle("/", assets)
	} else {
		mux.HandleFunc("/", placeholderHandler)
	}

	return &httpServer{
		srv: &http.Server{
			Addr:              addr,
			Handler:           withLogging(mux, logger),
			ReadHeaderTimeout: 5 * time.Second,
		},
		logger: logger,
	}
}

func (s *httpServer) Start() error {
	s.logger.Info("listening", "addr", s.srv.Addr)
	if err := s.srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func (s *httpServer) Stop(ctx context.Context) error {
	return s.srv.Shutdown(ctx)
}

func withLogging(next http.Handler, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rw, r)
		logger.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status,
			"dur_ms", time.Since(start).Milliseconds(),
		)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func placeholderHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(`<!doctype html><html><head><meta charset="utf-8"><title>diagramer</title>
<style>body{font-family:system-ui;margin:0;padding:2rem;background:#0b0b0d;color:#e5e7eb}
code{background:#1f2937;padding:.15rem .35rem;border-radius:3px}</style></head>
<body><h1>diagramer</h1>
<p>Backend running. Frontend not yet embedded.</p>
<p>API: <code>/api/diagrams</code> · Health: <code>/api/health</code></p>
</body></html>`))
}
