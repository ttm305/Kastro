import { tone, noiseBurst } from '../../sound'

/**
 * Ludo's own sound identity — built from the same shared WebAudio
 * primitives every game uses (tone/noiseBurst), but composed into a
 * palette that sounds nothing like the quiz games. This is the audio half
 * of the "shared backend, distinct game identity" rule: the synthesis
 * engine is infrastructure, this palette is Ludo's alone. A future
 * UNO/Chess/Checkers/Connect 4/Backgammon module would define its own file
 * here instead of reusing this one.
 */
export const ludoSound = {
  /** Quick rattly clicks while the die "tumbles", called once per visual tick during the roll animation. */
  diceRattle: () => {
    tone({ freq: 900 + Math.random() * 400, duration: 0.03, type: 'square', gain: 0.05 })
    noiseBurst(0.02, 0.03)
  },
  /** The die settling on its final face — pitch scales gently with the rolled value so a 6 "feels" bigger than a 1. */
  diceSettle: (value: number) => {
    const freq = 260 + value * 40
    tone({ freq, duration: 0.1, type: 'triangle', gain: 0.16 })
    tone({ freq: freq * 1.5, duration: 0.08, type: 'sine', gain: 0.1, delay: 0.03 })
  },
  /** A soft wooden "tock" as a piece slides to its new cell. */
  pieceSlide: () => tone({ freq: 340, duration: 0.05, type: 'triangle', gain: 0.1, glideTo: 420 }),
  /** A piece leaving base to enter play — brighter than a normal slide. */
  pieceEnter: () => {
    tone({ freq: 440, duration: 0.09, type: 'sine', gain: 0.16, glideTo: 660 })
  },
  /** An opponent piece getting sent home — playful "yelp", distinct from the quiz games' harsher "wrong" buzz. */
  pieceCaptured: () => {
    tone({ freq: 520, duration: 0.14, type: 'sawtooth', gain: 0.14, glideTo: 180 })
    noiseBurst(0.08, 0.06, 0.02)
  },
  /** A single piece reaching home. */
  pieceHome: () => {
    tone({ freq: 700, duration: 0.09, type: 'sine', gain: 0.18 })
    tone({ freq: 1050, duration: 0.14, type: 'sine', gain: 0.2, delay: 0.07 })
  },
  /** Turn silently passing to the next seat — a very quiet blip, not a full sound cue. */
  turnPass: () => tone({ freq: 300, duration: 0.04, type: 'sine', gain: 0.05 }),
  /** A whole seat finishing all 4 pieces — bigger than pieceHome, smaller than the final victory fanfare. */
  seatFinished: () => {
    tone({ freq: 587.33, duration: 0.12, type: 'sine', gain: 0.2 })
    tone({ freq: 739.99, duration: 0.12, type: 'sine', gain: 0.2, delay: 0.09 })
    tone({ freq: 987.77, duration: 0.22, type: 'sine', gain: 0.24, delay: 0.18 })
  },
  /** Ludo's own victory fanfare — a fuller five-note run + a low drum-ish thump, distinct from the quiz games' three-note win() chime. */
  victory: () => {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51]
    notes.forEach((f, i) => tone({ freq: f, duration: 0.2, type: 'sine', gain: 0.22, delay: i * 0.09 }))
    tone({ freq: 90, duration: 0.3, type: 'sine', gain: 0.2 })
    noiseBurst(0.4, 0.05, 0.05)
  },
  /** A player readying up in the online lobby — a small upward chirp. */
  ready: () => tone({ freq: 420, duration: 0.07, type: 'triangle', gain: 0.12, glideTo: 640 }),
  /** A player un-readying — the same chirp, downward. */
  unready: () => tone({ freq: 500, duration: 0.06, type: 'triangle', gain: 0.1, glideTo: 320 }),
  /** One tick of the pre-match "3-2-1" countdown. */
  countdownTick: () => tone({ freq: 520, duration: 0.08, type: 'square', gain: 0.14 }),
  /** The "GO" moment a match actually begins — a bright dice-flavored fanfare, distinct from victory(). */
  matchStart: () => {
    tone({ freq: 660, duration: 0.1, type: 'square', gain: 0.16 })
    tone({ freq: 880, duration: 0.22, type: 'sine', gain: 0.2, delay: 0.09 })
    noiseBurst(0.1, 0.06, 0.02)
  },
  /** A seat reconnecting mid-match. */
  reconnected: () => tone({ freq: 500, duration: 0.09, type: 'sine', gain: 0.12, glideTo: 700 }),
  /** A seat dropping mid-match. */
  disconnected: () => tone({ freq: 380, duration: 0.14, type: 'sawtooth', gain: 0.1, glideTo: 200 }),
}
