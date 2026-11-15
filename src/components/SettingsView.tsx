import React, { useState } from 'react';
import {
  Download,
  Lock,
  Moon,
  Shield,
  Smartphone,
  Sun,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { WillioSettings } from '../types/willio';
import { clearPin, hasPinConfigured, savePin } from '../utils/cryptoPin';
import { PWAInstallButton } from './PWAInstallButton';

interface SettingsViewProps {
  settings: WillioSettings;
  syncEmail: string;
  isDark: boolean;
  onToggleTheme: () => void;
  onUpdateSettings: (next: WillioSettings) => void;
  onClearAllData: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  syncEmail,
  isDark,
  onToggleTheme,
  onUpdateSettings,
  onClearAllData,
}) => {
  const [pinEnabled, setPinEnabled] = useState(hasPinConfigured());
  const [newPin, setNewPin] = useState('');
  const [pinFeedback, setPinFeedback] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  async function handleSavePin(e: React.FormEvent) {
    e.preventDefault();
    if (newPin.trim().length < 4) {
      setPinFeedback('Choisissez un code PIN d’au moins 4 chiffres.');
      return;
    }
    await savePin(newPin.trim());
    setPinEnabled(true);
    setNewPin('');
    setPinFeedback('Code PIN enregistré et chiffré localement (SHA-256).');
  }

  function handleDisablePin() {
    clearPin();
    setPinEnabled(false);
    setPinFeedback('Verrouillage par PIN désactivé.');
  }

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-slate-50">
            Réglages & Protection des données
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Voix masculine, compatibilité Android 10 (3 Go de RAM), sécurité et installation
            mobile.
          </p>
        </div>

        {/* Apparence & Android Performance */}
        <section className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
          <div className="p-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Thème visuel
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Mode sombre recommandé sur Android pour économiser la batterie.
              </div>
            </div>
            <button
              type="button"
              onClick={onToggleTheme}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 min-h-[42px] text-xs font-medium text-slate-800 dark:text-slate-200"
            >
              {isDark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              <span>{isDark ? 'Sombre' : 'Clair'}</span>
            </button>
          </div>

          <div className="p-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Mode Éco RAM (Android 10 · 3 Go)
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Désactive les transitions animées pour une fluidité maximale sur téléphone
                modeste.
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({ ...settings, ecoRamMode: !settings.ecoRamMode })
              }
              aria-pressed={settings.ecoRamMode}
              className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold transition-colors ${
                settings.ecoRamMode
                  ? 'bg-amber-600 text-slate-950'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {settings.ecoRamMode ? 'Activé' : 'Désactivé'}
            </button>
          </div>
        </section>

        {/* Voix masculine française */}
        <section className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Voix masculine naturelle en français
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onUpdateSettings({ ...settings, voiceEngine: 'gemini' })}
              className={`p-3.5 rounded-xl border text-left transition-colors ${
                settings.voiceEngine === 'gemini'
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Voix IA studio (Recommandée)
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Timbre masculin chaleureux et intonation humaine expressive générés par le serveur.
              </div>
            </button>

            <button
              type="button"
              onClick={() => onUpdateSettings({ ...settings, voiceEngine: 'browser' })}
              className={`p-3.5 rounded-xl border text-left transition-colors ${
                settings.voiceEngine === 'browser'
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Voix locale Android (Hors ligne)
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Zéro donnée consommée, utilise le synthétiseur vocal du téléphone.
              </div>
            </button>
          </div>

          {settings.voiceEngine === 'gemini' && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Timbre masculin
              </span>
              <div className="flex items-center gap-2">
                {(['Charon', 'Fenrir'] as const).map((voice) => (
                  <button
                    key={voice}
                    type="button"
                    onClick={() =>
                      onUpdateSettings({ ...settings, geminiVoiceName: voice })
                    }
                    className={`min-h-[38px] px-3 rounded-xl text-xs font-medium transition-colors ${
                      settings.geminiVoiceName === voice
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {voice === 'Charon' ? 'Charon (Grave & posé)' : 'Fenrir (Chaleureux)'}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div>
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Lecture vocale automatique des réponses
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                WILLIO lit automatiquement ses nouvelles réponses à voix haute.
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({ ...settings, autoSpeak: !settings.autoSpeak })
              }
              aria-pressed={settings.autoSpeak}
              className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold transition-colors ${
                settings.autoSpeak
                  ? 'bg-amber-600 text-slate-950'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {settings.autoSpeak ? 'Activé' : 'Désactivé'}
            </button>
          </div>
        </section>

        {/* Sécurité & protection des données */}
        <section className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Protection des données & Code PIN
            </h2>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Aucune clé API secrète n’est stockée dans le code client : toutes les requêtes IA
            passent par le serveur sécurisé. Vous pouvez aussi verrouiller l’accès sur votre
            téléphone par code PIN.
          </p>

          <form onSubmit={handleSavePin} className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              inputMode="numeric"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder={
                pinEnabled ? 'Nouveau code PIN (4+ chiffres)' : 'Définir un code PIN'
              }
              maxLength={12}
              className="flex-1 min-w-[180px] min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold px-4 min-h-[44px]"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{pinEnabled ? 'Modifier PIN' : 'Activer PIN'}</span>
            </button>
            {pinEnabled && (
              <button
                type="button"
                onClick={handleDisablePin}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium px-3.5 min-h-[44px]"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Retirer</span>
              </button>
            )}
          </form>

          {pinFeedback && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              {pinFeedback}
            </p>
          )}

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3">
            <a
              href={
                syncEmail
                  ? `/api/data/export?email=${encodeURIComponent(syncEmail)}`
                  : '/api/data/export'
              }
              download="willio-donnees.json"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 min-h-[42px] text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Download className="w-4 h-4" />
              <span>Exporter mes données (JSON)</span>
            </a>

            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 px-3.5 min-h-[42px] text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
              >
                <Trash2 className="w-4 h-4" />
                <span>Effacer l’historique</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await onClearAllData();
                    setConfirmClear(false);
                  }}
                  className="rounded-xl bg-rose-600 text-white px-3.5 min-h-[42px] text-xs font-semibold"
                >
                  Confirmer l’effacement
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 min-h-[42px] text-xs"
                >
                  Annuler
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Guide Android 10 */}
        <section className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Installer et utiliser sur Android 10 (3 Go RAM)
              </h2>
            </div>
            <PWAInstallButton compact />
          </div>
          <ol className="list-decimal pl-5 space-y-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            <li>
              Ouvrez l’URL de votre application dans <strong>Google Chrome</strong> sur
              votre téléphone Android 10.
            </li>
            <li>
              Appuyez sur <strong>Installer l’app</strong> (ou le menu ⋮ de Chrome puis{' '}
              <em>Installer l’application</em>).
            </li>
            <li>
              WILLIO s’ajoute à votre écran d’accueil comme une application native légère
              sans barre de navigateur, consommant très peu de RAM.
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
};
