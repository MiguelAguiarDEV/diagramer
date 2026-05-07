package main

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed all:web
var frontendFS embed.FS

// staticHandler serves the embedded frontend (index.html, app.js, style.css).
func staticHandler() http.Handler {
	sub, err := fs.Sub(frontendFS, "web")
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "frontend assets missing in this build", http.StatusInternalServerError)
		})
	}
	return http.FileServer(http.FS(sub))
}
