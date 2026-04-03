import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { jsPDF } from 'jspdf'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  try {
    const { images, docType, recipient, senderEmail } = await req.json()

    if (!images?.length || !recipient || !senderEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()

    images.forEach((dataUrl: string, index: number) => {
      if (index > 0) pdf.addPage()
      const base64 = dataUrl.split(',')[1]
      const mimeType = dataUrl.split(';')[0].split(':')[1]
      const padding = 10
      pdf.addImage(base64, mimeType === 'image/png' ? 'PNG' : 'JPEG', padding, padding, pageWidth - padding * 2, pageHeight - padding * 2, undefined, 'MEDIUM')
    })

    const pdfBase64 = pdf.output('datauristring').split(',')[1]
    const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    const filename = `${docType.toLowerCase()}-${Date.now()}.pdf`
    const pageCount = images.length

    const result = await resend.emails.send({
      from: `sqanflow <onboarding@resend.dev>`,
      to: recipient,
      replyTo: senderEmail,
      subject: `Your ${docType} scan — ${date}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0f0f0e;">
          <div style="font-size: 22px; font-weight: 600; margin-bottom: 6px;">sqanflow</div>
          <hr style="border: none; border-top: 1px solid #ebebeb; margin: 16px 0 24px;" />
          <p style="font-size: 15px; line-height: 1.6; color: #3a3a38; margin: 0 0 8px;">
            Your <strong>${docType}</strong> scan is attached.
          </p>
          <p style="font-size: 13px; color: #9a9a93; margin: 0;">
            ${pageCount} page${pageCount > 1 ? 's' : ''} · Scanned ${date} · Sent by ${senderEmail}
          </p>
          <hr style="border: none; border-top: 1px solid #ebebeb; margin: 24px 0;" />
          <p style="font-size: 12px; color: #b0afa8; margin: 0;">Sent with sqanflow</p>
        </div>
      `,
      attachments: [{ filename, content: pdfBase64 }],
    })

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, messageId: result.data?.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
