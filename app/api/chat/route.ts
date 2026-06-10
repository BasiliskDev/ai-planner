import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_calendar_events',
      description:
        'Propose a list of calendar events when the user asks for a plan, schedule, or routine. Events will be added directly to the user\'s Google Calendar.',
      parameters: {
        type: 'object',
        properties: {
          events: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title:       { type: 'string', description: 'Short event title' },
                description: { type: 'string', description: 'Detailed notes or instructions' },
                start: { type: 'string', description: 'ISO 8601 datetime, e.g. 2024-06-10T09:00:00' },
                end:   { type: 'string', description: 'ISO 8601 datetime' },
              },
              required: ['title', 'start', 'end'],
            },
          },
          summary: {
            type: 'string',
            description: 'Brief description of the plan being created.',
          },
        },
        required: ['events', 'summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_calendar_event',
      description:
        'Edit one or more existing Google Calendar events. Each entry specifies which event ID and what fields to change.',
      parameters: {
        type: 'object',
        properties: {
          events: {
            type: 'array',
            description: 'List of events to edit. Include ALL events that need to change.',
            items: {
              type: 'object',
              properties: {
                eventId: {
                  type: 'string',
                  description: 'The exact ID value from [gcal:ID] in the event listings — copy only the ID, not the brackets.',
                },
                updates: {
                  type: 'object',
                  description: 'Only include fields that should change for this specific event.',
                  properties: {
                    title:       { type: 'string' },
                    description: { type: 'string' },
                    start: { type: 'string', description: 'New ISO 8601 start datetime' },
                    end:   { type: 'string', description: 'New ISO 8601 end datetime' },
                  },
                },
              },
              required: ['eventId', 'updates'],
            },
          },
          message: { type: 'string', description: 'Human-readable summary of what changed' },
        },
        required: ['events', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_calendar_event',
      description:
        'Remove one or more events from Google Calendar. Include ALL matching events when the user asks to delete a group.',
      parameters: {
        type: 'object',
        properties: {
          events: {
            type: 'array',
            description: 'List of events to remove.',
            items: {
              type: 'object',
              properties: {
                eventId: {
                  type: 'string',
                  description: 'The exact ID value from [gcal:ID] in the event listings — copy only the ID, not the brackets.',
                },
              },
              required: ['eventId'],
            },
          },
          message: { type: 'string', description: 'Confirmation of what was removed' },
        },
        required: ['events', 'message'],
      },
    },
  },
];

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}
function fmtEnd(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

export async function POST(req: NextRequest) {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { messages, startDate, endDate, isAuthenticated } = await req.json();
    const today = new Date().toLocaleDateString('en-CA');

    let calendarSection = '';

    if (isAuthenticated) {
      const session = await getServerSession(authOptions);
      if (session?.accessToken) {
        try {
          const params = new URLSearchParams({
            maxResults:   '2500',
            orderBy:      'startTime',
            singleEvents: 'true',
            ...(startDate && { timeMin: new Date(`${startDate}T00:00:00`).toISOString() }),
            ...(endDate   && { timeMax: new Date(`${endDate}T23:59:59`).toISOString() }),
          });
          const gcalRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
            { headers: { Authorization: `Bearer ${session.accessToken}` } }
          );
          if (gcalRes.ok) {
            const gcalData = await gcalRes.json();
            const items: any[] = gcalData.items ?? [];
            if (items.length > 0) {
              calendarSection =
                `\n\nGoogle Calendar (${items.length} event${items.length !== 1 ? 's' : ''}, full access):\n` +
                items
                  .map(e => {
                    const start = e.start?.dateTime ?? e.start?.date ?? '';
                    const end   = e.end?.dateTime   ?? e.end?.date   ?? '';
                    const desc  = e.description ? ` | ${e.description.slice(0, 80)}` : '';
                    return `  [gcal:${e.id}] "${e.summary ?? '(no title)'}" — ${fmt(start)} → ${fmtEnd(end)}${desc}`;
                  })
                  .join('\n');
            } else {
              calendarSection = '\n\nGoogle Calendar: no events in the selected date range.';
            }
          }
        } catch {
          // non-fatal
        }
      }
    } else {
      calendarSection = '\n\nThe user is NOT signed in with Google — no calendar access.';
    }

    const systemPrompt = `You are an AI planning assistant. Today is ${today}.${calendarSection}

Rules:
1. Create a plan → call create_calendar_events. Events are added directly to Google Calendar — no confirmation needed.
2. Edit events → call edit_calendar_event with ALL events that need updating. Each entry has its own eventId and updates. IMPORTANT: for eventId, copy only the raw value between [gcal: and ] — never include the brackets.
3. Remove events → call remove_calendar_event with ALL matching events. IMPORTANT: for eventId, copy only the raw value between [gcal: and ] — never include the brackets. For example, when the user says "remove the plan" or "delete all Monday events", include every matching event.
4. If the user asks to edit or remove an event not in the listings, say you can't find it and ask them to describe it more specifically.
5. If the user is not signed in and wants calendar operations, tell them to sign in with Google first.
6. Everything else → reply conversationally, no function call.

Event creation guidelines:
- Start from tomorrow or the next logical weekday.
- Default 1-hour sessions unless the user says otherwise.
- Multi-week plans: generate every individual occurrence.
- Titles: short and action-oriented.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      tools,
      tool_choice: 'auto',
    });

    const message = response.choices[0].message;
    const call = message.tool_calls?.[0];

    if (call?.function?.arguments) {
      const args = JSON.parse(call.function.arguments);

      switch (call.function.name) {
        case 'create_calendar_events':
          return NextResponse.json({ type: 'events', content: args.summary, events: args.events });

        case 'edit_calendar_event':
          return NextResponse.json({ type: 'edit', events: args.events, message: args.message });

        case 'remove_calendar_event':
          return NextResponse.json({ type: 'remove', events: args.events, message: args.message });
      }
    }

    return NextResponse.json({
      type: 'message',
      content: message.content ?? "I'm not sure how to help with that.",
    });
  } catch (err: any) {
    console.error('Chat API error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}
