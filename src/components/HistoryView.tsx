import React, { useMemo, useState } from 'react';
import { MessageSquare, Plus, Search, Trash2 } from 'lucide-react';
import type { Conversation } from '../types/willio';

interface HistoryViewProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => Promise<void>;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
}) => {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [conversations, query]);

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Historique
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Retrouvez et reprenez toutes vos conversations précédentes avec WILLIO.
            </p>
          </div>
          <button
            type="button"
            onClick={onNewChat}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs px-4 min-h-[44px] transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Nouvelle</span>
          </button>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un mot-clé dans les échanges..."
            className="w-full min-h-[44px] pl-10 pr-4 rounded-xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-8 text-center">
            <MessageSquare className="w-7 h-7 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {query
                ? 'Aucune conversation ne correspond à votre recherche.'
                : 'Aucune conversation enregistrée pour le moment.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 overflow-hidden">
            {filtered.map((conv) => {
              const isActive = conv.id === activeId;
              const lastMsg = conv.messages[conv.messages.length - 1];
              return (
                <div
                  key={conv.id}
                  className={`flex items-center justify-between gap-3 p-4 transition-colors ${
                    isActive ? 'bg-amber-500/8' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(conv.id)}
                    className="flex-1 min-w-0 text-left min-h-[44px]"
                  >
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {conv.title}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="tabular-nums">
                        {conv.messages.length} message{conv.messages.length > 1 ? 's' : ''}
                      </span>
                      <span aria-hidden="true">·</span>
                      <time className="tabular-nums">
                        {new Date(conv.updatedAt).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </time>
                    </div>
                    {lastMsg && (
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 truncate">
                        {lastMsg.content}
                      </p>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => void onDelete(conv.id)}
                    aria-label={`Supprimer ${conv.title}`}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
