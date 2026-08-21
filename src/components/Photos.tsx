'use client';

import { useEffect, useState } from 'react';
import { ImagePlus, X, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Deux briques pour les photos : une bande de vignettes qui s'ouvre en grand
 * (lecture), un sélecteur de fichiers avec aperçu (édition).
 *
 * L'agrandissement est une vraie visionneuse plutôt qu'un lien `target=_blank` :
 * sur un signalement à cinq photos, ouvrir cinq onglets pour comparer un avant
 * et un après n'est pas un geste.
 */

export function PhotoStrip({ urls, taille = 56 }: { urls: string[]; taille?: number }) {
  const [ouvert, setOuvert] = useState<number | null>(null);

  useEffect(() => {
    if (ouvert === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuvert(null);
      if (e.key === 'ArrowRight') setOuvert(i => (i === null ? null : (i + 1) % urls.length));
      if (e.key === 'ArrowLeft') setOuvert(i => (i === null ? null : (i - 1 + urls.length) % urls.length));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ouvert, urls.length]);

  if (!urls?.length) return null;

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {urls.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => setOuvert(i)}
            className="rounded-lg overflow-hidden border border-slate-200 hover:border-[var(--brand)] hover:opacity-90 transition"
            style={{ width: taille, height: taille }}
            title="Agrandir"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>

      {ouvert !== null && (
        <div
          className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOuvert(null)}
        >
          <button
            type="button"
            onClick={() => setOuvert(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>

          {urls.length > 1 && (
            <>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setOuvert((ouvert - 1 + urls.length) % urls.length); }}
                className="absolute left-4 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition"
                aria-label="Photo précédente"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setOuvert((ouvert + 1) % urls.length); }}
                className="absolute right-4 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition"
                aria-label="Photo suivante"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={urls[ouvert]}
            alt=""
            className="max-h-[88vh] max-w-[92vw] object-contain rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />

          {urls.length > 1 && (
            <div className="absolute bottom-5 text-white/70 text-xs font-bold tracking-wide">
              {ouvert + 1} / {urls.length}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Sélecteur de photos pour un formulaire.
 *
 * `existantes` sont déjà dans le storage (URL), `fichiers` attendent le
 * téléversement. L'appelant garde les deux listes : c'est lui qui sait quand
 * enregistrer, et retirer une photo déjà en ligne ne doit rien effacer tant
 * qu'on n'a pas validé.
 */
export function PhotoPicker({
  existantes,
  fichiers,
  onExistantes,
  onFichiers,
  label = 'Photos',
}: {
  existantes: string[];
  fichiers: File[];
  onExistantes: (urls: string[]) => void;
  onFichiers: (files: File[]) => void;
  label?: string;
}) {
  const [apercus, setApercus] = useState<string[]>([]);

  // Les URL d'objet doivent être révoquées, sinon chaque photo choisie puis
  // retirée reste en mémoire tant que l'onglet est ouvert.
  useEffect(() => {
    const urls = fichiers.map(f => URL.createObjectURL(f));
    setApercus(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [fichiers]);

  return (
    <div>
      <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">{label}</label>
      <div className="flex flex-wrap gap-2">
        {existantes.map(url => (
          <div key={url} className="relative group/ph">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
            <button
              type="button"
              onClick={() => onExistantes(existantes.filter(u => u !== url))}
              className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 shadow-sm transition"
              aria-label="Retirer cette photo"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {apercus.map((src, i) => (
          <div key={src} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="w-16 h-16 object-cover rounded-lg border-2 border-dashed border-[var(--brand)]" />
            <button
              type="button"
              onClick={() => onFichiers(fichiers.filter((_, j) => j !== i))}
              className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 shadow-sm transition"
              aria-label="Retirer cette photo"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        <label className="w-16 h-16 flex flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 hover:border-[var(--brand)] hover:text-[var(--brand)] cursor-pointer transition">
          <ImagePlus className="w-5 h-5" />
          <span className="text-[9px] font-bold">Ajouter</span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => {
              // Copie synchrone : l'input est vidé juste après, et une lecture
              // paresseuse de e.target.files rendrait une liste vide.
              const choisis = Array.from(e.target.files || []);
              e.target.value = '';
              if (choisis.length) onFichiers([...fichiers, ...choisis]);
            }}
          />
        </label>
      </div>
    </div>
  );
}
