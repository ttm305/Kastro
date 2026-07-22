/**
 * Ad-hoc sandbox verification harness (NOT part of the shipped project).
 *
 * This sandbox has no network access to the npm registry (blocked with a
 * 403) and its node_modules was trimmed to only what `tsc`/`vite` need, so
 * `vitest`, `jsdom`, and `@testing-library/react` are not installable or
 * runnable here. That means the *real* regression test suite this task
 * ships (src/components/Avatar.test.tsx + src/lib/cosmetics.test.ts,
 * written against the project's normal vitest+RTL setup) cannot be
 * executed inside this sandbox.
 *
 * This script exists so the fix can still be verified against the ACTUAL
 * Avatar.tsx and cosmetics.ts source -- not a hand-drawn simulation --
 * using only what's already installed: the real `typescript` compiler
 * (for its JSX transform), the real `react` and `react-dom/server`
 * packages, and Node's CommonJS module hooks. It stubs exactly two
 * modules Avatar.tsx/cosmetics.ts pull in transitively (`../lib/api` and
 * `./supabaseClient`) purely because they'd otherwise require live
 * Supabase credentials/network to import -- neither stub touches any
 * logic this bug fix is about.
 */
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs')
const ts = require('typescript')
const assert = require('node:assert')

const PROJECT_ROOT = '/sessions/blissful-brave-brahmagupta/mnt/outputs/skillzone'

// --- stub the two modules Avatar/cosmetics import transitively that need
// live Supabase config; nothing else is touched. ---
const STUBS = {
  [path.join(PROJECT_ROOT, 'src/lib/api')]: `exports.BUILTIN_AVATARS = []`,
  [path.join(PROJECT_ROOT, 'src/lib/supabaseClient')]: `exports.supabase = {}`,
}

const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (parent && parent.filename) {
    const dir = path.dirname(parent.filename)
    const resolved = path.resolve(dir, request)
    if (STUBS[resolved]) return resolved + '.stub.js'
  }
  return origResolve.call(this, request, parent, ...rest)
}

const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename) {
    const dir = path.dirname(parent.filename)
    const resolved = path.resolve(dir, request)
    if (STUBS[resolved]) {
      const m = new Module(resolved + '.stub.js', parent)
      m._compile(STUBS[resolved], resolved + '.stub.js')
      return m.exports
    }
  }
  return origLoad.call(this, request, parent, isMain)
}

// --- real TS/TSX transform via the real `typescript` package (the same
// JSX settings this project's own tsconfig.json uses: react-jsx runtime). ---
require.extensions['.tsx'] = function (mod, filename) {
  const src = fs.readFileSync(filename, 'utf8')
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      jsxImportSource: 'react',
    },
    fileName: filename,
  }).outputText
  mod._compile(out, filename)
}
require.extensions['.ts'] = function (mod, filename) {
  const src = fs.readFileSync(filename, 'utf8')
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText
  mod._compile(out, filename)
}

const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { default: Avatar } = require(path.join(PROJECT_ROOT, 'src/components/Avatar.tsx'))
const { frameAvatarStyle } = require(path.join(PROJECT_ROOT, 'src/lib/cosmetics.ts'))

let failures = 0
function check(label, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${label}`)
  } else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ' -- ' + detail : ''}`)
  }
}

console.log('1) No frame equipped -> must render exactly like the original clean avatar (zero ring)')
{
  const html = renderToStaticMarkup(
    React.createElement(Avatar, { url: null, size: 64, style: frameAvatarStyle(null) })
  )
  check('frameAvatarStyle(null) produces no border/boxShadow at all', !/style="[^"]*\bborder:/.test(html) && !/style="[^"]*box-shadow:/.test(html), html)
  check('no frame overlay <img> is rendered', !html.includes('<img'), html)
}

console.log('\n2) Solar Frame equipped (legacy CSS ring, style.ring set) -> existing correct ring look')
{
  const solarFrame = { id: 'frame_solar', image_url: null, style: { ring: '#ffd700', glow: true } }
  const html = renderToStaticMarkup(
    React.createElement(Avatar, { url: null, size: 64, style: frameAvatarStyle(solarFrame), frame: solarFrame })
  )
  check('border uses the Solar ring color', html.includes('#ffd700') && /border:3px solid/.test(html), html)
  check('glow boxShadow present', /box-shadow:0 0 14px/.test(html), html)
}

console.log('\n3) Custom SVG-overlay frame equipped -> Solar geometry (photo untouched, no border) + outward decoration only')
{
  const customFrame = { id: 'frame_test', image_url: 'https://example.com/frame_test.svg', style: {} }
  const html = renderToStaticMarkup(
    React.createElement(Avatar, { url: null, size: 64, style: frameAvatarStyle(customFrame), frame: customFrame })
  )
  check('frame overlay <img> is rendered with the frame asset URL', html.includes('src="https://example.com/frame_test.svg"'), html)
  check('overlay is sized at FRAME_OVERHANG_SCALE (120%), not a custom scale', html.includes('width:120%') && html.includes('height:120%'), html)
  check('photo layer has border:none / box-shadow:none (frame draws its own ring entirely outside the photo)', /border:none/.test(html) && /box-shadow:none/.test(html), html)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
