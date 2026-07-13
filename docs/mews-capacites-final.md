# Mews — matrice de capacités (dernière passe)

Balayage du Connector API sur la **démo publique** (`api.mews-demo.com`), client `Hotel Les Voiles Integration INT004073`.

## Référentiels

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `configuration/get` | config | OK | — |
| `services/getAll` | services | OK | — |
| `reservations/getAll` | résas | OK | — |
| `rates/getAll` | tarifs | OK | — |
| `products/getAll` | produits | OK | — |
| `countries/getAll` | pays | OK | — |
| `currencies/getAll` | devises | OK | — |
| `languages/getAll` | langues | OK | — |

## Borne — annulation, titulaire

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `cancellationPolicies/getByRates` | conditions d'annulation PAR TARIF | OK | — |
| `cancellationPolicies/getByReservations` | conditions d'annulation PAR RÉSERVATION | OK | — |
| `customers/add` | créer le vrai client | OK | — |
| `reservations/updateCustomer` | CHANGER le titulaire | OK | — |
| `reservations/updateCustomer` | rétablir le titulaire | OK | — |
| `companionships/getAll` | accompagnants | OK | — |

## POS — carte bancaire, empreintes

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `customers/add` | client CB | OK | — |
| `payments/addCreditCard` | consigner un paiement CB | KO (403) | Invalid identifier. (Card payment (Visa ****1111)) |
| `paymentMethodRequests/add` | demander une empreinte CB | OK | — |

## Yield — extras, occupation

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `productCategories/getAll` | catégories d'extras | OK | — |
| `products/updatePrice` | changer le prix d'un extra | OK | — |
| `rates/updateCapacityOffset` | prix selon l'occupation | OK | — |

## Débiteurs société

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `companies/add` | créer la société | OK | — |
| `companyContracts/getAll` | contrats société | OK | — |
| `billingAutomations/add` | créer un routage automatique | OK | — |
| `billingAutomations/delete` | supprimer le routage | OK | — |
| `companies/delete` | supprimer la société | OK | — |

## Serrures / accès

| Opération | Étape | Verdict | Détail |
|---|---|---|---|
| `resourceAccessTokens/getAll` | jetons d'accès aux chambres | OK | — |

_25/26 appels en succès._
