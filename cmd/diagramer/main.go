package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/MiguelAguiarDEV/diagramer/internal/diagrams"
	"github.com/MiguelAguiarDEV/diagramer/internal/server"
	"github.com/MiguelAguiarDEV/diagramer/internal/storage"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:7777", "listen address (host:port)")
	dataDir := flag.String("data", "./data", "directory where diagrams are stored")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	repo, err := storage.NewJSONFileRepo(*dataDir)
	if err != nil {
		logger.Error("init repository", "err", err)
		os.Exit(1)
	}

	svc := diagrams.NewService(repo)

	srv := server.New(*addr, svc, staticHandler(), logger)

	go func() {
		if err := srv.Start(); err != nil {
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
	if err := srv.Stop(ctx); err != nil {
		logger.Error("shutdown error", "err", err)
	}
}
