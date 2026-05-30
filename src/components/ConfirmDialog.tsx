'use client';

import { useSyncExternalStore, useEffect, useRef } from 'react';

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Bouton de confirmation rouge (défaut true : la plupart des confirms sont destructifs). */
  danger?: boolean;
};

type State = { open: boolean; options: ConfirmOptions };

// --- Store externe minimal : permet d'appeler confirmDialog() depuis
//     n'importe quel handler, sans context ni prop drilling. ---
let state: State = { open: false, options: { message: '' } };
let resolver: ((v: boolean) => void) | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getSnapshot() {
  return state;
}

/**
 * Remplace le `confirm()` natif par une modale stylée.
 * Usage : `if (!(await confirmDialog('Supprimer ?'))) return;`
 */
export function confirmDialog(opts: string | ConfirmOptions): Promise<boolean> {
  const options = typeof opts === 'string' ? { message: opts } : opts;
  // Si une confirmation est déjà ouverte, on résout l'ancienne à false.
  resolver?.(false);
  state = { open: true, options };
  emit();
  return new Promise<boolean>((resolve) => {
    resolver = resolve;
  });
}

function close(result: boolean) {
  if (!state.open) return;
  state = { open: false, options: state.options };
  emit();
  const r = resolver;
  resolver = null;
  r?.(result);
}

/** Monté une seule fois dans le layout racine. */
export function ConfirmHost() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!snap.open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snap.open]);

  if (!snap.open) return null;
  const o = snap.options;
  const danger = o.danger !== false;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      onClick={() => close(false)}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-6"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        {o.title && (
          <h2 className="text-lg font-bold text-slate-900 mb-1">{o.title}</h2>
        )}
        <p className="text-sm text-slate-600 leading-relaxed">{o.message}</p>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => close(false)}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
          >
            {o.cancelLabel || 'Annuler'}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => close(true)}
            className={
              'px-4 py-2 rounded-lg text-sm font-semibold text-white transition shadow-sm ' +
              (danger
                ? 'bg-red-600 hover:bg-red-700 focus:ring-2 focus:ring-red-400'
                : 'bg-indigo-600 hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-400')
            }
          >
            {o.confirmLabel || 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  );
}
