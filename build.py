#!/usr/bin/env python3
"""
Build script: dashboard.jsx -> index.html
- Validates JS syntax (node --check)
- Precompiles JSX to plain JS via build_tools/transpile.js (babel-standalone
  under Node) so the shipped page has NO runtime Babel -> fast, app-like launch.
  Falls back to the old in-browser Babel mode if the transpile step fails.
- Stamps sw.js CACHE_VERSION with the build time so every deploy purges old
  caches and updates propagate without a manual cache clear.
Run: python3 build.py
"""
import subprocess, sys, time, re, tempfile, os

with open("dashboard.jsx", encoding="utf-8") as f:
    jsx = f.read()

# Validate JS syntax first
tmp = tempfile.NamedTemporaryFile(suffix=".js", delete=False, mode="w", encoding="utf-8")
tmp.write(jsx); tmp.close()
r = subprocess.run(["node", "--check", tmp.name], capture_output=True, text=True)
os.unlink(tmp.name)
if r.returncode != 0:
    print("BUILD FAILED - JS syntax error:")
    print(r.stderr)
    sys.exit(1)

jsx_clean = jsx.replace(
    'import { useState, useEffect, useRef, useCallback } from "react";',
    '// React loaded via CDN'
).replace('export default function App()', 'function App()')

if 'export default' in jsx_clean:
    print("BUILD FAILED - 'export default' found in built code")
    sys.exit(1)

full_src = ("const { useState, useEffect, useRef, useCallback } = React;\n\n"
            + jsx_clean +
            "\n\nconst root = ReactDOM.createRoot(document.getElementById('root'));\n"
            "root.render(<App />);\n")

# ── Precompile JSX -> plain JS ────────────────────────────────────────────────
compiled = None
try:
    src_tmp = tempfile.NamedTemporaryFile(suffix=".jsx", delete=False, mode="w", encoding="utf-8")
    src_tmp.write(full_src); src_tmp.close()
    out_path = src_tmp.name + ".out.js"
    tr = subprocess.run(["node", os.path.join("build_tools", "transpile.js"), src_tmp.name, out_path],
                        capture_output=True, text=True, timeout=120)
    if tr.returncode == 0 and os.path.exists(out_path):
        with open(out_path, encoding="utf-8") as f:
            compiled = f.read()
        os.unlink(out_path)
    else:
        print("WARN: transpile failed, falling back to runtime Babel:", tr.stderr[:300])
    os.unlink(src_tmp.name)
except Exception as e:
    print("WARN: transpile step errored, falling back to runtime Babel:", e)

if compiled:
    babel_cdn = ""
    script_block = "<script>\n" + compiled + "\n</script>"
    mode = "precompiled"
else:
    babel_cdn = '<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js"></script>\n'
    script_block = '<script type="text/babel">\n' + full_src + "\n</script>"
    mode = "runtime-babel"

html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover">
<title>Health Coach</title>
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#f5f4f0">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Health Coach">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,400;1,600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
""" + babel_cdn + """<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, sans-serif; background: #f5f4f0;
       padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);
       padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
</style>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-VH9YNK5TPT"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-VH9YNK5TPT');
</script>
</head>
<body>
<div id="root"></div>
""" + script_block + """
<script>
// PWA: register the service worker (relative path -> scope = this directory).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('sw.js').catch(function(e){ console.log('SW register failed:', e.message); });
  });
}
</script>
</body>
</html>"""

with open("index.html", "w", encoding="utf-8") as f:
    f.write(html)

# ── Stamp sw.js cache version so deploys invalidate old shells ───────────────
try:
    with open("sw.js", encoding="utf-8") as f:
        sw = f.read()
    version = "hc-" + time.strftime("%Y%m%d-%H%M%S")
    sw = re.sub(r'const CACHE_VERSION = "[^"]*"', 'const CACHE_VERSION = "%s"' % version, sw, count=1)
    with open("sw.js", "w", encoding="utf-8") as f:
        f.write(sw)
    print("sw.js CACHE_VERSION -> " + version)
except Exception as e:
    print("WARN: could not stamp sw.js:", e)

kb = round(len(html.encode()) / 1024, 1)
print("Built index.html (%s KB, %s)" % (kb, mode))
print("Next: run python3 qa_check.py to verify before deploying")
