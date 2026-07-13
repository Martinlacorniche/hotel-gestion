# Mews — matrice de capacités (écriture)

Balayage du Connector API sur la **démo publique** (`api.mews-demo.com`), client `Hotel Les Voiles Integration INT004073`.

## Découverte (lecture préalable)

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `configuration/get` | config | OK | — |
| `taxEnvironments/getAll` | taxes | OK | — |
| `services/getAll` | services | OK | — |
| `reservations/getAll` | résas existantes | OK | — |
| `resourceCategories/getAll` | catégories | OK | — |
| `ageCategories/getAll` | âges | OK | — |
| `rates/getAll` | tarifs | OK | — |
| `services/getAvailability` | disponibilité | OK | — |
| `orderItems/getAll` | lignes existantes | OK | — |

## Borne de self check-in

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `customers/add` | créer le profil client | OK | — |
| `customers/update` | compléter le profil | OK | — |
| `reservations/price` | chiffrer un séjour | OK | — |
| `reservations/add` | réserver (séjour en cours) | OK | — |
| `reservations/add` | réserver (séjour futur) | OK | — |
| `resources/getAll` | chambres | OK | — |
| `resourceCategoryAssignments/getAll` | chambres par catégorie | OK | — |
| `reservations/update` | attribuer la chambre | OK | — |
| `reservations/start` | CHECK-IN | OK | — |
| `reservations/process` | CHECK-OUT | OK | — |
| `reservations/updateInterval` | décaler les dates | OK | — |
| `reservations/cancel` | annuler la réservation | OK | — |

## Outil réception / consignes

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `resources/update` | chambre inspectée (housekeeping) | OK | — |
| `serviceOrderNotes/add` | poser une note de séjour | OK | — |
| `serviceOrderNotes/update` | corriger la note | OK | — |
| `serviceOrderNotes/delete` | supprimer la note | OK | — |
| `tasks/add` | créer une tâche | OK | — |
| `tasks/close` | clore la tâche | OK | — |
| `resources/getAll` | chambres | OK | — |
| `resourceBlocks/add` | bloquer une chambre (travaux) | OK | — |
| `resourceBlocks/delete` | débloquer la chambre | OK | — |

## POS Rooftop / facturation

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `bills/add` | ouvrir une note | OK | — |
| `orders/add` | imputer une consommation | OK | — |
| `payments/addExternal` | encaisser (TPE) | OK | — |
| `payments/addExternal` | rembourser (paiement négatif) | OK | — |
| `payments/addExternal` | encaisser (à annuler) | OK | — |
| `payments/updateState` | annuler un paiement (erreur de saisie) | OK | — |
| `paymentRequests/add` | demander un paiement (lien) | OK | — |
| `orders/add` | imputer une conso à tort | OK | — |
| `orderItems/getAll` | relire les lignes | OK | — |
| `orderItems/cancel` | annuler la ligne | OK | — |
| `bills/close` | clôturer la note | OK | — |
| `bills/getPdf` | éditer la facture PDF | OK | — |

## Yield / RMS interne

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `rates/updatePrice` | pousser un prix | OK | — |
| `restrictions/set` | poser une restriction (2 nuits mini le week-end) | OK | — |
| `restrictions/clear` | lever la restriction | OK | — |
| `services/updateAvailability` | ajuster la disponibilité | OK | — |
| `services/updateAvailability` | rétablir la disponibilité | OK | — |

_47/47 appels en succès._
