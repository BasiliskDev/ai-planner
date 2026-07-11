import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';

const tools: Anthropic.Tool[] = [
  {
    name: 'create_calendar_events',
    description:
      'Propose a list of calendar events when the user asks for a plan, schedule, or routine. Events will be added directly to the user\'s Google Calendar.',
    input_schema: {
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
  {
    name: 'edit_calendar_event',
    description:
      'Edit one or more existing Google Calendar events when multiple field types need to change at once (e.g. both time and title). For focused changes, prefer the specialized tools: edit_event_time, edit_event_description, or change_event_calendar.',
    input_schema: {
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
  {
    name: 'edit_event_time',
    description:
      'Reschedule one or more events by changing only their start and/or end time. Use this when the user explicitly asks to move, reschedule, or shift the time of an event.',
    input_schema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          description: 'List of events to reschedule.',
          items: {
            type: 'object',
            properties: {
              eventId: {
                type: 'string',
                description: 'The exact ID value from [gcal:ID] in the event listings — copy only the ID, not the brackets.',
              },
              start: { type: 'string', description: 'New ISO 8601 start datetime' },
              end:   { type: 'string', description: 'New ISO 8601 end datetime' },
            },
            required: ['eventId'],
          },
        },
        message: { type: 'string', description: 'Human-readable summary of the time changes' },
      },
      required: ['events', 'message'],
    },
  },
  {
    name: 'edit_event_description',
    description:
      'Update the title and/or description text of one or more events without touching their times. Use this when the user asks to rename an event or add/change notes.',
    input_schema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          description: 'List of events whose text content should change.',
          items: {
            type: 'object',
            properties: {
              eventId: {
                type: 'string',
                description: 'The exact ID value from [gcal:ID] in the event listings — copy only the ID, not the brackets.',
              },
              title:       { type: 'string', description: 'New event title' },
              description: { type: 'string', description: 'New notes or details' },
            },
            required: ['eventId'],
          },
        },
        message: { type: 'string', description: 'Human-readable summary of the text changes' },
      },
      required: ['events', 'message'],
    },
  },
  {
    name: 'change_event_calendar',
    description:
      'Move one or more events to a different Google Calendar (e.g. from Personal to Work). Use calendar IDs from the "Available Calendars" list in the system prompt.',
    input_schema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          description: 'List of events to move.',
          items: {
            type: 'object',
            properties: {
              eventId: {
                type: 'string',
                description: 'The exact ID value from [gcal:ID] in the event listings — copy only the ID, not the brackets.',
              },
              calendarId: {
                type: 'string',
                description: 'Target calendar ID from the Available Calendars list, e.g. "primary" or an email-style ID.',
              },
            },
            required: ['eventId', 'calendarId'],
          },
        },
        message: { type: 'string', description: 'Human-readable summary of where the events are being moved' },
      },
      required: ['events', 'message'],
    },
  },
  {
    name: 'remove_calendar_event',
    description:
      'Remove one or more events from Google Calendar. Include ALL matching events when the user asks to delete a group.',
    input_schema: {
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
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const { messages, startDate, endDate, isAuthenticated } = await req.json();
    const today = new Date().toLocaleDateString('en-CA');

    let calendarSection = '';
    let calendarsSection = '';

    if (isAuthenticated) {
      const session = await getServerSession(authOptions);
      if (session?.accessToken) {
        // Fetch events and calendar list in parallel
        const [eventsRes, calListRes] = await Promise.allSettled([
          fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({
              maxResults:   '2500',
              orderBy:      'startTime',
              singleEvents: 'true',
              ...(startDate && { timeMin: new Date(`${startDate}T00:00:00`).toISOString() }),
              ...(endDate   && { timeMax: new Date(`${endDate}T23:59:59`).toISOString() }),
            })}`,
            { headers: { Authorization: `Bearer ${session.accessToken}` } }
          ),
          fetch(
            'https://www.googleapis.com/calendar/v3/users/me/calendarList',
            { headers: { Authorization: `Bearer ${session.accessToken}` } }
          ),
        ]);

        if (eventsRes.status === 'fulfilled' && eventsRes.value.ok) {
          const gcalData = await eventsRes.value.json();
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

        if (calListRes.status === 'fulfilled' && calListRes.value.ok) {
          const calData = await calListRes.value.json();
          const writableCals: any[] = (calData.items ?? []).filter(
            (c: any) => c.accessRole === 'owner' || c.accessRole === 'writer'
          );
          if (writableCals.length > 0) {
            calendarsSection =
              '\n\nAvailable Calendars (for change_event_calendar):\n' +
              writableCals.map((c: any) => `  [cal:${c.id}] ${c.summary}`).join('\n');
          }
        }
      }
    } else {
      calendarSection = '\n\nThe user is NOT signed in with Google — no calendar access.';
    }

    const systemPrompt = `You are an AI planning assistant. Today is ${today}.${calendarSection}${calendarsSection}

Rules:
1. Create a plan → call create_calendar_events. Events are added directly to Google Calendar — no confirmation needed.
2. Edit events — pick the most specific tool:
   • Only time/schedule changes → edit_event_time
   • Only title or description changes → edit_event_description
   • Move to a different calendar → change_event_calendar (use the ID from Available Calendars above, e.g. "primary")
   • Multiple field types changing at once → edit_calendar_event
   For all edit tools: copy the raw event ID from [gcal:ID] — never include the brackets.
3. Remove events → call remove_calendar_event with ALL matching events. Copy the raw event ID from [gcal:ID].
4. If the user asks to edit or remove an event not in the listings, say you can't find it and ask them to describe it more specifically.
5. If the user is not signed in and wants calendar operations, tell them to sign in with Google first.
6. Everything else → reply conversationally, no function call.

Event creation guidelines:
- Start from tomorrow or the next logical weekday.
- Default 1-hour sessions unless the user says otherwise.
- Multi-week plans: generate every individual occurrence.
- Titles: short and action-oriented.`;

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map(({ role, content }: { role: string; content: string }) => ({ role, content })),
      tools,
      tool_choice: { type: 'auto' },
      thinking: { type: 'adaptive' },
    });

    const toolBlock = response.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined;
    if (toolBlock && response.stop_reason === 'tool_use') {
      const args = toolBlock.input as any;

      switch (toolBlock.name) {
        case 'create_calendar_events':
          return NextResponse.json({ type: 'events', content: args.summary, events: args.events });

        case 'edit_calendar_event':
          return NextResponse.json({ type: 'edit', events: args.events, message: args.message });

        case 'edit_event_time':
          return NextResponse.json({
            type: 'edit',
            message: args.message,
            events: (args.events as any[]).map((e: any) => ({
              eventId: e.eventId,
              updates: {
                ...(e.start !== undefined && { start: e.start }),
                ...(e.end   !== undefined && { end:   e.end   }),
              },
            })),
          });

        case 'edit_event_description':
          return NextResponse.json({
            type: 'edit',
            message: args.message,
            events: (args.events as any[]).map((e: any) => ({
              eventId: e.eventId,
              updates: {
                ...(e.title       !== undefined && { title:       e.title       }),
                ...(e.description !== undefined && { description: e.description }),
              },
            })),
          });

        case 'change_event_calendar':
          return NextResponse.json({
            type: 'edit',
            message: args.message,
            events: (args.events as any[]).map((e: any) => ({
              eventId:  e.eventId,
              updates: { calendarId: e.calendarId },
            })),
          });

        case 'remove_calendar_event':
          return NextResponse.json({ type: 'remove', events: args.events, message: args.message });
      }
    }

    const textBlock = response.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined;
    return NextResponse.json({
      type: 'message',
      content: textBlock?.text ?? "I'm not sure how to help with that.",
    });
  } catch (err: any) {
    console.error('Chat API error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}
