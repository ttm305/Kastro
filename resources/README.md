# KASTRO native app assets

Source artwork for iOS/Android app icons and splash screens, generated
from the existing `public/icon-512.png` (the approved KASTRO
castle-and-K mark) and the app's own brand background gradient
(`#1a0a3d` → `#03030f`, matching `manifest.webmanifest`'s
`background_color`/`theme_color`).

These follow the exact input convention the official
[`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets) CLI
tool expects, so generating the full native icon/splash sets for both
platforms is one command once the native projects exist:

```bash
npm install -D @capacitor/assets
npx cap add ios       # creates ios/
npx cap add android   # creates android/
npx capacitor-assets generate
```

That command reads everything in this folder and writes the complete
`Assets.xcassets/AppIcon.appiconset` (iOS) and `mipmap-*`/adaptive-icon
XML (Android) sets automatically — nothing in this folder needs to be
placed by hand.

## Files

- **`icon.png`** (1024×1024, no alpha) — the App Store / Play Store icon
  and the source for every smaller iOS icon size. Upscaled 2× from the
  existing 512×512 source via Lanczos resampling as a stopgap — this
  reads fine at every in-app size, but before final App Store submission
  it's worth re-exporting a true 1024×1024+ (or vector) version from the
  original KASTRO logo design file for maximum sharpness at the App
  Store listing size.
- **`icon-foreground.png`** / **`icon-background.png`** (1024×1024) —
  Android adaptive icon layers. The foreground is the mark scaled into
  the ~66% "safe zone" Android's circular/square/rounded-square masks
  crop to; the background is a flat fill of the brand gradient. The
  foreground layer still carries the icon's own baked-in background
  square (it was extracted from the flattened `icon-512.png`, not a
  separate transparent-background source) — it will look correct once
  masked, but a true transparent-background crest-only export would give
  a cleaner adaptive-icon result if one becomes available later.
- **`splash.png`** (2732×2732) — native splash screen, logo centered on
  the brand gradient. `@capacitor/assets` downsamples this one image for
  every iOS/Android splash size and density automatically.
- **`notification-icon.png`** (256×256, monochrome) — Android status-bar
  notification icon. Android renders this as a flat white silhouette
  regardless of the source's actual colors (colored status-bar icons are
  ignored/re-tinted by the OS), so it was generated as a rough
  auto-thresholded silhouette of the main icon. Worth a quick visual
  check before shipping — automated color-to-silhouette extraction from a
  detailed, colorful icon is inherently imprecise; a hand-cleaned
  silhouette will look crisper.

## Why these exist as loose files instead of already being inside `ios/`/`android/`

Those native project folders don't exist yet in this delivery — creating
them requires `npx cap add ios`/`android`, which in turn requires
`@capacitor/core`/`@capacitor/cli` to actually be installed via `npm
install`, and the environment that produced this delivery has no npm
registry access. See the root `MOBILE_PACKAGING.md` (or the delivery
report) for the full explanation and the exact commands to run locally.
