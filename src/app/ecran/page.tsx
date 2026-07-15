"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ThemedBackground } from "@/components/ThemedBackground";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import {
  Monitor, Send, Loader2, Clock, Check, AlertTriangle,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import toast from "react-hot-toast";

const MAX_TEXT_LEN = 200;

// Catalogue d'émoticônes cliquables (insérées dans le message)
const EMOJIS = [
  "😀","😁","😂","🤣","😅","😉","😎","😍","🥰","😘","😜","🤪","🤔","🙃","😴","🥳","😱","😭","😡","🤯",
  "😇","🫡","🥲","😬","🤗","🤭","🙄","😏","👀","🫣",
  "👍","👎","👏","🙌","🙏","💪","✌️","🤙","👋","🤝",
  "❤️","🔥","⭐","✨","💯","🎉","🎊","🥂","🍾","☕",
  "🍕","🍔","🎁","🏆","📢","🚨","⚠️","✅","❌","💩",
];

type ScreenMessage = {
  id: string;
  text: string;
  duration_sec: number;
  status: "pending" | "sent" | "failed";
  error: string | null;
  created_by_name: string | null;
  created_at: string;
  sent_at: string | null;
};

const STATUS_META: Record<
  ScreenMessage["status"],
  { label: string; badge: string; icon: typeof Check }
> = {
  pending: { label: "En attente", badge: "bg-amber-50 text-amber-700 ring-amber-200", icon: Clock },
  sent:    { label: "Affiché",    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: Check },
  failed:  { label: "Échec",      badge: "bg-rose-50 text-rose-700 ring-rose-200", icon: AlertTriangle },
};

async function authHeaders(): Promise<Record<string, string> | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export default function EcranPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const isSuperadmin = user?.role === "superadmin";

  const [text, setText] = useState("");
  const [duration, setDuration] = useState(10);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ScreenMessage[]>([]);

  // Garde d'accès : superadmin uniquement (page discrète, hors menu).
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    if (!isSuperadmin) { router.push("/"); return; }
  }, [authLoading, user, isSuperadmin, router]);

  const loadHistory = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) return;
    const resp = await fetch("/api/screen/message", { headers });
    const result = await resp.json();
    if (resp.ok && result.ok) setMessages(result.messages as ScreenMessage[]);
  }, []);

  useEffect(() => {
    if (isSuperadmin) loadHistory();
  }, [isSuperadmin, loadHistory]);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed) { toast.error("Saisis un texte"); return; }
    setSending(true);
    const headers = await authHeaders();
    if (!headers) { toast.error("Session expirée, reconnecte-toi."); setSending(false); return; }
    const resp = await fetch("/api/screen/message", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: trimmed, duration }),
    });
    const result = await resp.json();
    setSending(false);
    if (!resp.ok || !result.ok) {
      toast.error(result.error || "Envoi échoué");
      return;
    }
    toast.success("Message mis en file pour l'écran");
    setText("");
    loadHistory();
  };

  if (authLoading || !isSuperadmin) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Chargement…
      </div>
    );
  }

  const last = messages[0] ?? null;
  const remaining = MAX_TEXT_LEN - text.length;
  const addEmoji = (e: string) => setText((t) => (t + e).slice(0, MAX_TEXT_LEN));

  return (
    <div className="min-h-screen">
      <ThemedBackground />

      {/* Header sticky */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <PageHeader
            icon={Monitor}
            title="Écran"
            subtitle="Envoyer un message à l'écran SmallTV"
            iconClassName="bg-slate-100 text-slate-700"
            className="mb-0"
          />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid lg:grid-cols-2 gap-6 items-start">
          {/* Composer */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700">Message</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT_LEN))}
                placeholder="Texte à afficher sur l'écran…"
                rows={3}
                className="mt-1 w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
                }}
              />
              <div className="mt-1 flex justify-between text-xs text-slate-400">
                <span>Cmd/Ctrl + Entrée pour envoyer</span>
                <span className={remaining < 20 ? "text-amber-600" : ""}>{remaining}</span>
              </div>
            </div>

            {/* Catalogue d'émoticônes */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-1.5">Émoticônes</p>
              <div className="flex flex-wrap gap-0.5 rounded-lg border border-slate-100 bg-slate-50/60 p-1.5">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => addEmoji(e)}
                    disabled={remaining <= 0}
                    title={`Ajouter ${e}`}
                    className="w-9 h-9 rounded-lg text-xl leading-none flex items-center justify-center hover:bg-white hover:shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-end gap-3">
              <div>
                <label className="text-sm font-medium text-slate-700">Durée (s)</label>
                <Input
                  type="number"
                  min={1}
                  max={3600}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="mt-1 w-28"
                />
              </div>
              <Button
                variant="brand"
                onClick={send}
                disabled={sending || !text.trim()}
                className="ml-auto"
              >
                {sending ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Send size={15} className="mr-2" />}
                Envoyer
              </Button>
            </div>
          </div>

          {/* Aperçu de l'écran SmallTV — WYSIWYG */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-2">Aperçu écran</p>
            <div className="aspect-video w-full rounded-2xl bg-slate-900 border border-slate-800 shadow-inner flex items-center justify-center p-8 overflow-hidden">
              {text.trim() ? (
                <p className="text-white text-2xl md:text-3xl font-semibold text-center leading-snug break-words">{text}</p>
              ) : (
                <p className="text-slate-500 text-sm">L&apos;écran affichera votre message ici.</p>
              )}
            </div>
            {last && (
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                <StatusBadge status={last.status} />
                <span className="truncate">Dernier envoi · {format(parseISO(last.created_at), "d MMM HH:mm", { locale: fr })}</span>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: ScreenMessage["status"] }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.badge}`}>
      <Icon size={11} /> {meta.label}
    </span>
  );
}
