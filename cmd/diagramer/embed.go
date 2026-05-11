package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:web
var frontendFS embed.FS

// staticHandler serves the embedded frontend. Unknown paths fall back to
// index.html so client-side deep links like /d/{id} resolve to the SPA.
func staticHandler() http.Handler {
	sub, err := fs.Sub(frontendFS, "web")
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "frontend assets missing in this build", http.StatusInternalServerError)
		})
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			fileServer.ServeHTTP(w, r)
			return
		}
		if _, err := fs.Stat(sub, path); err != nil {
			// Not a real asset → serve index.html so the SPA can route.
			r2 := *r
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, &r2)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}
