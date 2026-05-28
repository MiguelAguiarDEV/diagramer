package diagrams

import "math"

// Layout constants mirror the frontend (cmd/diagramer/web/app.js) so the
// server-side auto-layout produces a result consistent with the browser's
// "Tidy up". Text width can't be measured server-side, so estimateNodeSize
// approximates it; the layered placement itself matches tidyUp exactly.
const (
	layoutNodeH    = 44.0
	layoutNodePadX = 20.0
	layoutNodeMinW = 80.0
	layoutNodeMaxW = 320.0
	layoutIconSize = 20.0
	layoutIconGap  = 6.0
	layoutGapX     = 80.0
	layoutGapY     = 30.0
	// avgCharW approximates the width of a glyph in the 13px system font the UI
	// uses. The browser measures exactly; this estimate only affects column
	// spacing, so a slight over-estimate is safe (text never clips).
	avgCharW = 7.0
)

var stencilKinds = map[string]struct{}{
	"database": {}, "backend": {}, "frontend": {},
	"queue": {}, "cache": {}, "user": {}, "cloud": {},
}

func shapeOf(kind string) string {
	switch kind {
	case "circle", "ellipse", "rhombus", "tri-up", "tri-down":
		return kind
	default:
		return "rect"
	}
}

func clamp(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}

// estimateNodeSize approximates the bbox a node occupies, mirroring nodeSize()
// in app.js. Width is estimated from the label length since we can't measure
// text on the server.
func estimateNodeSize(n Node) (w, h float64) {
	label := n.Data.Label
	tw := 0.0
	if label != "" {
		tw = float64(len([]rune(label))) * avgCharW
	}
	iconW := 0.0
	if _, ok := stencilKinds[n.Kind]; ok {
		iconW = layoutIconSize + layoutIconGap
	}

	// Icon-only nodes collapse to a tight square.
	if label == "" && iconW > 0 {
		return layoutNodeH, layoutNodeH
	}

	innerW := tw + iconW + layoutNodePadX*2 + 8
	switch shapeOf(n.Kind) {
	case "circle", "rhombus":
		d := clamp(math.Max(innerW+16, layoutNodeH+8), 0, layoutNodeMaxW)
		w, h = d, d
	case "tri-up", "tri-down":
		s := clamp(math.Max(innerW*1.6+8, layoutNodeH*2), 0, layoutNodeMaxW)
		w, h = s, s*(math.Sqrt(3)/2)
	case "ellipse":
		w = clamp(math.Max(innerW+24, layoutNodeMinW), 0, layoutNodeMaxW)
		h = layoutNodeH
	default: // rect
		w = clamp(math.Max(innerW, layoutNodeMinW), 0, layoutNodeMaxW)
		h = layoutNodeH
	}

	// Containers reserve a minimum footprint for their minimap + ports.
	if n.Data.SubdiagramID != "" {
		w = math.Max(w, 132)
		h = math.Max(h, 84)
	}
	return math.Ceil(w), math.Ceil(h)
}

// AutoLayout repositions a diagram's nodes into tidy left-to-right columns by
// dependency depth, the same layered algorithm as the frontend's "Tidy up".
// It mutates node positions in place and reports whether anything moved.
func AutoLayout(d *Diagram) bool {
	if d == nil || len(d.Nodes) == 0 {
		return false
	}

	byID := make(map[string]struct{}, len(d.Nodes))
	for i := range d.Nodes {
		byID[d.Nodes[i].ID] = struct{}{}
	}
	inAdj := make(map[string]int, len(d.Nodes))
	outAdj := make(map[string][]string, len(d.Nodes))
	for i := range d.Nodes {
		inAdj[d.Nodes[i].ID] = 0
		outAdj[d.Nodes[i].ID] = nil
	}
	for _, e := range d.Edges {
		_, okS := byID[e.Source]
		_, okT := byID[e.Target]
		if okS && okT {
			outAdj[e.Source] = append(outAdj[e.Source], e.Target)
			inAdj[e.Target]++
		}
	}

	// Longest-path level assignment: roots (in-degree 0) at level 0, each edge
	// pushes its target at least one column right.
	level := make(map[string]int, len(d.Nodes))
	queue := make([]string, 0, len(d.Nodes))
	for i := range d.Nodes {
		id := d.Nodes[i].ID
		if inAdj[id] == 0 {
			level[id] = 0
			queue = append(queue, id)
		}
	}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		next := level[id] + 1
		for _, tgt := range outAdj[id] {
			if cur, ok := level[tgt]; !ok || cur < next {
				level[tgt] = next
				queue = append(queue, tgt)
			}
		}
	}
	// Anything left (pure cycles) → level 0.
	for i := range d.Nodes {
		if _, ok := level[d.Nodes[i].ID]; !ok {
			level[d.Nodes[i].ID] = 0
		}
	}

	// Group node indices by column, preserving slice order for determinism.
	cols := map[int][]int{}
	maxLevel := 0
	for i := range d.Nodes {
		lvl := level[d.Nodes[i].ID]
		cols[lvl] = append(cols[lvl], i)
		if lvl > maxLevel {
			maxLevel = lvl
		}
	}

	cursorX := 0.0
	for lvl := 0; lvl <= maxLevel; lvl++ {
		colNodes := cols[lvl]
		if len(colNodes) == 0 {
			continue
		}
		sizes := make([][2]float64, len(colNodes))
		colW := 0.0
		totalH := layoutGapY * float64(len(colNodes)-1)
		for j, idx := range colNodes {
			w, h := estimateNodeSize(d.Nodes[idx])
			sizes[j] = [2]float64{w, h}
			totalH += h
			if w > colW {
				colW = w
			}
		}
		cursorY := -totalH / 2
		for j, idx := range colNodes {
			w, h := sizes[j][0], sizes[j][1]
			d.Nodes[idx].Position.X = cursorX + (colW-w)/2
			d.Nodes[idx].Position.Y = cursorY
			cursorY += h + layoutGapY
		}
		cursorX += colW + layoutGapX
	}
	return true
}

// AutoPlace returns a position for a new node so it lands beside existing
// content instead of overlapping it: just right of the current bounding box,
// vertically centered. An empty diagram places at the origin.
func AutoPlace(d *Diagram) Position {
	if d == nil || len(d.Nodes) == 0 {
		return Position{X: 0, Y: 0}
	}
	maxRight := math.Inf(-1)
	minY, maxY := math.Inf(1), math.Inf(-1)
	for i := range d.Nodes {
		w, h := estimateNodeSize(d.Nodes[i])
		x := d.Nodes[i].Position.X
		y := d.Nodes[i].Position.Y
		if x+w > maxRight {
			maxRight = x + w
		}
		if y < minY {
			minY = y
		}
		if y+h > maxY {
			maxY = y + h
		}
	}
	return Position{X: maxRight + layoutGapX, Y: (minY + maxY) / 2}
}
