'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  format,
  startOfMonth, endOfMonth,
  startOfWeek,  endOfWeek,
  startOfDay,   endOfDay,
  addDays, addMonths, subMonths,
  isSameMonth, isSameDay, isToday,
  getHours, getMinutes, differenceInMinutes,
} from 'date-fns';
import { useSession, signIn } from 'next-auth/react';
import { SerializableEvent } from '@/lib/types';

const EVENT_COLORS = [
  'bg-indigo-100 text-indigo-800 hover:bg-indigo-200',
  'bg-emerald-100 text-emerald-800 hover:bg-emerald-200',
  'bg-violet-100 text-violet-800 hover:bg-violet-200',
  'bg-amber-100 text-amber-800 hover:bg-amber-200',
  'bg-rose-100 text-rose-800 hover:bg-rose-200',
];

function colorFor(index: number) {
  return EVENT_COLORS[index % EVENT_COLORS.length];
}

type ViewMode = 'month' | 'week' | 'day';

const HOUR_HEIGHT = 48; // px per hour in the time-grid views
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Persisted across route changes (calendar <-> chat) via sessionStorage.
const VIEW_KEY = 'calendar:view';
const DATE_KEY = 'calendar:date';

function loadInitialView(): ViewMode {
  if (typeof window === 'undefined') return 'month';
  const saved = window.sessionStorage.getItem(VIEW_KEY);
  return saved === 'month' || saved === 'week' || saved === 'day' ? saved : 'month';
}

function loadInitialDate(): Date {
  if (typeof window === 'undefined') return new Date();
  const saved = window.sessionStorage.getItem(DATE_KEY);
  if (!saved) return new Date();
  const d = new Date(saved);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function formatHour(h: number) {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

export default function AppCalendar() {
  const { data: session, status } = useSession();
  const [view, setView] = useState<ViewMode>(loadInitialView);
  const [currentDate, setCurrentDate] = useState<Date>(loadInitialDate);
  const [events, setEvents] = useState<SerializableEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<SerializableEvent | null>(null);
  const [deleting, setDeleting] = useState(false);

  // The date range currently on screen — drives both fetching and the header.
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (view === 'month') {
      return {
        rangeStart: startOfWeek(startOfMonth(currentDate)),
        rangeEnd:   endOfWeek(endOfMonth(currentDate)),
      };
    }
    if (view === 'week') {
      return { rangeStart: startOfWeek(currentDate), rangeEnd: endOfWeek(currentDate) };
    }
    return { rangeStart: startOfDay(currentDate), rangeEnd: endOfDay(currentDate) };
  }, [view, currentDate]);

  const monthGridDays = useMemo(() => {
    const days: Date[] = [];
    let day = startOfWeek(startOfMonth(currentDate));
    const gridEnd = endOfWeek(endOfMonth(currentDate));
    while (day <= gridEnd) { days.push(day); day = addDays(day, 1); }
    return days;
  }, [currentDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [currentDate]);

  const fetchEvents = useCallback(async () => {
    if (!session?.accessToken) return;
    setLoading(true);
    try {
      const start = format(rangeStart, 'yyyy-MM-dd');
      const end   = format(rangeEnd,   'yyyy-MM-dd');
      const res = await fetch(`/api/google-calendar?startDate=${start}&endDate=${end}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [session, rangeStart, rangeEnd]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // Remember the viewing state so it survives navigating away and back.
  useEffect(() => { window.sessionStorage.setItem(VIEW_KEY, view); }, [view]);
  useEffect(() => { window.sessionStorage.setItem(DATE_KEY, currentDate.toISOString()); }, [currentDate]);

  const getEventsForDay = (day: Date) =>
    events
      .filter(e => isSameDay(new Date(e.start), day))
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const navigate = (dir: 1 | -1) => {
    setCurrentDate(d => {
      if (view === 'month') return dir === 1 ? addMonths(d, 1) : subMonths(d, 1);
      if (view === 'week')  return addDays(d, dir * 7);
      return addDays(d, dir);
    });
  };

  const goToToday = () => setCurrentDate(new Date());

  const deleteEvent = async (eventId: string) => {
    setDeleting(true);
    try {
      const res = await fetch('/api/google-calendar', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventIds: [eventId] }),
      });
      if (res.ok) {
        setEvents(prev => prev.filter(e => e.id !== eventId));
        setSelectedEvent(null);
      }
    } finally {
      setDeleting(false);
    }
  };

  const title = useMemo(() => {
    if (view === 'month') return format(currentDate, 'MMMM yyyy');
    if (view === 'week') {
      const start = startOfWeek(currentDate);
      const end   = endOfWeek(currentDate);
      const sameMonth = isSameMonth(start, end);
      return sameMonth
        ? `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`
        : `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
    }
    return format(currentDate, 'EEEE, MMMM d, yyyy');
  }, [view, currentDate]);

  if (status === 'loading') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
        <div className="text-5xl">📅</div>
        <h2 className="text-xl font-bold text-gray-800">Connect your Google Calendar</h2>
        <p className="text-gray-500 text-sm max-w-xs">
          Sign in with Google to view and manage your calendar events here.
        </p>
        <button
          onClick={() => signIn('google')}
          className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-300 rounded-xl shadow-sm hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 border-b gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors text-lg font-medium leading-none"
              aria-label="Previous"
            >‹</button>
            <button
              onClick={() => navigate(1)}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors text-lg font-medium leading-none"
              aria-label="Next"
            >›</button>
          </div>
          <button
            onClick={goToToday}
            className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-medium text-gray-600 transition-colors"
          >
            Today
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 truncate">{title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {loading ? 'Loading…' : `${events.length} event${events.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchEvents}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors text-sm disabled:opacity-40"
            title="Refresh"
          >↻</button>
          {/* View switcher */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            {(['month', 'week', 'day'] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                  view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === 'month' && (
        <MonthView
          days={monthGridDays}
          currentDate={currentDate}
          getEventsForDay={getEventsForDay}
          onSelectEvent={setSelectedEvent}
        />
      )}
      {view === 'week' && (
        <TimeGridView
          days={weekDays}
          getEventsForDay={getEventsForDay}
          onSelectEvent={setSelectedEvent}
        />
      )}
      {view === 'day' && (
        <TimeGridView
          days={[currentDate]}
          getEventsForDay={getEventsForDay}
          onSelectEvent={setSelectedEvent}
        />
      )}

      {/* Event detail modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setSelectedEvent(null); }}
        >
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-lg font-bold text-gray-900 pr-4">{selectedEvent.title}</h3>
              <button onClick={() => setSelectedEvent(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none flex-shrink-0">×</button>
            </div>
            <div className="space-y-2 mb-5">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>🕐</span>
                <span>{format(new Date(selectedEvent.start), 'PPp')}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>🏁</span>
                <span>{format(new Date(selectedEvent.end), 'PPp')}</span>
              </div>
              {selectedEvent.description && (
                <div className="flex items-start gap-2 text-sm text-gray-600 pt-1">
                  <span>📝</span>
                  <span>{selectedEvent.description}</span>
                </div>
              )}
            </div>
            <button
              onClick={() => deleteEvent(selectedEvent.id)}
              disabled={deleting}
              className="w-full py-2 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 rounded-xl text-sm font-medium transition-colors"
            >
              {deleting ? 'Deleting…' : 'Delete event'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Month view ------------------------------- */

interface ViewProps {
  getEventsForDay: (day: Date) => SerializableEvent[];
  onSelectEvent: (event: SerializableEvent) => void;
}

function MonthView({
  days, currentDate, getEventsForDay, onSelectEvent,
}: ViewProps & { days: Date[]; currentDate: Date }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="text-center text-xs font-semibold text-gray-400 uppercase tracking-wider py-2">
            {d}
          </div>
        ))}
      </div>

      <div className="flex-1 grid grid-cols-7 auto-rows-fr divide-x divide-y divide-gray-100 overflow-hidden">
        {days.map((day, idx) => {
          const dayEvents = getEventsForDay(day);
          const inMonth   = isSameMonth(day, currentDate);
          const todayFlag = isToday(day);

          return (
            <div
              key={idx}
              className={`min-h-0 p-1 overflow-hidden flex flex-col ${!inMonth ? 'bg-gray-50' : 'bg-white'}`}
            >
              <div
                className={`self-start w-7 h-7 flex items-center justify-center rounded-full text-sm font-medium mb-1 ${
                  todayFlag ? 'bg-indigo-600 text-white' : inMonth ? 'text-gray-700' : 'text-gray-300'
                }`}
              >
                {format(day, 'd')}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {dayEvents.slice(0, 3).map((event, i) => (
                  <button
                    key={event.id}
                    onClick={() => onSelectEvent(event)}
                    className={`w-full text-left text-[11px] font-medium rounded px-1.5 py-0.5 truncate transition-colors ${colorFor(i)}`}
                  >
                    {event.title}
                  </button>
                ))}
                {dayEvents.length > 3 && (
                  <p className="text-[10px] text-gray-400 pl-1">+{dayEvents.length - 3} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------- Week / Day time grid -------------------------- */

function TimeGridView({
  days, getEventsForDay, onSelectEvent,
}: ViewProps & { days: Date[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to ~7 AM on first render so the day starts near business hours.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_HEIGHT;
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Column headers */}
      <div className="flex border-b flex-shrink-0 pr-4">
        <div className="w-14 flex-shrink-0" />
        <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((day, i) => {
            const todayFlag = isToday(day);
            return (
              <div key={i} className="text-center py-2 border-l border-gray-100 first:border-l-0">
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  {format(day, 'EEE')}
                </div>
                <div
                  className={`mt-1 mx-auto w-8 h-8 flex items-center justify-center rounded-full text-sm font-semibold ${
                    todayFlag ? 'bg-indigo-600 text-white' : 'text-gray-700'
                  }`}
                >
                  {format(day, 'd')}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex" style={{ height: 24 * HOUR_HEIGHT }}>
          {/* Hour gutter */}
          <div className="w-14 flex-shrink-0 relative">
            {HOURS.map(h => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-gray-400" style={{ top: h * HOUR_HEIGHT }}>
                {h === 0 ? '' : formatHour(h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((day, dayIdx) => {
              const dayEvents = getEventsForDay(day);
              return (
                <div key={dayIdx} className="relative border-l border-gray-100 first:border-l-0">
                  {/* Hour lines */}
                  {HOURS.map(h => (
                    <div
                      key={h}
                      className="absolute left-0 right-0 border-t border-gray-100"
                      style={{ top: h * HOUR_HEIGHT }}
                    />
                  ))}

                  {/* Events */}
                  {dayEvents.map((event, i) => {
                    const start = new Date(event.start);
                    const end   = new Date(event.end);
                    const top    = (getHours(start) + getMinutes(start) / 60) * HOUR_HEIGHT;
                    const height = Math.max((differenceInMinutes(end, start) / 60) * HOUR_HEIGHT, 20);
                    return (
                      <button
                        key={event.id}
                        onClick={() => onSelectEvent(event)}
                        className={`absolute left-0.5 right-0.5 rounded-md px-1.5 py-0.5 text-left overflow-hidden transition-colors ${colorFor(i)}`}
                        style={{ top, height }}
                      >
                        <div className="text-[11px] font-semibold truncate leading-tight">{event.title}</div>
                        <div className="text-[10px] opacity-75 truncate">{format(start, 'h:mm a')}</div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
