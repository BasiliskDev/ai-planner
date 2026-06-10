'use client';

import { SessionProvider } from 'next-auth/react';
import { ChatProvider } from '@/contexts/ChatContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ChatProvider>{children}</ChatProvider>
    </SessionProvider>
  );
}
