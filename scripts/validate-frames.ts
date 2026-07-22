/**
 * Standalone CLI: validates every avatar-frame SVG asset in
 * src/assets/frames/ against AVATAR_FRAME_STANDARD, and fails (non-zero
 * exit code) if any frame violates it.
 *
 * Run directly:
 *   node --experimental-strip-types scripts/validate-frames.ts
 *
 * Wired into package.json as:
 *   "validate:frames": "node --experimental-strip-types scripts/validate-frames.ts"
 * and into "build", so `npm run build` cannot produce a build with a
 * broken frame in it -- see AVATAR_FRAME_STANDARD.md's "validation steps."
 *
 * TEMPLATE.svg is intentionally skipped: it's a starter file for authoring
 * new frames, not a shipped asset, and is exempt from the "must have real
 * decoration touching FRAME_INNER_RADIUS" gap check the same way a blank
 * canvas is exempt -- see the SKIP_FILES set below.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateFrameSvg } from '../src/lib/frameValidator.ts'
import { AVATAR_FRAME_STANDARD } from '../src/lib/avatarFrameStandard.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRAMES_DIR = join(__dirname, '..', 'src', 'assets', 'frames')
const SKIP_FILES = new Set(['TEMPLATE.svg'])

function main() {
  let files: string[]
  try {
    files = readdirSync(FRAMES_DIR).filter((f) => f.endsWith('.svg') && !SKIP_FILES.has(f)).sort()
  } catch (err) {
    console.error(`[validate:frames] Could not read ${FRAMES_DIR}:`, err)
    process.exit(1)
    return
  }

  if (files.length === 0) {
    console.error(`[validate:frames] No frame SVGs found in ${FRAMES_DIR} -- nothing to validate. Failing closed (an empty asset dir is itself suspicious).`)
    process.exit(1)
    return
  }

  console.log('AVATAR FRAME STANDARD validation')
  console.log(`  standard: PHOTO_RADIUS=${AVATAR_FRAME_STANDARD.PHOTO_RADIUS}  FRAME_INNER_RADIUS=${AVATAR_FRAME_STANDARD.FRAME_INNER_RADIUS}  FRAME_CANVAS_SIZE=${AVATAR_FRAME_STANDARD.FRAME_CANVAS_SIZE}  FRAME_OVERHANG=${AVATAR_FRAME_STANDARD.FRAME_OVERHANG}`)
  console.log(`  checking ${files.length} frame asset(s) in src/assets/frames/\n`)

  let anyError = false
  let anyWarning = false

  for (const file of files) {
    const svg = readFileSync(join(FRAMES_DIR, file), 'utf8')
    const result = validateFrameSvg(svg, file)

    const errorIssues = result.issues.filter((i) => i.severity === 'error')
    const warningIssues = result.issues.filter((i) => i.severity === 'warning')
    if (errorIssues.length) anyError = true
    if (warningIssues.length) anyWarning = true

    const status = result.valid ? 'PASS' : 'FAIL'
    const radii = result.minRadiusFound != null
      ? `  (min radius ${result.minRadiusFound.toFixed(1)}, max radius ${result.maxRadiusFound!.toFixed(1)})`
      : ''
    console.log(`  [${status}] ${file}${radii}`)

    for (const issue of errorIssues) console.log(`         ERROR: ${issue.message}`)
    for (const issue of warningIssues) console.log(`         WARN:  ${issue.message}`)
  }

  console.log('')
  if (anyError) {
    console.error(`validate:frames FAILED -- one or more frames violate AVATAR_FRAME_STANDARD. See errors above and fix the assets (do not loosen the standard). Full rules: /AVATAR_FRAME_STANDARD.md`)
    process.exit(1)
  } else if (anyWarning) {
    console.log(`validate:frames PASSED with warnings -- all frames meet the geometry standard, but see WARN lines above (usually an unsupported <path> command that wasn't fully checked).`)
    process.exit(0)
  } else {
    console.log(`validate:frames PASSED -- all ${files.length} frame(s) meet AVATAR_FRAME_STANDARD exactly.`)
    process.exit(0)
  }
}

main()
