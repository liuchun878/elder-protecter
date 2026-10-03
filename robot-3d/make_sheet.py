# -*- coding: utf-8 -*-
"""把 shots/ 里的渲染图拼成一张总览图 preview/00-总览九宫格.png（便于一眼核对）。"""
import os
import re

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
OUTDIR = os.path.join(HERE, "preview")
CELL = (330, 368)
COLS = 4

files = sorted(f for f in os.listdir(SHOTS) if re.match(r"^\d\d-.*\.png$", f))
os.makedirs(OUTDIR, exist_ok=True)
rows = (len(files) + COLS - 1) // COLS
sheet = Image.new("RGB", (CELL[0] * COLS, CELL[1] * rows + 34 * rows), (24, 26, 28))
d = ImageDraw.Draw(sheet)
try:
    from PIL import ImageFont
    font = ImageFont.load_default(size=18)
except Exception:
    font = None
for i, f in enumerate(files):
    im = Image.open(os.path.join(SHOTS, f)).convert("RGB")
    im.thumbnail((CELL[0] - 10, CELL[1] - 10), Image.LANCZOS)
    cx, cy = (i % COLS) * CELL[0], (i // COLS) * (CELL[1] + 34)
    sheet.paste(im, (cx + (CELL[0] - im.width) // 2, cy + 30 + (CELL[1] - im.height) // 2))
    d.text((cx + 10, cy + 6), f[:-4], fill=(232, 232, 228), font=font)
out = os.path.join(OUTDIR, "00-总览.png")
sheet.save(out)
print("写了", out, sheet.size, "共", len(files), "张")
