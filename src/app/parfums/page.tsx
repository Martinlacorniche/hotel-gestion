'use client';

// Console Parfums d'accueil (hôtel Corniche). Le staff supervise les SÉJOURS ;
// l'agent applique les consignes. Deux onglets : Supervision (état + actions) et
// Réglages (mapping machine→chambre + flacons). Design Byca — voir parfums.module.css.

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '@/lib/supabaseClient';
import { useSelectedHotel } from '@/context/SelectedHotelContext';
import { useAuth } from '@/context/AuthContext';
import { Loader2, Power, Flower2, Link2, Zap } from 'lucide-react';
import styles from './parfums.module.css';

interface Parfum { id: string; code: string; nom: string; emoji: string | null; couleur: string | null }
interface Buse { buse_no: number; parfum_id: string | null; role: string }
interface Diffuseur {
  id: string; device_id: string; nom: string | null; en_ligne: boolean;
  room_unit_id: string | null; room_units: { numero: string } | null; diffuseur_buses: Buse[];
}
interface RoomUnit { id: string; numero: string }
interface Last { mode: string; parfum_id: string | null; nuits: number | null; created_at: string }

const META: Record<string, { img: string; cvar: string }> = {
  figue:      { img: '/parfums/figue.webp',      cvar: 'var(--figue)' },
  petitgrain: { img: '/parfums/petitgrain.webp', cvar: 'var(--petit)' },
  thenoir:    { img: '/parfums/thenoir.webp',    cvar: 'var(--thenoir)' },
};
const vars = (o: Record<string, string>) => o as React.CSSProperties;

function checkout(c: Last): Date | null {
  if (c.mode !== 'sejour' || c.nuits == null) return null;
  const d = new Date(c.created_at); d.setDate(d.getDate() + c.nuits); d.setHours(12, 0, 0, 0);
  return d;
}
function shortDay(d: Date) {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(d).replace('.', '');
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function ParfumsPage() {
  const { selectedHotelId } = useSelectedHotel();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'supervision' | 'reglages'>('supervision');
  const [parfums, setParfums] = useState<Parfum[]>([]);
  const [diffuseurs, setDiffuseurs] = useState<Diffuseur[]>([]);
  const [rooms, setRooms] = useState<RoomUnit[]>([]);
  const [last, setLast] = useState<Record<string, Last>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [p, d, r, c] = await Promise.all([
      supabase.from('parfums').select('*').eq('actif', true).order('ordre'),
      supabase.from('diffuseurs')
        .select('id,device_id,nom,en_ligne,room_unit_id,room_units(numero),diffuseur_buses(buse_no,parfum_id,role)')
        .order('created_at'),
      selectedHotelId
        ? supabase.from('room_units').select('id,numero').eq('hotel_id', selectedHotelId).eq('active', true).order('numero')
        : Promise.resolve({ data: [] as RoomUnit[] }),
      supabase.from('consignes_parfum').select('diffuseur_id,mode,parfum_id,nuits,created_at')
        .order('created_at', { ascending: false }).limit(400),
    ]);
    setParfums((p.data as Parfum[]) ?? []);
    setDiffuseurs((d.data as unknown as Diffuseur[]) ?? []);
    setRooms((r.data as RoomUnit[]) ?? []);
    const latest: Record<string, Last> = {};
    for (const row of (c.data ?? []) as (Last & { diffuseur_id: string })[]) {
      if (!latest[row.diffuseur_id]) latest[row.diffuseur_id] = row;
    }
    setLast(latest);
    setLoading(false);
  }, [selectedHotelId]);

  useEffect(() => { refresh(); }, [refresh]);

  const parfumDe = (id: string | null) => parfums.find((p) => p.id === id) || null;
  const cvarDe = (p: Parfum | null) => (p ? META[p.code]?.cvar ?? p.couleur ?? 'var(--brand)' : 'var(--bd)');

  async function arreter(d: Diffuseur) {
    setBusy(d.id);
    const { error } = await supabase.from('consignes_parfum').insert({
      hotel_id: selectedHotelId, diffuseur_id: d.id, parfum_id: null, mode: 'off', source: 'staff', cree_par: user?.id ?? null,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Arrêt — chambre ${d.room_units?.numero ?? d.device_id}`);
    setLast((l) => ({ ...l, [d.id]: { mode: 'off', parfum_id: null, nuits: null, created_at: new Date().toISOString() } }));
  }
  async function envoyerBoost(d: Diffuseur, parfum_id: string) {
    setBusy(d.id);
    const { error } = await supabase.from('consignes_parfum').insert({
      hotel_id: selectedHotelId, diffuseur_id: d.id, parfum_id, mode: 'boost', source: 'staff', cree_par: user?.id ?? null,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Bouffée envoyée — chambre ${d.room_units?.numero ?? d.device_id}`);
  }
  async function assigner(d: Diffuseur, room_unit_id: string) {
    const { error } = await supabase.from('diffuseurs').update({ room_unit_id: room_unit_id || null, hotel_id: selectedHotelId }).eq('id', d.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Chambre assignée'); refresh();
  }
  async function setBuse(d: Diffuseur, buse_no: number, parfum_id: string) {
    const { error } = await supabase.from('diffuseur_buses')
      .upsert({ diffuseur_id: d.id, buse_no, parfum_id: parfum_id || null, role: 'principal' }, { onConflict: 'diffuseur_id,buse_no' });
    if (error) { toast.error(error.message); return; }
    toast.success(`Flacon ${buse_no} configuré`); refresh();
  }

  const mapped = diffuseurs.filter((d) => d.room_unit_id);
  const aMapper = diffuseurs.filter((d) => !d.room_unit_id);
  const today = new Date();
  const active = (l?: Last) => !!l && l.mode !== 'off';
  const nbParfumees = mapped.filter((d) => active(last[d.id])).length;
  const nbDepart = mapped.filter((d) => { const co = last[d.id] && checkout(last[d.id]); return co ? sameDay(co, today) : false; }).length;
  const nbHorsLigne = mapped.filter((d) => !d.en_ligne).length;

  if (loading) return <div className={styles.wrap}><div className={styles.center}><Loader2 className="w-6 h-6 animate-spin" /></div></div>;

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <img className={styles.logo} src="/parfums/logo-byca.webp" alt="BYCA" />
          <div className={styles.divider} />
          <div>
            <div className={styles.brandTxt1}>La Corniche</div>
            <div className={styles.brandTxt2}>Signature olfactive</div>
          </div>
        </div>

        <div className={styles.tabs}>
          <button className={`${styles.tab} ${tab === 'supervision' ? styles.tabOn : ''}`} onClick={() => setTab('supervision')}>Supervision</button>
          <button className={`${styles.tab} ${tab === 'reglages' ? styles.tabOn : ''}`} onClick={() => setTab('reglages')}>
            Réglages{aMapper.length ? ` · ${aMapper.length}` : ''}
          </button>
        </div>

        {tab === 'supervision' && (
          <>
            <div className={styles.consoleHead}>
              <div>
                <div className={styles.eyebrow}>Console olfactive</div>
                <h1>Supervision des séjours</h1>
                <div className={styles.sub}>Ce que diffuse chaque chambre, et jusqu&apos;à quand.</div>
              </div>
              <div className={styles.kpis}>
                <div className={`${styles.kpi} ${styles.kpiLive}`}><div className={styles.n}>{nbParfumees}</div><div className={styles.l}>parfumées</div></div>
                <div className={styles.kpi}><div className={styles.n}>{nbDepart}</div><div className={styles.l}>départ ce jour</div></div>
                <div className={styles.kpi}><div className={styles.n}>{nbHorsLigne}</div><div className={styles.l}>hors ligne</div></div>
              </div>
            </div>

            {mapped.length === 0 && <p className={styles.note}>Aucune machine assignée à une chambre. Va dans <b>Réglages</b> pour les mapper.</p>}

            <div className={styles.grid}>
              {mapped.map((d) => {
                const l = last[d.id];
                const cur = parfumDe(l?.parfum_id ?? null);
                const co = l ? checkout(l) : null;
                const isActive = active(l);
                return (
                  <div key={d.id} className={styles.room} style={vars({ '--c': isActive ? cvarDe(cur) : 'var(--bd)' })}>
                    <div className={styles.r1}>
                      <span className={styles.rn}>{d.room_units?.numero}<small>La Corniche</small></span>
                      <span className={`${styles.pill} ${d.en_ligne ? styles.pillOn : styles.pillOff}`}><span className={styles.dot} />{d.en_ligne ? 'en ligne' : 'hors ligne'}</span>
                    </div>
                    {isActive && cur ? (
                      <>
                        <div className={styles.themeRow}>
                          <span className={styles.sw} style={META[cur.code]?.img ? { backgroundImage: `url(${META[cur.code].img})` } : { background: cvarDe(cur) }} />
                          <span className={styles.nm}>{cur.nom}</span>
                        </div>
                        <div className={styles.stayline}>
                          {co ? <>Séjour jusqu&apos;à <b>{shortDay(co)}. 12 h</b> · matin + soir</> : <>En diffusion · matin + soir</>}
                        </div>
                        <div className={styles.acts}>
                          <a className={`${styles.chip} ${styles.chipPrimary}`} href={`/parfums/choix?diffuseur=${d.id}`}><Flower2 className="w-3.5 h-3.5" />Changer</a>
                          <button className={styles.chip} disabled={busy === d.id} onClick={() => envoyerBoost(d, cur.id)}><Zap className="w-3.5 h-3.5" />Boost</button>
                          <button className={`${styles.chip} ${styles.chipStop}`} disabled={busy === d.id} onClick={() => arreter(d)}><Power className="w-3.5 h-3.5" />Arrêter</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={styles.empty}>Chambre libre — aucun parfum.</div>
                        <div className={styles.acts}>
                          <a className={`${styles.chip} ${styles.chipPrimary}`} href={`/parfums/choix?diffuseur=${d.id}`}><Flower2 className="w-3.5 h-3.5" />Check-in</a>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === 'reglages' && (
          <>
            {aMapper.length > 0 && (
              <div className={styles.subBlock}>
                <h2><Link2 className="w-3.5 h-3.5 inline mr-1" />Machines à rattacher ({aMapper.length})</h2>
                {aMapper.map((d) => (
                  <div key={d.id} className={styles.maprow}>
                    <div>
                      <div className={styles.dev}>{d.nom ?? d.device_id} <span className={styles.wchip}>WiFi hôtel requis</span></div>
                      <div className={styles.id}>{d.device_id}</div>
                    </div>
                    <select className={styles.select} defaultValue="" onChange={(e) => e.target.value && assigner(d, e.target.value)}>
                      <option value="">Assigner à une chambre…</option>
                      {rooms.map((r) => <option key={r.id} value={r.id}>Chambre {r.numero}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.subBlock}>
              <h2>Flacons par machine</h2>
              {mapped.map((d) => (
                <div key={d.id} className={styles.maprow} style={{ display: 'block' }}>
                  <div className={styles.dev} style={{ marginBottom: 8 }}>Chambre {d.room_units?.numero}</div>
                  <div className={styles.flacons}>
                    {[1, 2, 3, 4, 5].map((n) => {
                      const b = d.diffuseur_buses.find((x) => x.buse_no === n);
                      return (
                        <label key={n} className={styles.flacon}>Flacon {n}
                          <select className={styles.select} style={{ marginTop: 4, width: '100%' }} defaultValue={b?.parfum_id ?? ''} onChange={(e) => setBuse(d, n, e.target.value)}>
                            <option value="">—</option>
                            {parfums.map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.nom}</option>)}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
