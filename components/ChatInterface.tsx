'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { useSession, signIn } from 'next-auth/react';
import { useChatContext } from '@/contexts/ChatContext';
import { ChatMessage, SerializableEvent, RawApiEvent } from '@/lib/types';

const DATE_RANGE_KEY = 'ai-planner-date-range';

function getDefaultRange() {
  const start = new Date();
  start.setDate(1);
  const end = new Date();
  end.setMonth(end.getMonth() + 3);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const EXAMPLE_PROMPTS = [
  'Create a 4-week workout plan (Mon, Wed, Fri)',
  'Make a 2-week study schedule for my exam',
  'Plan daily meditation sessions for a month',
  'Schedule a book club meeting every other Sunday',
];

function EventList({ events }: { events: SerializableEvent[] }) {
  return (
    <div className="mt-3 space-y-1.5 max-h-52 overflow-y-auto pr-1">
      {events.map((e, i) => (
        <div key={i} className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
          <p className="font-semibold text-xs text-indigo-900 leading-tight">{e.title}</p>
          <p className="text-[11px] text-indigo-500 mt-0.5">
            {format(new Date(e.start), 'EEE, MMM d · h:mm a')}
            {' – '}
            {format(new Date(e.end), 'h:mm a')}
          </p>
          {e.description && (
            <p className="text-[11px] text-indigo-400 mt-0.5 line-clamp-2">{e.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ChatInterface() {
  const { messages, addMessage, clearMessages } = useChatContext();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(getDefaultRange);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { data: session } = useSession();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Load persisted date range after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DATE_RANGE_KEY);
      if (stored) setDateRange(JSON.parse(stored));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem(DATE_RANGE_KEY, JSON.stringify(dateRange));
  }, [dateRange]);

  // Auto-resize textarea upward
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
    }
  }, [input]);

  function rawId(id: string): string {
    const m = id.match(/^\[(?:id|gcal):(.+)\]$/) || id.match(/^\[ID:\s*(.+)\]$/i);
    return m ? m[1].trim() : id.trim();
  }

  async function processGCalInChunks<T>(
    items: T[],
    label: string,
    handler: (chunk: T[]) => Promise<void>,
    chunkSize = 5,
    delayMs = 600
  ) {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) chunks.push(items.slice(i, i + chunkSize));
    setBatchProgress({ current: 0, total: items.length, label });
    let processed = 0;
    try {
      for (let i = 0; i < chunks.length; i++) {
        await handler(chunks[i]);
        processed += chunks[i].length;
        setBatchProgress({ current: processed, total: items.length, label });
        if (i < chunks.length - 1) await new Promise<void>(r => setTimeout(r, delayMs));
      }
    } finally {
      setBatchProgress(null);
    }
  }

  function requireAuth(action: string): boolean {
    if (!session) {
      addMessage({ role: 'assistant', content: `⚠️ You need to sign in with Google to ${action}. Use the Sign in button above.` });
      return false;
    }
    if ((session as any).error === 'RefreshTokenError') {
      addMessage({ role: 'assistant', content: '⚠️ Your Google session has expired. Please sign out and sign back in.' });
      return false;
    }
    return true;
  }

  async function handleResponse(data: any) {
    switch (data.type) {
      case 'events': {
        const serialized: SerializableEvent[] = (data.events as RawApiEvent[]).map(e => ({
          id:          crypto.randomUUID(),
          title:       e.title,
          description: e.description,
          start:       e.start,
          end:         e.end,
        }));

        addMessage({ role: 'assistant', content: data.content, events: serialized });

        if (!requireAuth('add events to your calendar')) break;

        setIsActing(true);
        try {
          await processGCalInChunks(
            serialized,
            'Adding to Google Calendar…',
            async (chunk) => {
              const res = await fetch('/api/google-calendar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ events: chunk }),
              });
              const result = await res.json();
              if (!res.ok) throw new Error(result.error || 'Failed');
            }
          );
          addMessage({
            role: 'assistant',
            content: `✅ ${serialized.length} event${serialized.length !== 1 ? 's' : ''} added to your Google Calendar!`,
          });
        } catch (err: any) {
          addMessage({ role: 'assistant', content: `❌ Could not add to Google Calendar: ${err.message}` });
        } finally {
          setIsActing(false);
        }
        break;
      }

      case 'edit': {
        const toEdit: Array<{ eventId: string; updates: Record<string, unknown> }> = data.events ?? [];
        if (!requireAuth('edit calendar events')) break;

        setIsActing(true);
        try {
          await processGCalInChunks(
            toEdit,
            'Updating Google Calendar…',
            async (chunk) => {
              const res = await fetch('/api/google-calendar', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ events: chunk.map(e => ({ eventId: rawId(e.eventId), updates: e.updates })) }),
              });
              const result = await res.json();
              if (!res.ok) throw new Error(result.error || 'Failed to update');
            }
          );
          addMessage({ role: 'assistant', content: `✅ ${data.message}` });
        } catch (err: any) {
          addMessage({ role: 'assistant', content: `❌ Could not update: ${err.message}` });
        } finally {
          setIsActing(false);
        }
        break;
      }

      case 'remove': {
        const toRemove: Array<{ eventId: string }> = data.events ?? [];
        const googleIds = toRemove.map(e => rawId(e.eventId));
        if (!requireAuth('delete calendar events')) break;

        setIsActing(true);
        try {
          await processGCalInChunks(
            googleIds,
            'Removing from Google Calendar…',
            async (chunk) => {
              const res = await fetch('/api/google-calendar', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventIds: chunk }),
              });
              const result = await res.json();
              if (!res.ok) throw new Error(result.error || 'Failed to delete');
            }
          );
          addMessage({ role: 'assistant', content: `✅ ${data.message}` });
        } catch (err: any) {
          addMessage({ role: 'assistant', content: `❌ Could not remove: ${err.message}` });
        } finally {
          setIsActing(false);
        }
        break;
      }

      default:
        addMessage({ role: 'assistant', content: data.content });
    }
  }

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading || isActing) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const history = [...messages, userMsg];

    addMessage(userMsg);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages:        history,
          startDate:       dateRange.start,
          endDate:         dateRange.end,
          isAuthenticated: !!session && !(session as any).error,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'API error');
      }

      const data = await res.json();
      setIsLoading(false);
      await handleResponse(data);
    } catch (err: any) {
      setIsLoading(false);
      addMessage({ role: 'assistant', content: `Sorry, something went wrong: ${err.message}. Please try again.` });
    } finally {
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Plain Enter sends; Shift+Enter and Cmd/Ctrl+Enter insert a newline
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 ? (
          <div className="max-w-lg mx-auto">
            <div className="text-center mb-8">
              <div className="text-4xl mb-3">🤖</div>
              <h2 className="text-xl font-bold text-gray-900">AI Planning Assistant</h2>
              <p className="text-gray-500 text-sm mt-1">
                Ask me to create any plan or schedule and I'll add it straight to your Google Calendar.
              </p>
              {!session && (
                <button
                  onClick={() => signIn('google')}
                  className="mt-4 flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-xl shadow-sm hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors mx-auto"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Sign in with Google to use calendar features
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {EXAMPLE_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => sendMessage(p)}
                  className="text-left text-sm p-3 bg-white border border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 text-gray-700 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-sm mr-2 flex-shrink-0 mt-1">
                  🤖
                </div>
              )}
              <div
                className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-sm whitespace-pre-wrap'
                    : 'bg-white text-gray-800 shadow-sm border border-gray-100 rounded-bl-sm'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {msg.events && msg.events.length > 0 && <EventList events={msg.events} />}
              </div>
            </div>
          ))
        )}

        {(isLoading || isActing) && (
          <div className="flex justify-start">
            <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-sm mr-2 flex-shrink-0">
              🤖
            </div>
            <div className="bg-white shadow-sm border border-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
              {batchProgress ? (
                <div className="w-52">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs text-gray-500">{batchProgress.label}</p>
                    <p className="text-xs text-gray-400 ml-3 tabular-nums">{batchProgress.current}/{batchProgress.total}</p>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${Math.round((batchProgress.current / batchProgress.total) * 100)}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex gap-1 items-center h-4">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Date range control */}
      <div className="mx-4 mb-2 px-3 py-2 bg-white border border-gray-200 rounded-xl flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="font-medium text-gray-600 shrink-0">AI date range:</span>
        <input
          type="date"
          value={dateRange.start}
          max={dateRange.end}
          onChange={e => setDateRange(r => ({ ...r, start: e.target.value }))}
          className="px-2 py-1 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <span className="shrink-0">→</span>
        <input
          type="date"
          value={dateRange.end}
          min={dateRange.start}
          onChange={e => setDateRange(r => ({ ...r, end: e.target.value }))}
          className="px-2 py-1 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button
          type="button"
          onClick={() => setDateRange(getDefaultRange())}
          className="ml-auto text-gray-400 hover:text-indigo-500 transition-colors shrink-0"
          title="Reset to default range"
        >
          Reset
        </button>
      </div>

      {/* Input bar */}
      <form
        onSubmit={e => { e.preventDefault(); sendMessage(input); }}
        className="px-4 py-3 bg-white border-t border-gray-100"
      >
        <div className="flex gap-2 items-end max-w-4xl mx-auto">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me to create a plan, or edit an existing event… (Shift+Enter or ⌘+Enter for new line)"
            disabled={isLoading || isActing}
            rows={1}
            className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent text-sm disabled:opacity-50 resize-none overflow-hidden leading-relaxed"
          />
          <button
            type="submit"
            disabled={isLoading || isActing || !input.trim()}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl font-medium text-sm transition-colors flex-shrink-0"
          >
            Send
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Clear all chat history? This cannot be undone.')) clearMessages();
              }}
              disabled={isLoading || isActing}
              className="px-3 py-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-xl transition-colors disabled:opacity-40 text-sm flex-shrink-0 whitespace-nowrap"
            >
              Clear chat
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
