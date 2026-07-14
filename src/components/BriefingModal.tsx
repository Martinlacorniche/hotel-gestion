'use client';

import { useState } from 'react';
import { format as formatDate } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2, Sunrise, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

// Briefing de prise de poste — phase 4 du chantier "outil vivant".
// JAMAIS d'ouverture automatique (demande Martin) : uniquement la pastille
// "Mon brief". Le serveur (/api/brief) digère tout ce qui s'est passé depuis
// le DERNIER shift travaillé de la personne (y compris ce qui s'est réglé
// pendant l'absence et les fils de réponses — invisibles sur le dashboard)
// et le LLM le raconte en 8 puces max, priorisées selon son service.
// "Trop d'info tue l'info" : c'est un récit court, pas une liste.

interface BriefData {
  brief: string;
  since: string | null;
}

// Rendu minimal du markdown produit par le brief : ## titres, - puces, **gras**.
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={i} className="font-semibold text-slate-900">{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function BriefBody({ text }: { text: string }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (line.startsWith('#')) {
          return (
            <h3 key={i} className="pt-2 text-[11px] font-bold uppercase tracking-wider text-[var(--brand)] first:pt-0">
              {line.replace(/^#+\s*/, '')}
            </h3>
          );
        }
        if (/^[-•*]\s/.test(line)) {
          return (
            <p key={i} className="flex gap-2 text-sm leading-snug text-slate-700">
              <span className="text-slate-300">•</span>
              <span>{renderInline(line.replace(/^[-•*]\s*/, ''))}</span>
            </p>
          );
        }
        return (
          <p key={i} className="text-sm leading-snug text-slate-700">{renderInline(line)}</p>
        );
      })}
    </div>
  );
}

export default function BriefingModal({
  user,
  hotelId,
}: {
  user: { id: string; name?: string } | null;
  hotelId: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(false);

  // L'API Chromecast vit sur le LAN de l'hôtel (inaccessible depuis Netlify) :
  // c'est le navigateur — souvent dans le LAN — qui relève l'état temps réel
  // et le passe à la route. Hors réseau ou API muette → on s'en passe.
  const fetchChromecasts = async (): Promise<Array<{ name: string; disconnected_since: string | null }> | null> => {
    const base = process.env.NEXT_PUBLIC_CHROMECAST_API_BASE;
    const key = process.env.NEXT_PUBLIC_CHROMECAST_API_KEY;
    if (!base || !key) return null;
    try {
      const res = await fetch(`${base}/api/status`, {
        headers: { 'x-api-key': key },
        signal: AbortSignal.timeout(3000),
      });
      const json = await res.json();
      return (json.rooms ?? [])
        .filter((r: { connected: boolean }) => !r.connected)
        .map((r: { name: string; disconnected_since: string | null }) => ({
          name: r.name,
          disconnected_since: r.disconnected_since,
        }));
    } catch {
      return null;
    }
  };

  const openBrief = async () => {
    if (loading || !hotelId) return;
    setLoading(true);
    try {
      const [{ data }, chromecasts] = await Promise.all([
        supabase.auth.getSession(),
        fetchChromecasts(),
      ]);
      const token = data.session?.access_token;
      const res = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ hotel_id: hotelId, chromecasts }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setBrief({ brief: json.brief, since: json.since });
        setOpen(true);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!user?.id || !hotelId) return null;

  return (
    <>
      {/* Bouton discret (inline dans le header, sous le "Bonjour") — seul
          point d'entrée, jamais d'ouverture auto. La mention "résumé IA" est
          explicite (demande Martin). */}
      <button
        onClick={openBrief}
        title="Ce qui a bougé depuis ton dernier shift — résumé généré par IA"
        disabled={loading}
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-500 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:opacity-70"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sunrise className="h-3.5 w-3.5" />}
        {loading ? 'Je lis tout…' : 'Mon brief'}
      </button>

      {open && brief && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-1 flex items-start justify-between gap-3">
              <h2 className="text-xl font-bold text-slate-900">
                Bonjour{user.name ? `, ${user.name}` : ''} 👋
              </h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-4 text-sm text-slate-500">
              {brief.since
                ? `Depuis ton dernier shift (${formatDate(new Date(brief.since), 'eeee HH:mm', { locale: fr })}) :`
                : 'Sur les dernières 24 h :'}
            </p>

            <BriefBody text={brief.brief} />

            <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
              ✨ Résumé généré par IA à partir des consignes, fils de discussion, tickets et
              modules — il peut se tromper : le tableau de bord fait foi.
            </p>

            <button
              onClick={() => setOpen(false)}
              className="mt-4 w-full rounded-xl bg-[var(--brand)] py-2.5 text-sm font-bold text-white transition hover:brightness-110"
            >
              C’est parti
            </button>
          </div>
        </div>
      )}
    </>
  );
}
