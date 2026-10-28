"""Compose docs/media/hero.png from a real gameplay frame (still-omo.png).

still-omo.png is an untouched frame of Omo in the Omo Space Batcave from the
27 October 2026 stream, cropped above the face cam. This script only crops it,
warms it into the omo.sh palette and sets the type.
Fonts: Crimson Text + IBM Plex Mono (SIL OFL). Run from the repo root:
    python3 docs/media/make_hero.py [path/to/fonts] [path/to/omo-mark.png]
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFont

HERE = Path(__file__).resolve().parent
FONTS = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "fonts"
MARK = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "omo-icon.png"

CREAM = (245, 240, 232)
INK = (26, 16, 8)
BROWN = (74, 59, 47)
LINE = (212, 205, 192)
SAND = (196, 184, 168)
ORANGE = (226, 104, 36)

W, H = 2400, 960


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def main():
    img = Image.new("RGB", (W, H), CREAM)

    # Real frame: Omo and his name tag, scaled to the banner height.
    src = Image.open(HERE / "still-omo.png").convert("RGB")
    rh = H
    rw = round(src.width * rh / src.height)
    shot = src.resize((rw, rh), Image.LANCZOS)
    # The Batcave is dark: lift it a little and warm it towards the paper.
    shot = ImageEnhance.Brightness(shot).enhance(1.25)
    shot = ImageChops.multiply(shot, Image.new("RGB", shot.size, (255, 244, 228)))

    x0 = W - rw
    mask = Image.new("L", shot.size, 255)
    md = ImageDraw.Draw(mask)
    fade = 360
    for x in range(fade):
        t = x / fade
        md.line([(x, 0), (x, rh)], fill=round(255 * (t * t * (3 - 2 * t))))
    img.paste(shot, (x0, 0), mask)

    d = ImageDraw.Draw(img)
    lx = 150

    eb = font("IBMPlexMono-Medium.ttf", 34)
    label = "OMO RESEARCH  ·  BROUGHT TO LIFE"
    tw = d.textlength(label, font=eb)
    d.rounded_rectangle((lx - 4, 168, lx + tw + 44, 228), radius=30, fill=INK)
    d.text((lx + 20, 178), label, font=eb, fill=CREAM)

    serif = font("CrimsonText-SemiBold.ttf", 132)
    d.text((lx, 262), "Talk to him.", font=serif, fill=INK)
    d.text((lx, 400), "He's in your world.", font=serif, fill=INK)

    d.text((lx, 566), "A voice, a Hermes brain and a real player body.",
           font=font("CrimsonText-Italic.ttf", 54), fill=BROWN)

    d.rectangle((lx, 668, lx + 120, 673), fill=ORANGE)
    mono = font("IBMPlexMono-Regular.ttf", 34)
    d.text((lx, 702), "GPT-Live  ·  Hermes Agent  ·  Mineflayer  ·  MC 26.2",
           font=mono, fill=INK)

    fy = 840
    if MARK and MARK.exists():
        m = Image.open(MARK).convert("RGBA").resize((64, 64), Image.LANCZOS)
        img.paste(m, (lx, fy - 14), m)
        tx = lx + 84
    else:
        tx = lx
    d.text((tx, fy), "omo.sh", font=font("IBMPlexMono-Medium.ttf", 32), fill=BROWN)

    d.rectangle((0, 0, W - 1, H - 1), outline=LINE, width=4)

    out = img.resize((W // 3 * 2, H // 3 * 2), Image.LANCZOS)  # 1600 x 640
    out.save(HERE / "hero.png", optimize=True)
    print("wrote", HERE / "hero.png", out.size)


if __name__ == "__main__":
    main()
