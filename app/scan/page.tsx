'use client'
import { useRef, useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type DocType = 'Receipt' | 'Invoice' | 'Document'
type AppState = 'idle' | 'preview' | 'sending' | 'sent' | 'error'

interface Scan {
  dataUrl: string
  type: DocType
  date: string
  recipient: string
}

interface Corner { x: number; y: number }

const DOC_TYPES: DocType[] = ['Receipt', 'Invoice', 'Document']

export default function ScanPage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  const detectionCountRef = useRef<number>(0)
  const lastCornersRef = useRef<Corner[] | null>(null)

  const [state, setState] = useState<AppState>('idle')
  const [docType, setDocType] = useState<DocType>('Receipt')
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [recipient, setRecipient] = useState('')
  const [senderEmail, setSenderEmail] = useState('')
  const [error, setError] = useState('')
  const [recentScans, setRecentScans] = useState<Scan[]>([])
  const [cameraError, setCameraError] = useState(false)
  const [pages, setPages] = useState<string[]>([])
  const [docDetected, setDocDetected] = useState(false)
  const [autoCapturing, setAutoCapturing] = useState(false)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    const email = localStorage.getItem('sqanflow_sender')
    const verified = localStorage.getItem('sqanflow_verified')
    if (!email || verified !== 'true') { router.replace('/onboard'); return }
    setSenderEmail(email)
    const stored = localStorage.getItem('sqanflow_scans')
    if (stored) setRecentScans(JSON.parse(stored))
  }, [router])

  useEffect(() => {
    if (state !== 'idle') return
    startCamera()
    return () => stopCamera()
  }, [state])

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
        videoRef.current.onloadedmetadata = () => {
          detectionCountRef.current = 0
          requestAnimationFrame(detect)
        }
      }
    } catch (e) {
      setCameraError(true)
    }
  }

  function stopCamera() {
    cancelAnimationFrame(animFrameRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  const captureAndProcess = useCallback((corners: Corner[]) => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const vw = video.videoWidth || 1280
    const vh = video.videoHeight || 720

    canvas.width = vw
    canvas.height = vh

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0, vw, vh)

    // Get bounding box of detected corners
    const xs = corners.map(c => c.x)
    const ys = corners.map(c => c.y)
    const x = Math.max(0, Math.min(...xs))
    const y = Math.max(0, Math.min(...ys))
    const w = Math.min(vw, Math.max(...xs)) - x
    const h = Math.min(vh, Math.max(...ys)) - y

    // Crop to document bounds
    const cropped = document.createElement('canvas')
    cropped.width = w
    cropped.height = h
    const croppedCtx = cropped.getContext('2d')
    if (!croppedCtx) return

    croppedCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h)

    // Enhance — high contrast grayscale scan look
    const imageData = croppedCtx.getImageData(0, 0, w, h)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
      const avg = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114
      const contrast = 1.5
      const bright = 20
      let val = avg * contrast + bright
      if (val > 210) val = Math.min(255, val * 1.05)
      else if (val < 70) val = Math.max(0, val * 0.75)
      val = Math.max(0, Math.min(255, val))
      data[i] = val; data[i+1] = val; data[i+2] = val
    }
    croppedCtx.putImageData(imageData, 0, 0)

    const processed = cropped.toDataURL('image/jpeg', 0.92)
    setPages(prev => [...prev, processed])
    setCapturedImage(processed)
    stopCamera()
    setAutoCapturing(false)
    setCountdown(0)
    setState('preview')
  }, [])

  const detect = useCallback(() => {
    const video = videoRef.current
    const overlay = overlayRef.current
    if (!video || !overlay || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(detect)
      return
    }

    const ctx = overlay.getContext('2d')
    if (!ctx) return

    const dw = video.clientWidth || 320
    const dh = video.clientHeight || 240
    overlay.width = dw
    overlay.height = dh

    ctx.clearRect(0, 0, dw, dh)

    // Sample video at low res for performance
    const temp = document.createElement('canvas')
    const scale = 0.2
    temp.width = Math.round((video.videoWidth || 640) * scale)
    temp.height = Math.round((video.videoHeight || 480) * scale)
    const tctx = temp.getContext('2d')
    if (!tctx) return
    tctx.drawImage(video, 0, 0, temp.width, temp.height)

    const imageData = tctx.getImageData(0, 0, temp.width, temp.height)
    const d = imageData.data

    // Find bright document region
    let minX = temp.width, minY = temp.height, maxX = 0, maxY = 0
    let brightCount = 0
    const thresh = 155

    for (let y = 2; y < temp.height - 2; y++) {
      for (let x = 2; x < temp.width - 2; x++) {
        const i = (y * temp.width + x) * 4
        const lum = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114
        if (lum > thresh) {
          brightCount++
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }

    const coverage = brightCount / (temp.width * temp.height)
    const rw = (maxX - minX) / temp.width
    const rh = (maxY - minY) / temp.height
    const isDoc = coverage > 0.12 && coverage < 0.88 && rw > 0.25 && rh > 0.25

    if (isDoc) {
      // Scale corners back to display size
      const sx = (minX / scale) * (dw / (video.videoWidth || 640))
      const sy = (minY / scale) * (dh / (video.videoHeight || 480))
      const ex = (maxX / scale) * (dw / (video.videoWidth || 640))
      const ey = (maxY / scale) * (dh / (video.videoHeight || 480))

      const corners: Corner[] = [
        { x: sx, y: sy }, { x: ex, y: sy },
        { x: ex, y: ey }, { x: sx, y: ey }
      ]
      lastCornersRef.current = corners

      // Draw green outline
      ctx.strokeStyle = '#4ade80'
      ctx.lineWidth = 2.5
      ctx.shadowColor = '#4ade80'
      ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.moveTo(corners[0].x, corners[0].y)
      corners.forEach(c => ctx.lineTo(c.x, c.y))
      ctx.closePath()
      ctx.stroke()

      ctx.fillStyle = 'rgba(74,222,128,0.07)'
      ctx.fill()

      corners.forEach(c => {
        ctx.beginPath()
        ctx.arc(c.x, c.y, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#4ade80'
        ctx.shadowBlur = 10
        ctx.fill()
      })

      setDocDetected(true)
      detectionCountRef.current += 1

      // Auto capture after 1.5 seconds of stable detection (45 frames)
      if (detectionCountRef.current >= 45) {
        setAutoCapturing(true)
        // Scale corners to video resolution for cropping
        const vw = video.videoWidth || 640
        const vh = video.videoHeight || 480
        const videoCornersX = minX / scale
        const videoCornersY = minY / scale
        const videoCornersMaxX = maxX / scale
        const videoCornersMaxY = maxY / scale
        const videoCorners: Corner[] = [
          { x: videoCornersX, y: videoCornersY },
          { x: videoCornersMaxX, y: videoCornersY },
          { x: videoCornersMaxX, y: videoCornersMaxY },
          { x: videoCornersX, y: videoCornersMaxY },
        ]
        captureAndProcess(videoCorners)
        return
      }

      // Show countdown progress
      const progress = detectionCountRef.current / 45
      setCountdown(Math.round(progress * 100))

    } else {
      setDocDetected(false)
      detectionCountRef.current = Math.max(0, detectionCountRef.current - 2)
      setCountdown(0)
      lastCornersRef.current = null

      // Draw guide
      const pad = Math.min(dw, dh) * 0.08
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'
      ctx.lineWidth = 1
      ctx.setLineDash([6, 5])
      ctx.strokeRect(pad, pad * 1.5, dw - pad * 2, dh - pad * 3)
      ctx.setLineDash([])
    }

    animFrameRef.current = requestAnimationFrame(detect)
  }, [captureAndProcess])

  function retake() {
    setPages([])
    setCapturedImage(null)
    detectionCountRef.current = 0
    setState('idle')
  }

  function addPage() {
    detectionCountRef.current = 0
    setState('idle')
  }

  async function sendScan() {
    if (!recipient || !recipient.includes('@')) {
      setError('Please enter a valid recipient email.')
      return
    }
    setState('sending')
    setError('')
    try {
      const res = await fetch('/api/send-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: pages, docType, recipient, senderEmail }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      const newScan: Scan = {
        dataUrl: pages[0],
        type: docType,
        date: new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }),
        recipient,
      }
      const updated = [newScan, ...recentScans].slice(0, 10)
      setRecentScans(updated)
      localStorage.setItem('sqanflow_scans', JSON.stringify(updated))
      setState('sent')
      setTimeout(() => { setState('idle'); setPages([]); setCapturedImage(null) }, 2500)
    } catch (e: any) {
      setError(e.message)
      setState('error')
    }
  }

  const docTypeIcon: Record<DocType, string> = { Receipt: '🧾', Invoice: '📋', Document: '📄' }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', maxWidth: 480, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.4px' }}>
            sqan<span style={{ color: 'var(--ink-muted)' }}>flow</span>
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 1 }}>from: {senderEmail}</div>
        </div>
        <button onClick={() => { localStorage.clear(); router.push('/onboard') }} style={{ fontSize: 12, color: 'var(--ink-muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
          Change email
        </button>
      </header>

      <main style={{ flex: 1, padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        <div style={{ display: 'flex', gap: 8 }}>
          {DOC_TYPES.map(t => (
            <button key={t} onClick={() => setDocType(t)} style={{ flex: 1, padding: '9px 4px', fontSize: 13, fontWeight: 500, borderRadius: 'var(--radius-pill)', border: '1px solid', borderColor: docType === t ? 'var(--accent)' : 'var(--border)', background: docType === t ? 'var(--accent)' : 'var(--surface)', color: docType === t ? '#fff' : 'var(--ink-muted)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}>
              {t}
            </button>
          ))}
        </div>

        <div style={{ background: '#111', borderRadius: 'var(--radius)', overflow: 'hidden', aspectRatio: '4/3', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

          {state === 'idle' && !cameraError && (
            <>
              <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
              <canvas ref={canvasRef} style={{ display: 'none' }} />

              {/* Progress ring when auto capturing */}
              {autoCapturing && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
                  <div style={{ color: '#4ade80', fontSize: 18, fontWeight: 600 }}>Scanning...</div>
                </div>
              )}

              {/* Status pill */}
              <div style={{
                position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
                background: docDetected ? 'rgba(74,222,128,0.2)' : 'rgba(0,0,0,0.5)',
                border: `1px solid ${docDetected ? '#4ade80' : 'rgba(255,255,255,0.2)'}`,
                borderRadius: 20, padding: '5px 14px',
                color: docDetected ? '#4ade80' : 'rgba(255,255,255,0.6)',
                fontSize: 12, fontWeight: 500, transition: 'all 0.3s',
                whiteSpace: 'nowrap',
              }}>
                {docDetected ? `Hold steady... ${countdown}%` : 'Point at a document'}
              </div>

              {pages.length > 0 && (
                <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: '4px 10px', color: '#fff', fontSize: 12, fontWeight: 500 }}>
                  {pages.length} page{pages.length > 1 ? 's' : ''}
                </div>
              )}
            </>
          )}

          {cameraError && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'rgba(255,255,255,0.6)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📷</div>
              <p style={{ fontSize: 14 }}>Camera access denied</p>
              <p style={{ fontSize: 12, marginTop: 6 }}>Allow camera access in your browser settings</p>
            </div>
          )}

          {state === 'preview' && capturedImage && (
            <>
              <img src={capturedImage} alt="Scan" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#111' }} />
              <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: '5px 12px', color: '#4ade80', fontSize: 12, fontWeight: 500 }}>
                ✓ Auto cropped
              </div>
            </>
          )}

          {state === 'sending' && (
            <div style={{ textAlign: 'center', color: '#fff' }}>
              <div style={{ width: 36, height: 36, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
              <p style={{ fontSize: 14 }}>Sending scan...</p>
            </div>
          )}

          {state === 'sent' && (
            <div style={{ textAlign: 'center', color: '#fff' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
              <p style={{ fontSize: 16, fontWeight: 500 }}>Sent!</p>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>to {recipient}</p>
            </div>
          )}

          {state === 'error' && (
            <div style={{ textAlign: 'center', color: '#fff', padding: '2rem' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⚠</div>
              <p style={{ fontSize: 14 }}>{error}</p>
              <button onClick={() => setState('preview')} style={{ marginTop: 12, padding: '8px 16px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 20, color: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Try again</button>
            </div>
          )}
        </div>

        {(state === 'idle' || state === 'preview') && (
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Send to</label>
            <input type="email" value={recipient} onChange={e => { setRecipient(e.target.value); setError('') }} placeholder="recipient@example.com" style={{ width: '100%', padding: '12px 14px', fontSize: 14, border: `1px solid ${error && !recipient ? '#e24b4a' : 'var(--border-strong)'}`, borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', fontFamily: 'inherit' }} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          {state === 'idle' && (
            <div style={{ flex: 1, padding: '14px', fontSize: 14, color: 'var(--ink-muted)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', textAlign: 'center' }}>
              {docDetected ? 'Auto scanning...' : 'Waiting for document...'}
            </div>
          )}

          {state === 'preview' && (
            <>
              <button onClick={sendScan} style={{ flex: 1, padding: '14px', fontSize: 15, fontWeight: 500, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'inherit' }}>Send scan →</button>
              <button onClick={addPage} style={{ padding: '14px 16px', fontSize: 13, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink-muted)' }}>+ Page</button>
              <button onClick={retake} style={{ padding: '14px 16px', fontSize: 13, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink-muted)' }}>Retake</button>
            </>
          )}
        </div>

        {recentScans.length > 0 && state === 'idle' && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Recent</div>
            {recentScans.slice(0, 5).map((scan, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ width: 40, height: 40, background: '#f0f0ec', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{docTypeIcon[scan.type]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{scan.type}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 1 }}>{scan.date} · {scan.recipient}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
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
