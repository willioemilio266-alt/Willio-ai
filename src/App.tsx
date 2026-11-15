import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  History,
  Lock,
  Menu,
  MessageSquare,
  Plus,
  Puzzle,
  Settings,
  X,
} from 'lucide-react';
import { ChatView } from './components/ChatView';
import { HistoryView } from './components/HistoryView';
import { MemoryView } from './components/MemoryView';
import { ModulesView } from './components/ModulesView';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { PinLockScreen } from './components/PinLockScreen';
import { SettingsView } from './components/SettingsView';
import type {
  AttachedDocument,
  Conversation,
  DeletedTracker,
  MemoryCategory,
  MemoryItem,
  WillioModule,
  WillioSettings,
  WillioStoreData,
} from './types/willio';
import { hasPinConfigured } from './utils/cryptoPin';
import {
  clearLocalStore,
  emptyDeletedTracker,
  getSavedSyncEmail,
  loadLocalStore,
  saveLocalStore,
  saveSyncEmail,
} from './utils/localMemoryStore';

type ActiveTab = 'chat' | 'history' | 'memory' | 'modules' | 'settings';

const SETTINGS_STORAGE_KEY = 'willio_settings_v1';
const THEME_STORAGE_KEY = 'willio_theme_v1';

const DEFAULT_SETTINGS: WillioSettings = {
  voiceEngine: 'gemini',
  geminiVoiceName: 'Charon',
  autoSpeak: false,
  ecoRamMode: false,
  defaultWebSearch: false,
  defaultDeepThinking: false,
};

function loadSavedSettings(): WillioSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<WillioSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function App() {
  const [locked, setLocked] = useState<boolean>(() => hasPinConfigured());
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      return saved ? saved === 'dark' : true;
    } catch {
      return true;
    }
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [syncEmail, setSyncEmail] = useState<string>(() => getSavedSyncEmail());
  const initialLocal = loadLocalStore(getSavedSyncEmail());

  const [conversations, setConversations] = useState<Conversation[]>(
    () => initialLocal?.conversations ?? []
  );
  const [memories, setMemories] = useState<MemoryItem[]>(
    () => initialLocal?.memories ?? []
  );
  const [modules, setModules] = useState<WillioModule[]>(
    () => initialLocal?.modules ?? []
  );
  const [deletedTracker, setDeletedTracker] = useState<DeletedTracker>(
    () => initialLocal?.deleted ?? emptyDeletedTracker()
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(
    () => initialLocal?.lastSyncedAt ?? null
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeConvId, setActiveConvId] = useState<string | null>(
    () => initialLocal?.conversations?.[0]?.id ?? null
  );

  const [settings, setSettings] = useState<WillioSettings>(loadSavedSettings);
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const hasLoadedFromStorageRef = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [isDark]);

  // Persist automatically to localStorage whenever conversations, memories, or modules change
  useEffect(() => {
    if (!hasLoadedFromStorageRef.current) {
      hasLoadedFromStorageRef.current = true;
    }
    saveLocalStore(syncEmail, {
      conversations,
      memories,
      modules,
      deleted: deletedTracker,
      lastSyncedAt: lastSyncedAt ?? undefined,
    });
  }, [syncEmail, conversations, memories, modules, deletedTracker, lastSyncedAt]);

  const syncWithServer = useCallback(
    async (
      emailOverride?: string,
      localOverride?: WillioStoreData | null
    ) => {
      const targetEmail = emailOverride !== undefined ? emailOverride : syncEmail;
      const localSnapshot = localOverride ?? loadLocalStore(targetEmail);
      setIsSyncing(true);
      try {
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(targetEmail ? { 'x-willio-email': targetEmail } : {}),
          },
          body: JSON.stringify({
            email: targetEmail,
            store: localSnapshot ?? {
              conversations: [],
              memories: [],
              modules: [],
              deleted: emptyDeletedTracker(),
            },
          }),
        });
        if (!res.ok) return;
        const merged = (await res.json()) as WillioStoreData;
        setConversations(merged.conversations || []);
        setMemories(merged.memories || []);
        setModules(merged.modules || []);
        setDeletedTracker(merged.deleted ?? emptyDeletedTracker());
        setLastSyncedAt(merged.lastSyncedAt ?? new Date().toISOString());
        saveLocalStore(targetEmail, merged);
        setActiveConvId((prev) =>
          prev && merged.conversations?.some((c) => c.id === prev)
            ? prev
            : merged.conversations?.[0]?.id ?? null
        );
      } catch {
        // Offline or unreachable: localStorage data remains active
      } finally {
        setIsSyncing(false);
      }
    },
    [syncEmail]
  );

  // Restore past conversations & memories at startup, then synchronize with server
  useEffect(() => {
    if (locked) return;
    void syncWithServer();
  }, [locked, syncWithServer]);

  async function handleUpdateSyncEmail(nextEmailRaw: string) {
    const normalized = saveSyncEmail(nextEmailRaw);
    setSyncEmail(normalized);
    const existingForEmail = loadLocalStore(normalized);
    if (existingForEmail) {
      setConversations(existingForEmail.conversations);
      setMemories(existingForEmail.memories);
      setModules(existingForEmail.modules);
      setDeletedTracker(existingForEmail.deleted ?? emptyDeletedTracker());
      setActiveConvId(existingForEmail.conversations[0]?.id ?? null);
    }
    await syncWithServer(normalized, existingForEmail ?? {
      conversations,
      memories,
      modules,
      deleted: deletedTracker,
    });
  }

  function handleUpdateSettings(next: WillioSettings) {
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  function handleNewChat() {
    setActiveConvId(null);
    setActiveTab('chat');
    setMobileMenuOpen(false);
    setErrorMsg(null);
  }

  async function handleSendMessage(payload: {
    text: string;
    useWebSearch: boolean;
    deepThinking: boolean;
    attachment: AttachedDocument | null;
  }) {
    setIsSending(true);
    setErrorMsg(null);

    const tempId = activeConvId || `conv-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const existingConv = conversations.find((c) => c.id === tempId);
    const priorMessages = existingConv?.messages ?? [];

    const optimisticUserMsg = {
      id: `temp-u-${Date.now()}`,
      role: 'user' as const,
      content: payload.text || `Analyse le document : ${payload.attachment?.name}`,
      createdAt: now,
      attachmentName: payload.attachment?.name,
    };

    setConversations((prev) => {
      const exists = prev.find((c) => c.id === tempId);
      if (exists) {
        return prev.map((c) =>
          c.id === tempId
            ? { ...c, messages: [...c.messages, optimisticUserMsg], updatedAt: now }
            : c
        );
      }
      const newConv: Conversation = {
        id: tempId,
        title: (payload.text || payload.attachment?.name || 'Discussion').slice(0, 48),
        createdAt: now,
        updatedAt: now,
        messages: [optimisticUserMsg],
      };
      return [newConv, ...prev];
    });
    setActiveConvId(tempId);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(syncEmail ? { 'x-willio-email': syncEmail } : {}),
        },
        body: JSON.stringify({
          email: syncEmail,
          conversationId: tempId,
          message: payload.text,
          useWebSearch: payload.useWebSearch,
          deepThinking: payload.deepThinking,
          attachment: payload.attachment,
          clientMemories: memories,
          clientMessages: priorMessages,
        }),
      });

      const data = (await res.json()) as {
        conversation?: Conversation;
        memorySaved?: string | null;
        error?: string;
      };

      if (!res.ok || !data.conversation) {
        throw new Error(data.error || 'Erreur lors de la réponse de WILLIO.');
      }

      setConversations((prev) => {
        const filtered = prev.filter((c) => c.id !== data.conversation!.id);
        return [data.conversation!, ...filtered];
      });
      setActiveConvId(data.conversation.id);

      if (data.memorySaved) {
        await syncWithServer();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Connexion au serveur WILLIO impossible.'
      );
      await syncWithServer();
    } finally {
      setIsSending(false);
    }
  }

  async function handleDeleteConversation(id: string) {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setDeletedTracker((prev) => ({
      ...prev,
      conversations: Array.from(new Set([...prev.conversations, id])),
    }));
    if (activeConvId === id) {
      setActiveConvId(null);
    }
    try {
      await fetch(`/api/conversations/${id}`, {
        method: 'DELETE',
        headers: syncEmail ? { 'x-willio-email': syncEmail } : undefined,
      });
    } catch {
      // Deletion recorded in deletedTracker for next sync
    }
  }

  async function handleAddMemory(content: string, category: MemoryCategory) {
    const now = new Date().toISOString();
    const localItem: MemoryItem = {
      id: `mem-${Date.now().toString(36)}`,
      content,
      category,
      source: 'manuel',
      createdAt: now,
      updatedAt: now,
    };
    setMemories((prev) => [localItem, ...prev]);

    try {
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(syncEmail ? { 'x-willio-email': syncEmail } : {}),
        },
        body: JSON.stringify({ email: syncEmail, content, category, source: 'manuel' }),
      });
      if (res.ok) {
        const created = (await res.json()) as MemoryItem;
        setMemories((prev) => [
          created,
          ...prev.filter((m) => m.id !== localItem.id && m.id !== created.id),
        ]);
      }
    } catch {
      // Saved locally in localStorage, will sync when online
    }
  }

  async function handleDeleteMemory(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    setDeletedTracker((prev) => ({
      ...prev,
      memories: Array.from(new Set([...prev.memories, id])),
    }));
    try {
      await fetch(`/api/memories/${id}`, {
        method: 'DELETE',
        headers: syncEmail ? { 'x-willio-email': syncEmail } : undefined,
      });
    } catch {
      // Deletion recorded in deletedTracker for next sync
    }
  }

  async function handleClearMemories() {
    const coreIds = new Set(['mem-founder', 'mem-spiritual-identity']);
    const removedIds = memories
      .filter((m) => !coreIds.has(m.id))
      .map((m) => m.id);
    setMemories((prev) => prev.filter((m) => coreIds.has(m.id)));
    setDeletedTracker((prev) => ({
      ...prev,
      memories: Array.from(new Set([...prev.memories, ...removedIds])),
    }));
    try {
      const res = await fetch('/api/memories/clear', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(syncEmail ? { 'x-willio-email': syncEmail } : {}),
        },
        body: JSON.stringify({ email: syncEmail }),
      });
      if (res.ok) {
        const updated = (await res.json()) as WillioStoreData;
        setMemories(updated.memories);
        setDeletedTracker(updated.deleted ?? emptyDeletedTracker());
      }
    } catch {
      // Cleared locally and tracked for next sync
    }
  }

  async function handleToggleModule(id: string, enabled: boolean) {
    setModules((prev) => prev.map((m) => (m.id === id ? { ...m, enabled } : m)));
    try {
      const res = await fetch(`/api/modules/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(syncEmail ? { 'x-willio-email': syncEmail } : {}),
        },
        body: JSON.stringify({ email: syncEmail, enabled }),
      });
      if (res.ok) {
        const updated = (await res.json()) as WillioModule;
        setModules((prev) => prev.map((m) => (m.id === id ? updated : m)));
      }
    } catch {
      // Persisted locally in localStorage
    }
  }

  async function handleCreateModule(payload: {
    name: string;
    description: string;
    instruction: string;
  }) {
    const res = await fetch('/api/modules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(syncEmail ? { 'x-willio-email': syncEmail } : {}),
      },
      body: JSON.stringify({ ...payload, email: syncEmail }),
    });
    if (res.ok) {
      const created = (await res.json()) as WillioModule;
      setModules((prev) => [created, ...prev]);
    }
  }

  async function handleDeleteModule(id: string) {
    setModules((prev) => prev.filter((m) => m.id !== id));
    setDeletedTracker((prev) => ({
      ...prev,
      modules: Array.from(new Set([...prev.modules, id])),
    }));
    try {
      await fetch(`/api/modules/${id}`, {
        method: 'DELETE',
        headers: syncEmail ? { 'x-willio-email': syncEmail } : undefined,
      });
    } catch {
      // Deletion recorded in deletedTracker
    }
  }

  async function handleClearAllData() {
    clearLocalStore(syncEmail);
    try {
      const res = await fetch('/api/data/clear', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(syncEmail ? { 'x-willio-email': syncEmail } : {}),
        },
        body: JSON.stringify({ email: syncEmail }),
      });
      if (res.ok) {
        const fresh = (await res.json()) as WillioStoreData;
        setConversations(fresh.conversations);
        setMemories(fresh.memories);
        setModules(fresh.modules);
        setDeletedTracker(emptyDeletedTracker());
        setActiveConvId(null);
      }
    } catch {
      setConversations([]);
      setActiveConvId(null);
    }
  }

  async function handleAppendLiveTurn(userText: string, assistantText: string) {
    const convId = activeConvId || `conv-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const uText = userText.trim();
    const aText = assistantText.trim();
    if (!uText && !aText) return;

    setConversations((prev) => {
      const existing = prev.find((c) => c.id === convId);
      const added: Conversation['messages'] = [];
      if (uText) {
        added.push({
          id: `live-u-${Date.now()}`,
          role: 'user',
          content: uText,
          createdAt: now,
        });
      }
      if (aText) {
        added.push({
          id: `live-a-${Date.now() + 1}`,
          role: 'assistant',
          content: aText,
          createdAt: new Date().toISOString(),
        });
      }
      if (existing) {
        return prev.map((c) =>
          c.id === convId
            ? { ...c, messages: [...c.messages, ...added], updatedAt: now }
            : c
        );
      }
      const seed = uText || aText;
      return [
        {
          id: convId,
          title: seed.length > 48 ? `${seed.slice(0, 48).trim()}...` : seed,
          createdAt: now,
          updatedAt: now,
          messages: added,
        },
        ...prev,
      ];
    });
    setActiveConvId(convId);

    try {
      const res = await fetch('/api/conversations/append', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(syncEmail ? { 'x-willio-email': syncEmail } : {}),
        },
        body: JSON.stringify({
          email: syncEmail,
          conversationId: convId,
          userText: uText,
          assistantText: aText,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { conversation?: Conversation };
        if (data.conversation) {
          setConversations((prev) => [
            data.conversation!,
            ...prev.filter((c) => c.id !== data.conversation!.id),
          ]);
          setActiveConvId(data.conversation.id);
        }
      }
    } catch {
      // Saved locally in localStorage; syncs when online
    }
  }

  if (locked) {
    return <PinLockScreen onUnlock={() => setLocked(false)} />;
  }

  const activeConversation =
    conversations.find((c) => c.id === activeConvId) ?? null;

  const navItems: Array<{ id: ActiveTab; label: string; icon: React.ReactNode }> = [
    { id: 'chat', label: 'Discussion', icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'history', label: 'Historique', icon: <History className="w-4 h-4" /> },
    { id: 'memory', label: 'Mémoire', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'modules', label: 'Modules', icon: <Puzzle className="w-4 h-4" /> },
    { id: 'settings', label: 'Réglages', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="h-dvh flex flex-col lg:flex-row bg-[#F6F7F9] dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-72 lg:flex-col shrink-0 border-r border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0F141E]">
        <div className="px-5 py-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800/80">
          <button
            type="button"
            onClick={handleNewChat}
            className="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0"
          >
            WILLIO
          </button>
          <button
            type="button"
            onClick={handleNewChat}
            title="Nouvelle discussion"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <nav className="p-3 space-y-1">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full min-h-[42px] px-3.5 rounded-xl flex items-center gap-3 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-4 pt-3 pb-2 text-xs font-semibold text-slate-400 dark:text-slate-500">
          Discussions récentes
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
          {conversations.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">
              Aucune discussion récente.
            </p>
          ) : (
            conversations.slice(0, 20).map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => {
                  setActiveConvId(conv.id);
                  setActiveTab('chat');
                }}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-xs truncate transition-colors ${
                  activeTab === 'chat' && conv.id === activeConvId
                    ? 'bg-slate-100 dark:bg-slate-800 font-semibold text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/70 dark:hover:bg-slate-800/40'
                }`}
              >
                {conv.title}
              </button>
            ))
          )}
        </div>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-2">
          <PWAInstallButton compact />
          {hasPinConfigured() && (
            <button
              type="button"
              onClick={() => setLocked(true)}
              className="inline-flex items-center gap-1.5 px-3 min-h-[38px] rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Verrouiller</span>
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Top Bar (compact 52px) */}
      <header className="lg:hidden shrink-0 h-[52px] px-3.5 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/90 bg-white/90 dark:bg-[#0F141E]/90 backdrop-blur-md z-30">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Ouvrir le menu"
            className="min-h-[44px] min-w-[44px] -ml-1.5 flex items-center justify-center rounded-xl text-slate-700 dark:text-slate-200"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-display text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0">
            WILLIO
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton compact />
          <button
            type="button"
            onClick={handleNewChat}
            aria-label="Nouvelle discussion"
            className="min-h-[40px] px-3 inline-flex items-center gap-1.5 rounded-xl bg-amber-600 text-slate-950 font-semibold text-xs whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Nouveau</span>
          </button>
        </div>
      </header>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] bg-white dark:bg-[#0F141E] h-full flex flex-col border-r border-slate-200 dark:border-slate-800 z-10">
            <div className="px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <span className="font-display text-lg font-semibold">WILLIO</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Fermer le menu"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3 space-y-1 flex-1 overflow-y-auto">
              <p className="px-2 pb-1 text-xs font-semibold text-slate-400">
                Discussions récentes
              </p>
              {conversations.slice(0, 20).map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => {
                    setActiveConvId(conv.id);
                    setActiveTab('chat');
                    setMobileMenuOpen(false);
                  }}
                  className="w-full text-left px-3 min-h-[44px] rounded-xl text-sm truncate hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {conv.title}
                </button>
              ))}
            </div>
            {hasPinConfigured() && (
              <div className="p-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setLocked(true);
                  }}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 flex items-center justify-center gap-2 text-xs font-medium"
                >
                  <Lock className="w-4 h-4" />
                  <span>Verrouiller WILLIO</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 min-h-0 flex flex-col">
        {activeTab === 'chat' && (
          <ChatView
            conversation={activeConversation}
            syncEmail={syncEmail}
            settings={settings}
            isSending={isSending}
            errorMsg={errorMsg}
            onSendMessage={handleSendMessage}
            onAppendLiveTurn={handleAppendLiveTurn}
            onDismissError={() => setErrorMsg(null)}
          />
        )}
        {activeTab === 'history' && (
          <HistoryView
            conversations={conversations}
            activeId={activeConvId}
            onSelect={(id) => {
              setActiveConvId(id);
              setActiveTab('chat');
            }}
            onNewChat={handleNewChat}
            onDelete={handleDeleteConversation}
          />
        )}
        {activeTab === 'memory' && (
          <MemoryView
            memories={memories}
            syncEmail={syncEmail}
            lastSyncedAt={lastSyncedAt}
            isSyncing={isSyncing}
            onUpdateSyncEmail={handleUpdateSyncEmail}
            onSyncNow={() => syncWithServer()}
            onAddMemory={handleAddMemory}
            onDeleteMemory={handleDeleteMemory}
            onClearMemories={handleClearMemories}
          />
        )}
        {activeTab === 'modules' && (
          <ModulesView
            modules={modules}
            onToggleModule={handleToggleModule}
            onCreateModule={handleCreateModule}
            onDeleteModule={handleDeleteModule}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsView
            settings={settings}
            syncEmail={syncEmail}
            isDark={isDark}
            onToggleTheme={() => setIsDark((d) => !d)}
            onUpdateSettings={handleUpdateSettings}
            onClearAllData={handleClearAllData}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Navigation principale"
        className="lg:hidden shrink-0 h-[56px] pb-safe border-t border-slate-200 dark:border-slate-800/90 bg-white/95 dark:bg-[#0F141E]/95 backdrop-blur-md grid grid-cols-5"
      >
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                active
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {item.icon}
              <span className="truncate max-w-[64px]">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <OfflineIndicator />
    </div>
  );
}
