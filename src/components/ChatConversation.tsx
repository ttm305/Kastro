import { useEffect, useRef, useState, useCallback } from 'react'
import type { Lang } from '../App'
import Avatar from './Avatar'
import { useAuth } from '../lib/auth'
import {
  getMessages,
  sendMessage,
  openConversation,
  heartbeatConversation,
  leaveConversation,
  saveDraft,
  getDraft,
  subscribeToConversation,
  subscribeToTyping,
  getPresence,
  toggleSaveMessage,
  getConversationDisappearingMode,
  setConversationDisappearingMode,
  validateChatMedia,
  normalizeMediaMime,
  chatMediaExtension,
  CHAT_MEDIA_MAX_BYTES,
  buildChatMediaPath,
  uploadChatMedia,
  sendMediaMessage,
  getChatMediaUrl,
  type ChatMessage,
  type DisappearingMode,
  type ChatAttachmentType,
  type ChatMediaValidationError,
} from '../lib/api'
import { activeConversation, setActiveConversation } from '../lib/chatPresence'
import { formatPresence } from '../lib/presenceFormat'
import { safeTop, safeBottom, safeLeft, safeRight, tapTarget } from '../lib/safeArea'

function timeShort(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds % 60)
  const m = Math.floor(seconds / 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// crypto.randomUUID() requires a secure context and a modern browser
// (Safari 15.4+). If it's ever unavailable — an older WebView, an
// HTTP-served dev build, etc. — calling it throws synchronously, and if
// that throw happens before handleSend's try block even starts, it's
// uncaught: no optimistic message, no error shown, input untouched, which
// looks exactly like "pressing Send does nothing." This fallback and the
// try block below being moved to wrap UUID generation too make that
// specific failure mode impossible either way.
function safeRandomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID() } catch { /* fall through to manual generation */ }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function getAudioCtor(): typeof AudioContext | null {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/** Downsamples raw PCM into a fixed number of peak-amplitude buckets — a real waveform derived from the actual decoded audio, used for both the sender's own just-recorded bubble and for playback of any received voice message (see VoiceBubble). */
function computePeaks(audioBuffer: AudioBuffer, bucketCount: number): number[] {
  const data = audioBuffer.getChannelData(0)
  const bucketSize = Math.max(1, Math.floor(data.length / bucketCount))
  const peaks: number[] = []
  for (let i = 0; i < bucketCount; i++) {
    let max = 0
    const start = i * bucketSize
    const end = Math.min(data.length, start + bucketSize)
    for (let j = start; j < end; j++) { const v = Math.abs(data[j]); if (v > max) max = v }
    peaks.push(max)
  }
  return peaks
}

function getImageDimensions(file: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url) }
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url) }
    img.src = url
  })
}

function getVideoMeta(file: Blob): Promise<{ width: number; height: number; duration: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => { resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration }); URL.revokeObjectURL(url) }
    video.onerror = () => { resolve(null); URL.revokeObjectURL(url) }
    video.src = url
  })
}

// Hard cap for how long a send is allowed to stay "in flight" before the
// UI treats it as failed, independent of api.ts's own AbortController
// timeout — belt and suspenders. Background tabs on iOS Safari can throttle
// or fully suspend JS timers (including the AbortController's own
// setTimeout), so relying on a single timeout mechanism isn't safe; this
// second check runs specifically on the app coming back to the
// foreground, when timers resume, and force-clears a send that's been
// stuck since before backgrounding.
const SEND_STUCK_MS = 20000

interface OtherUser {
  id: string
  username: string
  avatar_url?: string | null
}

interface Props {
  conversationId: string
  otherUser: OtherUser
  lang: Lang
  /** Renders as a compact overlay panel (in-game) instead of a full-screen sheet (normal chat). */
  variant?: 'full' | 'panel'
  onClose: () => void
}

type UploadState = { status: 'uploading' | 'failed'; progress: number; cancel: () => void }

/** Plays and, on first use, decodes a real per-message waveform from the actual audio (via Web Audio's decodeAudioData) — never a canned/fake pattern. Works identically for a just-recorded local blob: URL and a signed https:// playback URL, since both are fetchable. */
function VoiceBubble({ src, mine, isAr, cachedDurationSeconds }: { src: string | null; mine: boolean; isAr: boolean; cachedDurationSeconds: number | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(cachedDurationSeconds ?? 0)
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [decodeFailed, setDecodeFailed] = useState(false)

  useEffect(() => {
    if (!src) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(src)
        const buf = await res.arrayBuffer()
        const AudioCtx = getAudioCtor()
        if (!AudioCtx) { setDecodeFailed(true); return }
        const ctx = new AudioCtx()
        const audioBuffer = await ctx.decodeAudioData(buf)
        if (cancelled) return
        setDuration(audioBuffer.duration)
        setPeaks(computePeaks(audioBuffer, 36))
        ctx.close().catch(() => {})
      } catch {
        if (!cancelled) setDecodeFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [src])

  function togglePlay() {
    if (!audioRef.current) return
    if (playing) audioRef.current.pause()
    else audioRef.current.play().catch(() => {})
  }

  function seek(fraction: number) {
    if (!audioRef.current || !duration) return
    audioRef.current.currentTime = Math.min(duration, Math.max(0, fraction * duration))
  }

  const barColor = mine ? 'rgba(255,255,255,0.92)' : '#7c3aed'
  const barTrack = mine ? 'rgba(255,255,255,0.32)' : 'rgba(var(--fg-rgb),0.22)'
  const bars = peaks ?? new Array(36).fill(0.3)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 176, padding: '2px 2px' }}>
      <button
        onClick={togglePlay}
        disabled={!src}
        aria-label={playing ? (isAr ? 'إيقاف' : 'Pause') : (isAr ? 'تشغيل' : 'Play')}
        style={{ flexShrink: 0, width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: src ? 'pointer' : 'default', background: mine ? 'rgba(255,255,255,0.22)' : 'rgba(124,58,237,0.16)', color: mine ? '#fff' : '#7c3aed', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', ...tapTarget(30, 30) }}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <div
        role="slider"
        aria-label={isAr ? 'موضع التشغيل' : 'Playback position'}
        aria-valuenow={Math.round(progress * 100)}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          seek((e.clientX - rect.left) / rect.width)
        }}
        style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1.5, height: 26, cursor: src ? 'pointer' : 'default' }}
      >
        {bars.map((v, i) => {
          const filled = i / bars.length <= progress
          return <span key={i} style={{ width: 2.5, borderRadius: 2, height: Math.max(3, v * 22), background: filled ? barColor : barTrack, flexShrink: 0, transition: 'background 0.15s ease' }} />
        })}
      </div>
      <span style={{ flexShrink: 0, fontSize: 10, opacity: 0.75, minWidth: 30, textAlign: 'right' }}>
        {formatDuration(progress > 0 ? progress * duration : duration)}
      </span>
      {decodeFailed && <span style={{ fontSize: 9, color: '#f87171' }}>⚠</span>}
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setProgress(0) }}
          onTimeUpdate={(e) => { const a = e.currentTarget; if (a.duration) setProgress(a.currentTime / a.duration) }}
          onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (isFinite(d) && d > 0) setDuration(d) }}
          style={{ display: 'none' }}
        />
      )}
    </div>
  )
}

/**
 * The single shared 1:1 conversation surface — used both for normal private
 * chat and (Phase 4) in-game chat, since both resolve to the same
 * conversation row. Owns the entire disappearing-message lifecycle from the
 * client side: open marks read, heartbeat keeps "still viewing" alive,
 * unmount/close triggers the permanent server-side deletion sweep for
 * whatever this user has already read.
 */
export default function ChatConversation({ conversationId, otherUser, lang, variant = 'full', onClose }: Props) {
  const { profile } = useAuth()
  const isAr = lang === 'ar'
  const myId = profile?.id ?? ''

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [otherTyping, setOtherTyping] = useState(false)
  const [otherOnline, setOtherOnline] = useState(false)
  const [otherLastSeenAt, setOtherLastSeenAt] = useState<string | null>(null)
  const [otherInGame, setOtherInGame] = useState<{ name: string; nameAr: string } | null>(null)
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null)
  const [savePending, setSavePending] = useState(false)
  const [disappearingMode, setDisappearingModeState] = useState<DisappearingMode>('read_leave')
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [modePending, setModePending] = useState(false)
  const [modeNotice, setModeNotice] = useState<string | null>(null)
  const modeNoticeTimerRef = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<number | null>(null)
  const draftTimerRef = useRef<number | null>(null)
  const sendTypingRef = useRef<(() => void) | null>(null)
  const lastTypingSentAtRef = useRef(0)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressFiredRef = useRef(false)
  const sendStartedAtRef = useRef<number | null>(null)

  // --- Media attachments (image/video/voice) ---
  const [uploads, setUploads] = useState<Map<string, UploadState>>(new Map())
  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(new Map())
  const [viewerMedia, setViewerMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null)
  const localMediaUrlsRef = useRef<Map<string, string>>(new Map())
  const pendingRetryRef = useRef<Map<string, () => void>>(new Map())
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // --- Voice recording ---
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [recordLevels, setRecordLevels] = useState<number[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordChunksRef = useRef<Blob[]>([])
  const recordStreamRef = useRef<MediaStream | null>(null)
  const recordTimerRef = useRef<number | null>(null)
  const recordStartedAtRef = useRef(0)
  const recordAudioCtxRef = useRef<AudioContext | null>(null)
  const recordAnalyserRef = useRef<AnalyserNode | null>(null)
  const recordRafRef = useRef<number | null>(null)

  // Tracks whether the user is already near the bottom of the scrollback —
  // an incoming message only force-scrolls if they are (or it's their own
  // just-sent message). Someone scrolled up reading history shouldn't get
  // yanked back down every time the other person sends something.
  const isNearBottomRef = useRef(true)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
    })
  }, [])

  function handleListScroll() {
    const el = listRef.current
    if (!el) return
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  // Mount: mark read, load history, subscribe to live changes. Unmount: leave
  // (permanent-delete sweep for whatever I've already read) and tear down channels.
  useEffect(() => {
    if (!conversationId || !myId) return
    let cancelled = false
    setActiveConversation(conversationId)

    ;(async () => {
      setLoading(true)
      await openConversation(conversationId)
      const [msgs, draft, mode] = await Promise.all([getMessages(conversationId), getDraft(conversationId, myId), getConversationDisappearingMode(conversationId)])
      if (cancelled) return
      setMessages(msgs)
      setInput(draft)
      if (mode) setDisappearingModeState(mode)
      setLoading(false)
      scrollToBottom()
    })()

    const unsubMessages = subscribeToConversation(
      conversationId,
      (m) => {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
        // Preserve reading position: only auto-scroll for an incoming
        // message if the user was already near the bottom, or it's my own
        // message confirming — never yank them away from history they
        // scrolled up to read.
        if (m.sender_id === myId || isNearBottomRef.current) scrollToBottom()
        // A message arriving while I'm actively viewing should be marked read immediately
        // (mirrors "if both users present simultaneously, messages stay until reader exits").
        if (m.sender_id !== myId) openConversation(conversationId)
      },
      (deletedId) => setMessages((prev) => prev.filter((x) => x.id !== deletedId)),
      (updated) => setMessages((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
    )

    const typing = subscribeToTyping(conversationId, myId, () => {
      setOtherTyping(true)
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = window.setTimeout(() => setOtherTyping(false), 3000)
    })
    sendTypingRef.current = typing.sendTyping

    const heartbeat = window.setInterval(() => heartbeatConversation(conversationId), 10000)

    const handleLeaveSignals = () => { leaveConversation(conversationId).catch(() => {}) }
    const handleVisibility = () => { if (document.visibilityState === 'hidden') handleLeaveSignals() }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('beforeunload', handleLeaveSignals)

    return () => {
      cancelled = true
      window.clearInterval(heartbeat)
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current)
      if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current)
      if (modeNoticeTimerRef.current) window.clearTimeout(modeNoticeTimerRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('beforeunload', handleLeaveSignals)
      unsubMessages()
      typing.unsubscribe()
      leaveConversation(conversationId).catch(() => {})
      if (activeConversation.current === conversationId) setActiveConversation(null)
      // Release every local blob: preview URL created for this session's
      // own optimistic media messages — they're only ever needed until the
      // real signed URL takes over.
      localMediaUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
      localMediaUrlsRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, myId])

  // Presence for the header (online/away + server-verified "currently playing").
  useEffect(() => {
    if (!otherUser.id) return
    let cancelled = false
    const poll = async () => {
      const [p] = await getPresence([otherUser.id])
      if (!cancelled && p) {
        setOtherOnline(p.is_online)
        setOtherLastSeenAt(p.last_seen_at)
        setOtherInGame(p.is_in_game ? { name: p.game_name ?? 'a game', nameAr: p.game_name_ar ?? 'لعبة' } : null)
      }
    }
    poll()
    // 15s poll matched to the presence heartbeat's own 20s interval (see
    // src/lib/presenceHeartbeat.ts) plus the 45s server-side freshness
    // window in get_presence() — frequent enough that "just went offline"
    // shows up within about one poll cycle, not tied to any Realtime
    // subscription that could silently stop firing. Also re-polls
    // immediately on foreground so reopening this chat after backgrounding
    // the app never shows a stale Online carried over from before.
    const id = window.setInterval(poll, 15000)
    const onForeground = () => { if (document.visibilityState === 'visible') poll() }
    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('focus', onForeground)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('focus', onForeground)
    }
  }, [otherUser.id])

  // Resolves signed playback/view URLs for any message with media_path that
  // doesn't have one cached yet — the bucket is private, so a raw path is
  // never directly loadable; getChatMediaUrl() itself is RLS-gated (only a
  // conversation participant can generate one) and short-lived-cached.
  useEffect(() => {
    const missing = messages.filter((m) => m.media_path && !signedUrls.has(m.media_path))
    if (!missing.length) return
    let cancelled = false
    ;(async () => {
      const entries: [string, string][] = []
      for (const m of missing) {
        const url = await getChatMediaUrl(m.media_path as string)
        if (url) entries.push([m.media_path as string, url])
      }
      if (!cancelled && entries.length) {
        setSignedUrls((prev) => { const next = new Map(prev); entries.forEach(([k, v]) => next.set(k, v)); return next })
      }
    })()
    return () => { cancelled = true }
  }, [messages, signedUrls])

  function mediaSrcFor(m: ChatMessage): string | null {
    const local = localMediaUrlsRef.current.get(m.id)
    if (local) return local
    if (m.media_path) return signedUrls.get(m.media_path) ?? null
    return null
  }

  function handleInputChange(v: string) {
    setInput(v)
    if (sendError) setSendError(null)
    if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current)
    draftTimerRef.current = window.setTimeout(() => saveDraft(conversationId, myId, v), 500)
    const now = Date.now()
    if (v.trim() && now - lastTypingSentAtRef.current > 2000) {
      lastTypingSentAtRef.current = now
      sendTypingRef.current?.()
    }
  }

  // Watchdog: if a send has been "in flight" since before the app was
  // backgrounded, force-clear it the moment we're foregrounded again.
  // Root cause this specifically targets: on mobile Safari/WKWebView, a
  // fetch in flight when the tab backgrounds can be suspended by the OS
  // and never resolve or reject — and the JS timer inside api.ts's own
  // AbortController timeout can ALSO be suspended along with everything
  // else while backgrounded, so it isn't guaranteed to fire either. This
  // is the second, independent layer: it runs on the 'visible' transition
  // specifically, which is exactly when suspended timers/promises resume
  // or can be safely given up on. Without this, `sending` can stay stuck
  // true forever and every subsequent tap of Send does nothing — which is
  // the exact symptom reported.
  useEffect(() => {
    function handleVisible() {
      if (document.visibilityState !== 'visible') return
      if (!sending || sendStartedAtRef.current === null) return
      const elapsed = Date.now() - sendStartedAtRef.current
      if (elapsed > SEND_STUCK_MS) {
        if (import.meta.env.DEV) console.warn('[chat] send: watchdog force-reset stuck send', { elapsedMs: elapsed })
        setSending(false)
        sendStartedAtRef.current = null
        setSendError(isAr ? 'انتهت مهلة الإرسال. حاول مرة أخرى.' : 'Send timed out. Please try again.')
      }
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => document.removeEventListener('visibilitychange', handleVisible)
  }, [sending, isAr])

  // Handles the actual send RPC plus every failure mode around it:
  // - guarded against double-submit by `sending`, but `sending` is *always*
  //   released in `finally` so a thrown exception (flaky network, tab
  //   backgrounded mid-request on mobile, etc.) can never permanently wedge
  //   the Send button the way it used to.
  // - api.ts's sendMessage() now hard-times-out after 15s via
  //   AbortController, and the visibility watchdog above is a second,
  //   independent layer against the same "request silently hangs forever
  //   on mobile" failure mode — together these make it structurally
  //   impossible for `sending` to stay stuck true indefinitely.
  // - the input is only cleared once the server has confirmed the message
  //   was actually persisted; on any failure the typed text is restored so
  //   nothing is silently lost. Never a fake/optimistic-only success.
  // - failures always surface the exact underlying error text, not just a
  //   generic message, so the real cause is visible rather than guessed at.
  // - everything, including UUID generation, is inside the try block, so
  //   even an unexpected synchronous throw (e.g. crypto.randomUUID
  //   unavailable in some browser context) can never silently no-op the
  //   button — it always reaches the catch block and shows an error.
  async function handleSend() {
    const body = input.trim()
    if (!body || sending) return
    setSending(true)
    setSendError(null)
    sendStartedAtRef.current = Date.now()

    try {
      const clientMessageId = safeRandomUUID()
      // Optimistic append so the sender never waits on round-trip latency;
      // the real row (with a real id) replaces it once the RPC resolves,
      // and the realtime INSERT-dedup-by-id above no-ops if it arrives first.
      const optimistic: ChatMessage = {
        id: `pending-${clientMessageId}`,
        conversation_id: conversationId,
        sender_id: myId,
        body,
        client_message_id: clientMessageId,
        source: variant === 'panel' ? 'game' : 'chat',
        created_at: new Date().toISOString(),
        delivered_at: new Date().toISOString(),
        read_at: null,
        is_saved: false,
        saved_at: null,
        saved_by: null,
        message_type: 'text',
        media_path: null,
        media_thumb_path: null,
        media_mime: null,
        media_size_bytes: null,
        media_duration_seconds: null,
        media_width: null,
        media_height: null,
      }
      setMessages((prev) => [...prev, optimistic])
      scrollToBottom()

      // Debug logging (temporary, per explicit request): the exact
      // request being sent, and who/what conversation it's for.
      // eslint-disable-next-line no-console
      console.debug('[careerxp:chat] send: start', {
        conversationId,
        clientMessageId,
        myId,
        otherUserId: otherUser.id,
        bodyLength: body.length,
      })

      const { id, error } = await sendMessage(conversationId, body, clientMessageId)

      if (error || !id) {
        // eslint-disable-next-line no-console
        console.warn('[careerxp:chat] send: rpc returned error', error)
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
        setInput(body)
        // Shows the exact underlying error text alongside a friendly
        // prefix, per explicit requirement — never just a generic
        // "something went wrong" with the real cause hidden.
        setSendError(
          (isAr ? 'تعذّر إرسال الرسالة: ' : 'Message failed to send: ') + (error || (isAr ? 'خطأ غير معروف' : 'unknown error'))
        )
        return
      }

      // eslint-disable-next-line no-console
      console.debug('[careerxp:chat] send: confirmed', { id })
      setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? { ...m, id } : m)))
      // Only clear the input / draft now that the send is actually confirmed.
      setInput('')
      saveDraft(conversationId, myId, '')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[careerxp:chat] send: threw', err)
      // Remove only the optimistic (still-pending) message(s) — there is
      // at most one in flight at a time thanks to the `sending` guard, so
      // this can never touch already-confirmed real messages.
      setMessages((prev) => prev.filter((m) => !m.id.startsWith('pending-')))
      setInput(body)
      const raw = err instanceof Error ? err.message : String(err)
      setSendError((isAr ? 'حدث خطأ: ' : 'An error occurred: ') + raw)
    } finally {
      // Always released, even on a thrown exception — this is the fix for
      // "Send stays disabled forever after pressing it once."
      setSending(false)
      sendStartedAtRef.current = null
    }
  }

  // Translates validateChatMedia's error *code* into a friendly, localized
  // string — never the raw mime type. This was the actual bug report: a
  // real recording (audio/webm;codecs=opus) was being rejected by an
  // over-strict string comparison and the raw mime was leaking straight
  // into the UI. See normalizeMediaMime's doc comment in api.ts for the
  // underlying fix; this is just the presentation layer for whatever
  // validation still legitimately fails (wrong file type entirely, empty
  // file, oversized file).
  function mediaErrorMessage(code: ChatMediaValidationError, type: ChatAttachmentType): string {
    if (code === 'unsupported_type') {
      if (type === 'voice') return isAr ? 'تعذّر إرسال الرسالة الصوتية — صيغة التسجيل غير مدعومة على هذا الجهاز.' : 'Couldn’t send the voice message — this device recorded it in an unsupported format.'
      if (type === 'video') return isAr ? 'صيغة الفيديو غير مدعومة.' : 'This video format isn’t supported.'
      return isAr ? 'صيغة الصورة غير مدعومة.' : 'This image format isn’t supported.'
    }
    if (code === 'empty') return isAr ? 'الملف فارغ.' : 'That file is empty.'
    const maxMb = Math.round(CHAT_MEDIA_MAX_BYTES[type] / (1024 * 1024))
    return isAr ? `الملف كبير جدًا (الحد الأقصى ${maxMb} ميغابايت).` : `That file is too large (max ${maxMb}MB).`
  }

  // --- Media attachment send pipeline (image/video/voice) ---
  // Mirrors handleSend's exact contract (optimistic append → real RPC →
  // reconcile id, remove-on-failure, never a fake success) but layers real
  // upload progress/cancel/retry on top, since a media send has an extra
  // step (the storage upload) that plain text never needed.
  async function sendMediaAttachment(args: { blob: Blob; type: ChatAttachmentType; mime: string; durationSeconds?: number; width?: number; height?: number }) {
    const validationError = validateChatMedia(args.type, args.mime, args.blob.size)
    if (validationError) { setSendError(mediaErrorMessage(validationError, args.type)); return }

    // Normalize + re-wrap the Blob with the canonical mime *before* it ever
    // touches the network. MediaRecorder blobs in particular report things
    // like "audio/webm;codecs=opus" — normalizing only for our own
    // validation but then uploading the original Blob would just move the
    // same mismatch to the Storage bucket's own allowlist check instead of
    // fixing it. This way the actual Content-Type Storage sees, the mime
    // recorded on the message row, and the extension are always the same
    // clean value everywhere.
    const normalizedMime = normalizeMediaMime(args.mime)
    const blob = args.blob.type === normalizedMime ? args.blob : new Blob([args.blob], { type: normalizedMime })
    const ext = chatMediaExtension(args.type, normalizedMime)

    const clientMessageId = safeRandomUUID()
    const pendingId = `pending-${clientMessageId}`
    const localUrl = URL.createObjectURL(blob)
    localMediaUrlsRef.current.set(pendingId, localUrl)

    const optimistic: ChatMessage = {
      id: pendingId,
      conversation_id: conversationId,
      sender_id: myId,
      body: null,
      client_message_id: clientMessageId,
      source: variant === 'panel' ? 'game' : 'chat',
      created_at: new Date().toISOString(),
      delivered_at: new Date().toISOString(),
      read_at: null,
      is_saved: false,
      saved_at: null,
      saved_by: null,
      message_type: args.type,
      media_path: null,
      media_thumb_path: null,
      media_mime: normalizedMime,
      media_size_bytes: blob.size,
      media_duration_seconds: args.durationSeconds ?? null,
      media_width: args.width ?? null,
      media_height: args.height ?? null,
    }
    setMessages((prev) => [...prev, optimistic])
    scrollToBottom()

    const path = buildChatMediaPath(conversationId, myId, ext)

    const run = () => {
      setUploads((prev) => new Map(prev).set(pendingId, { status: 'uploading', progress: 0, cancel: () => {} }))
      const { promise, cancel } = uploadChatMedia(path, blob, (fraction) => {
        setUploads((prev) => {
          const cur = prev.get(pendingId)
          if (!cur) return prev
          const next = new Map(prev)
          next.set(pendingId, { ...cur, progress: fraction })
          return next
        })
      })
      setUploads((prev) => {
        const cur = prev.get(pendingId)
        const next = new Map(prev)
        next.set(pendingId, { status: 'uploading', progress: cur?.progress ?? 0, cancel })
        return next
      })

      promise.then(async ({ error }) => {
        if (error) {
          if (error === 'cancelled') {
            setMessages((prev) => prev.filter((m) => m.id !== pendingId))
            setUploads((prev) => { const next = new Map(prev); next.delete(pendingId); return next })
            const u = localMediaUrlsRef.current.get(pendingId)
            if (u) { URL.revokeObjectURL(u); localMediaUrlsRef.current.delete(pendingId) }
            return
          }
          setUploads((prev) => new Map(prev).set(pendingId, { status: 'failed', progress: 0, cancel: () => {} }))
          return
        }

        const { id, error: rpcError } = await sendMediaMessage({
          conversationId,
          messageType: args.type,
          mediaPath: path,
          mediaMime: normalizedMime,
          mediaSizeBytes: blob.size,
          clientMessageId,
          durationSeconds: args.durationSeconds,
          width: args.width,
          height: args.height,
        })

        if (rpcError || !id) {
          setUploads((prev) => new Map(prev).set(pendingId, { status: 'failed', progress: 1, cancel: () => {} }))
          return
        }

        setMessages((prev) => prev.map((m) => (m.id === pendingId ? { ...m, id } : m)))
        setUploads((prev) => { const next = new Map(prev); next.delete(pendingId); return next })
      })
    }

    pendingRetryRef.current.set(pendingId, run)
    run()
  }

  function handleRetryUpload(messageId: string) {
    pendingRetryRef.current.get(messageId)?.()
  }
  function handleCancelUpload(messageId: string) {
    uploads.get(messageId)?.cancel()
  }

  async function handleAttachFile(file: File) {
    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    if (!isImage && !isVideo) { setSendError(isAr ? 'نوع ملف غير مدعوم.' : 'Unsupported file type.'); return }
    const type: ChatAttachmentType = isImage ? 'image' : 'video'
    // sendMediaAttachment re-validates + normalizes internally too, but
    // checking here first avoids reading image/video metadata for a file
    // that's going to be rejected anyway.
    const validationError = validateChatMedia(type, file.type, file.size)
    if (validationError) { setSendError(mediaErrorMessage(validationError, type)); return }

    if (isImage) {
      const dims = await getImageDimensions(file)
      await sendMediaAttachment({ blob: file, type: 'image', mime: file.type, width: dims?.width, height: dims?.height })
    } else {
      const meta = await getVideoMeta(file)
      await sendMediaAttachment({ blob: file, type: 'video', mime: file.type, width: meta?.width, height: meta?.height, durationSeconds: meta?.duration })
    }
  }

  // --- Voice recording ---
  function cleanupRecording() {
    if (recordTimerRef.current) { window.clearInterval(recordTimerRef.current); recordTimerRef.current = null }
    if (recordRafRef.current) { cancelAnimationFrame(recordRafRef.current); recordRafRef.current = null }
    recordAnalyserRef.current = null
    if (recordAudioCtxRef.current) { recordAudioCtxRef.current.close().catch(() => {}); recordAudioCtxRef.current = null }
    if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach((t) => t.stop()); recordStreamRef.current = null }
    setRecording(false)
    setRecordLevels([])
  }

  async function startRecording() {
    if (recording) return
    setSendError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recordStreamRef.current = stream
      const preferredType = ['audio/webm', 'audio/mp4'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t))
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined)
      recordChunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordChunksRef.current.push(e.data) }
      recorder.start()
      mediaRecorderRef.current = recorder
      recordStartedAtRef.current = Date.now()
      setRecording(true)
      setRecordSeconds(0)
      recordTimerRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000)

      // Live amplitude bars driven by a real Web Audio analyser — actual
      // input levels while recording, not a canned animation.
      const AudioCtx = getAudioCtor()
      if (AudioCtx) {
        const audioCtx = new AudioCtx()
        recordAudioCtxRef.current = audioCtx
        const source = audioCtx.createMediaStreamSource(stream)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        recordAnalyserRef.current = analyser
        const data = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          if (!recordAnalyserRef.current) return
          recordAnalyserRef.current.getByteTimeDomainData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v }
          const rms = Math.sqrt(sum / data.length)
          setRecordLevels((prev) => {
            const next = [...prev, Math.min(1, rms * 4)]
            return next.length > 28 ? next.slice(-28) : next
          })
          recordRafRef.current = requestAnimationFrame(tick)
        }
        tick()
      }
    } catch {
      setSendError(isAr ? 'تعذّر الوصول إلى الميكروفون.' : 'Could not access the microphone.')
      cleanupRecording()
    }
  }

  function cancelRecording() {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null
      recorder.stop()
    }
    cleanupRecording()
  }

  async function stopRecordingAndSend() {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') { cleanupRecording(); return }
    const elapsedMs = Date.now() - recordStartedAtRef.current

    const finalize = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(recordChunksRef.current, { type: recorder.mimeType || 'audio/webm' }))
    })
    recorder.stop()
    cleanupRecording()

    // Under half a second is treated as an accidental tap and silently
    // discarded — no send, no error, exactly like every mainstream chat app.
    if (elapsedMs < 500) return
    const blob = await finalize
    if (!blob.size) return

    const mime = blob.type || 'audio/webm'
    let durationSeconds: number | undefined
    try {
      const AudioCtx = getAudioCtor()
      if (AudioCtx) {
        const ctx = new AudioCtx()
        const arrayBuffer = await blob.arrayBuffer()
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
        durationSeconds = audioBuffer.duration
        ctx.close().catch(() => {})
      }
    } catch { /* duration is best-effort; upload still proceeds without it and VoiceBubble will decode it again for playback */ }

    // Extension is derived from the normalized mime inside
    // sendMediaAttachment now — MediaRecorder's raw mimeType (e.g.
    // "audio/webm;codecs=opus") is passed through as-is here.
    await sendMediaAttachment({ blob, type: 'voice', mime, durationSeconds })
  }

  // Long-press (mobile) or click-and-hold (desktop) on a real (non-pending)
  // message opens the Save/Unsave action sheet. A short tap or a drag/scroll
  // never fires it (guarded by longPressFiredRef + a 500ms threshold).
  function handlePressStart(m: ChatMessage) {
    if (m.id.startsWith('pending-')) return
    longPressFiredRef.current = false
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true
      setActionMessage(m)
    }, 500)
  }
  function handlePressEnd() {
    if (longPressTimerRef.current) { window.clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
  }

  async function handleToggleSave() {
    if (!actionMessage || savePending) return
    const target = actionMessage
    const nextSaved = !target.is_saved
    setSavePending(true)
    if (import.meta.env.DEV) console.debug('[chat] toggleSave: start', { id: target.id, nextSaved })
    try {
      const { message, error } = await toggleSaveMessage(target.id, nextSaved)
      if (error || !message) {
        if (import.meta.env.DEV) console.warn('[chat] toggleSave: failed', error)
        setSendError(isAr ? 'تعذّر تحديث حالة الحفظ. حاول مرة أخرى.' : 'Could not update saved status. Try again.')
      } else {
        setMessages((prev) => prev.map((x) => (x.id === message.id ? message : x)))
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('[chat] toggleSave: threw', err)
      setSendError(isAr ? 'حدث خطأ في الاتصال.' : 'A connection error occurred.')
    } finally {
      setSavePending(false)
      setActionMessage(null)
    }
  }

  const modeLabel = (m: DisappearingMode) => {
    if (m === 'keep_forever') return isAr ? 'الاحتفاظ للأبد' : 'Keep Forever'
    if (m === 'delete_24h') return isAr ? 'الحذف بعد 24 ساعة' : 'Delete After 24 Hours'
    return isAr ? 'الحذف بعد القراءة ومغادرة المحادثة' : 'Delete After Read + User Leaves Chat'
  }

  // Applies a new per-conversation disappearing-message mode. This is a
  // property of the shared conversation (not per-user), matching Snapchat's
  // model — either participant can change it and it takes effect for both.
  async function handleSelectMode(mode: DisappearingMode) {
    if (mode === disappearingMode || modePending) { setModeMenuOpen(false); return }
    setModePending(true)
    const previous = disappearingMode
    setDisappearingModeState(mode)
    try {
      const { error } = await setConversationDisappearingMode(conversationId, mode)
      if (error) {
        setDisappearingModeState(previous)
        setSendError(isAr ? 'تعذّر تحديث إعداد الرسائل المؤقتة.' : 'Could not update disappearing messages setting.')
      } else {
        if (modeNoticeTimerRef.current) window.clearTimeout(modeNoticeTimerRef.current)
        setModeNotice(isAr ? `تم التغيير إلى: ${modeLabel(mode)}` : `Changed to: ${modeLabel(mode)}`)
        modeNoticeTimerRef.current = window.setTimeout(() => setModeNotice(null), 4000)
      }
    } catch {
      setDisappearingModeState(previous)
      setSendError(isAr ? 'حدث خطأ في الاتصال.' : 'A connection error occurred.')
    } finally {
      setModePending(false)
      setModeMenuOpen(false)
    }
  }

  function renderUploadOverlay(upload: UploadState | undefined, messageId: string) {
    if (!upload) return null
    if (upload.status === 'uploading') {
      return (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.25)', borderTopColor: '#fff', animation: 'star-spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 10, color: '#fff', fontWeight: 700 }}>{Math.round(upload.progress * 100)}%</span>
          <button onClick={() => handleCancelUpload(messageId)} style={{ fontSize: 10, color: '#fff', background: 'rgba(255,255,255,0.18)', border: 'none', borderRadius: 8, padding: '3px 9px', cursor: 'pointer' }}>
            {isAr ? 'إلغاء' : 'Cancel'}
          </button>
        </div>
      )
    }
    return (
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: '#f87171', fontWeight: 700 }}>{isAr ? 'فشل الرفع' : 'Upload failed'}</span>
        <button onClick={() => handleRetryUpload(messageId)} style={{ fontSize: 10, color: '#fff', background: 'rgba(124,58,237,0.85)', border: 'none', borderRadius: 8, padding: '4px 11px', cursor: 'pointer', fontWeight: 700 }}>
          {isAr ? 'إعادة المحاولة' : 'Retry'}
        </button>
      </div>
    )
  }

  function renderMediaContent(m: ChatMessage, mine: boolean) {
    const src = mediaSrcFor(m)
    const upload = uploads.get(m.id)

    if (m.message_type === 'image') {
      return (
        <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', width: 210 }}>
          {src ? (
            <img
              src={src}
              alt=""
              onClick={() => { if (!longPressFiredRef.current) setViewerMedia({ url: src, type: 'image' }) }}
              style={{ display: 'block', width: '100%', height: 190, objectFit: 'cover', cursor: 'pointer' }}
            />
          ) : (
            <div style={{ width: '100%', height: 190, background: 'rgba(var(--fg-rgb),0.08)' }} />
          )}
          {renderUploadOverlay(upload, m.id)}
        </div>
      )
    }

    if (m.message_type === 'video') {
      return (
        <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', width: 210 }}>
          {src ? (
            <video src={src} preload="metadata" muted style={{ display: 'block', width: '100%', height: 190, objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: 190, background: 'rgba(var(--fg-rgb),0.08)' }} />
          )}
          {src && !upload && (
            <button
              onClick={() => setViewerMedia({ url: src, type: 'video' })}
              aria-label={isAr ? 'تشغيل الفيديو' : 'Play video'}
              style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.22)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>▶</span>
              {m.media_duration_seconds != null && (
                <span style={{ position: 'absolute', bottom: 6, right: isAr ? undefined : 8, left: isAr ? 8 : undefined, fontSize: 10, color: '#fff', background: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: '2px 6px' }}>
                  {formatDuration(m.media_duration_seconds)}
                </span>
              )}
            </button>
          )}
          {renderUploadOverlay(upload, m.id)}
        </div>
      )
    }

    // voice
    return (
      <div style={{ position: 'relative' }}>
        <VoiceBubble src={src} mine={mine} isAr={isAr} cachedDurationSeconds={m.media_duration_seconds} />
        {upload && (
          <div style={{ position: 'absolute', inset: -4, borderRadius: 14, background: upload.status === 'failed' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {upload.status === 'uploading' ? (
              <>
                <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', animation: 'star-spin 0.8s linear infinite' }} />
                <button onClick={() => handleCancelUpload(m.id)} style={{ fontSize: 10, color: '#fff', background: 'rgba(255,255,255,0.18)', border: 'none', borderRadius: 8, padding: '3px 8px', cursor: 'pointer' }}>
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
              </>
            ) : (
              <>
                <span style={{ fontSize: 10, color: '#f87171', fontWeight: 700 }}>{isAr ? 'فشل' : 'Failed'}</span>
                <button onClick={() => handleRetryUpload(m.id)} style={{ fontSize: 10, color: '#fff', background: 'rgba(124,58,237,0.85)', border: 'none', borderRadius: 8, padding: '3px 9px', cursor: 'pointer', fontWeight: 700 }}>
                  {isAr ? 'إعادة' : 'Retry'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  const isPanel = variant === 'panel'
  const composerHasText = input.trim().length > 0

  return (
    <div
      style={
        isPanel
          ? { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-1)', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(var(--fg-rgb),0.1)' }
          : { position: 'fixed', inset: 0, zIndex: 400, background: 'var(--background)', display: 'flex', flexDirection: 'column' }
      }
    >
      {/* Header — the full-screen variant (isPanel === false, used for the
          standalone friend-chat route opened from FriendsScreen) is
          `position: fixed, inset: 0` with nothing above it, so it needs its
          own top/left/right safe-area padding same as any other full-screen
          header; the embedded panel variant (used inside GameChatPanel)
          lives inside an already-safe-area-padded parent, so it keeps its
          flat padding. */}
      <div className="glass" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: isPanel ? '10px 14px' : '14px 16px', paddingTop: isPanel ? undefined : safeTop(14), paddingLeft: isPanel ? undefined : safeLeft(16), paddingRight: isPanel ? undefined : safeRight(16), flexShrink: 0 }}>
        <button onClick={onClose} aria-label={isAr ? 'رجوع' : 'Back'} style={{ background: 'rgba(var(--fg-rgb),0.08)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 10, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 15, color: 'var(--foreground)', ...tapTarget(34, 34) }}>
          {isPanel ? '✕' : (isAr ? '→' : '←')}
        </button>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Avatar url={otherUser.avatar_url} size={isPanel ? 32 : 40} style={{ border: '2px solid rgba(124,58,237,0.3)' }} />
          <div style={{ position: 'absolute', bottom: 0, right: isAr ? 'auto' : 0, left: isAr ? 0 : 'auto', width: 11, height: 11, borderRadius: '50%', background: otherOnline ? '#10b981' : '#4b5563', border: '2px solid var(--surface-1)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{otherUser.username}</p>
          <p style={{ margin: 0, fontSize: 11, color: otherOnline ? '#10b981' : 'rgba(var(--fg-rgb),0.35)' }}>
            {otherTyping
              ? (isAr ? 'يكتب الآن…' : 'typing…')
              : otherInGame
                ? (isAr ? `يلعب الآن: ${otherInGame.nameAr}` : `Playing ${otherInGame.name}`)
                : formatPresence(otherOnline, otherLastSeenAt, isAr)}
          </p>
        </div>
        <button
          onClick={() => setModeMenuOpen(true)}
          title={isAr ? 'إعدادات المحادثة' : 'Conversation settings'}
          aria-label={isAr ? 'إعدادات المحادثة' : 'Conversation settings'}
          style={{ background: 'rgba(var(--fg-rgb),0.08)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 10, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 17, lineHeight: 1, color: 'var(--foreground)', flexShrink: 0, ...tapTarget(34, 34) }}
        >
          ⋮
        </button>
      </div>

      {/* Transient confirmation banner after changing the disappearing-message mode */}
      {modeNotice && (
        <div style={{ padding: '6px 14px 0', flexShrink: 0, textAlign: 'center' }}>
          <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, color: 'rgba(var(--fg-rgb),0.55)', background: 'rgba(var(--fg-rgb),0.06)', borderRadius: 10, padding: '4px 12px' }}>
            {modeNotice}
          </span>
        </div>
      )}

      {/* Messages */}
      <div ref={listRef} onScroll={handleListScroll} style={{ flex: 1, overflowY: 'auto', padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 8, WebkitOverflowScrolling: 'touch' }}>
        {loading && (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(var(--fg-rgb),0.4)', margin: '20px 0' }}>{isAr ? 'جارٍ التحميل...' : 'Loading…'}</p>
        )}
        {!loading && messages.length === 0 && (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(var(--fg-rgb),0.35)', margin: '30px 0' }}>
            {isAr ? 'لا توجد رسائل بعد. قل مرحبًا!' : 'No messages yet. Say hi!'}
          </p>
        )}
        {messages.map((m, i) => {
          const mine = m.sender_id === myId
          const isMedia = m.message_type !== 'text'
          const prev = messages[i - 1]
          // Groups consecutive messages from the same sender closer together
          // (tighter gap) for a more premium, less choppy rhythm — a purely
          // visual grouping, no data/logic change.
          const grouped = prev && prev.sender_id === m.sender_id
          return (
            <div
              key={m.id}
              style={{
                display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: grouped ? -3 : 2,
                animation: 'chat-bubble-in 0.22s cubic-bezier(.2,.8,.2,1)',
              }}
            >
              <div
                onPointerDown={() => handlePressStart(m)}
                onPointerUp={handlePressEnd}
                onPointerLeave={handlePressEnd}
                onPointerCancel={handlePressEnd}
                onContextMenu={(e) => { if (!m.id.startsWith('pending-')) { e.preventDefault(); setActionMessage(m) } }}
                style={{
                  maxWidth: '76%',
                  padding: isMedia && !m.body ? 5 : '9px 13px',
                  borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: mine ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(var(--fg-rgb),0.06)',
                  color: mine ? '#fff' : 'var(--foreground)',
                  border: m.is_saved ? '1px solid rgba(250,204,21,0.55)' : mine ? 'none' : '1px solid rgba(var(--fg-rgb),0.08)',
                  direction: m.body && /[؀-ۿ]/.test(m.body) ? 'rtl' : 'ltr',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  touchAction: 'manipulation',
                  cursor: 'pointer',
                  boxShadow: mine ? '0 2px 10px rgba(124,58,237,0.25)' : 'none',
                }}
              >
                {isMedia && renderMediaContent(m, mine)}
                {m.body && <p style={{ margin: isMedia ? '6px 4px 0' : 0, fontSize: 13.5, lineHeight: 1.4, wordBreak: 'break-word' }}>{m.body}</p>}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end', marginTop: isMedia && !m.body ? 2 : 3, padding: isMedia && !m.body ? '0 4px 2px' : 0 }}>
                  {m.is_saved && <span title={isAr ? 'محفوظة' : 'Saved'} style={{ fontSize: 9.5, opacity: 0.8 }}>📌</span>}
                  <span style={{ fontSize: 9.5, opacity: 0.65 }}>{timeShort(m.created_at)}</span>
                  {mine && (
                    <span style={{ fontSize: 9.5, opacity: m.id.startsWith('pending-') ? 0.45 : 0.65 }}>
                      {m.id.startsWith('pending-') ? '🕓' : m.read_at ? '✓✓' : '✓'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Full-screen image/video viewer */}
      {viewerMedia && (
        <div
          onClick={() => setViewerMedia(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 700, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: safeTop(0), paddingBottom: safeBottom(0) }}
        >
          <button
            onClick={() => setViewerMedia(null)}
            aria-label={isAr ? 'إغلاق' : 'Close'}
            style={{ position: 'absolute', top: safeTop(16), right: isAr ? undefined : safeRight(16), left: isAr ? safeLeft(16) : undefined, width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', fontSize: 16, cursor: 'pointer', ...tapTarget(38, 38) }}
          >
            ✕
          </button>
          {viewerMedia.type === 'image' ? (
            <img src={viewerMedia.url} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '94vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 8 }} />
          ) : (
            <video src={viewerMedia.url} onClick={(e) => e.stopPropagation()} controls autoPlay playsInline style={{ maxWidth: '94vw', maxHeight: '88vh', borderRadius: 8 }} />
          )}
        </div>
      )}

      {/* Save / Unsave action sheet — long-press (mobile) or right-click (desktop) on any real message */}
      {actionMessage && (
        <div
          onClick={() => setActionMessage(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass"
            style={{ width: '100%', maxWidth: 420, borderRadius: '18px 18px 0 0', padding: '10px 0 max(10px, env(safe-area-inset-bottom))' }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(var(--fg-rgb),0.2)', margin: '4px auto 10px' }} />
            <button
              onClick={handleToggleSave}
              disabled={savePending}
              style={{
                width: '100%', textAlign: isAr ? 'right' : 'left', padding: '13px 20px', background: 'none', border: 'none',
                fontSize: 14, fontWeight: 600, color: 'var(--foreground)', cursor: savePending ? 'default' : 'pointer', opacity: savePending ? 0.6 : 1,
              }}
            >
              {actionMessage.is_saved
                ? (isAr ? 'إلغاء الحفظ' : 'Unsave from Chat')
                : (isAr ? 'حفظ في المحادثة' : 'Save in Chat')}
            </button>
            <button
              onClick={() => setActionMessage(null)}
              style={{ width: '100%', textAlign: 'center', padding: '13px 20px', background: 'none', border: 'none', borderTop: '1px solid rgba(var(--fg-rgb),0.08)', fontSize: 13.5, color: 'rgba(var(--fg-rgb),0.5)', cursor: 'pointer', marginTop: 4 }}
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Disappearing-messages conversation settings — one mode per shared
          conversation (not per-user), exactly like Snapchat's chat settings.
          Changing it never touches already-existing messages retroactively;
          it only changes how future leave/expiry sweeps behave from here on. */}
      {modeMenuOpen && (
        <div
          onClick={() => !modePending && setModeMenuOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass"
            style={{ width: '100%', maxWidth: 420, borderRadius: '18px 18px 0 0', padding: '10px 0 max(10px, env(safe-area-inset-bottom))' }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(var(--fg-rgb),0.2)', margin: '4px auto 6px' }} />
            <p style={{ margin: '2px 20px 10px', fontSize: 12.5, fontWeight: 700, color: 'rgba(var(--fg-rgb),0.5)', textAlign: isAr ? 'right' : 'left' }}>
              {isAr ? 'الرسائل المؤقتة' : 'Disappearing Messages'}
            </p>
            {(['keep_forever', 'delete_24h', 'read_leave'] as DisappearingMode[]).map((m) => {
              const selected = m === disappearingMode
              const desc = m === 'keep_forever'
                ? (isAr ? 'لا يتم حذف أي رسالة تلقائيًا' : 'No message is ever auto-deleted')
                : m === 'delete_24h'
                  ? (isAr ? 'تُحذف كل رسالة بعد 24 ساعة من إرسالها' : 'Each message is deleted 24 hours after it’s sent')
                  : (isAr ? 'تُحذف الرسالة بعد قراءتها ومغادرة الطرفين للمحادثة' : 'A message is deleted once it’s been read and you leave the chat')
              return (
                <button
                  key={m}
                  onClick={() => handleSelectMode(m)}
                  disabled={modePending}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: isAr ? 'right' : 'left',
                    padding: '11px 20px', background: selected ? 'rgba(124,58,237,0.1)' : 'none', border: 'none',
                    borderTop: m !== 'keep_forever' ? '1px solid rgba(var(--fg-rgb),0.08)' : 'none',
                    cursor: modePending ? 'default' : 'pointer', opacity: modePending && !selected ? 0.5 : 1,
                    flexDirection: isAr ? 'row-reverse' : 'row',
                  }}
                >
                  <span style={{ marginTop: 2, flexShrink: 0, width: 16, height: 16, borderRadius: '50%', border: `2px solid ${selected ? '#7c3aed' : 'rgba(var(--fg-rgb),0.25)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {selected && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7c3aed' }} />}
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>{modeLabel(m)}</span>
                    <span style={{ display: 'block', fontSize: 11.5, marginTop: 1, color: 'rgba(var(--fg-rgb),0.45)' }}>{desc}</span>
                  </span>
                </button>
              )
            })}
            <button
              onClick={() => setModeMenuOpen(false)}
              style={{ width: '100%', textAlign: 'center', padding: '13px 20px', background: 'none', border: 'none', borderTop: '1px solid rgba(var(--fg-rgb),0.08)', fontSize: 13.5, color: 'rgba(var(--fg-rgb),0.5)', cursor: 'pointer', marginTop: 4 }}
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Send error */}
      {sendError && (
        <div style={{ padding: '6px 14px', flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: 11.5, color: '#f87171', textAlign: isAr ? 'right' : 'left' }}>{sendError}</p>
        </div>
      )}

      {/* Recording indicator — replaces the composer entirely while active,
          exactly like Snapchat/WhatsApp: hold the mic to record, release to
          send, tap ✕ to cancel without sending. */}
      {recording && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: isPanel ? '8px 10px' : '10px 14px',
          paddingBottom: isPanel ? undefined : safeBottom(10), paddingLeft: isPanel ? undefined : safeLeft(14), paddingRight: isPanel ? undefined : safeRight(14),
          borderTop: '1px solid rgba(var(--fg-rgb),0.08)', flexShrink: 0,
        }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', flexShrink: 0, animation: 'live-pulse 1.1s ease-in-out infinite' }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--foreground)', flexShrink: 0, minWidth: 34 }}>{formatDuration(recordSeconds)}</span>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2, height: 22, overflow: 'hidden' }}>
            {recordLevels.length === 0 && <span style={{ fontSize: 11, color: 'rgba(var(--fg-rgb),0.4)' }}>{isAr ? 'جارٍ الاستماع…' : 'Listening…'}</span>}
            {recordLevels.map((v, i) => (
              <span key={i} style={{ width: 2.5, borderRadius: 2, height: Math.max(3, v * 20), background: '#ef4444', flexShrink: 0 }} />
            ))}
          </div>
          <button
            onClick={cancelRecording}
            aria-label={isAr ? 'إلغاء التسجيل' : 'Cancel recording'}
            style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, background: 'rgba(var(--fg-rgb),0.08)', border: '1px solid rgba(var(--fg-rgb),0.1)', color: 'var(--foreground)', fontSize: 14, cursor: 'pointer', ...tapTarget(34, 34) }}
          >
            ✕
          </button>
          <button
            onClick={stopRecordingAndSend}
            aria-label={isAr ? 'إرسال الرسالة الصوتية' : 'Send voice message'}
            style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', border: 'none', color: '#fff', fontSize: 14, cursor: 'pointer', ...tapTarget(34, 34) }}
          >
            ➤
          </button>
        </div>
      )}

      {/* Composer — full-screen variant needs its own bottom/left/right
          safe-area clearance (home indicator, landscape notch) since this
          is the last element in a `position: fixed, inset: 0` screen with
          no bottom nav below it. Panel variant sits inside GameChatPanel's
          own safe-area-padded wrapper, so it's left alone. */}
      {!recording && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center', padding: isPanel ? '8px 10px' : '10px 14px',
          paddingBottom: isPanel ? undefined : safeBottom(10),
          paddingLeft: isPanel ? undefined : safeLeft(14),
          paddingRight: isPanel ? undefined : safeRight(14),
          borderTop: '1px solid rgba(var(--fg-rgb),0.08)', flexShrink: 0,
        }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) handleAttachFile(file)
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            aria-label={isAr ? 'إرفاق صورة أو فيديو' : 'Attach photo or video'}
            style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 10, background: 'rgba(var(--fg-rgb),0.08)', border: '1px solid rgba(var(--fg-rgb),0.1)', color: 'var(--foreground)', fontSize: 15, cursor: 'pointer', ...tapTarget(36, 36) }}
          >
            📎
          </button>
          <input
            type="text"
            value={input}
            placeholder={isAr ? 'اكتب رسالة…' : 'Type a message…'}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
            style={{ flex: 1, fontSize: 13.5 }}
          />
          {composerHasText ? (
            <button
              onClick={handleSend}
              disabled={sending}
              aria-label={isAr ? 'إرسال' : 'Send'}
              style={{
                flexShrink: 0, padding: '0 16px', height: 36, borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', color: '#fff', fontSize: 13, fontWeight: 700,
              }}
            >
              {isAr ? 'إرسال' : 'Send'}
            </button>
          ) : (
            <button
              onPointerDown={(e) => { e.preventDefault(); startRecording() }}
              onPointerUp={stopRecordingAndSend}
              onPointerLeave={() => { if (recording) cancelRecording() }}
              onPointerCancel={cancelRecording}
              aria-label={isAr ? 'اضغط مطولاً لتسجيل رسالة صوتية' : 'Hold to record a voice message'}
              style={{
                flexShrink: 0, width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', color: '#fff', fontSize: 15,
                display: 'flex', alignItems: 'center', justifyContent: 'center', ...tapTarget(36, 36),
              }}
            >
              🎤
            </button>
          )}
        </div>
      )}
    </div>
  )
}
