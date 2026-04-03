'use client'
import { useRef, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type DocType = 'Receipt' | 'Invoice' | 'Document'
type AppState = 'idle' | 'preview' | 'sending' | 'sent' | 'error'
interface Pt { x: number; y: number }
interface Quad { tl: Pt; tr: Pt; br: Pt; bl: Pt }
interface Scan { dataUrl: string; type: DocType; date: string; recipient: string }

const DOC_TYPES: DocType[] = ['Receipt', 'Invoice', 'Document']
const STABLE_FRAMES = 40
const SMOOTH = 0.18

function ptLerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}
function quadLerp(a: Quad, b: Quad, t: number): Quad {
  return { tl: ptLerp(a.tl, b.tl, t), tr: ptLerp(a.tr, b.tr, t), br: ptLerp(a.br, b.br, t), bl: ptLerp(a.bl, b.bl, t) }
}

function warpPerspective(src: HTMLCanvasElement, quad: Quad, outW: number, outH: number): HTMLCanvasElement {
  const dst = document.createElement('canvas')
  dst.width = outW; dst.height = outH
  const ctx = dst.getContext('2d')!
  const srcCtx = src.getContext('2d')!
  const srcData = srcCtx.getImageData(0, 0, src.width, src.height)
  const dstData = ctx.createImageData(outW, outH)
  const { tl, tr, br, bl } = quad
  const sw = src.width

  for (let y = 0; y < outH; y++) {
    const fy = y / outH
    const lx = tl.x + (bl.x - tl.x) * fy
    const ly = tl.y + (bl.y - tl.y) * fy
    const rx = tr.x + (br.x - tr.x) * fy
    const ry = tr.y + (br.y - tr.y) * fy
    for (let x = 0; x < outW; x++) {
      const fx = x / outW
      const sx = Math.round(lx + (rx - lx) * fx)
      const sy = Math.round(ly + (ry - ly) * fx + (ry - ly) * 0)
      const srcX = Math.max(0, Math.min(sw - 1, sx))
      const srcY = Math.max(0, Math.min(src.height - 1, sy))
      const si = (srcY * sw + srcX) * 4
      const di = (y * outW + x) * 4
      dstData.data[di] = srcData.data[si]
      dstData.data[di+1] = srcData.data[si+1]
      dstData.data[di+2] = srcData.data[si+2]
      dstData.data[di+3] = 255
    }
  }
  ctx.putImageData(dstData, 0, 0)
  return dst
}

function enhanceScan(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = canvas.width; out.height = canvas.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(canvas, 0, 0)
  const id = ctx.getImageData(0, 0, out.width, out.height)
  const d = id.data
  const w = out.width, h = out.height

  for (let i = 0; i < d.length; i += 4) {
    const g = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114
    d[i] = d[i+1] = d[i+2] = g
  }

  const blockSize = Math.max(20, Math.round(Math.min(w, h) / 20))
  const out2 = new Uint8ClampedArray(d.length)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0
      const r = blockSize
      for (let dy = -r; dy <= r; dy += 4) {
        for (let dx = -r; dx <= r; dx += 4) {
          const nx = x + dx, ny = y + dy
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            sum += d[(ny * w + nx) * 4]; cnt++
          }
        }
      }
      const mean = sum / cnt
      const idx = (y * w + x) * 4
      const val = d[idx] < mean * 0.88 ? 0 : 255
      out2[idx] = out2[idx+1] = out2[idx+2] = val; out2[idx+3] = 255
    }
  }
  ctx.putImageData(new ImageData(out2, w, h), 0, 0)
  return out
}

function detectDoc(video: HTMLVideoElement, scale: number): Quad | null {
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480
  const tw = Math.round(vw * scale), th = Math.round(vh * scale)
  const tmp = document.createElement('canvas')
  tmp.width = tw; tmp.height = th
  const ctx = tmp.getContext('2d')!
  ctx.drawImage(video, 0, 0, tw, th)
  const { data } = ctx.getImageData(0, 0, tw, th)
  const margin = Math.round(tw * 0.04)
  let minX = tw, minY = th, maxX = 0, maxY = 0, bright = 0
  const thresh = 145

  for (let y = margin; y < th - margin; y++) {
    for (let x = margin; x < tw - margin; x++) {
      const i = (y * tw + x) * 4
      const lum = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114
      if (lum > thresh) {
        bright++
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
    }
  }

  const total = (tw - margin * 2) * (th - margin * 2)
  const cov = bright / total
  const rw = (maxX - minX) / tw, rh = (maxY - minY) / th
  if (cov < 0.1 || cov > 0.9 || rw < 0.2 || rh < 0.2) return null

  const pad = 3
  return {
    tl: { x: Math.max(0, minX - pad) / scale, y: Math.max(0, minY - pad) / scale },
    tr: { x: Math.min(tw, maxX + pad) / scale, y: Math.max(0, minY - pad) / scale },
    br: { x: Math.min(tw, maxX + pad) / scale, y: Math.min(th, maxY + pad) / scale },
    bl: { x: Math.max(0, minX - pad) / scale, y: Math.min(th, maxY + pad) / scale },
  }
}

export default function ScanPage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const hiddenRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  const smoothQ = useRef<Quad | null>(null)
  const stableN = useRef(0)
  const captured = useRef(false)

  const [state, setState] = useState<AppState>('idle')
  const [docType, setDocType] = useState<DocType>('Receipt')
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [recipient, setRecipient] = useState('')
  const [senderEmail, setSenderEmail] = useState('')
  const [error, setError] = useState('')
  const [recentScans, setRecentScans] = useState<Scan[]>([])
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [pages, setPages] = useState<string[]>([])
  const [detected, setDetected] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const email = localStorage.getItem('sqanflow_sender')
    const verified = localStorage.getItem('sqanflow_verified')
    if (!email || verified !== 'true') { router.replace('/onboard'); return }
    setSenderEmail(email)
    const stored = localStorage.getItem('sqanflow_scans')
    if (stored) setRecentScans(JSON.parse(stored))
  }, [router])

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    captured.current = false
    stableN.current = 0
    smoothQ.current = null
  }, [])

  const doCapture = useCallback((quad: Quad) => {
    if (captured.current) return
    captured.current = true
    const video = videoRef.current, canvas = hiddenRef.current
    if (!video || !canvas) return
    const vw = video.videoWidth || 1280, vh = video.videoHeight || 720
    canvas.width = vw; canvas.height = vh
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0, vw, vh)
    const qw = Math.round(Math.hypot(quad.tr.x - quad.tl.x, quad.tr.y - quad.tl.y))
    const qh = Math.round(Math.hypot(quad.bl.x - quad.tl.x, quad.bl.y - quad.tl.y))
    const outW = Math.max(qw, 900)
    const outH = Math.round(outW * (qh / Math.max(qw, 1)))
    const warped = warpPerspective(canvas, quad, outW, outH)
    const enhanced = enhanceScan(warped)
    const result = enhanced.toDataURL('image/jpeg', 0.95)
    stopCamera()
    setPages(prev => [...prev, result])
    setCapturedImage(result)
    setDetected(false); setProgress(0)
    setState('preview')
  }, [stopCamera])

  const runDetection = useCallback(() => {
    const video = videoRef.current, overlay = overlayRef.current
    if (!video || !overlay || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(runDetection); return
    }
    const dw = overlay.clientWidth, dh = overlay.clientHeight
    if (overlay.width !== dw) overlay.width = dw
    if (overlay.height !== dh) overlay.height = dh
    const ctx = overlay.getContext('2d')!
    ctx.clearRect(0, 0, dw, dh)
    const vw = video.videoWidth || 640, vh = video.videoHeight || 480
    const scaleX = dw / vw, scaleY = dh / vh
    const raw = detectDoc(video, 0.22)

    if (raw) {
      const disp: Quad = {
        tl: { x: raw.tl.x * scaleX, y: raw.tl.y * scaleY },
        tr: { x: raw.tr.x * scaleX, y: raw.tr.y * scaleY },
        br: { x: raw.br.x * scaleX, y: raw.br.y * scaleY },
        bl: { x: raw.bl.x * scaleX, y: raw.bl.y * scaleY },
      }
      smoothQ.current = smoothQ.current ? quadLerp(smoothQ.current, disp, SMOOTH) : disp
      const q = smoothQ.current
      stableN.current = Math.min(STABLE_FRAMES, stableN.current + 1)
      const prog = stableN.current / STABLE_FRAMES
      setDetected(true); setProgress(Math.round(prog * 100))

      ctx.save()
      ctx.fillStyle = `rgba(0,0,0,${0.3 * prog})`
      ctx.fillRect(0, 0, dw, dh)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      ctx.moveTo(q.tl.x, q.tl.y); ctx.lineTo(q.tr.x, q.tr.y)
      ctx.lineTo(q.br.x, q.br.y); ctx.lineTo(q.bl.x, q.bl.y)
      ctx.closePath(); ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
      ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 10 * prog
      ctx.strokeStyle = `rgba(74,222,128,${0.5 + prog * 0.5})`
      ctx.lineWidth = 2 + prog * 1.5
      ctx.beginPath()
      ctx.moveTo(q.tl.x, q.tl.y); ctx.lineTo(q.tr.x, q.tr.y)
      ctx.lineTo(q.br.x, q.br.y); ctx.lineTo(q.bl.x, q.bl.y)
      ctx.closePath(); ctx.stroke(); ctx.shadowBlur = 0

      const sz = 16 + prog * 4
      ;[[q.tl,1,1],[q.tr,-1,1],[q.br,-1,-1],[q.bl,1,-1]].forEach(([c,dx,dy]: any) => {
        ctx.save(); ctx.translate(c.x, c.y)
        ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo((dx as number)*sz,0); ctx.lineTo(0,0); ctx.lineTo(0,(dy as number)*sz); ctx.stroke()
        ctx.restore()
      })
      ctx.restore()

      if (stableN.current >= STABLE_FRAMES) { doCapture(raw); return }
    } else {
      stableN.current = Math.max(0, stableN.current - 3)
      if (stableN.current === 0) smoothQ.current = null
      setDetected(false); setProgress(0)
      const pad = Math.min(dw, dh) * 0.07
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([7, 6])
      ctx.strokeRect(pad, pad * 1.8, dw - pad * 2, dh - pad * 3.6); ctx.setLineDash([])
      const gx = pad, gy = pad * 1.8, gw = dw - pad * 2, gh = dh - pad * 3.6, sz = 16
      ;[[gx,gy,1,1],[gx+gw,gy,-1,1],[gx+gw,gy+gh,-1,-1],[gx,gy+gh,1,-1]].forEach(([cx,cy,dx,dy]) => {
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2; ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(cx+dx*sz,cy); ctx.lineTo(cx,cy); ctx.lineTo(cx,cy+dy*sz); ctx.stroke()
      })
    }
    rafRef.current = requestAnimationFrame(runDetection)
  }, [doCapture])

  const startCamera = useCallback(async () => {
    captured.current = false; stableN.current = 0; smoothQ.current = null
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play()
      setCameraReady(true)
      rafRef.current = requestAnimationFrame(runDetection)
    } catch { setCameraError(true) }
  }, [runDetection])

  useEffect(() => {
    if (state === 'idle') { setCameraReady(false); startCamera() }
    return () => { if (state === 'idle') stopCamera() }
  }, [state])

  function retake() { setPages([]); setCapturedImage(null); setState('idle') }
  function addPage() { setState('idle') }

  async function sendScan() {
    if (!recipient || !recipient.includes('@')) { setError('Please enter a valid recipient email.'); return }
    setState('sending'); setError('')
    try {
      const res = await fetch('/api/send-scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: pages, docType, recipient, senderEmail }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      const newScan: Scan = { dataUrl: pages[0], type: docType, date: new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }), recipient }
      const updated = [newScan, ...recentScans].slice(0, 10)
      setRecentScans(updated); localStorage.setItem('sqanflow_scans', JSON.stringify(updated))
      setState('sent')
      setTimeout(() => { setState('idle'); setPages([]); setCapturedImage(null) }, 2500)
    } catch (e: any) { setError(e.message); setState('error') }
  }

  const icons: Record<DocType, string> = { Receipt: '🧾', Invoice: '📋', Document: '📄' }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', maxWidth: 480, margin: '0 auto', background: 'var(--bg)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.4px' }}>sqan<span style={{ color: 'var(--ink-muted)' }}>flow</span></div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 1 }}>from: {senderEmail}</div>
        </div>
        <button onClick={() => { localStorage.clear(); router.push('/onboard') }} style={{ fontSize: 12, color: 'var(--ink-muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>Change email</button>
      </header>

      <main style={{ flex: 1, padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {DOC_TYPES.map(t => (
            <button key={t} onClick={() => setDocType(t)} style={{ flex: 1, padding: '9px 4px', fontSize: 13, fontWeight: 500, borderRadius: 'var(--radius-pill)', border: '1px solid', borderColor: docType === t ? 'var(--accent)' : 'var(--border)', background: docType === t ? 'var(--accent)' : 'var(--surface)', color: docType === t ? '#fff' : 'var(--ink-muted)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s' }}>
              {t}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', borderRadius: 'var(--radius)', overflow: 'hidden', background: '#0a0a0a', aspectRatio: '4/3' }}>
          {state === 'idle' && (
            <>
              <video ref={videoRef} playsInline muted autoPlay style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: cameraReady ? 1 : 0, transition: 'opacity 0.5s' }} />
              <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
              <canvas ref={hiddenRef} style={{ display: 'none' }} />
              {!cameraReady && !cameraError && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 28, height: 28, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                </div>
              )}
              {cameraError && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'rgba(255,255,255,0.5)' }}>
                  <div style={{ fontSize: 28 }}>📷</div>
                  <p style={{ fontSize: 13 }}>Camera access denied</p>
                </div>
              )}
              {cameraReady && (
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '32px 16px 14px', background: 'linear-gradient(transparent, rgba(0,0,0,0.65))' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: detected ? '#4ade80' : 'rgba(255,255,255,0.3)', boxShadow: detected ? '0 0 8px #4ade80' : 'none', transition: 'all 0.3s' }} />
                      <span style={{ fontSize: 12, color: detected ? '#4ade80' : 'rgba(255,255,255,0.5)', fontWeight: 500, transition: 'color 0.3s' }}>
                        {detected ? `Scanning ${progress}%` : 'Point at document'}
                      </span>
                    </div>
                    {pages.length > 0 && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.1)', padding: '3px 10px', borderRadius: 20 }}>{pages.length}p</span>}
                  </div>
                  {detected && (
                    <div style={{ marginTop: 8, height: 2, background: 'rgba(255,255,255,0.12)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: '#4ade80', width: `${progress}%`, transition: 'width 0.08s linear', borderRadius: 2, boxShadow: '0 0 6px #4ade80' }} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {state === 'preview' && capturedImage && (
            <>
              <img src={capturedImage} alt="Scan" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
              <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: '5px 12px', color: '#4ade80', fontSize: 12, fontWeight: 500 }}>✓ Scanned</div>
              {pages.length > 1 && <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: '5px 12px', color: '#fff', fontSize: 12 }}>{pages.length} pages</div>}
            </>
          )}

          {state === 'sending' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: '#fff' }}>
              <div style={{ width: 36, height: 36, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>Sending...</p>
            </div>
          )}

          {state === 'sent' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'rgba(0,0,0,0.35)' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(74,222,128,0.15)', border: '2px solid #4ade80', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#4ade80' }}>✓</div>
              <p style={{ fontSize: 16, fontWeight: 500, color: '#fff' }}>Sent!</p>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>{recipient}</p>
            </div>
          )}

          {state === 'error' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '2rem', color: '#fff' }}>
              <div style={{ fontSize: 28 }}>⚠</div>
              <p style={{ fontSize: 14, textAlign: 'center', color: 'rgba(255,255,255,0.8)' }}>{error}</p>
              <button onClick={() => setState('preview')} style={{ padding: '9px 20px', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 20, color: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Try again</button>
            </div>
          )}
        </div>

        {(state === 'idle' || state === 'preview') && (
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--ink-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Send to</label>
            <input type="email" value={recipient} onChange={e => { setRecipient(e.target.value); setError('') }} placeholder="recipient@example.com" style={{ width: '100%', padding: '12px 14px', fontSize: 15, border: `1px solid ${error ? '#e24b4a' : 'var(--border-strong)'}`, borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', fontFamily: 'inherit' }} />
            {error && <p style={{ fontSize: 13, color: '#e24b4a', marginTop: 6 }}>{error}</p>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          {state === 'idle' && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '13px', fontSize: 14, color: 'var(--ink-faint)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)' }}>
              {detected ? 'Hold still…' : 'Waiting for document'}
            </div>
          )}
          {state === 'preview' && (
            <>
              <button onClick={sendScan} style={{ flex: 1, padding: '13px', fontSize: 15, fontWeight: 500, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'inherit' }}>Send {icons[docType]}</button>
              <button onClick={addPage} style={{ padding: '13px 16px', fontSize: 13, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink-muted)' }}>+ Page</button>
              <button onClick={retake} style={{ padding: '13px 16px', fontSize: 13, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink-muted)' }}>Retake</button>
            </>
          )}
        </div>

        {recentScans.length > 0 && state === 'idle' && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Recent</div>
            {recentScans.slice(0, 5).map((scan, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ width: 38, height: 38, background: '#f0f0ec', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{icons[scan.type]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{scan.type}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scan.date} · {scan.recipient}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 6, height: 6, background: '#4ade80', borderRadius: '50%' }} />
                  <span style={{ fontSize: 12, color: 'var(--accent-green)', fontWeight: 500 }}>Sent</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
