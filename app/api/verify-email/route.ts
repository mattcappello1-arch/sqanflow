import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
    }
    const result = await resend.emails.send({
      from: 'sqanflow <onboarding@resend.dev>',
      to: email,
      subject: 'Verify your sender address — sqanflow',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; color: #0f0f0e;">
          <div style="font-size: 24px; font-weight: 600; margin-bottom: 8px;">sqanflow</div>
          <h2 style="font-size: 20px; font-weight: 500; margin-bottom: 12px;">Verify your sender email</h2>
          <p style="font-size: 15px; line-height: 1.6; color: #3a3a38; margin-bottom: 28px;">
            You're setting up <strong>${email}</strong> as your sender address in sqanflow.
          </p>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/api/verify-email?email=${encodeURIComponent(email)}&token=${Buffer.from(email + process.env.VERIFY_SECRET).toString('base64url')}"
            style="display: inline-block; padding: 14px 28px; background: #0f0f0e; color: #fff; border-radius: 100px; font-size: 15px; font-weight: 500; text-decoration: none;">
            Verify sender address →
          </a>
          <p style="font-size: 13px; color: #b0afa8; margin-top: 28px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    })
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const email = searchParams.get('email')
  const token = searchParams.get('token')

  if (!email) {
    return NextResponse.json({ error: 'Missing email' }, { status: 400 })
  }

  if (token) {
    const expected = Buffer.from(email + process.env.VERIFY_SECRET).toString('base64url')
    if (token !== expected) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }
    const response = NextResponse.redirect(
      new URL(`${process.env.NEXT_PUBLIC_APP_URL}/onboard?verified=true&email=${encodeURIComponent(email)}`)
    )
    response.cookies.set(`sqanflow_verified_${Buffer.from(email).toString('base64url')}`, '1', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    })
    return response
  }

  const cookieKey = `sqanflow_verified_${Buffer.from(email).toString('base64url')}`
  const cookie = req.cookies.get(cookieKey)
  return NextResponse.json({ verified: !!cookie?.value })
}
