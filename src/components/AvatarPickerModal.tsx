import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent } from 'react'
import type { Lang } from '../App'
import Avatar from './Avatar'
import { BUILTIN_AVATARS, updateProfile, uploadAvatar } from '../lib/api'
import { safeTop, safeBottom, safeLeft, safeRight } from '../lib/safeArea'

interface Props {
  lang: Lang
  userId: string
  currentAvatarUrl: string | null
  onClose: () => void
  onSaved: (newAvatarUrl: string) => void
}

const CANVAS_SIZE = 260 // on-screen preview + exported resolution (square PNG; displayed as a circle via <Avatar>)
const MIN_ZOOM = 1
const MAX_ZOOM = 3

export default function AvatarPickerModal({ lang, userId, currentAvatarUrl, onClose, onSaved }: Props) {
  const isAr = lang === 'ar'
  const [tab, setTab] = useState<'builtin' | 'upload'>('builtin')
  const [selectedBuiltin, setSelectedBuiltin] = useState<string | null>(
    currentAvatarUrl?.startsWith('builtin:') ? currentAvatarUrl.slice('builtin:'.length) : null
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Upload/crop state
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [hasImage, setHasImage] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; startOffX: number; startOffY: number }>({
    dragging: false, startX: 0, startY: 0, startOffX: 0, startOffY: 0,
  })

  const clampOffset = (img: HTMLImageElement, z: number, off: { x: number; y: number }) => {
    const baseScale = Math.max(CANVAS_SIZE / img.naturalWidth, CANVAS_SIZE / img.naturalHeight)
    const scale = baseScale * z
    const drawW = img.naturalWidth * scale
    const drawH = img.naturalHeight * scale
    const maxOffX = Math.max(0, (drawW - CANVAS_SIZE) / 2)
    const maxOffY = Math.max(0, (drawH - CANVAS_SIZE) / 2)
    return { x: Math.min(maxOffX, Math.max(-maxOffX, off.x)), y: Math.min(maxOffY, Math.max(-maxOffY, off.y)) }
  }

  const draw = () => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const baseScale = Math.max(CANVAS_SIZE / img.naturalWidth, CANVAS_SIZE / img.naturalHeight)
    const scale = baseScale * zoom
    const drawW = img.naturalWidth * scale
    const drawH = img.naturalHeight * scale
    const dx = (CANVAS_SIZE - drawW) / 2 + offset.x
    const dy = (CANVAS_SIZE - drawH) / 2 + offset.y
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    ctx.drawImage(img, dx, dy, drawW, drawH)
  }

  useEffect(() => { if (hasImage) draw() }, [zoom, offset, hasImage])

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError(isAr ? 'الرجاء اختيار ملف صورة' : 'Please choose an image file'); return }
    if (file.size > 8 * 1024 * 1024) { setError(isAr ? 'الحد الأقصى لحجم الصورة 8 ميجابايت' : 'Image must be under 8MB'); return }

    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      setZoom(1)
      setOffset({ x: 0, y: 0 })
      setHasImage(true)
      URL.revokeObjectURL(url)
    }
    img.onerror = () => setError(isAr ? 'تعذّر تحميل الصورة' : 'Could not load that image')
    img.src = url
  }

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, startOffX: offset.x, startOffY: offset.y }
    ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.dragging || !imgRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setOffset(clampOffset(imgRef.current, zoom, { x: dragRef.current.startOffX + dx, y: dragRef.current.startOffY + dy }))
  }
  const onPointerUp = () => { dragRef.current.dragging = false }

  const handleZoomChange = (z: number) => {
    setZoom(z)
    if (imgRef.current) setOffset((prev) => clampOffset(imgRef.current!, z, prev))
  }

  const handleSaveBuiltin = async () => {
    if (!selectedBuiltin) return
    setSaving(true); setError(null)
    const { error: err } = await updateProfile(userId, { avatar_url: `builtin:${selectedBuiltin}` })
    setSaving(false)
    if (err) { setError(err); return }
    onSaved(`builtin:${selectedBuiltin}`)
  }

  const handleSaveUpload = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    setSaving(true); setError(null)
    canvas.toBlob(async (blob) => {
      if (!blob) { setSaving(false); setError(isAr ? 'فشل تصدير الصورة' : 'Failed to process image'); return }
      const { url, error: upErr } = await uploadAvatar(userId, blob)
      if (upErr || !url) { setSaving(false); setError(upErr ?? 'Upload failed'); return }
      const { error: profErr } = await updateProfile(userId, { avatar_url: url })
      setSaving(false)
      if (profErr) { setError(profErr); return }
      onSaved(url)
    }, 'image/png', 0.92)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(3,3,15,0.9)', backdropFilter: 'blur(16px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        paddingTop: safeTop(16), paddingBottom: safeBottom(16), paddingLeft: safeLeft(16), paddingRight: safeRight(16),
        overflowY: 'auto',
      }}
    >
      <div
        className="card animate-slide-up"
        style={{ width: '100%', maxWidth: 420, padding: '24px 20px', background: 'linear-gradient(160deg, rgba(124,58,237,0.1) 0%, rgba(0,212,255,0.06) 100%)', border: '1px solid rgba(124,58,237,0.22)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={isAr ? 'font-cairo' : 'font-display'} style={{ fontSize: 18, fontWeight: 800, color: 'var(--foreground)', margin: '0 0 16px', textAlign: 'center' }}>
          {isAr ? 'صورة الملف الشخصي' : 'Profile Picture'}
        </h2>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, background: 'rgba(var(--fg-rgb),0.04)', borderRadius: 12, padding: 4, marginBottom: 18 }}>
          {(['builtin', 'upload'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '9px', borderRadius: 9, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 700,
                background: tab === t ? 'linear-gradient(135deg, #7c3aed, #5b21b6)' : 'transparent',
                color: tab === t ? 'white' : 'rgba(var(--fg2-rgb),0.5)',
                fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif",
              }}
            >
              {t === 'builtin' ? (isAr ? 'الصور الجاهزة' : 'Built-in') : (isAr ? 'رفع صورة' : 'Upload')}
            </button>
          ))}
        </div>

        {tab === 'builtin' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
              {BUILTIN_AVATARS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedBuiltin(a.id)}
                  style={{
                    background: 'none', border: selectedBuiltin === a.id ? '2px solid #9d6fff' : '2px solid transparent',
                    borderRadius: '50%', padding: 3, cursor: 'pointer',
                  }}
                >
                  <Avatar url={`builtin:${a.id}`} size={56} />
                </button>
              ))}
            </div>
            {error && <p style={{ margin: '0 0 12px', fontSize: 12, color: '#ff4785' }}>{error}</p>}
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSaveBuiltin} disabled={!selectedBuiltin || saving}>
              {saving ? (isAr ? 'جارٍ الحفظ...' : 'Saving…') : (isAr ? 'حفظ' : 'Save')}
            </button>
          </>
        ) : (
          <>
            {!hasImage ? (
              <label
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                  height: 200, borderRadius: 16, border: '2px dashed rgba(157,111,255,0.35)',
                  background: 'rgba(157,111,255,0.05)', cursor: 'pointer', marginBottom: 16,
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9d6fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17,8 12,3 7,8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span style={{ fontSize: 13, color: 'rgba(var(--fg2-rgb),0.6)' }}>{isAr ? 'اختر صورة من جهازك' : 'Choose a photo from your device'}</span>
                <input type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
              </label>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                  <div style={{ width: CANVAS_SIZE, height: CANVAS_SIZE, borderRadius: '50%', overflow: 'hidden', border: '2px solid rgba(157,111,255,0.4)', boxShadow: '0 0 24px rgba(124,58,237,0.25)' }}>
                    <canvas
                      ref={canvasRef}
                      width={CANVAS_SIZE}
                      height={CANVAS_SIZE}
                      style={{ touchAction: 'none', cursor: 'grab' }}
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerLeave={onPointerUp}
                    />
                  </div>
                </div>
                <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(var(--fg2-rgb),0.45)', margin: '0 0 10px' }}>
                  {isAr ? 'اسحب لإعادة التموضع' : 'Drag to reposition'}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg2-rgb),0.5)" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  <input
                    type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.05} value={zoom}
                    onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg2-rgb),0.5)" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                </div>
                <button
                  onClick={() => { setHasImage(false); imgRef.current = null }}
                  style={{ background: 'none', border: 'none', color: 'rgba(var(--fg2-rgb),0.5)', fontSize: 12, cursor: 'pointer', width: '100%', textAlign: 'center', marginBottom: 12 }}
                >
                  {isAr ? '← اختر صورة أخرى' : '← Choose a different photo'}
                </button>
              </>
            )}
            {error && <p style={{ margin: '0 0 12px', fontSize: 12, color: '#ff4785' }}>{error}</p>}
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSaveUpload} disabled={!hasImage || saving}>
              {saving ? (isAr ? 'جارٍ الرفع...' : 'Uploading…') : (isAr ? 'حفظ' : 'Save')}
            </button>
          </>
        )}

        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(var(--fg2-rgb),0.4)', fontSize: 12, cursor: 'pointer', width: '100%', textAlign: 'center', marginTop: 14 }}>
          {isAr ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}
