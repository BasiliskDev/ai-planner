import ChatInterface from '@/components/ChatInterface';

export default function ChatPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 border-b border-gray-100 bg-white flex-shrink-0">
        <h1 className="text-base font-semibold text-gray-700">
          💬 AI Planning Assistant
        </h1>
        <p className="text-xs text-gray-400">
          Describe any plan and I'll turn it into calendar events.
        </p>
      </div>
      <div className="flex-1 overflow-hidden">
        <ChatInterface />
      </div>
    </div>
  );
}
