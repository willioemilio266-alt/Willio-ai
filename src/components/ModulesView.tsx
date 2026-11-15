import React, { useState } from 'react';
import { Plus, Power, Puzzle, Trash2 } from 'lucide-react';
import type { WillioModule } from '../types/willio';

interface ModulesViewProps {
  modules: WillioModule[];
  onToggleModule: (id: string, enabled: boolean) => Promise<void>;
  onCreateModule: (payload: {
    name: string;
    description: string;
    instruction: string;
  }) => Promise<void>;
  onDeleteModule: (id: string) => Promise<void>;
}

const CORE_CAPABILITIES = [
  {
    name: 'Moteur IA conversationnel',
    detail: 'Connecté côté serveur via API sécurisée (Gemini 4 Hydrogen).',
  },
  {
    name: 'Recherche Internet en direct',
    detail: 'Ancrage web avec citations vérifiables activable par message.',
  },
  {
    name: 'Voix masculine française & dictée',
    detail: 'Synthèse vocale naturelle (Charon / Fenrir) et transcription audio.',
  },
  {
    name: 'Lecture de documents',
    detail: 'Analyse de fichiers TXT, Markdown, CSV, JSON, code, PDF et images.',
  },
];

export const ModulesView: React.FC<ModulesViewProps> = ({
  modules,
  onToggleModule,
  onCreateModule,
  onDeleteModule,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instruction, setInstruction] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !instruction.trim() || creating) return;
    setCreating(true);
    await onCreateModule({
      name: name.trim(),
      description: description.trim(),
      instruction: instruction.trim(),
    });
    setName('');
    setDescription('');
    setInstruction('');
    setCreating(false);
  }

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-slate-50">
            Architecture & Modules
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Activez ou ajoutez de nouvelles capacités comportementales et spécialisations à
            WILLIO sans modifier le cœur du code.
          </p>
        </div>

        <section className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
          <div className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
            Capacités natives intégrées
          </div>
          {CORE_CAPABILITIES.map((cap) => (
            <div key={cap.name} className="px-4 py-3.5 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {cap.name}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {cap.detail}
                </div>
              </div>
              <span className="text-xs font-medium text-amber-700 dark:text-amber-400 shrink-0">
                Actif
              </span>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Modules d’extension actifs ({modules.filter((m) => m.enabled).length}/
            <span className="tabular-nums">{modules.length}</span>)
          </h2>
          <div className="space-y-3">
            {modules.map((mod) => (
              <div
                key={mod.id}
                className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 flex items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Puzzle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {mod.name}
                    </h3>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {mod.description}
                  </p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 italic">
                    Directive : {mod.instruction}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => void onToggleModule(mod.id, !mod.enabled)}
                    aria-pressed={mod.enabled}
                    className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                      mod.enabled
                        ? 'bg-amber-600 text-slate-950'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>{mod.enabled ? 'Activé' : 'Inactif'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteModule(mod.id)}
                    aria-label={`Supprimer le module ${mod.name}`}
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <form
          onSubmit={handleCreate}
          className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 space-y-3"
        >
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Ajouter une nouvelle fonctionnalité / module
          </h2>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom du module (ex. : Coach d'écriture & étymologie)"
            className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Courte description"
            className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <textarea
            rows={2}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Instruction injectée à WILLIO quand ce module est activé..."
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <button
            type="submit"
            disabled={creating || !name.trim() || !instruction.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-slate-950 font-semibold text-xs px-4 min-h-[44px] transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>{creating ? 'Création...' : 'Créer le module'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
