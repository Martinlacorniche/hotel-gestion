"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ThemedBackground } from "@/components/ThemedBackground";
import { confirmDialog } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState as SharedEmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  UserPlus,
  Loader2,
  Search,
  MoreVertical,
  Mail,
  Power,
  PowerOff,
  ShieldCheck,
  Users as UsersIcon,
  UserCheck,
  UserX,
  AlertTriangle,
  Cake,
  Calendar,
  Pencil,
  X,
  FileText,
  Plus,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";

type AppRole = "superadmin" | "admin" | "user";

type Hotel = { id: string; nom: string };

type UserRow = {
  id_auth: string;
  email: string;
  name: string | null;
  role: AppRole;
  hotel_id: string | null;
  birth_date: string | null;
  active: boolean | null;
  employment_end_date: string | null;
  emoji: string | null;
  created_at?: string | null;
};

type ContratType = "CDI" | "CDD" | "Extra" | "Alternance";
type ContratRow = {
  id: string;
  user_id: string;
  type: ContratType;
  date_debut: string;
  date_fin: string | null;
  heures_hebdo: number | null;
  hotel_id: string | null;
};

const ROLE_LABEL: Record<AppRole, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
  user: "Employé",
};

const ROLE_BADGE: Record<AppRole, string> = {
  superadmin: "bg-violet-50 text-violet-700 ring-violet-200",
  admin: "bg-[var(--brand-bg)] text-[var(--brand)] ring-[var(--brand)]",
  user: "bg-slate-100 text-slate-600 ring-slate-200",
};

const AVATAR_PALETTE = [
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-pink-100 text-pink-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
  "bg-orange-100 text-orange-700",
  "bg-teal-100 text-teal-700",
];

function avatarFor(name: string | null, email: string): { initials: string; color: string } {
  const src = (name || email).trim();
  const parts = src.split(/[\s.@_-]+/).filter(Boolean);
  const initials = (
    (parts[0]?.[0] || "") + (parts[1]?.[0] || parts[0]?.[1] || "")
  ).toUpperCase();
  let hash = 0;
  for (let i = 0; i < src.length; i++) hash = (hash * 31 + src.charCodeAt(i)) | 0;
  const color = AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
  return { initials: initials || "?", color };
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

async function apiCall(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { ok: false, error: "Session expirée, reconnectez-vous." };
  const resp = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result = await resp.json();
  if (!resp.ok || !result.ok) return { ok: false, error: result.error || resp.statusText };
  return { ok: true };
}

export default function UsersPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const isSuperadmin = user?.role === "superadmin";

  const [users, setUsers] = useState<UserRow[]>([]);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterStatus, setFilterStatus] = useState<"active" | "inactive" | "all">("active");
  const [filterRole, setFilterRole] = useState<"all" | AppRole>("all");
  const [filterHotel, setFilterHotel] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Modal Invite
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "user">("user");
  const [inviteHotel, setInviteHotel] = useState("");
  const [inviteBirth, setInviteBirth] = useState("");
  const [inviting, setInviting] = useState(false);

  // Modal Close
  const [closeTarget, setCloseTarget] = useState<UserRow | null>(null);
  const [closeDate, setCloseDate] = useState(new Date().toISOString().slice(0, 10));
  const [closing, setClosing] = useState(false);

  // Modal Update Role
  const [roleTarget, setRoleTarget] = useState<UserRow | null>(null);
  const [newRoleVal, setNewRoleVal] = useState<"admin" | "user">("user");
  const [updatingRole, setUpdatingRole] = useState(false);

  // Modal Edit Profile
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editBirth, setEditBirth] = useState("");
  const [editHotel, setEditHotel] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);

  // Contrats
  const [contratTarget, setContratTarget] = useState<UserRow | null>(null);
  const [contrats, setContrats] = useState<ContratRow[]>([]);
  const [loadingContrats, setLoadingContrats] = useState(false);
  const [savingContrat, setSavingContrat] = useState(false);
  const [editingContratId, setEditingContratId] = useState<string | null>(null);
  const [cType, setCType] = useState<ContratType>("CDI");
  const [cDebut, setCDebut] = useState("");
  const [cFin, setCFin] = useState("");
  const [cHeures, setCHeures] = useState("");
  const [cHotel, setCHotel] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    if (!isAdmin) { router.push("/"); return; }
  }, [authLoading, user, isAdmin, router]);

  const loadAll = async () => {
    setLoading(true);
    const [usersRes, hotelsRes] = await Promise.all([
      supabase
        .from("users")
        .select("id_auth, email, name, role, hotel_id, birth_date, active, employment_end_date, emoji")
        .order("name", { ascending: true }),
      supabase.from("hotels").select("id, nom").order("nom", { ascending: true }),
    ]);
    setUsers((usersRes.data || []) as UserRow[]);
    setHotels((hotelsRes.data || []) as Hotel[]);
    setLoading(false);
  };

  useEffect(() => { if (isAdmin) loadAll(); }, [isAdmin]);

  useEffect(() => {
    if (inviteOpen && !inviteHotel && hotels.length > 0) setInviteHotel(hotels[0].id);
  }, [inviteOpen, inviteHotel, hotels]);

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.active !== false).length;
    const inactive = total - active;
    const admins = users.filter((u) => (u.role === "admin" || u.role === "superadmin") && u.active !== false).length;
    return { total, active, inactive, admins };
  }, [users]);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (filterStatus === "active" && u.active === false) return false;
      if (filterStatus === "inactive" && u.active !== false) return false;
      if (filterRole !== "all" && u.role !== filterRole) return false;
      if (filterHotel !== "all" && u.hotel_id !== filterHotel) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (!(u.name || "").toLowerCase().includes(s) && !u.email.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [users, filterStatus, filterRole, filterHotel, search]);

  const hotelName = (id: string | null) => hotels.find((h) => h.id === id)?.nom || "—";

  const doInvite = async () => {
    if (!inviteEmail.trim() || !inviteName.trim() || !inviteHotel) {
      toast.error("Email, nom et hôtel requis");
      return;
    }
    setInviting(true);
    const res = await apiCall("/api/users/invite", {
      email: inviteEmail.trim(), name: inviteName.trim(), role: inviteRole,
      hotel_id: inviteHotel, birth_date: inviteBirth || undefined,
    });
    setInviting(false);
    if (!res.ok) { toast.error(res.error || "Erreur"); return; }
    toast.success(`Invitation envoyée à ${inviteEmail}`);
    setInviteOpen(false);
    setInviteEmail(""); setInviteName(""); setInviteRole("user"); setInviteBirth("");
    await loadAll();
  };

  const doClose = async () => {
    if (!closeTarget) return;
    setClosing(true);
    const res = await apiCall("/api/users/deactivate", {
      user_id: closeTarget.id_auth, employment_end_date: closeDate,
    });
    setClosing(false);
    if (!res.ok) { toast.error(res.error || "Erreur"); return; }
    toast.success("Utilisateur clôturé");
    setCloseTarget(null);
    await loadAll();
  };

  const doReactivate = async (u: UserRow) => {
    const res = await apiCall("/api/users/reactivate", { user_id: u.id_auth });
    if (!res.ok) { toast.error(res.error || "Erreur"); return; }
    toast.success("Utilisateur réactivé");
    await loadAll();
  };

  const openEdit = (u: UserRow) => {
    setEditTarget(u);
    setEditName(u.name || "");
    setEditBirth(u.birth_date || "");
    setEditHotel(u.hotel_id || "");
  };

  const doEditProfile = async () => {
    if (!editTarget) return;
    if (!editName.trim()) { toast.error("Le nom est requis"); return; }
    if (!editHotel) { toast.error("L'hôtel est requis"); return; }
    setEditingProfile(true);
    const res = await apiCall("/api/users/update-profile", {
      user_id: editTarget.id_auth,
      name: editName.trim(),
      birth_date: editBirth || null,
      hotel_id: editHotel,
    });
    setEditingProfile(false);
    if (!res.ok) { toast.error(res.error || "Erreur"); return; }
    toast.success("Profil mis à jour");
    setEditTarget(null);
    await loadAll();
  };

  // ── Contrats ──
  const resetContratForm = () => {
    setEditingContratId(null); setCType("CDI"); setCDebut(""); setCFin(""); setCHeures(""); setCHotel("");
  };
  const openContrats = async (u: UserRow) => {
    setContratTarget(u); resetContratForm(); setLoadingContrats(true);
    const { data } = await supabase.from("contrats").select("*").eq("user_id", u.id_auth).order("date_debut", { ascending: false });
    setContrats((data as ContratRow[]) || []); setLoadingContrats(false);
  };
  const editContrat = (c: ContratRow) => {
    setEditingContratId(c.id); setCType(c.type); setCDebut(c.date_debut); setCFin(c.date_fin || "");
    setCHeures(c.heures_hebdo != null ? String(c.heures_hebdo) : ""); setCHotel(c.hotel_id || "");
  };
  const saveContrat = async () => {
    if (!contratTarget || !cDebut) { toast.error("Date de début requise"); return; }
    setSavingContrat(true);
    const payload = {
      user_id: contratTarget.id_auth, type: cType, date_debut: cDebut,
      date_fin: cFin || null,
      heures_hebdo: cType === "Extra" ? null : (cHeures ? parseFloat(cHeures) : null),
      hotel_id: cHotel || null,
    };
    const { error } = editingContratId
      ? await supabase.from("contrats").update(payload).eq("id", editingContratId)
      : await supabase.from("contrats").insert(payload);
    setSavingContrat(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editingContratId ? "Contrat mis à jour" : "Contrat ajouté");
    await openContrats(contratTarget);
  };
  const deleteContrat = async (id: string) => {
    if (!(await confirmDialog("Supprimer ce contrat ?"))) return;
    await supabase.from("contrats").delete().eq("id", id);
    if (contratTarget) await openContrats(contratTarget);
  };

  const doUpdateRole = async () => {
    if (!roleTarget) return;
    setUpdatingRole(true);
    const res = await apiCall("/api/users/update-role", {
      user_id: roleTarget.id_auth, new_role: newRoleVal,
    });
    setUpdatingRole(false);
    if (!res.ok) { toast.error(res.error || "Erreur"); return; }
    toast.success("Rôle mis à jour");
    setRoleTarget(null);
    await loadAll();
  };

  if (authLoading || !user || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        <Loader2 className="animate-spin mr-2" size={18} /> Chargement…
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <ThemedBackground />
      <main className="max-w-7xl mx-auto px-6 py-6">
        <PageHeader
          icon={UsersIcon}
          title="Utilisateurs"
          subtitle="Gérez les accès et les rôles de votre équipe"
          iconClassName="bg-[var(--brand-bg)] text-[var(--brand)]"
          actions={
            <Button
              onClick={() => setInviteOpen(true)}
              className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm"
            >
              <UserPlus size={15} className="mr-2" /> Inviter
            </Button>
          }
        />
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard icon={UsersIcon} iconBg="bg-slate-100" iconColor="text-slate-600" label="Total" value={stats.total} />
          <StatCard icon={UserCheck} iconBg="bg-emerald-100" iconColor="text-emerald-600" label="Actifs" value={stats.active} />
          <StatCard icon={ShieldCheck} iconBg="bg-[var(--brand-bg)]" iconColor="text-[var(--brand)]" label="Admins" value={stats.admins} />
          <StatCard icon={UserX} iconBg="bg-rose-100" iconColor="text-rose-600" label="Désactivés" value={stats.inactive} />
        </div>

        {/* Toolbar */}
        <div className="bg-white rounded-xl border border-slate-200 mb-4">
          <div className="p-3 flex flex-wrap items-center gap-3 border-b border-slate-100">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Rechercher un utilisateur…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 bg-slate-50 border-slate-200 focus:bg-white"
              />
            </div>

            {/* Segmented status */}
            <Segmented
              value={filterStatus}
              onChange={setFilterStatus}
              options={[
                { value: "active", label: "Actifs" },
                { value: "inactive", label: "Inactifs" },
                { value: "all", label: "Tous" },
              ]}
            />

            {/* Role filter */}
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value as "all" | AppRole)}
              className="h-9 px-3 text-sm bg-white border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50"
            >
              <option value="all">Tous rôles</option>
              <option value="superadmin">Superadmin</option>
              <option value="admin">Admin</option>
              <option value="user">Employé</option>
            </select>

            {/* Hotel filter */}
            <select
              value={filterHotel}
              onChange={(e) => setFilterHotel(e.target.value)}
              className="h-9 px-3 text-sm bg-white border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50"
            >
              <option value="all">Tous hôtels</option>
              {hotels.map((h) => (<option key={h.id} value={h.id}>{h.nom}</option>))}
            </select>

            <div className="ml-auto text-xs text-slate-500">
              {filtered.length} <span className="text-slate-400">/ {users.length}</span>
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm">
              <Loader2 className="animate-spin inline mr-2" size={16} /> Chargement…
            </div>
          ) : filtered.length === 0 ? (
            <SharedEmptyState
              icon={Search}
              title="Aucun utilisateur trouvé"
              subtitle="Essayez de modifier les filtres ou invitez un nouvel utilisateur."
              action={
                <Button size="sm" onClick={() => setInviteOpen(true)} className="bg-slate-900 hover:bg-slate-800 text-white">
                  <UserPlus size={14} className="mr-2" /> Inviter
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    <th className="px-4 py-2.5 font-medium">Nom</th>
                    <th className="px-4 py-2.5 font-medium hidden md:table-cell">Rôle</th>
                    <th className="px-4 py-2.5 font-medium hidden md:table-cell">Hôtel</th>
                    <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Date de naissance</th>
                    <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Fin d&apos;emploi</th>
                    <th className="px-4 py-2.5 font-medium">Statut</th>
                    <th className="px-4 py-2.5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((u) => {
                    const isClosed = u.active === false;
                    const av = avatarFor(u.name, u.email);
                    const isProtected = u.role === "superadmin";
                    return (
                      <tr key={u.id_auth} className={`hover:bg-slate-50/80 transition-colors ${isClosed ? "opacity-60" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${av.color} shrink-0`}>
                              {av.initials}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900 truncate">
                                {u.emoji && <span className="mr-1">{u.emoji}</span>}
                                {u.name || "(sans nom)"}
                              </div>
                              <div className="text-xs text-slate-500 truncate flex items-center gap-1">
                                <Mail size={10} className="shrink-0" />
                                <span className="truncate">{u.email}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <RoleBadge role={u.role} />
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-slate-600">{hotelName(u.hotel_id)}</td>
                        <td className="px-4 py-3 hidden lg:table-cell text-slate-600">
                          {u.birth_date ? (
                            <span className="inline-flex items-center gap-1.5 text-slate-600">
                              <Cake size={12} className="text-slate-400" />
                              {fmtDate(u.birth_date)}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell text-slate-600">
                          {u.employment_end_date ? (
                            <span className="inline-flex items-center gap-1.5 text-slate-600">
                              <Calendar size={12} className="text-slate-400" />
                              {fmtDate(u.employment_end_date)}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <StatusDot active={!isClosed} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isProtected ? (
                            <span className="text-slate-300 text-xs italic pr-2">protégé</span>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700">
                                  <MoreVertical size={16} />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuLabel className="text-xs text-slate-400">Actions</DropdownMenuLabel>
                                {!isClosed && (
                                  <DropdownMenuItem onClick={() => openEdit(u)}>
                                    <Pencil size={14} /> Modifier le profil
                                  </DropdownMenuItem>
                                )}
                                {!isClosed && (
                                  <DropdownMenuItem onClick={() => openContrats(u)}>
                                    <FileText size={14} /> Contrats
                                  </DropdownMenuItem>
                                )}
                                {isSuperadmin && !isClosed && (
                                  <DropdownMenuItem onClick={() => { setRoleTarget(u); setNewRoleVal(u.role === "admin" ? "user" : "admin"); }}>
                                    <ShieldCheck size={14} /> Changer le rôle
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                {!isClosed ? (
                                  <DropdownMenuItem onClick={() => { setCloseTarget(u); setCloseDate(new Date().toISOString().slice(0, 10)); }} className="text-rose-600 focus:text-rose-700 focus:bg-rose-50">
                                    <PowerOff size={14} /> Désactiver
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => doReactivate(u)} className="text-emerald-600 focus:text-emerald-700 focus:bg-emerald-50">
                                    <Power size={14} /> Réactiver
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Modal Invite */}
      {inviteOpen && (
        <Modal onClose={() => !inviting && setInviteOpen(false)} icon={<Mail className="text-[var(--brand)]" size={20} />} title="Inviter un utilisateur" subtitle="Un email lui sera envoyé pour définir son mot de passe.">
          <div className="space-y-3">
            <Field label="Prénom">
              <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Jean" />
            </Field>
            <Field label="Email">
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="jean.dupont@exemple.com" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date de naissance">
                <Input type="date" value={inviteBirth} onChange={(e) => setInviteBirth(e.target.value)} />
              </Field>
              <Field label="Rôle">
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "user")}
                  className="w-full h-9 px-3 text-sm bg-white border border-slate-200 rounded-md"
                >
                  <option value="user">Employé</option>
                  {isSuperadmin && <option value="admin">Admin</option>}
                </select>
              </Field>
            </div>
            <Field label="Hôtel">
              <select
                value={inviteHotel}
                onChange={(e) => setInviteHotel(e.target.value)}
                className="w-full h-9 px-3 text-sm bg-white border border-slate-200 rounded-md"
              >
                {hotels.map((h) => (<option key={h.id} value={h.id}>{h.nom}</option>))}
              </select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" onClick={() => setInviteOpen(false)} disabled={inviting}>Annuler</Button>
            <Button onClick={doInvite} disabled={inviting} className="bg-slate-900 hover:bg-slate-800 text-white">
              {inviting ? <><Loader2 size={14} className="animate-spin mr-2" /> Envoi…</> : <><Mail size={14} className="mr-2" /> Envoyer l&apos;invitation</>}
            </Button>
          </div>
        </Modal>
      )}

      {/* Modal Close */}
      {closeTarget && (
        <Modal onClose={() => !closing && setCloseTarget(null)} icon={<AlertTriangle className="text-rose-600" size={20} />} title={`Désactiver ${closeTarget.name || closeTarget.email}`} subtitle="L'utilisateur ne pourra plus se connecter mais restera dans l'historique (planning, etc).">
          <Field label="Date de fin d'emploi">
            <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" onClick={() => setCloseTarget(null)} disabled={closing}>Annuler</Button>
            <Button onClick={doClose} disabled={closing} className="bg-rose-600 hover:bg-rose-700 text-white">
              {closing ? <><Loader2 size={14} className="animate-spin mr-2" /> Désactivation…</> : <><PowerOff size={14} className="mr-2" /> Désactiver</>}
            </Button>
          </div>
        </Modal>
      )}

      {/* Modal Edit Profile */}
      {editTarget && (
        <Modal onClose={() => !editingProfile && setEditTarget(null)} icon={<Pencil className="text-[var(--brand)]" size={20} />} title={`Modifier ${editTarget.name || editTarget.email}`} subtitle={editTarget.email}>
          <div className="space-y-3">
            <Field label="Prénom">
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Jean" />
            </Field>
            <Field label="Date de naissance">
              <Input type="date" value={editBirth} onChange={(e) => setEditBirth(e.target.value)} />
            </Field>
            <Field label="Hôtel de rattachement">
              <select
                value={editHotel}
                onChange={(e) => setEditHotel(e.target.value)}
                className="w-full h-9 px-3 text-sm bg-white border border-slate-200 rounded-md"
              >
                {hotels.map((h) => (<option key={h.id} value={h.id}>{h.nom}</option>))}
              </select>
              <p className="text-xs text-slate-400 mt-1">Détermine dans quel planning le salarié apparaît.</p>
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" onClick={() => setEditTarget(null)} disabled={editingProfile}>Annuler</Button>
            <Button onClick={doEditProfile} disabled={editingProfile} className="btn-brand hover:brightness-110 text-white">
              {editingProfile ? <><Loader2 size={14} className="animate-spin mr-2" /> Enregistrement…</> : "Enregistrer"}
            </Button>
          </div>
        </Modal>
      )}

      {/* Modal Contrats */}
      {contratTarget && (
        <Modal onClose={() => setContratTarget(null)} icon={<FileText className="text-[var(--brand)]" size={20} />} title={`Contrats — ${contratTarget.name || contratTarget.email}`} subtitle="CDI · CDD · Extra · Alternance">
          <div className="space-y-2 mb-4">
            {loadingContrats ? (
              <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Chargement…</div>
            ) : contrats.length === 0 ? (
              <div className="text-sm text-slate-400">Aucun contrat enregistré.</div>
            ) : contrats.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                <div className="text-sm">
                  <span className="font-bold text-slate-700">{c.type}</span>
                  <span className="text-slate-500"> · {c.date_debut}{c.date_fin ? ` → ${c.date_fin}` : " → en cours"}</span>
                  {c.heures_hebdo != null && <span className="text-slate-500"> · {c.heures_hebdo}h/sem</span>}
                  <span className="text-slate-400"> · {c.hotel_id ? (hotels.find((h) => h.id === c.hotel_id)?.nom || "hôtel") : "groupe"}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => editContrat(c)} className="p-1.5 text-slate-400 hover:text-[var(--brand)] rounded transition"><Pencil size={14} /></button>
                  <button onClick={() => deleteContrat(c.id)} className="p-1.5 text-slate-400 hover:text-rose-600 rounded transition"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{editingContratId ? "Modifier le contrat" : "Nouveau contrat"}</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select value={cType} onChange={(e) => setCType(e.target.value as ContratType)} className="w-full h-9 px-3 text-sm bg-white border border-slate-200 rounded-md">
                  <option value="CDI">CDI</option><option value="CDD">CDD</option><option value="Extra">Extra</option><option value="Alternance">Alternance</option>
                </select>
              </Field>
              <Field label="Heures / semaine">
                <Input type="number" value={cHeures} onChange={(e) => setCHeures(e.target.value)} placeholder={cType === "Extra" ? "—" : "35"} disabled={cType === "Extra"} />
              </Field>
              <Field label="Début"><Input type="date" value={cDebut} onChange={(e) => setCDebut(e.target.value)} /></Field>
              <Field label="Fin (vide = en cours)"><Input type="date" value={cFin} onChange={(e) => setCFin(e.target.value)} /></Field>
            </div>
            <Field label="Hôtel">
              <select value={cHotel} onChange={(e) => setCHotel(e.target.value)} className="w-full h-9 px-3 text-sm bg-white border border-slate-200 rounded-md">
                <option value="">Groupe (tous les hôtels)</option>
                {hotels.map((h) => (<option key={h.id} value={h.id}>{h.nom}</option>))}
              </select>
            </Field>
            <div className="flex justify-end gap-2">
              {editingContratId && <Button variant="ghost" onClick={resetContratForm}>Annuler</Button>}
              <Button onClick={saveContrat} disabled={savingContrat} className="btn-brand hover:brightness-110 text-white">
                {savingContrat ? <><Loader2 size={14} className="animate-spin mr-2" />…</> : (editingContratId ? "Mettre à jour" : <><Plus size={14} className="mr-2" /> Ajouter</>)}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Update Role */}
      {roleTarget && (
        <Modal onClose={() => !updatingRole && setRoleTarget(null)} icon={<ShieldCheck className="text-violet-600" size={20} />} title={`Modifier le rôle de ${roleTarget.name || roleTarget.email}`} subtitle={`Rôle actuel : ${ROLE_LABEL[roleTarget.role]}`}>
          <Field label="Nouveau rôle">
            <select
              value={newRoleVal}
              onChange={(e) => setNewRoleVal(e.target.value as "admin" | "user")}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-200 rounded-md"
            >
              <option value="user">Employé</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" onClick={() => setRoleTarget(null)} disabled={updatingRole}>Annuler</Button>
            <Button onClick={doUpdateRole} disabled={updatingRole} className="bg-violet-600 hover:bg-violet-700 text-white">
              {updatingRole ? <><Loader2 size={14} className="animate-spin mr-2" /> Mise à jour…</> : "Confirmer"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function StatCard({ icon: Icon, iconBg, iconColor, label, value }: { icon: typeof UsersIcon; iconBg: string; iconColor: string; label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center ${iconColor}`}>
        <Icon size={18} />
      </div>
      <div>
        <div className="text-2xl font-semibold text-slate-900 leading-none">{value}</div>
        <div className="text-xs text-slate-500 mt-1">{label}</div>
      </div>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex bg-slate-100 rounded-md p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 h-8 text-xs font-medium rounded transition-colors ${value === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RoleBadge({ role }: { role: AppRole }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md ring-1 ring-inset ${ROLE_BADGE[role]}`}>
      {ROLE_LABEL[role]}
    </span>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-rose-400"}`} />
      <span className={active ? "text-emerald-700" : "text-rose-600"}>{active ? "Actif" : "Désactivé"}</span>
    </span>
  );
}

function Modal({ children, onClose, icon, title, subtitle }: { children: React.ReactNode; onClose: () => void; icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md animate-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 p-5 border-b border-slate-100">
          <div className="shrink-0 w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 -mt-1 -mr-1">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1.5">{label}</span>
      {children}
    </label>
  );
}
