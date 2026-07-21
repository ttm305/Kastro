import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent } from 'react'
import type { Lang } from '../App'
import { updateProfile, uploadHeader, removeHeader } from '../lib/api'

interface Props {
  lang: Lang
  userId: string
  currentHeaderUrl: string | null
  onClose: () => void
  /** newHeaderUrl is null when the header was removed rather than replaced. */
  onSaved: (newHeaderUrl: string | null) => void
}

// 3:1 cover ratio, matched to a mobile card width. The on-screen canvas is
// kept small for a smooth touch-drag experience; the actual uploaded file is
// re-rendered onto a separate, higher-resolution offscreen canvas at save
// time (see handleSave) so the stored image doesn't inherit the low
// resolution of the interactive preview.
const PREVIEW_W = 330
const PREVIEW_H = 110
const EXPORT_W = 1200
const EXPORT_H = 400
const MIN_ZOOM = 1
const MAX_ZOOM = 3
const MAX_FILE_BYTES = 10 * 1024 * 1024
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export default function HeaderPickerModal({ lang, userId, currentHeaderUrl, onClose, onSaved }: Props) {
  const isAr = lang === 'ar'
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [hasImage, setHasImage] = useState(false)
  const [imageLoading, setImageLoading] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; startOffX: number; startOffY: number }>({
    dragging: false, startX: 0, startY: 0, startOffX: 0, startOffY: 0,
  })

  const clampOffset = (img: HTMLImageElement, z: number, off: { x: number; y: number }, w = PREVIEW_W, h = PREVIEW_H) => {
    const baseScale = Math.max(w / img.naturalWidth, h / img.naturalHeight)
    const scale = baseScale * z
    const drawW = img.naturalWidth * scale
    const drawH = img.naturalHeight * scale
    const maxOffX = Math.max(0, (drawW - w) / 2)
    const maxOffY = Math.max(0, (drawH - h) / 2)
    return { x: Math.min(maxOffX, Math.max(-maxOffX, off.x)), y: Math.min(maxOffY, Math.max(-maxOffY, off.y)) }
  }

  const draw = () => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const baseScale = Math.max(PREVIEW_W / img.naturalWidth, PREVIEW_H / img.naturalHeight)
    const scale = baseScale * zoom
    const drawW = img.naturalWidth * scale
    const drawH = img.naturalHeight * scale
    const dx = (PREVIEW_W - drawW) / 2 + offset.x
    const dy = (PREVIEW_H - drawH) / 2 + offset.y
    ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H)
    ctx.drawImage(img, dx, dy, drawW, drawH)
  }

  useEffect(() => { if (hasImage) draw() }, [zoom, offset, hasImage])

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setError(null)
    setSuccess(false)
    const file = e.target.files?.[0]
    if (!file) return
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(isAr ? 'الصيغ المدعومة: JPEG أو PNG أو WebP فقط' : 'Only JPEG, PNG, or WebP images are supported')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(isAr ? 'الحد الأقصى لحجم الصورة 10 ميجابايت' : 'Image must be under 10MB')
      return
    }

    setImageLoading(true)
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      setZoom(1)
      setOffset({ x: 0, y: 0 })
      setHasImage(true)
      setImageLoading(false)
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      setImageLoading(false)
      setError(isAr ? 'تعذّر تحميل الصورة' : 'Could not load that image')
    }
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

  const handleSave = async () => {
    const img = imgRef.current
    if (!img) return
    setSaving(true); setError(null); setSuccess(false)

    // Re-render at export resolution using the exact same crop math, scaled
    // up from the preview's coordinate space — what the user sees while
    // dragging/zooming is exactly what gets uploaded, just at real
    // resolution instead of the small interactive preview's.
    const scaleFactor = EXPORT_W / PREVIEW_W
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = EXPORT_W
    exportCanvas.height = EXPORT_H
    const ctx = exportCanvas.getContext('2d')
    if (!ctx) { setSaving(false); setError(isAr ? 'فشل تصدير الصورة' : 'Failed to process image'); return }
    const baseScale = Math.max(PREVIEW_W / img.naturalWidth, PREVIEW_H / img.naturalHeight)
    const scale = baseScale * zoom * scaleFactor
    const drawW = img.naturalWidth * scale
    const drawH = img.naturalHeight * scale
    const dx = (EXPORT_W - drawW) / 2 + offset.x * scaleFactor
    const dy = (EXPORT_H - drawH) / 2 + offset.y * scaleFactor
    ctx.drawImage(img, dx, dy, drawW, drawH)

    exportCanvas.toBlob(async (blob) => {
      if (!blob) { setSaving(false); setError(isAr ? 'فشل تصدير الصورة' : 'Failed to process image'); return }
      const { url, error: upErr } = await uploadHeader(userId, blob)
      if (upErr || !url) { setSaving(false); setError(upErr ?? (isAr ? 'فشل الرفع' : 'Upload failed')); return }
      const { error: profErr } = await updateProfile(userId, { header_url: url })
      setSaving(false)
      if (profErr) { setError(profErr); return }
      setSuccess(true)
      setTimeout(() => onSaved(url), 450)
    }, 'image/jpeg', 0.85) // compress + resize before storing, per spec
  }

  const handleRemove = async () => {
    setRemoving(true); setError(null)
    const { error: err } = await removeHeader(userId)
    setRemoving(false)
    if (err) { setError(err); return }
    setSuccess(true)
    setTimeout(() => onSaved(null), 350)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(3,3,15,0.9)', backdropFilter: 'blur(16px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        className="card animate-slide-up"
        style={{ width: '100%', maxWidth: 420, padding: '24px 20px', background: 'linear-gradient(160deg, rgba(124,58,237,0.1) 0%, rgba(0,212,255,0.06) 100%)', border: '1px solid rgba(124,58,237,0.22)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={isAr ? 'font-cairo' : 'font-display'} style={{ fontSize: 18, fontWeight: 800, color: 'var(--foreground)', margin: '0 0 6px', textAlign: 'center' }}>
          {isAr ? 'صورة الغلاف' : 'Cover Image'}
        </h2>
        <p style={{ fontSize: 11.5, color: 'rgba(var(--fg2-rgb),0.5)', textAlign: 'center', margin: '0 0 16px' }}>
          {isAr ? 'تظهر أعلى ملفك الشخصي وفي بطاقة الترحيب' : 'Shown at the top of your profile and on your welcome card'}
        </p>

        {!hasImage ? (
          <>
            <label
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                height: PREVIEW_H + 90, borderRadius: 16, border: '2px dashed rgba(157,111,255,0.35)',
                background: currentHeaderUrl ? `url(${currentHeaderUrl}) center/cover no-repeat` : 'rgba(157,111,255,0.05)',
                cursor: imageLoading ? 'wait' : 'pointer', marginBottom: 16, position: 'relative', overflow: 'hidden',
              }}
            >
              {currentHeaderUrl && <div style={{ position: 'absolute', inset: 0, background: 'rgba(3,3,15,0.55)' }} />}
              {imageLoading ? (
                <div className="live-dot" style={{ background: '#9d6fff', position: 'relative' }} />
              ) : (
                <>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9d6fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative' }}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17,8 12,3 7,8" /><line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span style={{ fontSize: 13, color: currentHeaderUrl ? '#fff' : 'rgba(var(--fg2-rgb),0.6)', position: 'relative', fontWeight: currentHeaderUrl ? 700 : 400 }}>
                    {currentHeaderUrl
                      ? (isAr ? 'اختر صورة جديدة' : 'Choose a new photo')
                      : (isAr ? 'اختر صورة من جهازك (3:1 تقريبًا)' : 'Choose a photo from your device (~3:1)')}
                  </span>
                </>
              )}
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} style={{ display: 'none' }} disabled={imageLoading} />
            </label>

            {currentHeaderUrl && (
              <div style={{ marginBottom: 16 }}>
                {!confirmRemove ? (
                  <button
                    onClick={() => setConfirmRemove(true)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 10, background: 'rgba(255,71,133,0.08)', border: '1px solid rgba(255,71,133,0.25)', color: '#ff4785', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    {isAr ? 'إزالة صورة الغلاف' : 'Remove header'}
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={handleRemove}
                      disabled={removing}
                      style={{ flex: 1, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,71,133,0.18)', border: '1px solid rgba(255,71,133,0.4)', color: '#ff4785', fontSize: 12.5, fontWeight: 700, cursor: removing ? 'wait' : 'pointer' }}
                    >
                      {removing ? (isAr ? 'جارٍ الإزالة...' : 'Removing…') : (isAr ? 'تأكيد الإزالة' : 'Confirm remove')}
                    </button>
                    <button
                      onClick={() => setConfirmRemove(false)}
                      style={{ flex: 1, padding: '10px 14px', borderRadius: 10, background: 'rgba(var(--fg-rgb),0.06)', border: '1px solid rgba(var(--fg-rgb),0.1)', color: 'rgba(var(--fg-rgb),0.6)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                    >
                      {isAr ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <div style={{ width: PREVIEW_W, height: PREVIEW_H, borderRadius: 12, overflow: 'hidden', border: '2px solid rgba(157,111,255,0.4)', boxShadow: '0 0 24px rgba(124,58,237,0.25)' }}>
                <canvas
                  ref={canvasRef}
                  width={PREVIEW_W}
                  height={PREVIEW_H}
                  style={{ touchAction: 'none', cursor: 'grab', display: 'block' }}
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

        {error && <p style={{ margin: '0 0 12px', fontSize: 12, color: '#ff4785', textAlign: 'center' }}>{error}</p>}
        {success && <p style={{ margin: '0 0 12px', fontSize: 12, color: '#00e676', textAlign: 'center', fontWeight: 700 }}>{isAr ? '✓ تم الحفظ' : '✓ Saved'}</p>}

        {hasImage && (
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSave} disabled={saving}>
            {saving ? (isAr ? 'جارٍ الرفع...' : 'Uploading…') : (isAr ? 'حفظ' : 'Save')}
          </button>
        )}

        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(var(--fg2-rgb),0.4)', fontSize: 12, cursor: 'pointer', width: '100%', textAlign: 'center', marginTop: 14 }}>
          {isAr ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}
