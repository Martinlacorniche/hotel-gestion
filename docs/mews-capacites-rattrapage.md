# Mews — matrice de capacités (rattrapage)

Balayage du Connector API sur la **démo publique** (`api.mews-demo.com`), client `Hotel Les Voiles Integration INT004073`.

## Découverte & référentiels

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `configuration/get` | config | OK | — |
| `services/getAll` | services | OK | — |
| `reservations/getAll` | résas | OK | — |
| `resourceCategories/getAll` | catégories | OK | — |
| `ageCategories/getAll` | âges | OK | — |
| `rates/getAll` | tarifs | OK | — |
| `products/getAll` | produits | OK | — |
| `services/getAvailability` | disponibilité | OK | — |
| `resourceFeatures/getAll` | équipements des chambres | OK | — |
| `resourceFeatureAssignments/getAll` | quelle chambre a quel équipement | OK | — |

## Borne — option, extras, aperçu de facture

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `customers/add` | créer le client | OK | — |
| `reservations/add` | poser une OPTION | OK | — |
| `reservations/confirm` | CONFIRMER l'option | OK | — |
| `reservations/addProduct` | ajouter un extra du catalogue | OK | — |
| `products/getPricing` | prix de l'extra | OK | — |
| `customers/add` | créer un accompagnant | OK | — |
| `reservations/addCompanion` | ajouter l'accompagnant | OK | — |
| `reservations/deleteCompanion` | retirer l'accompagnant | OK | — |
| `reservations/getAllItems` | lignes du séjour (aperçu facture) | OK | — |
| `reservations/cancel` | annuler (nettoyage) | OK | — |

## Réception — notes de fiche client

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `accountNotes/add` | note sur la fiche client | OK | — |
| `accountNotes/getAll` | relire les notes de fiche | OK | — |
| `accountNotes/update` | corriger la note de fiche | KO (500) | Something went wrong on our end. Our team has been notified and is working to fix the issu |
| `accountNotes/delete` | supprimer la note de fiche | OK | — |
| `customers/getRelationships` | relations du profil | OK | — |

## POS — liens de paiement, corrections

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `paymentRequests/add` | envoyer un lien de paiement | OK | — |
| `paymentRequests/getAll` | relire les liens (payé ?) | OK | — |
| `paymentRequests/cancel` | annuler le lien | OK | — |
| `preauthorizations/getAllByCustomers` | empreintes CB en cours | OK | — |
| `bills/add` | ouvrir une note | OK | — |
| `bills/update` | corriger le porteur de la note | OK | — |
| `bills/delete` | supprimer la note vide | OK | — |

## Rapports

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `sourceAssignments/getAll` | origine des réservations | OK | — |
| `productServiceOrders/getAll` | extras vendus | OK | — |

## Yield

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `availabilityAdjustments/getAll` | ajustements de disponibilité | OK | — |

## Périphériques

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `commands/getAllActive` | commandes en cours (encodeur) | OK | — |

_35/36 appels en succès._
