'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useHotelScope } from '@/hooks/useHotelScope';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  SprayCan, Loader2, Plus, Lock, MoreHorizontal, Pencil, Trash2, EyeOff, Eye, Clock,
  ChevronUp, ChevronDown, ArrowLeft, CalendarRange,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  type CleaningZone, type CleaningTask, type CleaningFrequency,
  FREQUENCY_LABELS, FREQUENCY_BADGE_CLASSES, FREQUENCY_ORDER,
} from './types';

export default function HACCPCleaningAdminPage() {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const { hotels, selectedHotelId, setSelectedHotelId } = useHotelScope();
  const [zones, setZones] = useState<CleaningZone[]>([]);
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingZone, setEditingZone] = useState<CleaningZone | 'new' | null>(null);
  const [editingTask, setEditingTask] = useState<CleaningTask | { zoneId: string } | null>(null);

  // Données
  const loadAll = useCallback(async (hotelId: string) => {
    setLoading(true);
    const [zRes, tRes] = await Promise.all([
      supabase
        .from('haccp_cleaning_zones')
        .select('*')
        .eq('hotel_id', hotelId)
        .order('sort_order'),
      supabase
        .from('haccp_cleaning_tasks')
        .select('*, haccp_cleaning_zones!inner(hotel_id)')
        .eq('haccp_cleaning_zones.hotel_id', hotelId)
        .order('sort_order'),
    ]);
    if (zRes.error) toast.error('Zones : ' + zRes.error.message);
    if (tRes.error) toast.error('Tâches : ' + tRes.error.message);
    setZones((zRes.data || []) as CleaningZone[]);
    setTasks((tRes.data || []) as CleaningTask[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedHotelId) loadAll(selectedHotelId);
  }, [selectedHotelId, loadAll]);

  const tasksByZone = useMemo(() => {
    const m: Record<string, CleaningTask[]> = {};
    for (const t of tasks) (m[t.zone_id] ||= []).push(t);
    return m;
  }, [tasks]);

  // --- Guards ---
  if (authLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }
  if (!user) return <div className="p-8">Authentification requise.</div>;
  if (!isAdmin) {
    return (
      <div className="p-8 max-w-md mx-auto">
        <Card>
          <CardContent className="py-8 text-center">
            <Lock className="w-10 h-10 mx-auto mb-3 text-muted-foreground/60" />
            <h2 className="font-semibold mb-1">Accès réservé</h2>
            <p className="text-sm text-muted-foreground">
              La configuration du plan de nettoyage est réservée aux administrateurs.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeZones = zones.filter(z => z.active);
  const inactiveZones = zones.filter(z => !z.active);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <header className="mb-6 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <Link
            href="/haccp/nettoyage"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-1"
          >
            <ArrowLeft className="w-3 h-3" /> Retour à la check-list
          </Link>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <SprayCan className="w-6 h-6" /> Plan de nettoyage — Configuration
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Définis tes zones (cuisine, buffet, plonge…) puis les tâches récurrentes par zone.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/haccp/admin/nettoyage/calendrier">
            <Button variant="outline">
              <CalendarRange className="w-4 h-4 mr-1" /> Calendrier
            </Button>
          </Link>
          <Button onClick={() => setEditingZone('new')}>
            <Plus className="w-4 h-4 mr-1" /> Nouvelle zone
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : zones.length === 0 ? (
        <EmptyState onCreate={() => setEditingZone('new')} />
      ) : (
        <div className="space-y-4">
          {activeZones.map((zone, idx) => (
            <ZoneCard
              key={zone.id}
              zone={zone}
              tasks={tasksByZone[zone.id] || []}
              isFirst={idx === 0}
              isLast={idx === activeZones.length - 1}
              onEdit={() => setEditingZone(zone)}
              onAddTask={() => setEditingTask({ zoneId: zone.id })}
              onEditTask={(t) => setEditingTask(t)}
              onReload={() => selectedHotelId && loadAll(selectedHotelId)}
            />
          ))}

          {inactiveZones.length > 0 && (
            <details className="mt-6">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground py-2">
                Zones désactivées ({inactiveZones.length})
              </summary>
              <div className="space-y-4 mt-2 opacity-70">
                {inactiveZones.map(zone => (
                  <ZoneCard
                    key={zone.id}
                    zone={zone}
                    tasks={tasksByZone[zone.id] || []}
                    isFirst
                    isLast
                    onEdit={() => setEditingZone(zone)}
                    onAddTask={() => setEditingTask({ zoneId: zone.id })}
                    onEditTask={(t) => setEditingTask(t)}
                    onReload={() => selectedHotelId && loadAll(selectedHotelId)}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {editingZone && selectedHotelId && (
        <ZoneDialog
          hotelId={selectedHotelId}
          zone={editingZone === 'new' ? null : editingZone}
          existingMaxOrder={Math.max(0, ...zones.map(z => z.sort_order))}
          onClose={() => setEditingZone(null)}
          onSaved={() => {
            setEditingZone(null);
            loadAll(selectedHotelId);
          }}
        />
      )}

      {editingTask && (
        <TaskDialog
          task={'id' in editingTask ? editingTask : null}
          zoneId={'zoneId' in editingTask ? editingTask.zoneId : editingTask.zone_id}
          existingMaxOrder={Math.max(
            0,
            ...tasks
              .filter(t => t.zone_id === ('zoneId' in editingTask ? editingTask.zoneId : editingTask.zone_id))
              .map(t => t.sort_order),
          )}
          onClose={() => setEditingTask(null)}
          onSaved={() => {
            setEditingTask(null);
            if (selectedHotelId) loadAll(selectedHotelId);
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Empty state
// ============================================================================
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <SprayCan className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
        <h3 className="font-semibold mb-1">Aucune zone configurée</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
          Crée tes premières zones de nettoyage (Cuisine, Buffet, Plonge, Sanitaires…) puis ajoute
          les tâches récurrentes dans chacune.
        </p>
        <Button onClick={onCreate}>
          <Plus className="w-4 h-4 mr-1" /> Créer ma première zone
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Card d'une zone (+ ses tâches)
// ============================================================================
function ZoneCard({
  zone, tasks, isFirst, isLast, onEdit, onAddTask, onEditTask, onReload,
}: {
  zone: CleaningZone;
  tasks: CleaningTask[];
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onAddTask: () => void;
  onEditTask: (t: CleaningTask) => void;
  onReload: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const reorderZone = async (dir: -1 | 1) => {
    setBusy(true);
    const { error } = await supabase
      .from('haccp_cleaning_zones')
      .update({ sort_order: zone.sort_order + dir * 10 })
      .eq('id', zone.id);
    setBusy(false);
    if (error) toast.error('Réordonnancement : ' + error.message);
    else onReload();
  };

  const toggleActive = async () => {
    setBusy(true);
    const { error } = await supabase
      .from('haccp_cleaning_zones')
      .update({ active: !zone.active })
      .eq('id', zone.id);
    setBusy(false);
    if (error) toast.error('Mise à jour : ' + error.message);
    else onReload();
  };

  const remove = async () => {
    if (!window.confirm(
      `Supprimer la zone "${zone.name}" et ses ${tasks.length} tâche${tasks.length > 1 ? 's' : ''} ? ` +
      `Les validations historiques seront aussi perdues. Préfère "Désactiver" pour garder l'historique.`,
    )) return;
    setBusy(true);
    const { error } = await supabase.from('haccp_cleaning_zones').delete().eq('id', zone.id);
    setBusy(false);
    if (error) toast.error('Suppression : ' + error.message);
    else { toast.success('Zone supprimée'); onReload(); }
  };

  return (
    <Card>
      <CardContent className="py-0">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <span className="text-2xl">{zone.icon || '🧽'}</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{zone.name}</div>
            <div className="text-xs text-muted-foreground">
              {tasks.length} tâche{tasks.length > 1 ? 's' : ''}
              {!zone.active && <span className="ml-2 text-amber-600">· désactivée</span>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => reorderZone(-1)} disabled={busy || isFirst} title="Monter">
              <ChevronUp className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => reorderZone(1)} disabled={busy || isLast} title="Descendre">
              <ChevronDown className="w-4 h-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" disabled={busy}>
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="w-3.5 h-3.5 mr-2" /> Renommer
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleActive}>
                  {zone.active
                    ? <><EyeOff className="w-3.5 h-3.5 mr-2" /> Désactiver</>
                    : <><Eye className="w-3.5 h-3.5 mr-2" /> Réactiver</>}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={remove} className="text-red-600 focus:text-red-700">
                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Supprimer
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {tasks.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            Aucune tâche dans cette zone.
            <Button size="sm" variant="link" onClick={onAddTask} className="ml-1">
              Ajouter une tâche
            </Button>
          </div>
        ) : (
          <div className="divide-y">
            {tasks.map(task => (
              <button
                key={task.id}
                onClick={() => onEditTask(task)}
                className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-medium ${!task.active ? 'line-through text-muted-foreground' : ''}`}>
                      {task.name}
                    </span>
                    <FrequencyBadge frequency={task.frequency} />
                    {!task.active && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">inactive</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                    {task.product && <span>🧴 {task.product}</span>}
                    {task.estimated_min && <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{task.estimated_min} min</span>}
                  </div>
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-opacity shrink-0" />
              </button>
            ))}
          </div>
        )}

        <div className="px-4 py-2 border-t">
          <Button size="sm" variant="ghost" onClick={onAddTask} className="w-full justify-start text-muted-foreground hover:text-foreground">
            <Plus className="w-4 h-4 mr-1" /> Ajouter une tâche
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FrequencyBadge({ frequency }: { frequency: CleaningFrequency }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border ${FREQUENCY_BADGE_CLASSES[frequency]}`}>
      {FREQUENCY_LABELS[frequency]}
    </span>
  );
}

// ============================================================================
// Dialog zone
// ============================================================================
const SUGGESTED_ICONS = ['🧽', '🍳', '🥐', '🍴', '🥂', '🧴', '🚿', '🚽', '🧹', '🗑️', '❄️', '🔥', '🧊', '🪟'];

function ZoneDialog({
  hotelId, zone, existingMaxOrder, onClose, onSaved,
}: {
  hotelId: string;
  zone: CleaningZone | null;
  existingMaxOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(zone?.name || '');
  const [icon, setIcon] = useState(zone?.icon || '🧽');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error('Le nom est obligatoire'); return; }
    setSaving(true);
    const payload = {
      hotel_id: hotelId,
      name: name.trim(),
      icon: icon || null,
      ...(zone ? {} : { sort_order: existingMaxOrder + 10 }),
    };
    const { error } = zone
      ? await supabase.from('haccp_cleaning_zones').update(payload).eq('id', zone.id)
      : await supabase.from('haccp_cleaning_zones').insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(zone ? 'Zone modifiée' : 'Zone créée');
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{zone ? 'Modifier la zone' : 'Nouvelle zone'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Field label="Nom">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex : Cuisine, Buffet, Plonge…" autoFocus />
          </Field>
          <Field label="Icône">
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_ICONS.map(em => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setIcon(em)}
                  className={`w-9 h-9 rounded text-xl flex items-center justify-center border transition-colors ${
                    icon === em ? 'border-foreground bg-muted' : 'border-transparent hover:bg-muted/50'
                  }`}
                >
                  {em}
                </button>
              ))}
            </div>
            <Input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="Ou colle ton emoji"
              className="mt-2 text-center text-lg"
              maxLength={4}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {zone ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Dialog tâche
// ============================================================================
function TaskDialog({
  task, zoneId, existingMaxOrder, onClose, onSaved,
}: {
  task: CleaningTask | null;
  zoneId: string;
  existingMaxOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName]                 = useState(task?.name || '');
  const [frequency, setFrequency]       = useState<CleaningFrequency>(task?.frequency || 'daily');
  const [product, setProduct]           = useState(task?.product || '');
  const [instructions, setInstructions] = useState(task?.instructions || '');
  const [estimatedMin, setEstimatedMin] = useState<string>(
    task?.estimated_min != null ? String(task.estimated_min) : '',
  );
  const [active, setActive]             = useState(task?.active ?? true);
  const [saving, setSaving]             = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error('Le nom est obligatoire'); return; }
    const dur = estimatedMin.trim() === '' ? null : parseInt(estimatedMin, 10);
    if (dur != null && (!isFinite(dur) || dur < 0)) {
      toast.error('Durée invalide');
      return;
    }
    setSaving(true);
    const payload = {
      zone_id: zoneId,
      name: name.trim(),
      frequency,
      product: product.trim() || null,
      instructions: instructions.trim() || null,
      estimated_min: dur,
      active,
      ...(task ? {} : { sort_order: existingMaxOrder + 10 }),
    };
    const { error } = task
      ? await supabase.from('haccp_cleaning_tasks').update(payload).eq('id', task.id)
      : await supabase.from('haccp_cleaning_tasks').insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(task ? 'Tâche modifiée' : 'Tâche créée');
    onSaved();
  };

  const remove = async () => {
    if (!task) return;
    if (!window.confirm(`Supprimer définitivement "${task.name}" et son historique de validations ?`)) return;
    setSaving(true);
    const { error } = await supabase.from('haccp_cleaning_tasks').delete().eq('id', task.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Tâche supprimée');
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? 'Modifier la tâche' : 'Nouvelle tâche'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Field label="Nom de la tâche">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex : Nettoyer plan de travail, Détartrer cafetière…"
              autoFocus
            />
          </Field>

          <Field label="Fréquence">
            <div className="grid grid-cols-2 gap-2">
              {FREQUENCY_ORDER.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFrequency(f)}
                  className={`px-3 py-2 text-sm rounded-md border transition-colors ${
                    frequency === f
                      ? `${FREQUENCY_BADGE_CLASSES[f]} border-current font-medium`
                      : 'border-input hover:bg-muted/40'
                  }`}
                >
                  {FREQUENCY_LABELS[f]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Produit utilisé" hint="Texte libre (ex : Détergent désinfectant Sani-Quat)">
            <Input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Optionnel" />
          </Field>

          <Field label="Durée estimée (min)" hint="Optionnel, sert au prévisionnel">
            <Input
              type="number"
              min={0}
              value={estimatedMin}
              onChange={(e) => setEstimatedMin(e.target.value)}
              placeholder="—"
            />
          </Field>

          <Field label="Instructions" hint="Pas-à-pas court visible côté terrain">
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background resize-none"
              placeholder="Optionnel"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded"
            />
            Tâche active (décocher pour suspendre sans supprimer l&apos;historique)
          </label>
        </div>
        <DialogFooter className="justify-between">
          {task ? (
            <Button variant="ghost" onClick={remove} disabled={saving} className="text-red-600 hover:text-red-700 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Supprimer
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Annuler</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {task ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      {children}
      {hint && <div className="text-xs text-muted-foreground/80">{hint}</div>}
    </div>
  );
}
