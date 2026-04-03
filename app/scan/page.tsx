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

const DOC_TYPES: DocType[] = ['Receipt', 'Invoice', 'Document']

export default function ScanPage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)

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
        videoRef.current.onloadedmetadata = () => startDetection()
      }
    } catch (e) {
      setCameraError(true)
    }
  }

  function stopCamera() {
    cancelAnimationFrame(animFrameRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  function startDetection() {
    const detect = () => {
      if (state !== 'idle') return
      drawOverlay()
      animFrameRef.current = requestAnimationFrame(detect)
    }
    animFrameRef.current = requestAnimationFrame(detect)
  }

  function drawOverlay() {
    const video = videoRef.current
    const overlay = overlayRef.current
    if (!video || !overlay || video.readyState < 2) return

    const ctx = overlay.getContext('2d')
    if (!ctx) return

    overlay.width = video.videoWidth || video.clientWidth
    overlay.height = video.videoHeight || video.clientHeight

    ctx.clearRect(0, 0, overlay.width, overlay.height)

    // Detect document using brightness/contrast analysis
    const corners = detectDocument(video, overlay.width, overlay.height)
    
    if (corners) {
      setDocDetected(true)
      // Draw detected document outline
      ctx.strokeStyle = '#4ade80'
      ctx.lineWidth = 3
      ctx.shadowColor = '#4ade80'
      ctx.shadowBlur = 8
      ctx.beginPath()
      ctx.moveTo(corners[0].x, corners[0].y)
      ctx.lineTo(corners[1].x, corners[1].y)
      ctx.lineTo(corners[2].x, corners[2].y)
      ctx.lineTo(corners[3].x, corners[3].y)
      ctx.closePath()
      ctx.stroke()

      // Fill with semi-transparent green
      ctx.fillStyle = 'rgba(74, 222, 128, 0.08)'
      ctx.fill()

      // Corner dots
      corners.forEach(corner => {
        ctx.beginPath()
        ctx.arc(corner.x, corner.y, 6, 0, Math.PI * 2)
        ctx.fillStyle = '#4ade80'
        ctx.shadowBlur = 12
        ctx.fill()
      })
    } else {
      setDocDetected(false)
      // Draw guide box
      const pad = Math.min(overlay.width, overlay.height) * 0.08
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([8, 6])
      ctx.strokeRect(pad, pad * 1.5, overlay.width - pad * 2, overlay.height - pad * 3)
      ctx.setLineDash([])
    }
  }

  function detectDocument(video: HTMLVideoElement, w: number, h: number): {x:number,y:number}[] | null {
    // Use a temp canvas to sample the video frame
    const temp = document.createElement('canvas')
    const scale = 0.25 // sample at 25% for performance
    temp.width = w * scale
    temp.height = h * scale
    const ctx = temp.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(video, 0, 0, temp.width, temp.height)
    const imageData = ctx.getImageData(0, 0, temp.width, temp.height)
    const data = imageData.data

    // Find bright region (document is usually brighter than background)
    let minX = temp.width, minY = temp.height, maxX = 0, maxY = 0
    let brightPixels = 0
    const threshold = 160

    for (let y = 0; y < temp.height; y++) {
      for (let x = 0; x < temp.width; x++) {
        const i = (y * temp.width + x) * 4
        const brightness = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114)
        if (brightness > threshold) {
          brightPixels++
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }

    const coverage = brightPixels / (temp.width * temp.height)
    const rectW = (maxX - minX) / temp.width
    const rectH = (maxY - minY) / temp.height

    // Only show detection if there is a clear bright rectangle
    if (coverage < 0.15 || coverage > 0.85 || rectW < 0.2 || rectH < 0.2) return null

    // Add small padding
    const pad = 4
    const sx = Math.max(0, minX - pad) / scale
    const sy = Math.max(0, minY - pad) / scale
    const ex = Math.min(temp.width, maxX + pad) / scale
    const ey = Math.min(temp.height, maxY + pad) / scale

    return [
      { x: sx, y: sy },
      { x: ex, y: sy },
      { x: ex, y: ey },
      { x: sx, y: ey },
    ]
  }

  const capture = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Draw video frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    // Apply document enhancement — increase contrast and convert to clean scan look
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data

    for (let i = 0; i < data.length; i += 4) {
      // Convert to grayscale with high contrast
      const avg = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114

      // Apply adaptive thresholding for clean scan look
      const contrast = 1.6
      const brightness = 15
      let val = avg * contrast + brightness

      // Sharpen whites and darken darks for document look
      if (val > 200) val = Math.min(255, val * 1.1)
      else if (val < 80) val = Math.max(0, val * 0.7)

      val = Math.max(0, Math.min(255, val))
      data[i] = val
      data[i+1] = val
      data[i+2] = val
    }

    ctx.putImageData(imageData, 0, 0)

    const processed = canvas.toDataURL('image/jpeg', 0.92)
    setPages(prev => [...prev, processed])
    setCapturedImage(processed)
    stopCamera()
    setState('preview')
  }, [])

  function retake() {
    setPages([])
    setCapturedImage(null)
    setState('idle')
  }

  function addPage() {
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
          <div className="mono" styl
cat > app/scan/page.tsx << 'EOF'
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

const DOC_TYPES: DocType[] = ['Receipt', 'Invoice', 'Document']

export default function ScanPage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)

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
        videoRef.current.onloadedmetadata = () => startDetection()
      }
    } catch (e) {
      setCameraError(true)
    }
  }

  function stopCamera() {
    cancelAnimationFrame(animFrameRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  function startDetection() {
    const detect = () => {
      if (state !== 'idle') return
      drawOverlay()
      animFrameRef.current = requestAnimationFrame(detect)
    }
    animFrameRef.current = requestAnimationFrame(detect)
  }

  function drawOverlay() {
    const video = videoRef.current
    const overlay = overlayRef.current
    if (!video || !overlay || video.readyState < 2) return

    const ctx = overlay.getContext('2d')
    if (!ctx) return

    overlay.width = video.videoWidth || video.clientWidth
    overlay.height = video.videoHeight || video.clientHeight

    ctx.clearRect(0, 0, overlay.width, overlay.height)

    // Detect document using brightness/contrast analysis
    const corners = detectDocument(video, overlay.width, overlay.height)
    
    if (corners) {
      setDocDetected(true)
      // Draw detected document outline
      ctx.strokeStyle = '#4ade80'
      ctx.lineWidth = 3
      ctx.shadowColor = '#4ade80'
      ctx.shadowBlur = 8
      ctx.beginPath()
      ctx.moveTo(corners[0].x, corners[0].y)
      ctx.lineTo(corners[1].x, corners[1].y)
      ctx.lineTo(corners[2].x, corners[2].y)
      ctx.lineTo(corners[3].x, corners[3].y)
      ctx.closePath()
      ctx.stroke()

      // Fill with semi-transparent green
      ctx.fillStyle = 'rgba(74, 222, 128, 0.08)'
      ctx.fill()

      // Corner dots
      corners.forEach(corner => {
        ctx.beginPath()
        ctx.arc(corner.x, corner.y, 6, 0, Math.PI * 2)
        ctx.fillStyle = '#4ade80'
        ctx.shadowBlur = 12
        ctx.fill()
      })
    } else {
      setDocDetected(false)
      // Draw guide box
      const pad = Math.min(overlay.width, overlay.height) * 0.08
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([8, 6])
      ctx.strokeRect(pad, pad * 1.5, overlay.width - pad * 2, overlay.height - pad * 3)
      ctx.setLineDash([])
    }
  }

  function detectDocument(video: HTMLVideoElement, w: number, h: number): {x:number,y:number}[] | null {
    // Use a temp canvas to sample the video frame
    const temp = document.createElement('canvas')
    const scale = 0.25 // sample at 25% for performance
    temp.width = w * scale
    temp.height = h * scale
    const ctx = temp.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(video, 0, 0, temp.width, temp.height)
    const imageData = ctx.getImageData(0, 0, temp.width, temp.height)
    const data = imageData.data

    // Find bright region (document is usually brighter than background)
    let minX = temp.width, minY = temp.height, maxX = 0, maxY = 0
    let brightPixels = 0
    const threshold = 160

    for (let y = 0; y < temp.height; y++) {
      for (let x = 0; x < temp.width; x++) {
        const i = (y * temp.width + x) * 4
        const brightness = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114)
        if (brightness > threshold) {
          brightPixels++
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }

    const coverage = brightPixels / (temp.width * temp.height)
    const rectW = (maxX - minX) / temp.width
    const rectH = (maxY - minY) / temp.height

    // Only show detection if there is a clear bright rectangle
    if (coverage < 0.15 || coverage > 0.85 || rectW < 0.2 || rectH < 0.2) return null

    // Add small padding
    const pad = 4
    const sx = Math.max(0, minX - pad) / scale
    const sy = Math.max(0, minY - pad) / scale
    const ex = Math.min(temp.width, maxX + pad) / scale
    const ey = Math.min(temp.height, maxY + pad) / scale

    return [
      { x: sx, y: sy },
      { x: ex, y: sy },
      { x: ex, y: ey },
      { x: sx, y: ey },
    ]
  }

  const capture = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Draw video frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    // Apply document enhancement — increase contrast and convert to clean scan look
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data

    for (let i = 0; i < data.length; i += 4) {
      // Convert to grayscale with high contrast
      const avg = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114

      // Apply adaptive thresholding for clean scan look
      const contrast = 1.6
      const brightness = 15
      let val = avg * contrast + brightness

      // Sharpen whites and darken darks for document look
      if (val > 200) val = Math.min(255, val * 1.1)
      else if (val < 80) val = Math.max(0, val * 0.7)

      val = Math.max(0, Math.min(255, val))
      data[i] = val
      data[i+1] = val
      data[i+2] = val
    }

    ctx.putImageData(imageData, 0, 0)

    const processed = canvas.toDataURL('image/jpeg', 0.92)
    setPages(prev => [...prev, processed])
    setCapturedImage(processed)
    stopCamera()
    setState('preview')
  }, [])

  function retake() {
    setPages([])
    setCapturedImage(null)
    setState('idle')
  }

  function addPage() {
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

        {/* Camera viewfinder */}
        <div style={{ background: '#111', borderRadius: 'var(--radius)', overflow: 'hidden', aspectRatio: '4/3', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

          {state === 'idle' && !cameraError && (
            <>
              <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
              <canvas ref={canvasRef} style={{ display: 'none' }} />

              {/* Status pill */}
              <div style={{
                position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
                background: docDetected ? 'rgba(74,222,128,0.2)' : 'rgba(0,0,0,0.5)',
                border: `1px solid ${docDetected ? '#4ade80' : 'rgba(255,255,255,0.2)'}`,
                borderRadius: 20, padding: '5px 14px',
                color: docDetected ? '#4ade80' : 'rgba(255,255,255,0.7)',
                fontSize: 12, fontWeight: 500, transition: 'all 0.3s',
                backdropFilter: 'blur(4px)',
              }}>
                {docDetected ? 'Document detected' : 'Point at document'}
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
              <img src={capturedImage} alt="Scan" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: '5px 12px', color: '#4ade80', fontSize: 12, fontWeight: 500 }}>
                ✓ Enhanced
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

        {/* Recipient */}
        {(state === 'idle' || state === 'preview') && (
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Send to</label>
            <input type="email" value={recipient} onChange={e => { setRecipient(e.target.value); setError('') }} placeholder="recipient@example.com" style={{ width: '100%', padding: '12px 14px', fontSize: 14, border: `1px solid ${error && !recipient ? '#e24b4a' : 'var(--border-strong)'}`, borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', fontFamily: 'inherit' }} />
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          {state === 'idle' && (
            <button onClick={capture} disabled={cameraError} style={{ flex: 1, padding: '14px', fontSize: 15, fontWeight: 500, background: docDetected ? '#2d6a4f' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', cursor: cameraError ? 'not-allowed' : 'pointer', opacity: cameraError ? 0.5 : 1, fontFamily: 'inherit', transition: 'background 0.3s' }}>
              {docDetected ? 'Capture document ✓' : `Scan ${docTypeIcon[docType]}`}
            </button>
          )}

          {state === 'preview' && (
            <>
              <button onClick={sendScan} style={{ flex: 1, padding: '14px', fontSize: 15, fontWeight: 500, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'inherit' }}>Send scan →</button>
              <button onClick={addPage} style={{ padding: '14px 16px', fontSize: 13, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink-muted)' }}>+ Page</button>
              <button onClick={retake} style={{ padding: '14px 16px', fontSize: 13, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink-muted)' }}>Retake</button>
            </>
          )}
        </div>

        {/* Recent scans */}
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

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}
