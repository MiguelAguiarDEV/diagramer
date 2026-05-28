package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/MiguelAguiarDEV/diagramer/internal/diagrams"
	"github.com/MiguelAguiarDEV/diagramer/internal/storage"
)

// cliCommands are the one-shot subcommands that operate directly on the data
// directory (no server). Anything else falls through to the server flags.
var cliCommands = map[string]string{
	"list":   "list diagrams (id, name, counts)",
	"get":    "print a diagram as JSON: get <id>",
	"create": "create a diagram, print its id: create <name>",
	"delete": "delete a diagram: delete <id>",
	"layout": "auto-layout (tidy) a diagram: layout <id>",
	"export": "write a diagram's JSON to a file or stdout: export <id> [path]",
}

// runCLI executes a subcommand against the on-disk repo. It returns errors
// (rather than exiting) and writes to `out` so it can be unit-tested.
func runCLI(out io.Writer, cmd string, args []string) error {
	fs := flag.NewFlagSet("diagramer "+cmd, flag.ContinueOnError)
	fs.SetOutput(out)
	dataDir := fs.String("data", "./data", "directory where diagrams are stored")
	if err := fs.Parse(args); err != nil {
		return err
	}
	rest := fs.Args()
	arg := func(i int, name string) (string, error) {
		if i >= len(rest) {
			return "", fmt.Errorf("%s: missing <%s>", cmd, name)
		}
		return rest[i], nil
	}

	repo, err := storage.NewJSONFileRepo(*dataDir)
	if err != nil {
		return err
	}
	svc := diagrams.NewService(repo)
	ctx := context.Background()

	switch cmd {
	case "list":
		metas, err := svc.List(ctx)
		if err != nil {
			return err
		}
		for _, m := range metas {
			kind := "diagram"
			if m.Component {
				kind = "component"
			}
			fmt.Fprintf(out, "%s\t%-30s\t%dn/%de\t%s\n", m.ID, m.Name, m.NodeCount, m.EdgeCount, kind)
		}
		return nil

	case "get":
		id, err := arg(0, "id")
		if err != nil {
			return err
		}
		d, err := svc.Get(ctx, id)
		if err != nil {
			return err
		}
		return writeJSONIndent(out, d)

	case "create":
		name, err := arg(0, "name")
		if err != nil {
			return err
		}
		d, err := svc.Create(ctx, name, false)
		if err != nil {
			return err
		}
		fmt.Fprintln(out, d.ID)
		return nil

	case "delete":
		id, err := arg(0, "id")
		if err != nil {
			return err
		}
		if err := svc.Delete(ctx, id); err != nil {
			return err
		}
		fmt.Fprintln(out, "deleted", id)
		return nil

	case "layout":
		id, err := arg(0, "id")
		if err != nil {
			return err
		}
		if _, err := svc.AutoLayout(ctx, id); err != nil {
			return err
		}
		fmt.Fprintln(out, "laid out", id)
		return nil

	case "export":
		id, err := arg(0, "id")
		if err != nil {
			return err
		}
		d, err := svc.Get(ctx, id)
		if err != nil {
			return err
		}
		b, err := json.MarshalIndent(d, "", "  ")
		if err != nil {
			return err
		}
		if len(rest) >= 2 {
			if err := os.WriteFile(rest[1], b, 0o644); err != nil {
				return err
			}
			fmt.Fprintln(out, "wrote", rest[1])
			return nil
		}
		out.Write(b)
		fmt.Fprintln(out)
		return nil
	}
	return fmt.Errorf("unknown command %q", cmd)
}

func writeJSONIndent(out io.Writer, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	out.Write(b)
	fmt.Fprintln(out)
	return nil
}
