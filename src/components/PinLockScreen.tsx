import React, { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { verifyPin } from '../utils/cryptoPin';

interface PinLockScreenProps {
  onUnlock: () => void;
}

export const PinLockScreen: React.FC<PinLockScreenProps> = ({ onUnlock }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) return;
    setChecking(true);
    setError('');
    const valid = await verifyPin(pin);
    setChecking(false);
    if (valid) {
      onUnlock();
    } else {
      setError('Code PIN incorrect.');
      setPin('');
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#F6F7F9] dark:bg-[#0B0F17] p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-7 shadow-sm"
      >
        <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-5">
          <Lock className="w-6 h-6" />
        </div>
        <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-slate-50">
          WILLIO verrouillé
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          Saisissez votre code PIN pour accéder à vos conversations et à votre mémoire personnelle.
        </p>

        <div className="mt-5">
          <label htmlFor="willio-pin-input" className="sr-only">
            Code PIN
          </label>
          <input
            id="willio-pin-input"
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Code PIN"
            maxLength={12}
            className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-center text-lg tracking-[0.25em] font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        {error && (
          <p className="mt-3 text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={checking || !pin.trim()}
          className="mt-5 w-full min-h-[48px] rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
        >
          <ShieldCheck className="w-4 h-4" />
          <span>{checking ? 'Vérification...' : 'Déverrouiller'}</span>
        </button>
      </form>
    </div>
  );
};
