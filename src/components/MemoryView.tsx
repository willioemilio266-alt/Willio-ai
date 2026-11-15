import React, { useMemo, useState } from 'react';
import { BookOpen, Mail, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { MemoryCategory, MemoryItem } from '../types/willio';

interface MemoryViewProps {
  memories: MemoryItem[];
  syncEmail: string;
  lastSyncedAt: string | null;
  isSyncing: boolean;
  onUpdateSyncEmail: (email: string) => Promise<void>;
  onSyncNow: () => Promise<void>;
  onAddMemory: (content: string, category: MemoryCategory) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
  onClearMemories: () => Promise<void>;
}

const CATEGORIES: Array<{ value: 'toutes' | MemoryCategory; label: string }> = [
  { value: 'toutes', label: 'Toutes' },
  { value: 'identité', label: 'Fondateur & Identité' },
  { value: 'projet', label: 'Projets' },
  { value: 'correction', label: 'Corrections' },
  { value: 'spiritualité', label: 'Spiritualité' },
  { value: 'connaissance', label: 'Connaissances' },
  { value: 'préférence', label: 'Préférences' },
];

export const MemoryView: React.FC<MemoryViewProps> = ({
  memories,
  syncEmail,
  lastSyncedAt,
  isSyncing,
  onUpdateSyncEmail,
  onSyncNow,
  onAddMemory,
  onDeleteMemory,
  onClearMemories,
}) => {
  const [filter, setFilter] = useState<'toutes' | MemoryCategory>('toutes');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<MemoryCategory>('projet');
  const [saving, setSaving] = useState(false);

  const [emailInput, setEmailInput] = useState(syncEmail);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const filtered = useMemo(() => {
    if (filter === 'toutes') return memories;
    return memories.filter((m) => m.category === filter);
  }, [memories, filter]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newContent.trim() || saving) return;
    setSaving(true);
    await onAddMemory(newContent.trim(), newCategory);
    setNewContent('');
    setSaving(false);
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEmailStatus(null);
    await onUpdateSyncEmail(emailInput.trim());
    setEmailStatus(
      emailInput.trim()
        ? `Mémoire synchronisée avec ${emailInput.trim().toLowerCase()}.`
        : 'Synchronisation email retirée (mode mémoire locale uniquement).'
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Mémoire persistante
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Souvenirs conservés localement (localStorage) et synchronisés par email. WILLIO
              n’invente jamais un souvenir absent de cette liste.
            </p>
          </div>

          {memories.length > 1 && (
            <div className="shrink-0">
              {!confirmClearAll ? (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 px-3 min-h-[40px] text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Tout effacer</span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await onClearMemories();
                      setConfirmClearAll(false);
                    }}
                    className="rounded-xl bg-rose-600 text-white px-3 min-h-[40px] text-xs font-semibold"
                  >
                    Confirmer
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 min-h-[40px] text-xs"
                  >
                    Annuler
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Synchronisation par adresse email */}
        <form
          onSubmit={handleEmailSubmit}
          className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Adresse email de synchronisation
              </span>
            </div>
            {lastSyncedAt && (
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                Synchro ·{' '}
                {new Date(lastSyncedAt).toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="votre.adresse@email.com"
              className="flex-1 min-w-[200px] min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <button
              type="submit"
              disabled={isSyncing}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold px-4 min-h-[44px] disabled:opacity-50"
            >
              <span>{syncEmail ? 'Mettre à jour' : 'Associer email'}</span>
            </button>
            <button
              type="button"
              onClick={() => void onSyncNow()}
              disabled={isSyncing}
              aria-label="Synchroniser maintenant"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium px-3.5 min-h-[44px] disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Synchroniser</span>
            </button>
          </div>

          {emailStatus && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              {emailStatus}
            </p>
          )}
        </form>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 space-y-3"
        >
          <label
            htmlFor="memory-input"
            className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            Mémoriser une information (fondateur, projet, connaissance ou correction)
          </label>
          <textarea
            id="memory-input"
            rows={2}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Ex. : Mon projet principal consiste à bâtir WILLIO pour Android 10..."
            className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
              aria-label="Catégorie de mémoire"
              className="min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200"
            >
              {CATEGORIES.filter((c) => c.value !== 'toutes').map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={saving || !newContent.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-slate-950 font-semibold text-xs px-4 min-h-[42px] transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>{saving ? 'Enregistrement...' : 'Mémoriser'}</span>
            </button>
          </div>
        </form>

        {/* Interactive filter tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => setFilter(cat.value)}
              className={`px-3 min-h-[38px] rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                filter === cat.value
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-white dark:bg-[#131A26] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-8 text-center">
            <BookOpen className="w-7 h-7 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Aucun élément dans cette catégorie pour le moment.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 overflow-hidden">
            {filtered.map((mem) => (
              <div key={mem.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed">
                    {mem.content}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="capitalize">{mem.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {mem.source === 'correction'
                        ? 'Correction apprise'
                        : mem.source === 'auto'
                          ? 'Appris automatiquement'
                          : 'Ajout manuel'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <time className="tabular-nums">
                      {new Date(mem.updatedAt).toLocaleDateString('fr-FR')}
                    </time>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onDeleteMemory(mem.id)}
                  aria-label="Supprimer ce souvenir"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
