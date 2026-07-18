// =============================================================================
// Lightweight WebAudio sound engine — every effect is synthesized in-browser
// (oscillators + gain envelopes), so there are no audio asset files to ship,
// load, or go missing. The AudioContext is created lazily on first use
// (browsers block autoplay before a user gesture, and the first tap in the
// mode-select screen satisfies that).
// =============================================================================

let ctx: AudioContext | null = null
let muted = false

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

export function setSoundMuted(m: boolean) {
  muted = m
}

export function isSoundMuted() {
  return muted
}

interface ToneOpts {
  freq: number
  duration: number
  type?: OscillatorType
  gain?: number
  delay?: number
  glideTo?: number
}

/**
 * Exported so each game can compose its OWN sound identity out of the same
 * underlying synth primitives — shared engine, distinct palette per game.
 * See src/lib/boardgames/ludo/sound.ts for Ludo's palette; a future
 * UNO/Chess/etc. sound module would do the same rather than reuse this
 * quiz-game palette below.
 */
export function tone({ freq, duration, type = 'sine', gain = 0.18, delay = 0, glideTo }: ToneOpts) {
  const audio = getCtx()
  if (!audio || muted) return
  const t0 = audio.currentTime + delay
  const osc = audio.createOscillator()
  const g = audio.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration)
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(g)
  g.connect(audio.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.02)
}

export function noiseBurst(duration: number, gain = 0.12, delay = 0) {
  const audio = getCtx()
  if (!audio || muted) return
  const t0 = audio.currentTime + delay
  const bufferSize = Math.floor(audio.sampleRate * duration)
  const buffer = audio.createBuffer(1, bufferSize, audio.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)
  const src = audio.createBufferSource()
  src.buffer = buffer
  const g = audio.createGain()
  const filter = audio.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 800
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
  src.connect(filter)
  filter.connect(g)
  g.connect(audio.destination)
  src.start(t0)
}

/** Unlocks the AudioContext — call once on the very first user tap of a screen. */
export function primeSound() {
  getCtx()
}

export const sound = {
  tap: () => tone({ freq: 520, duration: 0.06, type: 'triangle', gain: 0.1 }),
  correct: () => {
    tone({ freq: 660, duration: 0.1, type: 'sine', gain: 0.2 })
    tone({ freq: 880, duration: 0.16, type: 'sine', gain: 0.22, delay: 0.08 })
  },
  wrong: () => {
    tone({ freq: 180, duration: 0.22, type: 'sawtooth', gain: 0.16, glideTo: 90 })
    noiseBurst(0.12, 0.08)
  },
  lockout: () => tone({ freq: 140, duration: 0.12, type: 'square', gain: 0.08 }),
  roundStart: () => {
    tone({ freq: 440, duration: 0.14, type: 'sine', gain: 0.14, glideTo: 660 })
  },
  tick: () => tone({ freq: 900, duration: 0.04, type: 'square', gain: 0.05 }),
  timeUp: () => {
    tone({ freq: 300, duration: 0.3, type: 'sawtooth', gain: 0.14, glideTo: 120 })
  },
  win: () => {
    tone({ freq: 523.25, duration: 0.14, type: 'sine', gain: 0.2 })
    tone({ freq: 659.25, duration: 0.14, type: 'sine', gain: 0.2, delay: 0.11 })
    tone({ freq: 783.99, duration: 0.28, type: 'sine', gain: 0.24, delay: 0.22 })
  },
  matchEnd: () => {
    tone({ freq: 392, duration: 0.16, type: 'sine', gain: 0.16 })
    tone({ freq: 523.25, duration: 0.24, type: 'sine', gain: 0.18, delay: 0.14 })
  },
  ready: () => tone({ freq: 380, duration: 0.1, type: 'triangle', gain: 0.14, glideTo: 520 }),
  countdown: () => tone({ freq: 500, duration: 0.09, type: 'square', gain: 0.12 }),
  go: () => {
    tone({ freq: 500, duration: 0.08, type: 'square', gain: 0.14 })
    tone({ freq: 760, duration: 0.18, type: 'sine', gain: 0.2, delay: 0.09 })
  },
  coin: () => {
    tone({ freq: 988, duration: 0.05, type: 'square', gain: 0.14 })
    tone({ freq: 1319, duration: 0.12, type: 'square', gain: 0.16, delay: 0.05 })
  },
}
