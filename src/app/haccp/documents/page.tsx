'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useHotelScope } from '@/hooks/useHotelScope';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  FolderOpen, Upload, Download, RefreshCw, Trash2, AlertTriangle,
  Loader2, Search, FileText, Calendar, Plus, X,
} from 'lucide-react';
import { format, parseISO, addMonths, isBefore, isAfter } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

import {
  ALL_CATEGORIES, CATEGORY_LABELS, CATEGORY_GROUPS,
  type DocumentCategory,
} from './categories';
import type { HACCPDocument } from './types';

const BUCKET = 'haccp-documents';

export default function DocumentsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { hotels, selectedHotelId, setSelectedHotelId } = useHotelScope();

  const [documents, setDocuments] = useState<HACCPDocument[]>([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<DocumentCategory | 'all'>('all');

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<HACCPDocument | null>(null);

  const loadDocs = useCallback(async (hotelId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('haccp_documents')
      .select('*')
      .eq('hotel_id', hotelId)
      .is('replaced_at', null)
      .order('created_at', { ascending: false });
    if (error) toast.error('Chargement échoué : ' + error.message);
    setDocuments((data || []) as HACCPDocument[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedHotelId) loadDocs(selectedHotelId);
  }, [selectedHotelId, loadDocs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter(d => {
      if (filterCategory !== 'all' && d.category !== filterCategory) return false;
      if (q && !d.name.toLowerCase().includes(q) && !d.filename.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [documents, search, filterCategory]);

  const countsByCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of documents) m[d.category] = (m[d.category] || 0) + 1;
    return m;
  }, [documents]);

  const expiringCount = useMemo(() => {
    const cutoff = addMonths(new Date(), 1);
    return documents.filter(d => d.valid_until && isBefore(parseISO(d.valid_until), cutoff)).length;
  }, [documents]);

  if (authLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!user) return <div className="p-8">Authentification requise.</div>;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <header className="mb-6 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FolderOpen className="w-6 h-6" /> Bibliothèque HACCP
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Documents administratifs : PMS, formations, contrats nuisibles, FT/FDS produits ménage,
            carnets maintenance. Versionning + alerte d&apos;expiration.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowUploadModal(true)}>
            <Plus className="w-4 h-4 mr-1" /> Ajouter un document
          </Button>
        </div>
      </header>

      {expiringCount > 0 && (
        <div className="mb-4 rounded-md border-2 border-amber-300 bg-amber-50 p-3 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span>
            <strong>{expiringCount}</strong> document{expiringCount > 1 ? 's' : ''} expir{expiringCount > 1 ? 'ent' : 'e'} dans moins d&apos;un mois.
          </span>
        </div>
      )}

      {/* Filtres */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par nom de document…"
            className="pl-9"
          />
        </div>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value as DocumentCategory | 'all')}
          className="border rounded-md px-3 py-2 text-sm bg-background min-w-[200px]"
        >
          <option value="all">Toutes catégories ({documents.length})</option>
          {CATEGORY_GROUPS.map(group => (
            <optgroup key={group.label} label={group.label}>
              {group.values.map(cat => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat]} ({countsByCategory[cat] || 0})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Liste */}
      {loading ? (
        <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {documents.length === 0
              ? <>Aucun document encore. Clique sur <strong>Ajouter un document</strong> pour démarrer.</>
              : 'Aucun document ne correspond à la recherche.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(doc => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              onRefresh={() => selectedHotelId && loadDocs(selectedHotelId)}
              onReplace={() => setReplaceTarget(doc)}
            />
          ))}
        </div>
      )}

      {/* Modal upload */}
      {showUploadModal && selectedHotelId && (
        <UploadModal
          hotelId={selectedHotelId}
          userId={user.id}
          onClose={() => setShowUploadModal(false)}
          onUploaded={() => {
            setShowUploadModal(false);
            loadDocs(selectedHotelId);
          }}
        />
      )}

      {/* Modal remplacement (nouvelle version) */}
      {replaceTarget && selectedHotelId && (
        <UploadModal
          hotelId={selectedHotelId}
          userId={user.id}
          replaceTarget={replaceTarget}
          onClose={() => setReplaceTarget(null)}
          onUploaded={() => {
            setReplaceTarget(null);
            loadDocs(selectedHotelId);
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Ligne document
// ============================================================================
function DocumentRow({
  doc, onRefresh, onReplace,
}: {
  doc: HACCPDocument;
  onRefresh: () => void;
  onReplace: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const expiry = doc.valid_until ? parseISO(doc.valid_until) : null;
  const expiryStatus: 'ok' | 'soon' | 'expired' | null = expiry
    ? isAfter(new Date(), expiry)
      ? 'expired'
      : isBefore(expiry, addMonths(new Date(), 1))
        ? 'soon'
        : 'ok'
    : null;

  const download = async () => {
    setDownloading(true);
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(doc.storage_path, 3600); // 1h
    setDownloading(false);
    if (error || !data?.signedUrl) {
      toast.error('Lien introuvable : ' + (error?.message || 'inconnu'));
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const remove = async () => {
    if (!window.confirm(`Supprimer définitivement "${doc.name}" ? Cette action est irréversible.`)) return;
    setDeleting(true);
    // 1) Suppression du fichier dans le bucket
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([doc.storage_path]);
    if (storageError) {
      setDeleting(false);
      toast.error('Suppression fichier échouée : ' + storageError.message);
      return;
    }
    // 2) Suppression de la ligne BDD
    const { error: dbError } = await supabase.from('haccp_documents').delete().eq('id', doc.id);
    setDeleting(false);
    if (dbError) {
      toast.error('Suppression BDD échouée : ' + dbError.message);
      return;
    }
    toast.success('Document supprimé');
    onRefresh();
  };

  return (
    <Card className="hover:border-slate-300 transition-colors">
      <CardContent className="py-3">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-slate-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{doc.name}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                {CATEGORY_LABELS[doc.category]}
              </span>
              {doc.version > 1 && (
                <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                  v{doc.version}
                </span>
              )}
              {expiry && (
                <ExpiryBadge status={expiryStatus!} date={expiry} />
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3">
              <span>{doc.filename}</span>
              {doc.file_size && <span>{(doc.file_size / 1024).toFixed(0)} Ko</span>}
              <span>Ajouté le {format(parseISO(doc.created_at), 'd MMM yyyy', { locale: fr })}</span>
            </div>
            {doc.notes && (
              <div className="text-xs italic text-muted-foreground mt-1">{doc.notes}</div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="ghost" onClick={download} disabled={downloading} title="Télécharger">
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={onReplace} title="Remplacer (nouvelle version)">
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={remove} disabled={deleting} title="Supprimer">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 text-red-500" />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ExpiryBadge({ status, date }: { status: 'ok' | 'soon' | 'expired'; date: Date }) {
  const cls = {
    ok: 'bg-emerald-50 text-emerald-700',
    soon: 'bg-amber-50 text-amber-700',
    expired: 'bg-red-50 text-red-700',
  }[status];
  const label = {
    ok: `Valide jusqu'au ${format(date, 'd MMM yyyy', { locale: fr })}`,
    soon: `Expire le ${format(date, 'd MMM yyyy', { locale: fr })}`,
    expired: `Expiré le ${format(date, 'd MMM yyyy', { locale: fr })}`,
  }[status];
  return (
    <span className={`text-xs px-2 py-0.5 rounded inline-flex items-center gap-1 ${cls}`}>
      <Calendar className="w-3 h-3" />
      {label}
    </span>
  );
}

// ============================================================================
// Modal upload (ajout neuf OU remplacement = nouvelle version)
// ============================================================================
function UploadModal({
  hotelId, userId, replaceTarget, onClose, onUploaded,
}: {
  hotelId: string;
  userId: string;
  replaceTarget?: HACCPDocument;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [category, setCategory] = useState<DocumentCategory>(replaceTarget?.category || 'pms');
  const [name, setName] = useState(replaceTarget?.name || '');
  const [validUntil, setValidUntil] = useState(replaceTarget?.valid_until || '');
  const [notes, setNotes] = useState(replaceTarget?.notes || '');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isReplace = !!replaceTarget;

  const submit = async () => {
    if (!file) { toast.error('Sélectionne un fichier.'); return; }
    if (!name.trim()) { toast.error('Donne un nom au document.'); return; }

    setUploading(true);

    // Path : haccp_documents/{hotelId}/{uuid}-{filename}
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${hotelId}/${crypto.randomUUID()}-${safeName}`;

    const { error: upError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
      });

    if (upError) {
      setUploading(false);
      toast.error('Upload échoué : ' + upError.message);
      return;
    }

    // Si remplacement : marquer l'ancien comme replaced
    if (isReplace) {
      await supabase
        .from('haccp_documents')
        .update({ replaced_at: new Date().toISOString() })
        .eq('id', replaceTarget!.id);
    }

    // Insert nouvelle ligne
    const { error: dbError } = await supabase.from('haccp_documents').insert({
      hotel_id: hotelId,
      category,
      name: name.trim(),
      filename: file.name,
      storage_path: storagePath,
      mime_type: file.type || null,
      file_size: file.size,
      valid_until: validUntil || null,
      version: isReplace ? replaceTarget!.version + 1 : 1,
      notes: notes.trim() || null,
      uploaded_by: userId,
    });

    setUploading(false);

    if (dbError) {
      // Rollback storage si BDD échoue
      await supabase.storage.from(BUCKET).remove([storagePath]);
      toast.error('Enregistrement BDD échoué : ' + dbError.message);
      return;
    }

    toast.success(isReplace ? 'Nouvelle version enregistrée' : 'Document ajouté');
    onUploaded();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <CardContent className="py-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Upload className="w-5 h-5" />
              {isReplace ? `Remplacer : ${replaceTarget!.name}` : 'Ajouter un document'}
            </h2>
            <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
          </div>

          {isReplace && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
              L&apos;ancienne version (v{replaceTarget!.version}) sera archivée. La nouvelle deviendra v{replaceTarget!.version + 1}.
            </div>
          )}

          <Field label="Catégorie">
            <select
              value={category}
              onChange={e => setCategory(e.target.value as DocumentCategory)}
              disabled={isReplace}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background disabled:opacity-60"
            >
              {ALL_CATEGORIES.map(c => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </Field>

          <Field label="Nom du document">
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex : PMS Corniche 2026, Formation HACCP Marie D."
            />
          </Field>

          <Field label="Fichier (PDF recommandé)">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
            />
            {file && <div className="text-xs text-muted-foreground mt-1">{file.name} ({(file.size / 1024).toFixed(0)} Ko)</div>}
          </Field>

          <Field label="Date d'expiration (optionnel)">
            <Input
              type="date"
              value={validUntil}
              onChange={e => setValidUntil(e.target.value)}
            />
          </Field>

          <Field label="Notes (optionnel)">
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Précisions, n° contrat, fournisseur, etc."
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={onClose} disabled={uploading}>Annuler</Button>
            <Button onClick={submit} disabled={uploading}>
              {uploading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Upload…</>
                : <><Upload className="w-4 h-4 mr-2" /> {isReplace ? 'Remplacer' : 'Ajouter'}</>}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-600 mb-1 block">{label}</label>
      {children}
    </div>
  );
}
