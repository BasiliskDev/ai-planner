import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from '@/providers/Providers';
import Sidebar from '@/components/Sidebar';
import AuthButton from '@/components/AuthButton';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AI Planner',
  description: 'AI-powered calendar and planning assistant',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full`}>
        <Providers>
          <div className="flex flex-col h-full">
            {/* Header */}
            <header className="h-14 flex-shrink-0 border-b border-gray-200 bg-white flex items-center justify-between px-6 z-40">
              <div className="flex items-center gap-2">
                <span className="text-xl">🗓️</span>
                <span className="font-bold text-gray-900 text-lg">AI Planner</span>
              </div>
              <AuthButton />
            </header>

            {/* Body: persistent sidebar + page content */}
            <div className="flex-1 flex overflow-hidden">
              <Sidebar />
              <main className="flex-1 overflow-hidden">{children}</main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
