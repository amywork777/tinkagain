import { Inter } from 'next/font/google';
import { SpeechRecognitionProvider } from '@/components/utils/SpeechRecognitionProvider';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

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