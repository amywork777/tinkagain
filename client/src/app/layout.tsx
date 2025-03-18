import { SpeechRecognitionProvider } from '@/components/utils/SpeechRecognitionProvider';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SpeechRecognitionProvider>
          {children}
        </SpeechRecognitionProvider>
      </body>
    </html>
  )
} 