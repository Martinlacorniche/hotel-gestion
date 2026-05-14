"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Check, Smile, Building2, Palette, Type, X } from "lucide-react";
import toast from "react-hot-toast";
import { THEMES, FONTS, applyTheme, applyFont, type ThemeId, type FontId } from "@/lib/themes";

type Hotel = { id: string; nom: string };

// Liste d'emojis fun, pas trop chargée
const EMOJI_OPTIONS = [
  "🌸", "🌻", "🌺", "🌷", "🌹", "🍀", "🌿", "🌴", "🌊", "☀️",
  "⭐", "✨", "🔥", "❄️", "🌈", "⚡", "💎", "🎯", "🎨", "🎭",
  "🏖️", "🏝️", "⛵", "🚤", "🌅", "🌄", "🏔️", "🏰", "🎪", "🎡",
  "🐱", "🐶", "🐰", "🦊", "🐼", "🦁", "🐯", "🦄", "🐬", "🦋",
  "🍓", "🍊", "🍋", "🍒", "🍇", "🥑", "🌮", "🍕", "🍣", "🍰",
  "☕", "🍵", "🍷", "🍸", "🍹", "🎵", "📚", "✏️", "💼", "🎩",
];

async function saveUserPref(field: string, value: string | null) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Pas de session");
  const { error } = await supabase
    .from("users")
    .update({ [field]: value })
    .eq("id_auth", session.user.id);
  if (error) throw error;
}

export default function ProfilPage() {
  const router = useRouter();
  const { user, isLoading, refreshUser } = useAuth();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.push("/login"); return; }
  }, [isLoading, user, router]);

  useEffect(() => {
    supabase.from("hotels").select("id, nom").order("nom").then(({ data }) => {
      setHotels((data || []) as Hotel[]);
    });
  }, []);

  const setPref = async (field: string, value: string | null, applyFn?: () => void) => {
    setSaving(field);
    try {
      await saveUserPref(field, value);
      if (applyFn) applyFn();
      await refreshUser();
      toast.success("Préférence enregistrée");
    } catch (e) {
      toast.error("Erreur : " + (e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        <Loader2 className="animate-spin mr-2" size={18} /> Chargement…
      </div>
    );
  }

  const currentTheme = (user.theme || "classique") as ThemeId;
  const currentFont = (user.font_family || "inter") as FontId;
  const currentEmoji = user.emoji || null;
  const currentDefaultHotel = user.default_hotel_id || null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-white/85 backdrop-blur border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-slate-500 hover:text-slate-800 -ml-2">
              <ArrowLeft size={16} className="mr-1" /> Retour
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Mon profil</h1>
            <p className="text-xs text-slate-500">Personnalisez votre espace</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* === IDENTITÉ === */}
        <Section icon={<Smile className="text-amber-500" size={18} />} title="Identité" subtitle="Apparaît à côté de votre prénom partout dans l'app.">
          <div className="space-y-5">
            {/* Emoji */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Emoji perso</Label>
                {currentEmoji && (
                  <button
                    onClick={() => setPref("emoji", null)}
                    className="text-xs text-slate-400 hover:text-slate-700 inline-flex items-center gap-1"
                  >
                    <X size={11} /> Retirer
                  </button>
                )}
              </div>
              <div className="grid grid-cols-10 sm:grid-cols-12 gap-1.5 p-3 bg-white rounded-xl border border-slate-200">
                {EMOJI_OPTIONS.map((e) => (
                  <button
                    key={e}
                    onClick={() => setPref("emoji", e)}
                    disabled={saving === "emoji"}
                    className={`aspect-square flex items-center justify-center text-xl rounded-md transition-colors ${
                      currentEmoji === e ? "bg-amber-100 ring-2 ring-amber-400" : "hover:bg-slate-100"
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            {/* Hôtel par défaut */}
            <div>
              <Label>
                <Building2 size={13} className="inline mr-1 text-slate-400" />
                Hôtel par défaut au login
              </Label>
              <select
                value={currentDefaultHotel || ""}
                onChange={(e) => setPref("default_hotel_id", e.target.value || null)}
                disabled={saving === "default_hotel_id"}
                className="w-full max-w-sm h-9 px-3 text-sm bg-white border border-slate-200 rounded-md"
              >
                <option value="">— Aucun (choix manuel) —</option>
                {hotels.map((h) => (
                  <option key={h.id} value={h.id}>{h.nom}</option>
                ))}
              </select>
            </div>
          </div>
        </Section>

        {/* === APPARENCE === */}
        <Section icon={<Palette className="text-violet-500" size={18} />} title="Thème" subtitle="Choisissez l'ambiance visuelle de votre espace.">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {THEMES.map((t) => {
              const active = currentTheme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setPref("theme", t.id, () => applyTheme(t.id))}
                  disabled={saving === "theme"}
                  className={`group relative p-3 rounded-xl border transition-all text-left ${
                    active ? "border-slate-900 shadow-md" : "border-slate-200 hover:border-slate-300 hover:shadow-sm"
                  }`}
                  style={{ background: t.bgBase }}
                >
                  <div className="flex gap-1.5 mb-2.5">
                    <div className="w-5 h-5 rounded-full" style={{ background: t.accent }} />
                    <div className="w-5 h-5 rounded-full" style={{ background: t.bgBlob1 }} />
                    <div className="w-5 h-5 rounded-full" style={{ background: t.bgBlob3 }} />
                  </div>
                  <div className="text-sm font-semibold text-slate-900">{t.label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{t.description}</div>
                  {active && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-slate-900 flex items-center justify-center">
                      <Check size={12} className="text-white" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </Section>

        <Section icon={<Type className="text-blue-500" size={18} />} title="Police" subtitle="La typographie utilisée dans toute l'app.">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {FONTS.map((f) => {
              const active = currentFont === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setPref("font_family", f.id, () => applyFont(f.id))}
                  disabled={saving === "font_family"}
                  className={`group relative p-4 rounded-xl border transition-all text-left bg-white ${
                    active ? "border-slate-900 shadow-md" : "border-slate-200 hover:border-slate-300 hover:shadow-sm"
                  }`}
                >
                  <div className="text-2xl font-semibold text-slate-900 mb-1" style={{ fontFamily: f.cssVar }}>
                    Aa Bb 123
                  </div>
                  <div className="text-sm font-semibold text-slate-900">{f.label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{f.description}</div>
                  {active && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-slate-900 flex items-center justify-center">
                      <Check size={12} className="text-white" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </Section>
      </main>
    </div>
  );
}

function Section({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white/70 backdrop-blur rounded-2xl border border-slate-200 p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center">
          {icon}
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-slate-600 mb-1.5">{children}</div>;
}
