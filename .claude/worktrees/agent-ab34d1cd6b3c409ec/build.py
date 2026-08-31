#!/usr/bin/env python3
"""
Build script: dashboard.jsx → index.html
Run: python3 build.py
"""
import subprocess, sys

with open("dashboard.jsx", encoding="utf-8") as f:
    jsx = f.read()

# Validate JS syntax first
import tempfile, os
tmp = tempfile.NamedTemporaryFile(suffix=".js", delete=False, mode="w", encoding="utf-8")
tmp.write(jsx); tmp.close()
r = subprocess.run(["node","--check",tmp.name], capture_output=True, text=True)
os.unlink(tmp.name)
if r.returncode != 0:
    print("❌ JS syntax error — aborting build:")
    print(r.stderr)
    sys.exit(1)

# Transform JSX for browser
jsx_clean = jsx.replace(
    'import { useState, useEffect, useRef, useCallback } from "react";',
    '// React loaded via CDN'
).replace('export default function App()', 'function App()')

if 'export default' in jsx_clean:
    print("❌ 'export default' found in built code — aborting")
    sys.exit(1)

html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>Health Coach</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,400;1,600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js"></script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, sans-serif; background: #f5f4f0; }
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
<script type="text/babel">
const { useState, useEffect, useRef, useCallback } = React;

""" + jsx_clean + """

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
</script>
</body>
</html>"""

with open("index.html","w",encoding="utf-8") as f:
    f.write(html)

kb = round(len(html.encode())/1024,1)
print(f"✅ Built index.html ({kb} KB)")
print("Next: run python3 qa_check.py to verify before deploying")
