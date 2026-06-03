#!/usr/bin/env python3
"""Render README.md as a GitHub-styled HTML preview."""
import re
import sys
from pathlib import Path
import markdown

ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "README.md").read_text()

# python-markdown leaves raw HTML blocks alone, so anything inside
# <div align="center">…</div> stays unprocessed. Annotate those wrapper divs
# with markdown="1" (md_in_html extension) so their *contents* get rendered.
src = re.sub(r'<div\s+align="center">', '<div align="center" markdown="1">', src)
# Same trick for <table>…</table> cells written in HTML — they often contain
# markdown blurbs after the <img>.
src = src.replace("<td width=\"50%\" valign=\"top\">",
                  "<td width=\"50%\" valign=\"top\" markdown=\"1\">")
src = src.replace("<details>", "<details markdown=\"1\" open>")

body = markdown.markdown(
    src,
    extensions=["tables", "fenced_code", "toc", "sane_lists", "md_in_html"],
    output_format="html5",
)

# Subset of github-markdown-css inlined so the file is self-contained.
GH_CSS = """
:root {
  --bg: #ffffff;
  --fg: #1f2328;
  --muted: #59636e;
  --border: #d1d9e0;
  --code-bg: #f6f8fa;
  --link: #0969da;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
               Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.55;
  color: var(--fg);
  background: #ebedef;
}
.frame {
  max-width: 1012px;
  margin: 24px auto;
  padding: 56px 64px 72px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
h1, h2, h3, h4 { line-height: 1.25; margin-top: 28px; margin-bottom: 16px; font-weight: 600; }
h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid var(--border); }
h2 { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid var(--border); }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
p, ul, ol, blockquote, table, pre { margin-top: 0; margin-bottom: 16px; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
hr { border: 0; border-top: 1px solid var(--border); margin: 28px 0; }
code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 85%;
  background: rgba(175,184,193,0.2);
  padding: .2em .4em;
  border-radius: 6px;
}
pre {
  background: var(--code-bg);
  padding: 16px;
  border-radius: 6px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
}
pre code { background: transparent; padding: 0; font-size: 100%; }
blockquote {
  padding: 0 1em;
  color: var(--muted);
  border-left: .25em solid var(--border);
  margin-left: 0;
}
table { border-collapse: collapse; display: block; max-width: 100%; overflow: auto; }
table th, table td { padding: 8px 13px; border: 1px solid var(--border); vertical-align: top; }
table tr { background: #fff; border-top: 1px solid var(--border); }
table tr:nth-child(2n) { background: #f6f8fa; }
ul, ol { padding-left: 2em; }
img { max-width: 100%; height: auto; border-radius: 6px; }
details { padding: 14px 18px; border: 1px solid var(--border); border-radius: 6px; background: #f6f8fa; }
details summary { cursor: pointer; font-weight: 600; }
details > *:not(summary) { margin-top: 14px; }
sub { color: var(--muted); }
div[align="center"] { text-align: center; }
div[align="center"] img { margin: 14px auto; display: inline-block; }
div[align="center"] p { display: inline; }
/* Badges in the hero render as inline link-images */
div[align="center"] a { display: inline-block; margin: 2px 3px; }
div[align="center"] a img { display: inline-block; vertical-align: middle; margin: 0; }
"""

html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>README preview — diagramer</title>
<style>{GH_CSS}</style>
</head>
<body>
<article class="frame markdown-body">
{body}
</article>
</body>
</html>
"""

# Render at the repo root so relative paths like docs/media/demo.gif resolve.
out = ROOT / "readme-preview.html"
out.write_text(html)
print(out)
