import AppCalendar from '@/components/AppCalendar';

export default function CalendarPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 border-b border-gray-100 bg-white flex-shrink-0">
        <h1 className="text-base font-semibold text-gray-700">📅 Your Calendar</h1>
        <p className="text-xs text-gray-400">
          Connected to your Google Calendar. Use the AI Chat to add and manage events.
        </p>
      </div>
      <div className="flex-1 overflow-hidden">
        <AppCalendar />
      </div>
    </div>
  );
}
