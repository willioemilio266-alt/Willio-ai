export type MemoryCategory =
  | 'identité'
  | 'préférence'
  | 'correction'
  | 'connaissance'
  | 'spiritualité'
  | 'projet';

export interface MemoryItem {
  id: string;
  content: string;
  category: MemoryCategory;
  source: 'auto' | 'manuel' | 'correction';
  createdAt: string;
  updatedAt: string;
}

export interface WebSource {
  title: string;
  uri: string;
}

export interface AttachedDocument {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  textContent?: string;
  base64Data?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  sources?: WebSource[];
  attachmentName?: string;
  memorySaved?: string | null;
  usedWebSearch?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface WillioModule {
  id: string;
  name: string;
  description: string;
  instruction: string;
  enabled: boolean;
  builtin?: boolean;
  createdAt: string;
}

export interface WillioSettings {
  voiceEngine: 'gemini' | 'browser';
  geminiVoiceName: 'Charon' | 'Fenrir';
  autoSpeak: boolean;
  ecoRamMode: boolean;
  defaultWebSearch: boolean;
  defaultDeepThinking: boolean;
}

export interface DeletedTracker {
  conversations: string[];
  memories: string[];
  modules: string[];
}

export interface WillioStoreData {
  conversations: Conversation[];
  memories: MemoryItem[];
  modules: WillioModule[];
  deleted?: DeletedTracker;
  lastSyncedAt?: string;
}
