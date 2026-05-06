package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:web-dist
var frontendFS embed.FS

// staticHandler serves the embedded SPA, falling back to index.html for
// unknown paths so client-side routing works.
func staticHandler() http.Handler {
	sub, err := fs.Sub(frontendFS, "web-dist")
	if err != nil {
		// Fallback: tiny placeholder so the binary still runs without an embed.
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "frontend assets missing in this build", http.StatusInternalServerError)
		})
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// API routes are handled by mux upstream; static handler only sees "/" tree.
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		// If the requested file does not exist in the embedded FS,
		// serve index.html so the SPA can handle the route.
		if _, err := fs.Stat(sub, path); err != nil {
			r2 := *r
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, &r2)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}
