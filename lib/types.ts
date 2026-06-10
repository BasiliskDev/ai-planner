// Serialization-safe event used in API payloads and chat message display
export interface SerializableEvent {
  id: string;
  title: string;
  description?: string;
  start: string; // ISO 8601
  end: string;   // ISO 8601
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  events?: SerializableEvent[];
}

export interface RawApiEvent {
  title: string;
  description?: string;
  start: string;
  end: string;
}
