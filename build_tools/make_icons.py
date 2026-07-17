# Generates the PWA icon set from the Health Coach logo design:
# cream bg, thin connecting web, six colored nodes, white centre with green ring.
# (Text-free version of the full logo — legible at small sizes.)
# Outputs: icon-192.png, icon-512.png, icon-512-maskable.png, apple-touch-icon.png
from PIL import Image, ImageDraw
import math, os

OUT = os.path.join(os.path.dirname(__file__), "..")
CREAM = (245, 244, 240)
LINE = (176, 174, 168)
RING = (90, 125, 79)      # green ring
NODES = [                  # clockwise from top, sampled from the logo
    (224, 168, 63),        # amber (nutrition)
    (123, 42, 98),         # plum (training)
    (139, 163, 189),       # blue-grey (sleep)
    (217, 125, 146),       # rose (cycle)
    (191, 91, 50),         # terracotta (log)
    (155, 139, 184),       # lavender (supplements)
]

def draw_logo(size, maskable=False):
    S = 4  # supersample for antialiasing
    W = size * S
    img = Image.new("RGBA", (W, W), CREAM if maskable else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not maskable:
        d.rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.22), fill=CREAM)
    # Content scale: maskable needs a ~20% safe zone
    s = 0.80 if maskable else 1.0
    cx = cy = W / 2
    Rorbit = W * 0.36 * s           # node orbit radius
    rnode = W * 0.125 * s           # node radius
    Rcentre = W * 0.215 * s         # centre circle radius
    lw = max(2, int(W * 0.004))

    # Web: orbit circle + node-to-node chords + spokes to centre
    pts = []
    for i in range(6):
        a = -math.pi / 2 + i * math.pi / 3
        pts.append((cx + Rorbit * math.cos(a), cy + Rorbit * math.sin(a)))
    d.ellipse([cx - Rorbit, cy - Rorbit, cx + Rorbit, cy + Rorbit], outline=LINE, width=lw)
    for i in range(6):
        for j in range(i + 1, 6):
            d.line([pts[i], pts[j]], fill=LINE, width=lw)
    # Centre: white circle with green ring
    ringw = max(3, int(W * 0.016))
    d.ellipse([cx - Rcentre - ringw, cy - Rcentre - ringw, cx + Rcentre + ringw, cy + Rcentre + ringw], fill=RING)
    d.ellipse([cx - Rcentre, cy - Rcentre, cx + Rcentre, cy + Rcentre], fill=(255, 255, 255))
    # Nodes on top
    for (x, y), col in zip(pts, NODES):
        d.ellipse([x - rnode, y - rnode, x + rnode, y + rnode], fill=col)
        d.ellipse([x - rnode, y - rnode, x + rnode, y + rnode], outline=(255, 255, 255), width=max(2, int(W * 0.006)))
    return img.resize((size, size), Image.LANCZOS)

draw_logo(192).save(os.path.join(OUT, "icon-192.png"))
draw_logo(512).save(os.path.join(OUT, "icon-512.png"))
draw_logo(512, maskable=True).save(os.path.join(OUT, "icon-512-maskable.png"))
draw_logo(180, maskable=True).convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"))
print("icons written")
