package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/MiguelAguiarDEV/diagramer/internal/diagrams"
	mcpserver "github.com/MiguelAguiarDEV/diagramer/internal/mcp"
	"github.com/MiguelAguiarDEV/diagramer/internal/server"
	"github.com/MiguelAguiarDEV/diagramer/internal/storage"
)

// Stamped by GoReleaser via -ldflags "-X main.version=..." at release time.
// Stays "dev" for plain `go build` / `go run` so local work doesn't lie.
var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	// `diagramer --version` short-circuits before any flag parsing so it works
	// regardless of subcommand layout.
	if len(os.Args) == 2 && (os.Args[1] == "--version" || os.Args[1] == "-version" || os.Args[1] == "version") {
		fmt.Printf("diagramer %s (commit %s, built %s)\n", version, commit, date)
		return
	}

	// One-shot CLI subcommands operate directly on the data dir (no server).
	// Anything else (or no args) falls through to running the server.
	if len(os.Args) > 1 {
		if _, ok := cliCommands[os.Args[1]]; ok {
			if err := runCLI(os.Stdout, os.Args[1], os.Args[2:]); err != nil {
				fmt.Fprintln(os.Stderr, "error:", err)
				os.Exit(1)
			}
			return
		}
	}

	addr := flag.String("addr", "127.0.0.1:7777", "listen address (host:port)")
	dataDir := flag.String("data", "./data", "directory where diagrams are stored")
	mcp := flag.Bool("mcp", false, "run as an MCP server over stdio (no HTTP)")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	repo, err := storage.NewJSONFileRepo(*dataDir)
	if err != nil {
		logger.Error("init repository", "err", err)
		os.Exit(1)
	}

	svc := diagrams.NewService(repo)

	if *mcp {
		// MCP mode: stdio carries JSON-RPC, logs stay on stderr.
		ms := mcpserver.New(svc, logger)
		ctx, cancel := signalContext()
		defer cancel()
		if err := ms.Run(ctx); err != nil {
			logger.Error("mcp server error", "err", err)
			os.Exit(1)
		}
		return
	}

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

func signalContext() (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-ch
		cancel()
	}()
	return ctx, cancel
}
