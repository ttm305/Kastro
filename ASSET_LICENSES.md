# Cosmetics Starter Collection — Asset Licenses

This file documents the origin and license of every visual asset in the cosmetics
"starter collection" seeded into `cosmetic_items` (18 items, 9 collections: Bahrain,
Wizard School, Royal Luxury, Mythic Realm, Space & Celestial, Cyberpunk,
Nature & Weather, Fire & Elemental, Cute & Cozy).

## Origin

Every image asset in this starter collection is an **original, hand-authored SVG**
built directly in this project — geometric shapes, gradients, and simple path/polygon
compositions written by hand, with **no imported artwork, stock assets, fonts-as-images,
traced logos, or AI-generated raster/vector images**. No image-generation tool was used
or available in the environment this collection was built in.

Each SVG is embedded inline as a `data:image/svg+xml;base64,...` URI directly in the
`image_url` (and, for frames, `thumbnail_url`) column of `cosmetic_items` — there are no
separate asset files and no Storage bucket uploads for this starter set.

## License

All assets in this file are original work created for this project and are released
under **CC0 1.0 Universal (Public Domain Dedication)** — free to use, modify, and
redistribute without attribution, by KASTRO or anyone else.

## No third-party or copyrighted content

- **Bahrain collection**: colors and a serrated-band motif are used in an original
  geometric composition. This is a stylized reference to red/white as a color pair and a
  zig-zag/triangle pattern, not a traced or pixel-reproduction of the official flag
  artwork, and it deliberately stays **static** — no attempt was made to fake an animated
  flag without a real video asset.
- **Wizard School collection**: a generic "magic school" aesthetic (stars, candlelight,
  parchment purple, an open book, a moon) with no house colors, crests, scars, named
  characters, spells, or any other element referencing a specific copyrighted franchise.
- **Mythic Realm collection**: abstract geometric shapes stand in for "runes" — these are
  not characters from any real writing system, to avoid any ambiguity about reproducing
  existing scripts.
- All other collections (Royal Luxury, Space & Celestial, Cyberpunk, Nature & Weather,
  Fire & Elemental, Cute & Cozy) are generic thematic color/shape compositions with no
  ties to any specific brand, franchise, or third-party IP.

## Media type

All 18 items use `media_type = 'image'` (static). None are marked `is_animated`, since no
real video/animation asset pipeline exists yet for this starter set — this is intentional
and matches the "No Fake Completion" requirement: nothing here claims to be animated
without an actual video file behind it.

## Scaling this collection

To add more assets later (hundreds/thousands, premium artwork, real animated videos):

1. Upload the new image/video/poster files anywhere reachable by URL — the existing
   `cosmetic-media` Storage bucket (via the admin panel's built-in upload buttons) or any
   external CDN.
2. Insert a new row into `cosmetic_items` (or use the admin **Cosmetics** panel) with the
   new `image_url`/`video_url`/`poster_url`, a `collection` name (existing or new — the
   shop's collection filter is entirely data-driven), a `rarity`, and a `price_coins`.
3. No frontend code changes are required — the shop, admin panel, and profile-rendering
   components all resolve items purely from the database.

Update this file with the license/origin of any newly added third-party or
AI-generated assets when that happens.
