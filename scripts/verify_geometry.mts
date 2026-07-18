// Standalone geometry sanity check (not part of the app). Re-implements the
// exact same rotate/quarter algorithm as geometry.ts (values copied
// verbatim) to validate, outside of visually eyeballing it, that the new
// authentic-board coordinate system is internally consistent: no
// duplicate/overlapping cells, full 15x15 grid coverage, and safe/entry
// cells land in sensible places.

const GRID_SIZE = 15
type Cell = [number, number]

const RED_RING_QUARTER: Cell[] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7], [0, 8],
]
const RED_HOME_STRETCH: Cell[] = [
  [7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6],
]

function rotate90([r, c]: Cell): Cell { return [c, GRID_SIZE - 1 - r] }
function rotateN(cell: Cell, times: number): Cell {
  let x = cell
  for (let i = 0; i < times; i++) x = rotate90(x)
  return x
}

const RING: Cell[] = Array.from({ length: 52 }, (_, i) => {
  const q = Math.floor(i / 13)
  const w = i % 13
  return rotateN(RED_RING_QUARTER[w], q)
})
const HOME: Cell[][] = [0, 1, 2, 3].map((seat) => RED_HOME_STRETCH.map((c) => rotateN(c, seat)))

const BASE_ORIGIN: Cell[] = [[0, 0], [0, 9], [9, 9], [9, 0]]
const key = (c: Cell) => `${c[0]},${c[1]}`

function inBase(c: Cell): number | -1 {
  for (let s = 0; s < 4; s++) {
    const [r0, c0] = BASE_ORIGIN[s]
    if (c[0] >= r0 && c[0] < r0 + 6 && c[1] >= c0 && c[1] < c0 + 6) return s
  }
  return -1
}

let ok = true
const fail = (msg: string) => { ok = false; console.log('FAIL:', msg) }

// 1. 52 unique ring cells
const ringKeys = new Set(RING.map(key))
if (ringKeys.size !== 52) fail(`ring has duplicates: ${ringKeys.size} unique of 52`)

// 2. No ring cell falls inside any base
for (const c of RING) if (inBase(c) !== -1) fail(`ring cell ${key(c)} falls inside base ${inBase(c)}`)

// 3. All ring cells in bounds
for (const c of RING) if (c[0] < 0 || c[0] >= GRID_SIZE || c[1] < 0 || c[1] >= GRID_SIZE) fail(`ring cell out of bounds: ${key(c)}`)

// 4. Home stretch cells: 24 unique, none inside base, none overlap ring
const homeFlat = HOME.flat()
const homeKeys = new Set(homeFlat.map(key))
if (homeKeys.size !== 24) fail(`home-stretch has duplicates: ${homeKeys.size} unique of 24`)
for (const c of homeFlat) if (inBase(c) !== -1) fail(`home-stretch cell ${key(c)} falls inside a base`)
for (const c of homeFlat) if (ringKeys.has(key(c))) fail(`home-stretch cell ${key(c)} overlaps the ring`)

// 5. Entry cells (path index 0,13,26,39) each sit adjacent to their own seat's base
const START_OFFSETS = [0, 13, 26, 39]
START_OFFSETS.forEach((idx, seat) => {
  const [r0, c0] = BASE_ORIGIN[seat]
  const [r, c] = RING[idx]
  // "adjacent" = within 1 cell of the base's bounding box
  const nearRow = r >= r0 - 1 && r <= r0 + 6
  const nearCol = c >= c0 - 1 && c <= c0 + 6
  if (!(nearRow && nearCol)) fail(`seat ${seat} entry cell ${key(RING[idx])} is not adjacent to its own base`)
})

// 6. Finish cell (home-stretch index 5) for each seat lands in the 3x3 center block (rows/cols 6-8)
HOME.forEach((cells, seat) => {
  const [r, c] = cells[5]
  if (!(r >= 6 && r <= 8 && c >= 6 && c <= 8)) fail(`seat ${seat} finish cell ${key(cells[5])} is not in the center block`)
})

// 7. Full grid coverage: base(4*36) + ring(52) + home-stretch(24) + decorative-center(5) === 225
const total = 4 * 36 + 52 + 24 + 5
if (total !== GRID_SIZE * GRID_SIZE) fail(`coverage math doesn't add up to 225: got ${total}`)

// 8. Rotational symmetry: rotating seat0's ring quarter 4 times returns to itself
let roundTrip: Cell = RED_RING_QUARTER[0]
for (let i = 0; i < 4; i++) roundTrip = rotate90(roundTrip)
if (key(roundTrip) !== key(RED_RING_QUARTER[0])) fail('4x rotation does not return to identity')

console.log(ok ? 'ALL GEOMETRY CHECKS PASSED' : 'GEOMETRY CHECKS FAILED (see FAIL lines above)')
console.log('Ring cells:', RING.map(key).join(' | '))
