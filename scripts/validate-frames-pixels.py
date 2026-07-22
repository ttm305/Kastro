#!/usr/bin/env python3
"""
Pixel-level rasterization validator for avatar frame SVGs.

Unlike scripts/validate-frames.ts (which parses SVG source geometry), this
script actually RENDERS each frame to a bitmap and measures, per pixel, the
distance of every non-transparent pixel from the photo center (100, 100 in
the shared -20 -20 240 240 viewBox). This is the only way to catch bugs that
source-level geometry parsing can miss (renderer-specific stroke/curve/
transform behavior, anti-aliasing bleed, etc.) -- see AVATAR_FRAME_STANDARD.md.

Required valid condition (per product spec):
  minimum visible frame pixel radius == 100, within 0.5px anti-aliasing
  tolerance in EITHER direction:
    - no non-transparent pixel may exist at radius < 99.5 (covers the photo)
    - the nearest non-transparent pixel must not be farther than radius 100.5
      (no visible gap between photo edge and frame)

Rendering: uses ImageMagick's `convert` (with its built-in MSVG SVG delegate)
to rasterize each SVG at 10px per SVG user-unit (2400x2400 for the 240x240
viewBox), then scans every pixel with Pillow.

Usage:
  python3 scripts/validate-frames-pixels.py            # human-readable report
  python3 scripts/validate-frames-pixels.py --json      # machine-readable report
Exit code is non-zero if any frame fails.
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow (PIL) is required. Install with: pip install Pillow", file=sys.stderr)
    sys.exit(2)

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
FRAMES_DIR = PROJECT_ROOT / "src" / "assets" / "frames"

SCALE = 10.0  # rendered px per SVG user-unit
DENSITY = int(96 * SCALE)
VB_MINX, VB_MINY = -20.0, -20.0  # shared viewBox origin (see avatarFrameStandard.ts)
CX, CY = 100.0, 100.0  # photo center, always FRAME_INNER_RADIUS=100 from edge
ALPHA_THRESHOLD = 10  # 0-255; pixels at/below this are treated as transparent
INNER_TOLERANCE = 0.5  # px, matches product spec exactly
TARGET_RADIUS = 100.0

# The "newly added custom SVG frames" this validator is scoped to (per the
# explicit product requirement). Solar Frame and other legacy frames are a
# CSS ring drawn by Avatar.tsx, not an SVG asset, and are out of scope.
FRAME_FILES = [
    "frame_bahrain.svg",
    "frame_cute_cozy.svg",
    "frame_cyberpunk.svg",
    "frame_fire_elemental.svg",
    "frame_mythic_realm.svg",
    "frame_nature_weather.svg",
    "frame_royal_luxury.svg",
    "frame_space_celestial.svg",
    "frame_wizard_school.svg",
]


def render_svg_to_png(svg_path: Path, png_path: Path) -> None:
    result = subprocess.run(
        ["convert", "-background", "none", "-density", str(DENSITY), str(svg_path), str(png_path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"convert failed for {svg_path.name}: {result.stderr}")


def measure_min_radius(png_path: Path) -> tuple[float | None, int, int]:
    """Returns (min_visible_radius, pixel_count_inside_tolerance, total_visible_pixels)."""
    img = Image.open(png_path).convert("RGBA")
    w, h = img.size
    px = img.load()
    min_r: float | None = None
    violations = 0
    visible = 0
    for y in range(h):
        uy = VB_MINY + (y + 0.5) / SCALE
        dy = uy - CY
        for x in range(w):
            a = px[x, y][3]
            if a <= ALPHA_THRESHOLD:
                continue
            visible += 1
            ux = VB_MINX + (x + 0.5) / SCALE
            dx = ux - CX
            r = math.sqrt(dx * dx + dy * dy)
            if min_r is None or r < min_r:
                min_r = r
            if r < (TARGET_RADIUS - INNER_TOLERANCE):
                violations += 1
    return min_r, violations, visible


def main() -> int:
    as_json = "--json" in sys.argv
    render_dir = PROJECT_ROOT / "_pixel_validation_render"
    render_dir.mkdir(exist_ok=True)

    results = []
    any_fail = False

    for filename in FRAME_FILES:
        svg_path = FRAMES_DIR / filename
        if not svg_path.exists():
            results.append({"file": filename, "error": "file not found"})
            any_fail = True
            continue

        png_path = render_dir / (svg_path.stem + ".png")
        render_svg_to_png(svg_path, png_path)
        min_r, violations, visible = measure_min_radius(png_path)

        if min_r is None:
            status = "FAIL"
            reason = "no visible pixels rendered"
            any_fail = True
        elif violations > 0:
            status = "FAIL"
            reason = f"{violations} pixel(s) at radius < {TARGET_RADIUS - INNER_TOLERANCE} (covers the photo)"
            any_fail = True
        elif min_r > TARGET_RADIUS + INNER_TOLERANCE:
            status = "FAIL"
            reason = f"nearest visible pixel at radius {min_r:.3f} > {TARGET_RADIUS + INNER_TOLERANCE} (gap)"
            any_fail = True
        else:
            status = "PASS"
            reason = ""

        results.append(
            {
                "file": filename,
                "status": status,
                "measured_min_visible_radius": round(min_r, 3) if min_r is not None else None,
                "visible_pixel_count": visible,
                "violations_inside_r99_5": violations,
                "reason": reason,
            }
        )

    if as_json:
        print(json.dumps({"pass": not any_fail, "results": results}, indent=2))
    else:
        print(f"Pixel-level frame validation (render scale: {SCALE}px/unit, tolerance: ±{INNER_TOLERANCE}px)\n")
        print(f"{'FRAME':<28} {'STATUS':<6} {'MIN VISIBLE RADIUS':<20} {'NOTES'}")
        print("-" * 90)
        for r in results:
            if "error" in r:
                print(f"{r['file']:<28} {'ERROR':<6} {'-':<20} {r['error']}")
                continue
            mr = f"{r['measured_min_visible_radius']:.3f}" if r["measured_min_visible_radius"] is not None else "N/A"
            print(f"{r['file']:<28} {r['status']:<6} {mr:<20} {r['reason']}")
        print()
        print("RESULT: " + ("ALL FRAMES PASS" if not any_fail else "ONE OR MORE FRAMES FAILED"))

    return 1 if any_fail else 0


if __name__ == "__main__":
    sys.exit(main())
