#!/usr/bin/env python3
"""
Renders the required verification grid: a bright checkerboard circular
"photo" composited with Solar Frame (reference) and every newly added SVG
frame, all at identical dimensions. Used to visually confirm the checkerboard
is fully visible to its circular edge and each frame touches that edge from
outside only (zero overlap, zero gap).

Solar Frame itself is not an SVG asset (Avatar.tsx draws it as a plain CSS
border: 3px solid #ffd700 directly on the photo container), so for this
side-by-side visual reference we synthesize an equivalent thin-ring SVG
(radius = 100 + 3/2 = 101.5, stroke-width 3, color #ffd700) purely for this
comparison image -- Solar Frame's actual source (Avatar.tsx) is untouched.

Output: verification_grid.png in the project root's _pixel_validation_render/
directory (gitignored).
"""
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRAMES_DIR = PROJECT_ROOT / "src" / "assets" / "frames"
OUT_DIR = PROJECT_ROOT / "_pixel_validation_render"
OUT_DIR.mkdir(exist_ok=True)

SCALE = 4.0  # px per svg unit for the grid (smaller than the validator's 10x -- this is just for visual output)
DENSITY = int(96 * SCALE)
CANVAS_PX = int(240 * SCALE)  # 960
VB_MINX, VB_MINY = -20.0, -20.0
CENTER_PX = int((100 - VB_MINX) * SCALE)  # pixel coords of photo center
PHOTO_RADIUS_PX = int(100 * SCALE)

SOLAR_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 240 240">
<circle cx="100" cy="100" r="101.5" fill="none" stroke="#ffd700" stroke-width="3"/>
</svg>"""

FRAMES = [
    ("Solar Frame (reference)", None),  # synthesized above
    ("Bahrain Ring", "frame_bahrain.svg"),
    ("Pastel Dream Ring (Cute & Cozy)", "frame_cute_cozy.svg"),
    ("Neon Circuit Ring (Cyberpunk)", "frame_cyberpunk.svg"),
    ("Ember Ring (Fire Elemental)", "frame_fire_elemental.svg"),
    ("Dragon Scale Ring (Mythic Realm)", "frame_mythic_realm.svg"),
    ("Forest Vine Ring (Nature & Weather)", "frame_nature_weather.svg"),
    ("Gilded Laurel (Royal Luxury)", "frame_royal_luxury.svg"),
    ("Orbit Ring (Space & Celestial)", "frame_space_celestial.svg"),
    ("Arcane Scholar Ring (Wizard School)", "frame_wizard_school.svg"),
]


def make_checkerboard_photo(size_px: int, radius_px: int, center_px: int, squares: int = 10) -> Image.Image:
    """Bright magenta/cyan checkerboard clipped to a circle, transparent outside."""
    img = Image.new("RGBA", (size_px, size_px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cell = (2 * radius_px) / squares
    x0, y0 = center_px - radius_px, center_px - radius_px
    for row in range(squares):
        for col in range(squares):
            color = (255, 0, 200, 255) if (row + col) % 2 == 0 else (0, 230, 255, 255)
            draw.rectangle(
                [x0 + col * cell, y0 + row * cell, x0 + (col + 1) * cell, y0 + (row + 1) * cell],
                fill=color,
            )
    mask = Image.new("L", (size_px, size_px), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.ellipse([center_px - radius_px, center_px - radius_px, center_px + radius_px, center_px + radius_px], fill=255)
    img.putalpha(Image.composite(img.split()[3], Image.new("L", img.size, 0), mask))
    out = Image.new("RGBA", (size_px, size_px), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def render_svg(svg_text: str | None, svg_path: Path | None, out_png: Path) -> Image.Image:
    if svg_text is not None:
        tmp_svg = out_png.with_suffix(".src.svg")
        tmp_svg.write_text(svg_text)
        src = tmp_svg
    else:
        src = svg_path
    subprocess.run(
        ["convert", "-background", "none", "-density", str(DENSITY), str(src), str(out_png)],
        check=True, capture_output=True,
    )
    return Image.open(out_png).convert("RGBA")


def main():
    photo = make_checkerboard_photo(CANVAS_PX, PHOTO_RADIUS_PX, CENTER_PX)

    tiles = []
    for label, filename in FRAMES:
        out_png = OUT_DIR / f"grid_{filename or 'solar'}.png"
        svg_path = FRAMES_DIR / filename if filename else None
        frame_img = render_svg(SOLAR_SVG if filename is None else None, svg_path, out_png)
        composite = Image.alpha_composite(photo, frame_img)
        tiles.append((label, composite))

    # Lay out as a 5x2 grid with labels
    cols, rows = 5, 2
    pad = 20
    label_h = 40
    tile_w = CANVAS_PX + pad
    tile_h = CANVAS_PX + label_h + pad
    grid_img = Image.new("RGB", (cols * tile_w, rows * tile_h), (30, 30, 34))
    draw = ImageDraw.Draw(grid_img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
    except Exception:
        font = ImageFont.load_default()

    for i, (label, tile) in enumerate(tiles):
        col, row = i % cols, i // cols
        x = col * tile_w + pad // 2
        y = row * tile_h + pad // 2
        bg = Image.new("RGB", tile.size, (50, 50, 56))
        bg.paste(tile, (0, 0), tile)
        grid_img.paste(bg, (x, y))
        draw.text((x, y + CANVAS_PX + 4), label, fill=(255, 255, 255), font=font)

    final_path = OUT_DIR / "verification_grid.png"
    grid_img.save(final_path)
    print(f"Wrote {final_path} ({grid_img.size[0]}x{grid_img.size[1]})")


if __name__ == "__main__":
    main()
