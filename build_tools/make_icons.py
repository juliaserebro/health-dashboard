# Generates the PWA icon set: icon-192.png, icon-512.png, icon-512-maskable.png,
# apple-touch-icon.png (180). Brand: cream bg, italic serif "HC", purple->teal bar.
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "..")
CREAM, INK, PURPLE, TEAL = "#f5f4f0", "#1a1917", "#4a42b0", "#0f7b5f"

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def hx(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))

def make(size, maskable=False, radius_pct=0.22):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Maskable: full-bleed square (OS applies its own mask, needs 20% safe zone).
    # Regular: rounded rect on transparent.
    if maskable:
        d.rectangle([0, 0, size, size], fill=CREAM)
    else:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_pct), fill=CREAM)
    # Content scale: shrink into the safe zone for maskable
    s = 0.72 if maskable else 0.92
    cx = size / 2
    # "HC" in italic Georgia
    fsize = int(size * 0.42 * s)
    font = None
    for path in [r"C:\Windows\Fonts\georgiai.ttf", r"C:\Windows\Fonts\georgia.ttf",
                 "/System/Library/Fonts/Supplemental/Georgia Italic.ttf"]:
        if os.path.exists(path):
            font = ImageFont.truetype(path, fsize)
            break
    if font is None:
        font = ImageFont.load_default(fsize)
    bbox = d.textbbox((0, 0), "HC", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    ty = size * 0.44 - th / 2 - bbox[1]
    d.text((cx - tw / 2 - bbox[0], ty), "HC", font=font, fill=INK)
    # Gradient bar under the text
    bar_w, bar_h = int(size * 0.46 * s), max(3, int(size * 0.045))
    bx, by = int(cx - bar_w / 2), int(size * 0.66)
    p, t2 = hx(PURPLE), hx(TEAL)
    for i in range(bar_w):
        col = lerp(p, t2, i / bar_w)
        d.rectangle([bx + i, by, bx + i + 1, by + bar_h], fill=col + (255,))
    return img

make(192).save(os.path.join(OUT, "icon-192.png"))
make(512).save(os.path.join(OUT, "icon-512.png"))
make(512, maskable=True).save(os.path.join(OUT, "icon-512-maskable.png"))
# apple-touch-icon: no transparency, iOS rounds it itself
apple = Image.new("RGB", (180, 180), CREAM)
apple.paste(make(180, maskable=True).convert("RGB"), (0, 0))
apple.save(os.path.join(OUT, "apple-touch-icon.png"))
print("icons written")
