import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-gradient-to-br from-indigo-50 via-white to-white px-6 py-12">
      <div className="max-w-xl w-full text-center">
        <div className="text-6xl mb-5">🗓️</div>
        <h1 className="text-4xl font-bold text-gray-900 mb-3">AI Planner</h1>
        <p className="text-gray-500 text-lg mb-8 leading-relaxed">
          Your intelligent calendar assistant. Describe any plan in plain English and
          watch it appear on your Google Calendar — instantly.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <Link
            href="/chat"
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors shadow-sm"
          >
            Open AI Chat →
          </Link>
          <Link
            href="/calendar"
            className="px-6 py-3 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-xl font-semibold text-sm transition-colors shadow-sm"
          >
            View Calendar
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          {[
            { icon: '💬', title: 'Natural language', desc: 'Just describe what you want — workout plan, study schedule, anything.' },
            { icon: '📅', title: 'Google Calendar sync', desc: 'Events go directly to your Google Calendar, no extra steps.' },
            { icon: '✏️', title: 'Edit & delete', desc: 'Ask the AI to reschedule or remove events by name or date.' },
          ].map(f => (
            <div key={f.title} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <div className="text-2xl mb-2">{f.icon}</div>
              <h3 className="font-semibold text-gray-800 text-sm mb-1">{f.title}</h3>
              <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
