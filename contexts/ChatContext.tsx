'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { ChatMessage } from '@/lib/types';

interface ChatContextType {
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  clearMessages: () => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Use a ref so addMessage/clearMessages don't need to be re-created on key change
  const storageKeyRef = useRef<string | null>(null);

  // When auth state settles, load the right account's history (or clear if signed out)
  useEffect(() => {
    if (status === 'loading') return;

    if (session?.user?.email) {
      const key = `ai-planner-chat-${session.user.email}`;
      storageKeyRef.current = key;
      try {
        const stored = localStorage.getItem(key);
        setMessages(stored ? JSON.parse(stored) : []);
      } catch {
        setMessages([]);
      }
    } else {
      // Signed out: clear in-memory history, do not persist
      storageKeyRef.current = null;
      setMessages([]);
    }
  }, [session?.user?.email, status]);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => {
      const updated = [...prev, msg];
      if (storageKeyRef.current) {
        localStorage.setItem(storageKeyRef.current, JSON.stringify(updated));
      }
      return updated;
    });
  }, []);

  const clearMessages = useCallback(() => {
    if (storageKeyRef.current) {
      localStorage.removeItem(storageKeyRef.current);
    }
    setMessages([]);
  }, []);

  return (
    <ChatContext.Provider value={{ messages, addMessage, clearMessages }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used inside ChatProvider');
  return ctx;
}
