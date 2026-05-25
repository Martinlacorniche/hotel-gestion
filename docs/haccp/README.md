# Module HACCP — automatisation des relevés température

> Démarrage : 2026-05-15 — Phase **POC sur 1er hôtel** avant déploiement sur les 2 sites.

## Objectif

Automatiser le HACCP des 2 hôtels (activité quasi exclusivement petit-déj) :
- Suivi continu température des frigos / vitrines / chambre froide / congélateur
- Saisie mobile rapide pour le reste (DLC, nettoyage, réception, températures buffet)
- **Génération automatique du registre HACCP mensuel** en PDF (pièce maîtresse pour contrôle DDPP)
- Archivage 2 ans

Cible : zéro effort opérationnel quotidien, dossier prêt à sortir en cas de contrôle.

## Matos (par hôtel)

| Qté | Article | Source | Prix unitaire | Total |
|---|---|---|---|---|
| 8 | Sonde Zigbee Tuya **ZT01** (sonde déportée -40°C/+120°C, ±1°C, piles AAA) | AliExpress | 13,39€ | ~107€ |
| 1 | Dongle Zigbee USB **Sonoff ZBDongle-E** (EFR32MG21) | AliExpress | 23,39€ | ~23€ |
| 16 | Piles AAA Lithium **Energizer L92** (obligatoire — alcalines exclues) | — | ~1,5€ | ~25€ |
| 1 | Mini-PC Linux Debian/Ubuntu (déjà en place dans chaque hôtel) | — | — | 0€ |

**Total ~155€ par hôtel.**

### Pourquoi ces choix

- **Zigbee plutôt que WiFi Tuya** : données 100 % locales, pas de dépendance au cloud Tuya chinois. Indispensable pour la traçabilité HACCP (si le cloud coupe, on perd des relevés = trou dans le registre = problème en contrôle).
- **Sonde déportée** : le boîtier reste hors-frigo (radio + pile OK), seule la sonde inox est dans le frigo. Passage par le joint de porte, pas de perçage.
- **Piles Lithium L92** : tiennent 12-18 mois (vs 3-4 mois en alcalines) et supportent -40°C. Rentable vu 16 piles × 2 hôtels.
- **Sonoff ZBDongle-E** : pas le ZBDongle-P (obsolète). Le "Plus-E" a un amplificateur, meilleure portée. Compatible Zigbee2MQTT out-of-the-box.

## Architecture

```
┌─ Hôtel (×2) ─────────────────────────────────────────────┐
│                                                          │
│  ┌─ Frigo ─┐  ┌─ Vitrine ─┐  ┌─ Chambre froide ─┐  ...   │
│  │ sonde   │  │  sonde    │  │  sonde           │        │
│  └────┬────┘  └─────┬─────┘  └────────┬─────────┘        │
│       │             │                 │  Zigbee 3.0      │
│       └─────────────┴─────────────────┘                  │
│                     │                                    │
│       ┌─────────────▼──────────────┐                     │
│       │  Mini-PC Linux             │                     │
│       │  ┌──────────────────────┐  │                     │
│       │  │ Sonoff ZBDongle-E    │  │                     │
│       │  │   ↓                  │  │                     │
│       │  │ Zigbee2MQTT (Docker) │  │                     │
│       │  │   ↓ MQTT             │  │                     │
│       │  │ Mosquitto (Docker)   │  │                     │
│       │  └──────────┬───────────┘  │                     │
│       └─────────────┼──────────────┘                     │
└─────────────────────┼────────────────────────────────────┘
                      │ MQTT over WAN (TLS)
                      ▼
       ┌────────────────────────────────┐
       │  siteconsignes (Next.js)       │
       │  - Worker MQTT subscriber      │
       │  - Tables HACCP (Postgres)     │
       │  - Dashboard temps réel        │
       │  - Génération PDF mensuel      │
       │  - Alertes push/email/SMS      │
       └────────────────────────────────┘
                      ▲
                      │ saisie terrain
       ┌──────────────┴─────────────────┐
       │  App-Consignes (Expo)          │
       │  - DLC matin                   │
       │  - Plan de nettoyage           │
       │  - Réception marchandises      │
       │  - Températures buffet         │
       └────────────────────────────────┘
```

## Schéma BDD (à créer)

```sql
-- Sondes physiques
CREATE TABLE haccp_sensors (
  id              SERIAL PRIMARY KEY,
  hotel_id        INT NOT NULL REFERENCES hotels(id),
  zigbee_address  TEXT UNIQUE NOT NULL,   -- adresse IEEE Z2M
  location        TEXT NOT NULL,          -- "Frigo cuisine", "Vitrine buffet", etc.
  type            TEXT NOT NULL,          -- 'positive', 'negative', 'ambient'
  temp_min        NUMERIC,                -- seuil bas (alerte si <)
  temp_max        NUMERIC,                -- seuil haut (alerte si >)
  alert_delay_min INT DEFAULT 15,         -- délai avant alerte (anti faux positifs ouverture porte)
  active          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Relevés (haut volume, index obligatoire)
CREATE TABLE haccp_readings (
  id          BIGSERIAL PRIMARY KEY,
  sensor_id   INT NOT NULL REFERENCES haccp_sensors(id),
  temperature NUMERIC NOT NULL,
  humidity    NUMERIC,
  battery     INT,                        -- %
  rssi        INT,                        -- signal Zigbee
  recorded_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON haccp_readings (sensor_id, recorded_at DESC);

-- Alertes (dépassement de seuil > alert_delay_min)
CREATE TABLE haccp_alerts (
  id              SERIAL PRIMARY KEY,
  sensor_id       INT NOT NULL REFERENCES haccp_sensors(id),
  threshold_type  TEXT NOT NULL,          -- 'high', 'low'
  triggered_at    TIMESTAMPTZ NOT NULL,
  resolved_at     TIMESTAMPTZ,
  peak_value      NUMERIC,
  acknowledged_by INT REFERENCES users(id),
  action_taken    TEXT                    -- saisie utilisateur post-incident
);

-- Saisies manuelles (DLC, nettoyage, réception, températures buffet)
CREATE TABLE haccp_manual_entries (
  id          SERIAL PRIMARY KEY,
  hotel_id    INT NOT NULL REFERENCES hotels(id),
  user_id     INT NOT NULL REFERENCES users(id),
  entry_type  TEXT NOT NULL,              -- 'dlc_check', 'cleaning', 'reception', 'buffet_temp'
  data        JSONB NOT NULL,             -- payload variable selon entry_type
  photos      TEXT[],                     -- URLs photos (S3/Supabase)
  recorded_at TIMESTAMPTZ DEFAULT now()
);
```

## Plan de déploiement

```
J+0   commande matos AliExpress (POC 1 hôtel)
J+0→10 dev stack soft pendant la livraison :
        - Docker compose (Z2M + Mosquitto) sur mini-PC
        - Tables BDD
        - Worker MQTT subscriber
        - Dashboard + alertes
        - Génération PDF
J+10  réception → appairage Zigbee → install physique → test
J+24  bilan POC → si OK, commande matos 2e hôtel + déploiement
```

## Points DDPP (réglementation)

- Paquet hygiène CE 852/2004 et 853/2004 : surveillance + enregistrement requis, **pas de précision spécifique imposée** pour suivi continu.
- Norme NF EN 13485 (±0,5°C) concerne les enregistreurs homologués (~150€/sonde) — **non obligatoire** en hôtellerie petit-déj.
- ±1°C accepté en pratique pour suivi continu (le contrôle DDPP regarde surtout la régularité du suivi et les actions correctives en cas de dépassement).
- Garder un **thermomètre étalonné de référence** (~30€) en backup si audit lourd.
- Archivage relevés : **2 ans** recommandé (1 an minimum réglementaire).

## Points de mesure POC La Corniche (5 sondes commandées)

| # | Emplacement | Type | Seuil min | Seuil max | Délai alerte |
|---|---|---|---|---|---|
| 1 | Congélateur RS | négatif | — | -15°C | 30 min |
| 2 | Congélateur Pain | négatif | — | -15°C | 30 min |
| 3 | Congélateur Viennoiserie | négatif | — | -15°C | 30 min |
| 4 | Frigo Gauche | positif | -1°C | +4°C | 30 min |
| 5 | Frigo Droit | positif | -1°C | +4°C | 30 min |

Frigo Fruits et Frigo Bar reportés à plus tard (extension simple : ajouter 2 sondes + 2 lignes en BDD).
5 sondes commandées (pas de spare — faire gaffe à la manip lors de l'appairage).

## Scope HACCP complet — les 7 piliers

La température n'est **qu'un pilier sur 7**. Vision globale du projet HACCP :

| # | Pilier | Statut projet | Mode |
|---|---|---|---|
| 1 | **Suivi des températures** (frigos, vitrines, congel, buffet chaud >63°C) | ✅ POC en cours | Auto (Zigbee) |
| 2 | **Traçabilité réception** (T° camion + produits, DLC, lot, fournisseur, photo bon) | À venir | App mobile |
| 3 | **DLC quotidiennes** (check-list matinale + rotation FIFO) | À venir | App mobile |
| 4 | **Plan de nettoyage et désinfection** (planning par zone, FT/FDS produits) | À venir | App mobile + papier (FT/FDS) |
| 5 | **Hygiène du personnel** (formation HACCP obligatoire 1/site, tenues, lavage mains, absences) | À venir | App + formation présentielle |
| 6 | **Plan de lutte contre les nuisibles** (contrat externe ou rondes internes + rapports archivés) | À venir | Contrat externe recommandé |
| 7 | **PMS — Plan de Maîtrise Sanitaire** (doc chapeau obligatoire qui décrit tout ce qui précède) | À rédiger | Doc Word/PDF par hôtel |

### Ordre de mise en place recommandé

1. **Températures** (POC en cours) — c'est le plus visible et le plus chiant à tenir manuellement
2. **Traçabilité/DLC modernisée** (voir section dédiée ci-dessous) — scan EAN + OCR DLC + mini-imprimante DLC après ouverture
3. **Plan de nettoyage** dans App-Consignes — planning par zone + validation employé
4. **PMS rédigé** (template à pré-remplir spécifique petit-déj d'hôtel)
5. **Nuisibles** (souscrire un contrat externe Anticimex/Rentokil ~30-60€/mois) + **affichage procédures hygiène personnel**
6. **PDF mensuel global** : regroupe les 7 piliers en un dossier prêt à sortir au contrôle

## Modules admin (siteconsignes web)

### Plan de Nettoyage (PND)

**Admin (config hôtel)** : zones (cuisine, buffet, salle, frigos, plonge, sols, surfaces, poubelles, sanitaires, etc.) × fréquence (quotidien/hebdo/mensuel) × produit utilisé × rôle responsable.

**Terrain (App-Consignes)** : check-list filtrée par rôle au démarrage de service, validation tap + horodatage + photo optionnelle. Alerte gérant si retard.

**Rapport** : calendrier mensuel par zone (vert/rouge/gris), intégré au dossier de contrôle.

### PMS — Plan de Maîtrise Sanitaire

Document chapeau obligatoire. Approche en 2 niveaux :

1. **Template pré-rempli petit-déj d'hôtel** (à générer une fois) : description activité type, BPH, analyse dangers, CCP, procédures, allergènes 14 majeurs, marche en avant, traçabilité, non-conformités. Martin adapte 20% par hôtel.
2. **Stockage + versioning dans l'app** : upload PDF par hôtel, historique versions, alerte annuelle de révision (la DDPP regarde la fraîcheur).

### Bibliothèque documents

Module upload PDF pour tous les documents annexes obligatoires :

| Catégorie | Exemples |
|---|---|
| Fiches techniques produits ménage | Détergent, désinfectant, dégraissant |
| Fiches données sécurité (FDS) | Obligatoires par la loi |
| Formations HACCP personnel | Certificats employés + dates |
| Contrats nuisibles | Contrat + rapports d'intervention |
| Maintenance équipements | Frigos, four, lave-vaisselle |
| Étalonnage thermomètres | Si thermo de référence acheté |
| Attestations diverses | Eau potable, fournisseurs agréés |

Features : classement par catégorie, recherche, versioning, expiration avec alerte 1 mois avant.

### 🔥 Mode Contrôle DDPP — pièce maîtresse

Vue admin plein écran tactile, accessible en 1 tap. Quand le contrôleur arrive, le gérant ouvre cette vue et navigue avec lui dans les 7 piliers.

**Layout** :
```
HÔTEL [La Corniche]              Période [Mois en cours ▾]   [Exporter PDF]

  1. 🌡️ Températures      ✅ 7 sondes • 3 alertes ce mois     [Détail]
  2. 📦 Traçabilité       ✅ 28 livraisons enregistrées       [Bons]
  3. 🥛 Produits ouverts  ✅ 142 photos horodatées             [Photos]
  4. 🧽 Nettoyage         ✅ 96 % complétion                   [Calendrier]
  5. 👥 Hygiène perso     ✅ 2 employés formés HACCP           [Certificats]
  6. 🐀 Nuisibles         ✅ Contrat actif - 12/04             [Rapports]
  7. 📋 PMS               ✅ Version 2.3 - rév. 03/2026        [Ouvrir]

                    [⬇️ EXPORTER DOSSIER COMPLET PDF]
```

**Export PDF complet en 1 clic** : 30-50 pages structurées = page de garde + sommaire + section par pilier (graphes T°, listes BL, photos DLC, calendrier nettoyage, certificats personnel, rapports nuisibles) + annexes PDFs (PMS, contrats, FT/FDS, certificats). Daté, signé numériquement, prêt à envoyer/imprimer.

**Cas d'usage** :
- Navigation en direct avec le contrôleur (tactile, fluide)
- Envoi mail post-visite si demande complément
- Archivage interne (export trimestriel automatique)

## Traçabilité / DLC — modernisation App-Consignes

Au lieu de faire saisir les DLC à la main (source d'erreurs et de paresse), 3 étages d'automatisation :

### ⚠️ Principe directeur : efficacité opérationnelle

À 7h du matin avec un livreur qui attend, scanner 50 produits = irréaliste. L'effort se déplace de la réception (chronophage) vers l'ouverture du produit (action déjà nécessaire). Le bon de livraison = source de vérité, pas la saisie produit-par-produit.

### Étage 1 — Réception ultra-rapide (~45 sec)
- **Photo unique du bon de livraison** dans l'app
- Signature digitale employé + T° camion (à la louche)
- C'est tout — le livreur repart immédiatement

### Étage 2 — OCR du bon en arrière-plan
- Envoi du bon à **Claude Vision API** (qualité top pour les documents structurés)
- Extraction JSON : produits + quantités + n° lot + DLC + fournisseur + date livraison
- Stockage en BDD + flag des champs douteux pour validation manuelle
- Coût : ~3€/1000 photos = qq € / mois max
- **Validation différée** (1-2 min à un moment calme) : l'employé corrige les 2-3 lignes douteuses, valide en bloc

### Étage 3 — Photo du produit ouvert *(preuve numérique horodatée)*

Pas d'imprimante, pas de scan EAN, pas d'étiquette qui sort. Les employés annotent déjà au marqueur sur les produits ouverts (initiales + date) — c'est l'habitude métier, rien ne la bat en cuisine.

**Workflow** :
- Employé ouvre le produit
- Annote au marqueur sur le produit (initiales + date) → déjà l'habitude
- Ouvre l'app → bouton "Photo produit ouvert"
- Photo du produit (avec le marqueur visible si possible) → BDD avec timestamp + employé
- (Option) saisie texte rapide du nom du produit pour faciliter le filtrage

**Preuve en contrôle DDPP** :
- Le produit physique porte son marquage (inspecteur le voit)
- L'app fournit la **photo horodatée** non trafiquable = preuve numérique
- Combo imparable

**Tech** : `expo-image-picker` + upload Supabase Storage, métadata timestamp/user dans `haccp_manual_entries`. Dev ~1 jour.

### Vérification matinale DLC
- Vérification visuelle sur les produits (marqueur lisible, date OK)
- L'app affiche la liste des produits ouverts récents (info, aide à la mémoire, **pas de saisie obligatoire**)
- Rapport quotidien automatique avec photos horodatées disponibles pour audit

## Bilan effort opérationnel quotidien

| Tâche | Méthode papier classique | Avec ce workflow |
|---|---|---|
| Réception livraison | 5-10 min saisie cahier | 45 sec (photo + signature) |
| Saisie DLC produits reçus | 10-15 min | 1-2 min validation OCR |
| Étiquetage DLC après ouverture | 2-3 min (souvent zappé) | 5 sec/produit (marqueur + photo) |
| Check DLC matinal | 5 min visuel approximatif | 2 min visuel + app en référence |
| **Total quotidien** | **~25 min** | **~4 min** |

Matos additionnel : aucun (zéro imprimante, zéro scanner). Le smartphone de l'employé suffit.

### Workflow check matinale DLC
- App sort la liste triée par DLC croissante
- Scan QR rapide sur chaque produit → OK / retrait + photo + raison
- Génération rapport quotidien automatique → intégré au registre HACCP mensuel

## TODO de cadrage (avant commande matos)

- [x] **Choisir l'hôtel POC : La Corniche**
- [ ] Lister précisément les 7-8 points de mesure de La Corniche avec leur seuil min/max
- [ ] Vérifier couverture Internet du mini-PC La Corniche (pour publier vers siteconsignes en remote)
- [ ] Confirmer la stack Docker compatible avec l'OS du mini-PC La Corniche

## Tâches actives

Voir tâches `#1` à `#9` du tracker Claude — POC HACCP, ordonnancement séquentiel commande → dev soft pendant livraison → install → test 2 semaines.
