'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, ArrowLeft, ImagePlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { format as formatDate } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { useShift } from '@/context/ShiftContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  type CaptureProposal,
  type OpenItem,
  DEMANDE_TYPES,
  TICKET_SERVICES,
  TICKET_PRIORITES,
  MAINTENANCE_TYPES,
} from '@/lib/captureTypes';

// Barre de capture universelle : note libre (texte et/ou image) → /api/capture
// (LLM) → pile de cartes de confirmation éditables → création en lot dans les
// bons modules. Activée uniquement si NEXT_PUBLIC_CAPTURE_ENABLED=1.

const ENABLED = process.env.NEXT_PUBLIC_CAPTURE_ENABLED === '1';

const TYPE_LABELS: Record<string, string> = {
  consigne: 'Consigne',
  demande: 'Taxi / Réveil / VTC',
  ticket: 'Tâche',
  maintenance: 'Maintenance',
  objet_trouve: 'Objet trouvé',
  cloture: 'Clôture',
  inconnu: 'Non reconnu',
};

const EXAMPLES = [
  'taxi 12 demain 9h aéroport',
  'fuite douche chambre 24',
  'VIP suite 5 arrive jeudi',
  'réveil 17 samedi 6h30 + taxi gare 7h15',
  'fuite chambre 24 réparée en 2h',
];

interface CaptureImage {
  mediaType: string;
  base64: string;
  dataUrl: string;
}

interface EditableItem {
  p: CaptureProposal;
  hotelId: string;
  // Élément ouvert visé quand p.type === 'cloture' (résolu via target_index)
  target?: OpenItem;
}

// Éléments ouverts (toutes catégories, tous hôtels du groupe) que le routeur
// peut proposer de clôturer. Labels compacts : le modèle ne voit que ça.
async function fetchOpenItems(
  hotels: { id: string; nom: string }[],
): Promise<OpenItem[]> {
  const hotelName = (id: string | null) =>
    hotels.length > 1 ? hotels.find((h) => h.id === id)?.nom ?? '' : '';
  const suffix = (id: string | null) => {
    const n = hotelName(id);
    return n ? ` — ${n}` : '';
  };

  const [consignes, demandes, tickets, maintenance] = await Promise.all([
    supabase
      .from('consignes')
      .select('id, texte, hotel_id')
      .eq('valide', false)
      .order('date_creation', { ascending: false })
      .limit(40),
    supabase
      .from('demandes')
      .select('id, type, chambre, date, heure, hotel_id')
      .eq('valide', false)
      .order('date', { ascending: false })
      .limit(30),
    supabase
      .from('tickets')
      .select('id, titre, service, date_action, hotel_id')
      .eq('valide', false)
      .order('date_action', { ascending: false })
      .limit(40),
    supabase
      .from('maintenance')
      .select('id, titre, type, chambre, hotel_id')
      .neq('statut', 'Fait')
      .order('date_creation', { ascending: false })
      .limit(40),
  ]);

  return [
    ...(consignes.data ?? []).map((c): OpenItem => ({
      kind: 'consigne',
      id: c.id,
      label: `[Consigne] ${String(c.texte ?? '').slice(0, 90)}${suffix(c.hotel_id)}`,
    })),
    ...(demandes.data ?? []).map((d): OpenItem => ({
      kind: 'demande',
      id: d.id,
      label: `[${d.type}] chambre ${d.chambre || '?'} le ${d.date} à ${d.heure}${suffix(d.hotel_id)}`,
    })),
    ...(tickets.data ?? []).map((t): OpenItem => ({
      kind: 'ticket',
      id: t.id,
      label: `[Tâche] ${String(t.titre ?? '').slice(0, 70)} (${t.service}, pour le ${t.date_action})${suffix(t.hotel_id)}`,
    })),
    ...(maintenance.data ?? []).map((m): OpenItem => ({
      kind: 'maintenance',
      id: m.id,
      label: `[Maintenance] ${String(m.titre ?? '').slice(0, 70)} (${m.type}, chambre ${m.chambre || '?'})${suffix(m.hotel_id)}`,
    })),
  ];
}

// Redimensionne l'image côté client (max 1568px, JPEG) pour limiter le poids
// envoyé à l'API et le coût en tokens.
async function fileToCaptureImage(file: File): Promise<CaptureImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Image illisible'));
    i.src = dataUrl;
  });
  const MAX = 1568;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 1_500_000) {
    return { mediaType: file.type, base64: dataUrl.split(',')[1], dataUrl };
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL('image/jpeg', 0.8);
  return { mediaType: 'image/jpeg', base64: out.split(',')[1], dataUrl: out };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 rounded-md border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

type PatchFn = <
  K extends 'consigne' | 'demande' | 'ticket' | 'maintenance' | 'objet_trouve' | 'cloture',
>(
  key: K,
  update: Partial<NonNullable<CaptureProposal[K]>>,
) => void;

function ProposalFields({ p, patch }: { p: CaptureProposal; patch: PatchFn }) {
  if (p.type === 'consigne' && p.consigne) {
    return (
      <div className="grid gap-3">
        <Field label="Consigne">
          <textarea
            value={p.consigne.texte}
            onChange={(e) => patch('consigne', { texte: e.target.value })}
            rows={3}
            className="w-full resize-none rounded-md border border-gray-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </Field>
        <Field label="Date de fin (optionnel)">
          <Input
            type="date"
            value={p.consigne.date_fin ?? ''}
            onChange={(e) => patch('consigne', { date_fin: e.target.value || null })}
          />
        </Field>
      </div>
    );
  }

  if (p.type === 'demande' && p.demande) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select
            value={p.demande.type_demande}
            options={DEMANDE_TYPES}
            onChange={(v) => patch('demande', { type_demande: v as (typeof DEMANDE_TYPES)[number] })}
          />
        </Field>
        <Field label="Chambre">
          <Input
            value={p.demande.chambre}
            onChange={(e) => patch('demande', { chambre: e.target.value })}
          />
        </Field>
        <Field label="Date">
          <Input
            type="date"
            value={p.demande.date}
            onChange={(e) => patch('demande', { date: e.target.value })}
          />
        </Field>
        <Field label="Heure">
          <Input
            type="time"
            value={p.demande.heure}
            onChange={(e) => patch('demande', { heure: e.target.value })}
          />
        </Field>
        {p.demande.type_demande === 'VTC' && (
          <Field label="Prix (€)">
            <Input
              type="number"
              value={p.demande.prix ?? ''}
              onChange={(e) =>
                patch('demande', { prix: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          </Field>
        )}
      </div>
    );
  }

  if (p.type === 'ticket' && p.ticket) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Titre">
            <Input
              value={p.ticket.titre}
              onChange={(e) => patch('ticket', { titre: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Service">
          <Select
            value={p.ticket.service}
            options={TICKET_SERVICES}
            onChange={(v) => patch('ticket', { service: v as (typeof TICKET_SERVICES)[number] })}
          />
        </Field>
        <Field label="Priorité">
          <Select
            value={p.ticket.priorite}
            options={TICKET_PRIORITES}
            onChange={(v) => patch('ticket', { priorite: v as (typeof TICKET_PRIORITES)[number] })}
          />
        </Field>
        <Field label="À faire le">
          <Input
            type="date"
            value={p.ticket.date_action}
            onChange={(e) => patch('ticket', { date_action: e.target.value })}
          />
        </Field>
        <Field label="Date limite (optionnel)">
          <Input
            type="date"
            value={p.ticket.date_fin ?? ''}
            onChange={(e) => patch('ticket', { date_fin: e.target.value || null })}
          />
        </Field>
      </div>
    );
  }

  if (p.type === 'maintenance' && p.maintenance) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Problème">
            <Input
              value={p.maintenance.titre}
              onChange={(e) => patch('maintenance', { titre: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Type">
          <Select
            value={p.maintenance.type}
            options={MAINTENANCE_TYPES}
            onChange={(v) =>
              patch('maintenance', { type: v as (typeof MAINTENANCE_TYPES)[number] })
            }
          />
        </Field>
        <Field label="Chambre(s)">
          <Input
            value={p.maintenance.chambres.join(', ')}
            onChange={(e) =>
              patch('maintenance', {
                chambres: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
        <div className="col-span-2">
          <Field label="Commentaire (optionnel)">
            <Input
              value={p.maintenance.commentaire ?? ''}
              onChange={(e) => patch('maintenance', { commentaire: e.target.value || null })}
            />
          </Field>
        </div>
      </div>
    );
  }

  if (p.type === 'objet_trouve' && p.objet_trouve) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Objet">
            <Input
              value={p.objet_trouve.objet}
              onChange={(e) => patch('objet_trouve', { objet: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Client">
          <Input
            value={p.objet_trouve.nom_client}
            onChange={(e) => patch('objet_trouve', { nom_client: e.target.value })}
          />
        </Field>
        <Field label="Chambre">
          <Input
            value={p.objet_trouve.chambre}
            onChange={(e) => patch('objet_trouve', { chambre: e.target.value })}
          />
        </Field>
        <Field label="Date">
          <Input
            type="date"
            value={p.objet_trouve.date}
            onChange={(e) => patch('objet_trouve', { date: e.target.value })}
          />
        </Field>
      </div>
    );
  }

  if (p.type === 'inconnu') {
    return (
      <p className="text-sm text-gray-600">
        Je n’ai pas su ranger cet élément. Reformule la note avec plus de détails
        (chambre, date, type de demande…).
      </p>
    );
  }

  return null;
}

export default function CaptureBar() {
  const { user } = useAuth();
  const { restricted } = useShift();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<EditableItem[] | null>(null);
  const [hotels, setHotels] = useState<{ id: string; nom: string }[]>([]);
  const [image, setImage] = useState<CaptureImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Liste des hôtels (pour la détection dans la note + le sélecteur des cartes)
  useEffect(() => {
    if (!ENABLED || !open || hotels.length) return;
    supabase
      .from('hotels')
      .select('id, nom')
      .then(({ data }) => setHotels(data ?? []));
  }, [open, hotels.length]);

  // Ctrl+K / Cmd+K pour ouvrir depuis n'importe quelle page
  useEffect(() => {
    if (!ENABLED) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const reset = useCallback(() => {
    setText('');
    setItems(null);
    setLoading(false);
    setSaving(false);
    setImage(null);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  const addImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    try {
      setImage(await fileToCaptureImage(file));
    } catch {
      toast.error('Impossible de lire cette image');
    }
  }, []);

  if (!ENABLED || !user || restricted) return null;

  const currentHotelId =
    (typeof window !== 'undefined' && window.localStorage.getItem('selectedHotelId')) ||
    (user as { default_hotel_id?: string | null }).default_hotel_id ||
    (user as { hotel_id?: string | null }).hotel_id ||
    '';

  const analyse = async () => {
    if ((!text.trim() && !image) || loading) return;
    setLoading(true);
    try {
      // Éléments ouverts rechargés à chaque analyse : les target_index du
      // modèle référencent exactement cette liste.
      const openItems = await fetchOpenItems(hotels).catch(() => [] as OpenItem[]);
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: text.trim(),
          hotels: hotels.map((h) => h.nom),
          openItems: openItems.map((o) => o.label),
          image: image ? { media_type: image.mediaType, data: image.base64 } : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error || 'Analyse impossible');
        return;
      }
      const proposals = json.proposals as CaptureProposal[];
      setItems(
        proposals.map((p) => {
          if (p.type === 'cloture' && p.cloture) {
            return { p, hotelId: '', target: openItems[p.cloture.target_index] };
          }
          // Hôtel détecté dans la note, sinon l'hôtel sélectionné sur le site
          const detected = p.hotel
            ? hotels.find((h) => h.nom.toLowerCase() === p.hotel!.toLowerCase())
            : undefined;
          return { p, hotelId: detected?.id || currentHotelId };
        }),
      );
    } catch {
      toast.error('Erreur réseau pendant l’analyse');
    } finally {
      setLoading(false);
    }
  };

  const patchItem = (index: number): PatchFn => (key, update) => {
    setItems((prev) =>
      prev
        ? prev.map((it, i) =>
            i === index && it.p[key]
              ? { ...it, p: { ...it.p, [key]: { ...(it.p[key] as object), ...update } } }
              : it,
          )
        : prev,
    );
  };

  const removeItem = (index: number) => {
    setItems((prev) => {
      const next = prev ? prev.filter((_, i) => i !== index) : prev;
      return next && next.length ? next : null;
    });
  };

  // Insère un élément dans son module ; renvoie un message d'erreur ou null.
  const insertItem = async (it: EditableItem): Promise<string | null> => {
    const { p, hotelId } = it;
    const today = formatDate(new Date(), 'yyyy-MM-dd');
    const auteur = user.name || 'Anonyme';

    if (p.type === 'cloture') {
      const target = it.target;
      if (!target) return 'Élément à clôturer introuvable';
      // Mêmes updates que les pages des modules (page.tsx / maintenance/page.tsx)
      if (target.kind === 'maintenance') {
        const { error } = await supabase
          .from('maintenance')
          .update({
            statut: 'Fait',
            date_resolution: today,
            temps_travail: p.cloture?.temps_travail ?? null,
            budget: p.cloture?.budget ?? null,
          })
          .eq('id', target.id);
        return error?.message ?? null;
      }
      const table = { consigne: 'consignes', demande: 'demandes', ticket: 'tickets' }[target.kind];
      const { error } = await supabase
        .from(table)
        .update({ valide: true, date_validation: today })
        .eq('id', target.id);
      return error?.message ?? null;
    }

    if (p.type === 'consigne' && p.consigne) {
      const { error } = await supabase.from('consignes').insert({
        texte: p.consigne.texte,
        auteur,
        date_fin: p.consigne.date_fin || null,
        valide: false,
        utilisateurs_ids: [],
        hotel_id: hotelId,
        date_creation: today,
      });
      return error?.message ?? null;
    }
    if (p.type === 'demande' && p.demande) {
      const d = p.demande;
      const { error } = await supabase.from('demandes').insert({
        type: d.type_demande,
        nom: '',
        chambre: d.chambre,
        heure: d.heure,
        date: d.date,
        prix: d.type_demande === 'VTC' ? d.prix : null,
        chauffeur_id: null,
        valide: false,
        hotel_id: hotelId,
      });
      return error?.message ?? null;
    }
    if (p.type === 'ticket' && p.ticket) {
      const t = p.ticket;
      const { error } = await supabase.from('tickets').insert({
        titre: t.titre,
        service: t.service,
        priorite: t.priorite,
        date_action: t.date_action,
        date_fin: t.date_fin || null,
        valide: false,
        auteur,
        hotel_id: hotelId,
      });
      return error?.message ?? null;
    }
    if (p.type === 'maintenance' && p.maintenance) {
      const m = p.maintenance;
      const groupId = crypto.randomUUID();
      const rooms = m.chambres.length ? m.chambres : ['?'];
      const { error } = await supabase.from('maintenance').insert(
        rooms.map((room) => ({
          hotel_id: hotelId,
          group_id: groupId,
          titre: m.titre,
          type: m.type,
          chambre: room,
          chambres: [room],
          statut: 'À faire',
          commentaire: m.commentaire || null,
          date_creation: today,
        })),
      );
      return error?.message ?? null;
    }
    if (p.type === 'objet_trouve' && p.objet_trouve) {
      const o = p.objet_trouve;
      const { error } = await supabase.from('objets_trouves').insert({
        date: o.date || today,
        chambre: o.chambre,
        nomClient: o.nom_client,
        objet: o.objet,
        ficheLhost: false,
        paiementClient: false,
        colisEnvoye: false,
        createdAt: new Date().toISOString(),
        completedAt: null,
        hotel_id: hotelId,
      });
      return error?.message ?? null;
    }
    return 'Type non géré';
  };

  const creatable = (items ?? []).filter((it) => it.p.type !== 'inconnu');
  const clotureCount = creatable.filter((it) => it.p.type === 'cloture').length;
  const confirmLabel =
    clotureCount && clotureCount === creatable.length
      ? clotureCount > 1
        ? `Clôturer les ${clotureCount}`
        : 'Clôturer'
      : clotureCount
        ? 'Confirmer tout'
        : creatable.length > 1
          ? `Créer les ${creatable.length}`
          : 'Créer';

  const createAll = async () => {
    if (!items || saving || !creatable.length) return;
    if (creatable.some((it) => it.p.type !== 'cloture' && !it.hotelId)) {
      toast.error('Choisis l’hôtel pour chaque élément');
      return;
    }
    setSaving(true);
    try {
      const failed: EditableItem[] = [];
      let created = 0;
      for (const it of items) {
        if (it.p.type === 'inconnu') continue;
        const err = await insertItem(it);
        if (err) failed.push(it);
        else created++;
      }
      if (failed.length) {
        if (created) toast.success(`${created} élément${created > 1 ? 's' : ''} traité${created > 1 ? 's' : ''}`);
        toast.error(`${failed.length} échec${failed.length > 1 ? 's' : ''} — réessaie`);
        setItems(failed);
      } else {
        toast.success(
          created > 1 ? `${created} éléments traités` : creatable[0].p.resume || 'C’est fait !',
        );
        close();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Capture rapide (Ctrl+K)"
        title="Capture rapide (Ctrl+K)"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition hover:bg-indigo-700 active:scale-95"
      >
        <Sparkles className="h-6 w-6" />
      </button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {!items ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-indigo-600" />
                  Capture rapide
                </DialogTitle>
                <DialogDescription>
                  Tape ta note comme elle vient (plusieurs demandes possibles), je range tout au
                  bon endroit.
                </DialogDescription>
              </DialogHeader>
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    analyse();
                  }
                }}
                onPaste={(e) => {
                  const file = Array.from(e.clipboardData.items)
                    .find((i) => i.type.startsWith('image/'))
                    ?.getAsFile();
                  if (file) {
                    e.preventDefault();
                    addImageFile(file);
                  }
                }}
                rows={3}
                maxLength={500}
                placeholder="Ex : taxi 12 demain 9h aéroport — ou colle/photographie une image"
                className="w-full resize-none rounded-md border border-gray-300 p-3 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-11 items-center gap-2 rounded-md border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50"
                >
                  <ImagePlus className="h-5 w-5" />
                  Image
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) addImageFile(f);
                    e.target.value = '';
                  }}
                />
                {image && (
                  <div className="relative">
                    <img
                      src={image.dataUrl}
                      alt="Image à analyser"
                      className="h-14 w-14 rounded-md border border-gray-200 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setImage(null)}
                      aria-label="Retirer l’image"
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setText(ex)}
                    className="rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200"
                  >
                    {ex}
                  </button>
                ))}
              </div>
              <Button
                onClick={analyse}
                disabled={(!text.trim() && !image) || loading}
                className="w-full"
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {loading ? 'Analyse…' : 'Analyser'}
              </Button>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {creatable.length > 1
                    ? `${creatable.length} éléments détectés`
                    : 'Élément détecté'}
                </DialogTitle>
                <DialogDescription>
                  Vérifie, ajuste si besoin, puis crée le tout en un clic.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4">
                {items.map((it, index) => (
                  <div
                    key={index}
                    className="relative grid gap-3 rounded-lg border border-gray-200 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="rounded-full bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-700">
                          {TYPE_LABELS[it.p.type] ?? it.p.type}
                        </span>
                        <p className="mt-2 text-sm text-gray-600">{it.p.resume}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        aria-label="Retirer cet élément"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {it.p.type === 'cloture' && it.target && (
                      <div className="grid gap-3">
                        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                          ✓ {it.target.label}
                        </p>
                        {it.target.kind === 'maintenance' && (
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Temps de travail (h, optionnel)">
                              <Input
                                type="number"
                                value={it.p.cloture?.temps_travail ?? ''}
                                onChange={(e) =>
                                  patchItem(index)('cloture', {
                                    temps_travail:
                                      e.target.value === '' ? null : Number(e.target.value),
                                  })
                                }
                              />
                            </Field>
                            <Field label="Coût (€, optionnel)">
                              <Input
                                type="number"
                                value={it.p.cloture?.budget ?? ''}
                                onChange={(e) =>
                                  patchItem(index)('cloture', {
                                    budget: e.target.value === '' ? null : Number(e.target.value),
                                  })
                                }
                              />
                            </Field>
                          </div>
                        )}
                      </div>
                    )}

                    {it.p.type !== 'inconnu' && it.p.type !== 'cloture' && hotels.length > 1 && (
                      <Field label="Hôtel">
                        <select
                          value={it.hotelId}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev
                                ? prev.map((x, i) =>
                                    i === index ? { ...x, hotelId: e.target.value } : x,
                                  )
                                : prev,
                            )
                          }
                          className="h-11 rounded-md border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          {!it.hotelId && <option value="">— Choisir —</option>}
                          {hotels.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.nom}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}

                    <ProposalFields p={it.p} patch={patchItem(index)} />
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => setItems(null)}
                  className="flex-1"
                  disabled={saving}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Reformuler
                </Button>
                {creatable.length > 0 && (
                  <Button onClick={createAll} disabled={saving} className="flex-1">
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {confirmLabel}
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
