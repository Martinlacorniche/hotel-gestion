# Mews — matrice de capacités (complément)

Balayage du Connector API sur la **démo publique** (`api.mews-demo.com`), client `Hotel Les Voiles Integration INT004073`.

## Découverte

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `configuration/get` | config | OK | — |
| `services/getAll` | services | OK | — |
| `reservations/getAll` | résas | OK | — |
| `resourceCategories/getAll` | catégories | OK | — |
| `rates/getAll` | tarifs | OK | — |
| `orderItems/getAll` | lignes existantes | OK | — |

## Rapports & comptabilité

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `accountingItems/getAll` | écritures comptables | OK | — |
| `ledgerBalances/getAll` | balances des grands livres | OK | — |
| `customers/getOpenItems` | encours client | OK | — |
| `taxations/getAll` | taxations | OK | — |
| `departments/getAll` | départements | OK | — |
| `exports/add` | demander un export | OK | — |

## POS — transfert de charge

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `customers/add` | client de passage au bar | OK | — |
| `bills/add` | ouvrir la note du bar | OK | — |
| `orders/add` | conso posée au bar | OK | — |
| `orderItems/getAll` | retrouver la ligne | OK | — |
| `bills/add` | ouvrir la note de la chambre | OK | — |
| `accountingItems/update` | TRANSFÉRER la conso sur la chambre | OK | — |

## Groupes, allotements, sociétés

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `availabilityBlocks/add` | créer un allotement | OK | — |
| `availabilityBlocks/update` | modifier l'allotement | OK | — |
| `services/getAvailability` | disponibilité pour le bloc | OK | — |
| `services/updateAvailability` | affecter des chambres au bloc | OK | — |
| `availabilityBlocks/delete` | supprimer l'allotement | OK | — |
| `companies/add` | créer une société | OK | — |
| `companies/update` | modifier la société | OK | — |
| `companies/delete` | supprimer la société | OK | — |
| `billingAutomations/getAll` | lire les automations de facturation | OK | — |

## RMS avancé

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `rates/add` | créer un tarif | OK | — |
| `rates/delete` | supprimer le tarif | OK | — |
| `serviceOverbookingLimits/set` | autoriser 1 surbooking | OK | — |
| `serviceOverbookingLimits/getAll` | relire les limites | OK | — |
| `serviceOverbookingLimits/clear` | lever le surbooking | OK | — |

## Réception & housekeeping

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `resources/getOccupancyState` | état d'occupation des chambres | OK | — |
| `customers/add` | client doublon (source) | OK | — |
| `customers/add` | client doublon (cible) | OK | — |
| `customers/merge` | fusionner deux profils | OK | — |

## Périphériques (encodeur de clefs)

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `devices/getAll` | périphériques déclarés | OK | — |
| `commands/addKeyCutter` | encoder une clef | OK | — |

_38/38 appels en succès._
