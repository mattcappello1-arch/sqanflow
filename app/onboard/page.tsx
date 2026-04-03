'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Step = 'enter' | 'sent' | 'verified'

export default function OnboardPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<Step>('enter')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSendVerification() {
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send verification')
      localStorage.setItem('sqanflow_sender', email)
      setStep('sent')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmVerified() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/verify-email?email=${encodeURIComponent(email)}`)
      const data = await res.json()
      if (!res.ok || !data.verified) {
        setError('Not verified yet — check your inbox and click the link, then try again.')
        setLoading(false)
        return
      }
      localStorage.setItem('sqanflow_verified', 'true')
      setStep('verified')
      setTimeout(() => router.push('/scan'), 1200)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1.5rem' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div className="fade-up" style={{ marginBottom: '3rem' }}>
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.5px', color: 'var(--ink)' }}>
            sqan<span style={{ color: 'var(--ink-muted)' }}>flow</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 4 }}>Scan. Send. Done.</div>
        </div>

        {step === 'enter' && (
          <div>
            <div className="fade-up-1" style={{ marginBottom: '2rem' }}>
              <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 8, lineHeight: 1.3 }}>Set your sender email</h1>
              <p style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
                Scans will be sent from this address. We'll send a quick verification link to confirm it's yours.
              </p>
            </div>
            <div className="fade-up-2" style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Your email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
                placeholder="you@example.com"
                onKeyDown={e => e.key === 'Enter' && handleSendVerification()}
                style={{ width: '100%', padding: '13px 16px', fontSize: 15, border: `1px solid ${error ? '#e24b4a' : 'var(--border-strong)'}`, borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', fontFamily: 'inherit' }}
              />
              {error && <p style={{ fontSize: 13, color: '#e24b4a', marginTop: 6 }}>{error}</p>}
            </div>
            <div className="fade-up-3">
              <button onClick={handleSendVerification} disabled={loading} style={{ width: '100%', padding: '14px', fontSize: 15, fontWeight: 500, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, fontFamily: 'inherit' }}>
                {loading ? 'Sending…' : 'Send verification link'}
              </button>
            </div>
          </div>
        )}

        {step === 'sent' && (
          <div>
            <div className="fade-up-1" style={{ marginBottom: '2rem' }}>
              <div style={{ width: 52, height: 52, background: 'var(--accent-green-light)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, fontSize: 22 }}>📬</div>
              <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 8 }}>Check your inbox</h1>
              <p style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
                We sent a verification link to <strong style={{ color: 'var(--ink)' }}>{email}</strong>. Click it, then come back here.
              </p>
            </div>
            {error && (
              <div style={{ padding: '12px 14px', background: '#fff0f0', border: '1px solid #f7c1c1', borderRadius: 'var(--radius-sm)', marginBottom: 16 }}>
                <p style={{ fontSize: 13, color: '#a32d2d' }}>{error}</p>
              </div>
            )}
            <div className="fade-up-2" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={handleConfirmVerified} disabled={loading} style={{ width: '100%', padding: '14px', fontSize: 15, fontWeight: 500, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, fontFamily: 'inherit' }}>
                {loading ? 'Checking…' : "I've verified — continue"}
              </button>
              <button onClick={() => { setStep('enter'); setError('') }} style={{ width: '100%', padding: '14px', fontSize: 14, background: 'transparent', color: 'var(--ink-muted)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Use a different email
              </button>
            </div>
          </div>
        )}

        {step === 'verified' && (
          <div className="fade-up" style={{ textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, background: 'var(--accent-green-light)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 22 }}>✓</div>
            <h1 style={{ fontSize: 22, fontWeight: 500 }}>All set!</h1>
            <p style={{ fontSize: 14, color: 'var(--ink-muted)', marginTop: 8 }}>Taking you to the scanner…</p>
          </div>
        )}
      </div>
    </div>
  )
}
