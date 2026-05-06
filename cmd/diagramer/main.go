package main

import (
	"context"
	"errors"
	"flag"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:7777", "listen address")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(indexHTML))
	})

	srv := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("listening", "addr", *addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	logger.Info("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("shutdown error", "err", err)
	}
}

// staticFS will be wired in Fase 6 to serve the embedded frontend.
// For Fase 0, we serve a minimal placeholder so the binary stands alone.
var _ fs.FS = (fs.FS)(nil)

const indexHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>diagramer</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 2rem; background: #0b0b0d; color: #e5e7eb; }
  h1 { margin: 0 0 .5rem; font-size: 1.4rem; }
  p  { margin: 0; color: #9ca3af; }
  code { background: #1f2937; padding: .15rem .35rem; border-radius: 3px; }
</style>
</head>
<body>
  <h1>diagramer</h1>
  <p>Phase 0 OK. Backend serving on this port. Frontend will be embedded in Phase 6.</p>
  <p style="margin-top:1rem">Health: <code>/api/health</code></p>
</body>
</html>`
