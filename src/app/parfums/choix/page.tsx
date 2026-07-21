'use client';

// Sélection client du parfum d'accueil — ouverte par la RÉCEPTION (tablette),
// jamais depuis la chambre. Ouvrir avec ?diffuseur=<id>.
// Le choix crée une consigne 'sejour' (thème + nb de nuits) : l'agent génère un
// planning auto-porté (bouffée d'accueil → ambiance matin/soir → arrêt au départ 12h).
// Design « signature olfactive Byca » — voir parfums.module.css.

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { supabase } from '@/lib/supabaseClient';
import { Loader2, Check } from 'lucide-react';
import styles from '../parfums.module.css';

interface Parfum { id: string; code: string; nom: string; emoji: string | null; couleur: string | null }
interface Diffuseur { id: string; hotel_id: string | null; room_units: { numero: string } | null }

// Métadonnées d'affichage par parfum (photo produit + description + teinte).
const META: Record<string, { img: string; desc: string; cvar: string }> = {
  figue:      { img: '/parfums/figue.webp',      desc: 'Lactée, douce, enveloppante.', cvar: 'var(--figue)' },
  petitgrain: { img: '/parfums/petitgrain.webp', desc: 'Vert, frais, hespéridé.',      cvar: 'var(--petit)' },
  thenoir:    { img: '/parfums/thenoir.webp',    desc: 'Fumé, boisé, feutré.',         cvar: 'var(--thenoir)' },
};
const metaOf = (p: Parfum) => META[p.code] ?? { img: '', desc: '', cvar: p.couleur ?? 'var(--brand)' };

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function departLabel(nights: number) {
  const d = new Date();
  d.setDate(d.getDate() + nights);
  return cap(new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(d)) + ' 12 h 00';
}
// Autorise les custom properties CSS (--c) dans style.
const vars = (o: Record<string, string>) => o as React.CSSProperties;

function Choix() {
  const params = useSearchParams();
  const router = useRouter();
  const diffuseurId = params.get('diffuseur') ?? '';

  const [loading, setLoading] = useState(true);
  const [parfums, setParfums] = useState<Parfum[]>([]);
  const [diffuseur, setDiffuseur] = useState<Diffuseur | null>(null);
  const [choix, setChoix] = useState<Parfum | null>(null);
  const [nights, setNights] = useState(2);
  const [envoi, setEnvoi] = useState(false);
  const [fait, setFait] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, d] = await Promise.all([
        supabase.from('parfums').select('*').eq('actif', true).order('ordre'),
        diffuseurId
          ? supabase.from('diffuseurs').select('id,hotel_id,room_units(numero)').eq('id', diffuseurId).single()
          : Promise.resolve({ data: null }),
      ]);
      const list = (p.data as Parfum[]) ?? [];
      setParfums(list);
      setChoix(list[0] ?? null);
      setDiffuseur((d.data as unknown as Diffuseur) ?? null);
      setLoading(false);
    })();
  }, [diffuseurId]);

  async function confirmer() {
    if (!choix || !diffuseur) return;
    setEnvoi(true);
    const { error } = await supabase.from('consignes_parfum').insert({
      hotel_id: diffuseur.hotel_id,
      diffuseur_id: diffuseur.id,
      parfum_id: choix.id,
      mode: 'sejour',
      nuits: nights,
      source: 'client',
    });
    setEnvoi(false);
    if (error) { toast.error(error.message); return; }
    setFait(true);
  }

  // Une fois le check-in fait, on laisse voir la confirmation puis on ramène la
  // réception sur l'accueil (grille de toutes les chambres) — prêt pour le suivant.
  useEffect(() => {
    if (!fait) return;
    const t = setTimeout(() => router.push('/parfums'), 3000);
    return () => clearTimeout(t);
  }, [fait, router]);

  if (loading) return (
    <div className={styles.wrap}><div className={styles.center}>
      <Loader2 className="w-6 h-6 animate-spin" /></div></div>
  );
  if (!diffuseur) return (
    <div className={styles.wrap}><div className={styles.center}>
      Diffuseur introuvable. Ouvrez cette page depuis la fiche d&apos;une chambre.</div></div>
  );

  const numero = diffuseur.room_units?.numero;
  const dep = departLabel(nights);

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

        {fait ? (
          <div className={styles.done} style={vars({ '--c': metaOf(choix!).cvar })}>
            <div className={styles.ripple} />
            <div className="w-14 h-14 rounded-full bg-emerald-500/90 mx-auto flex items-center justify-center relative" style={{ marginBottom: 4 }}>
              <Check className="w-7 h-7 text-white" />
            </div>
            <h2 className={styles.doneH}>Chambre {numero}, en {choix!.nom}.</h2>
            <p className={styles.doneP}>Diffusion jusqu&apos;au départ {dep.replace(' 12 h 00', ' 12 h')} — matin et soir, en douceur.</p>
            <div className={styles.tag}>Bouffée d&apos;accueil envoyée</div>
            <div style={{ marginTop: 24 }}>
              <button className={`${styles.btn} ${styles.ghost}`} onClick={() => router.push('/parfums')}>Retour aux chambres</button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.eyebrow}>Arrivée{numero ? ` · Chambre ${numero}` : ''}</div>
            <div className={styles.hero}>
              <h1>L&apos;accueil<span>commence par une odeur.</span></h1>
            </div>
            <p className={styles.lede}>Une belle bouffée est diffusée dès maintenant. La chambre reste ensuite délicatement parfumée, matin et soir, jusqu&apos;au départ — puis s&apos;arrête d&apos;elle-même.</p>

            <div className={styles.scents}>
              {parfums.map((p) => {
                const m = metaOf(p);
                const on = choix?.id === p.id;
                return (
                  <button key={p.id} className={styles.scent} data-on={on ? '1' : '0'}
                    style={vars({ '--c': m.cvar })} onClick={() => setChoix(p)}>
                    <span className={styles.tick}>✓</span>
                    <span className={styles.shot} style={m.img ? { backgroundImage: `url(${m.img})` } : { background: m.cvar }} />
                    <span className={styles.body}>
                      <span className={styles.nm}>{p.nom}</span>
                      <span className={styles.ds}>{m.desc || (p.emoji ?? '')}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className={styles.bar}>
              <div>
                <div className={styles.fieldlab}>Durée du séjour</div>
                <div className={styles.stepper}>
                  <button aria-label="Une nuit de moins" onClick={() => setNights((n) => Math.max(1, n - 1))}>−</button>
                  <span className={styles.val}>{nights}{nights > 1 ? ' nuits' : ' nuit'}</span>
                  <button aria-label="Une nuit de plus" onClick={() => setNights((n) => Math.min(30, n + 1))}>+</button>
                </div>
              </div>
              <div className={styles.depart}>
                <div className={styles.departBig}>{dep}</div>
                <div className={styles.departSm}>fin de diffusion · départ</div>
              </div>
            </div>

            <div className={styles.ctaRow}>
              <span className={styles.hint}>
                {choix ? <><b>{choix.nom}</b> · {nights}{nights > 1 ? ' nuits' : ' nuit'} · départ {dep.replace(' 12 h 00', ' 12 h')}</> : 'Sélectionnez un parfum.'}
              </span>
              <button className={styles.btn} disabled={!choix || envoi} onClick={confirmer}>
                {envoi && <Loader2 className="w-4 h-4 animate-spin" />} Diffuser l&apos;accueil
              </button>
            </div>
            <p className={styles.note}>La bouffée d&apos;accueil part au clic — déclenchez-la 1 à 2 min avant que le client monte : il entre sur l&apos;odeur, plus sur le bruit.</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function ChoixPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>}>
      <Choix />
    </Suspense>
  );
}
