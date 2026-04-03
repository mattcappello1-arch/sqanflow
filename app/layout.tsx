import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'sqanflow',
  description: 'Scan. Send. Done.',
  themeColor: '#0f0f0e',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
