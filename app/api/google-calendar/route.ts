import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';

const BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const TZ = 'America/New_York';

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) return null;
  return session;
}

// ─── GET: fetch events for a date range ───────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate   = searchParams.get('endDate');

    const params = new URLSearchParams({
      maxResults:    '500',
      orderBy:       'startTime',
      singleEvents:  'true',
      ...(startDate && { timeMin: new Date(`${startDate}T00:00:00`).toISOString() }),
      ...(endDate   && { timeMax: new Date(`${endDate}T23:59:59`).toISOString() }),
    });

    const res = await fetch(`${BASE}?${params}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });

    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json({ error: err.error?.message ?? `HTTP ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    const events = (data.items ?? []).map((e: any) => ({
      id:          e.id,
      title:       e.summary ?? '(no title)',
      description: e.description,
      start:       e.start?.dateTime ?? e.start?.date ?? '',
      end:         e.end?.dateTime   ?? e.end?.date   ?? '',
    }));

    return NextResponse.json({ events });
  } catch (err: any) {
    console.error('GCal GET error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}

// ─── POST: create events ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated. Please sign in with Google.' }, { status: 401 });
    }

    const { events } = await req.json();
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: 'No events provided' }, { status: 400 });
    }

    const results = await Promise.allSettled(
      events.map(async (event: { title: string; description?: string; start: string; end: string }) => {
        const res = await fetch(BASE, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary:     event.title,
            description: event.description ?? '',
            start: { dateTime: new Date(event.start).toISOString(), timeZone: TZ },
            end:   { dateTime: new Date(event.end).toISOString(),   timeZone: TZ },
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error?.message ?? `HTTP ${res.status}`);
        return res.json();
      })
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed    = results.filter(r => r.status === 'rejected').length;
    return NextResponse.json({
      success: succeeded > 0,
      succeeded,
      failed,
      message: `Added ${succeeded} event${succeeded !== 1 ? 's' : ''} to Google Calendar${failed ? ` (${failed} failed)` : ''}`,
    });
  } catch (err: any) {
    console.error('GCal POST error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}

function buildPatchBody(updates: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (updates.title       !== undefined) body.summary     = updates.title;
  if (updates.description !== undefined) body.description = updates.description;
  if (updates.start       !== undefined) body.start = { dateTime: new Date(updates.start as string).toISOString(), timeZone: TZ };
  if (updates.end         !== undefined) body.end   = { dateTime: new Date(updates.end as string).toISOString(),   timeZone: TZ };
  return body;
}

// ─── PATCH: edit one or more events ───────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const body = await req.json();
    const items: Array<{ eventId: string; updates: Record<string, unknown> }> =
      body.events ?? (body.eventId ? [{ eventId: body.eventId, updates: body.updates }] : []);

    if (items.length === 0) return NextResponse.json({ error: 'No events provided' }, { status: 400 });

    const results = await Promise.allSettled(
      items.map(async ({ eventId, updates }) => {
        const patchBody = buildPatchBody(updates ?? {});
        const res = await fetch(`${BASE}/${eventId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody),
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error?.message ?? `HTTP ${res.status}`);
        }
      })
    );

    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length > 0) {
      const reasons = failed.map(f => f.reason?.message ?? 'unknown').join('; ');
      return NextResponse.json({ error: `Failed to update ${failed.length} event(s): ${reasons}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: `${items.length} event(s) updated in Google Calendar.` });
  } catch (err: any) {
    console.error('GCal PATCH error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}

// ─── DELETE: remove one or more events ────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const body = await req.json();
    const ids: string[] = body.eventIds ?? (body.eventId ? [body.eventId] : []);
    if (ids.length === 0) return NextResponse.json({ error: 'eventIds is required' }, { status: 400 });

    const results = await Promise.allSettled(
      ids.map(id =>
        fetch(`${BASE}/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.accessToken}` },
        }).then(async res => {
          if (!res.ok && res.status !== 410) {
            const text = await res.text();
            throw new Error(text || `HTTP ${res.status}`);
          }
        })
      )
    );

    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length > 0) {
      const reasons = failed.map(f => f.reason?.message ?? 'unknown').join('; ');
      return NextResponse.json({ error: `Failed to delete ${failed.length} event(s): ${reasons}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: `${ids.length} event(s) removed from Google Calendar.` });
  } catch (err: any) {
    console.error('GCal DELETE error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}
