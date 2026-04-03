'use client'
import { useRef, useState, useCallback, useEffect } from 'react'
import Webcam from 'react-webcam'
import { useRouter } from 'next/navigation'

type DocType = 'Receipt' | 'Invoice' | 'Document'
type AppState = 'idle' | 'scanning' | 'preview' | 'sending' | 'sent' | 'error'

interface Scan {
  dataUrl: string
  type: DocType
  date: string
  recipient: string
}

const DOC_TYPES: DocType[] = ['Receipt', 'Invoice', 'Document']

export default function ScanPage() {
  const router = useRouter()
  const webcamRef = useRef<Webcam>(null)
  const [state, setState] = useState<AppState>('idle')
  const [docType, setDocType] = useState<DocType>('Receipt')
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [recipient, setRecipient] = useState('')
  const [senderEmail, setSenderEmail] = useState('')
  const [error, setError] = useState('')
  const [recentScans, setRecentScans] = useState<Scan[]>([])
  const [cameraError, setCameraError] = useState(false)
  const [pages, setPages] = useState<string[]>([])

  useEffect(() => {
    const email = localStorage.getItem('sqanflow_sender')
    const verified = localStorage.getItem('sqanflow_verified')
    if (!email || verified !== 'true') {
      router.replace('/onboard')
      return
    }
    setSenderEmail(email)
    const stored = localStorage.getItem('sqanflow_scans')
    if (stored) setRecentScans(JSON.parse(stored))
  }, [router])

  const capture = useCallback(() => {
    const img = webcamRef.current?.getScreenshot()
    if (!img) return
    setPages(prev => [...prev, img])
    setCapturedImage(img)
    setState('preview')
  }, [])

  function addPage() { setState('scanning') }
  function retake() { setPages([]); setCapturedImage(null); setState('idle') }

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
        <div className="fade-up" style={{ display: 'flex', gap: 8 }}>
          {DOC_TYPES.map(t => (
            <button key={t} onClick={() => setDocType(t)} style={{ flex: 1, padding: '9px 4px', fontSize: 13, fontWeight: 500, borderRadius: 'var(--radius-pill)', border: '1px solid', borderColor: docType === t ? 'var(--accent)' : 'var(--border)', background: docType === t ? 'var(--accent)' : 'var(--surface)', color: docType === t ? '#fff' : 'var(--ink-muted)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}>
              {t}
            </button>
          ))}
        </div>

        <div className="fade-up-1" style={{ background: '#111', borderRadius: 'var(--radius)', overflow: 'hidden', aspectRatio: '4/3', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {(state === 'idle' || state === 'scanning') && !cameraError && (
            <>
              <Webcam ref={webcamRef} screenshotFormat="image/jpeg" screenshotQuality={0.92} videoConstraints={{ facingMode: { ideal: 'environment' }, aspectRatio: 4/3 }} onUserMediaError={() => setCameraError(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', top: 12, left: 12, width: 24, height: 24, borderTop: '2px solid rgba(255,255,255,0.8)', borderLeft: '2px solid rgba(255,255,255,0.8)' }} />
              <div style={{ position: 'absolute', top: 12, right: 12, width: 24, height: 24, borderTop: '2px solid rgba(255,255,255,0.8)', borderRight: '2px solid rgba(255,255,255,0.8)' }} />
              <div style={{ position: 'absolute', bottom: 12, left: 12, width: 24, height: 24, borderBottom: '2px solid rgba(255,255,255,0.8)', borderLeft: '2px solid rgba(255,255,255,0.8)' }} />
              <div style={{ position: 'absolute', bottom: 12, right: 12, width: 24, height: 24, borderBottom: '2px solid rgba(255,255,255,0.8)', borderRight: '2px solid rgba(255,255,255,0.8)' }} />
              <div style={{ position: 'absolute', left: '10%', right: '10%', height: 1.5, background: 'linear-gradient(90deg, transparent, #4ade80, transparent)', animation: 'scanline 2.2s ease-in-out infinite' }} />
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
            <img src={capturedImage} alt="Captured scan" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
          {state === 'sending' && (
            <div style={{ textAlign: 'center', color: '#fff' }}>
              <div style={{ width: 36, height: 36, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
              <p style={{ fontSize: 14 }}>Sending scan…</p>
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

        {(state === 'idle' || state === 'preview' || state === 'scanning') && (
          <div className="fade-up-2">
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Send to</label>
            <input type="email" value={recipient} onChange={e => { setRecipient(e.target.value); setError('') }} placeholder="recipient@example.com" style={{ width: '100%', padding: '12px 14px', fontSize: 14, border: `1px solid ${error && !recipient ? '#e24b4a' : 'var(--border-strong)'}`, borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', fontFamily: 'inherit' }} />
          </div>
        )}

        <div className="fade-up-3" style={{ display: 'flex', gap: 10 }}>
          {state === 'idle' && (
            <button onClick={capture} disabled={cameraError} style={{ flex: 1, padding: '14px', fontSize: 15, fontWeight: 500, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', cursor: cameraError ? 'not-allowed' : 'pointer', opacity: cameraError ? 0.5 : 1, fontFamily: 'inherit' }}>
              Scan {docTypeIcon[docType]}
            </button>
          )}
          {state === 'scanning' && (
            <>
              <button onClick={capture} style={{ flex: 1, padding: '14px', fontSize: 15, fontWeight: 500, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Capture page {pages.length + 1}
              </button>
              <button onClick={() => setState('preview')} style={{ padding: '14px 18px', fontSize: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink)' }}>Done</button>
            </>
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
          <div className="fade-up-4">
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
        @keyframes scanline { 0%,100% { top: 18%; opacity: 0.3; } 50% { top: 74%; opacity: 1; } }
      `}</style>
    </div>
  )
}
