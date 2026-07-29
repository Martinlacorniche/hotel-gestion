# HotSoft 8 Open API — couverture en lecture

Balayage **en lecture seule** du HotSoft 8 Open API sur le bac à sable de certification (`https://hsapi.hoistcloud.com/DemoHotel1/HotSoftOpenAPI.svc`).

Régénérer avec :

```bash
bash scripts/hotsoft-certif/run.sh sweep-read.mjs
```

Date d'exploitation du bac à sable au moment du balayage : **2024-12-02**
(l'environnement est figé — les fenêtres de dates sont calées dessus, pas sur le jour réel).

> Un KO ici ne signifie pas « impossible » : il peut s'agir d'un nom de paramètre
> encore inconnu, d'une donnée absente du jeu de démo, ou d'une zone non ouverte
> à notre `ProviderKey`. Le jeton porte des `AccessibleAreas` — le périmètre de
> La Corniche devra être revérifié une fois le protocole activé.

## Établissement et configuration

| Endpoint | Ce qu'on en attend | Verdict | Détail |
|---|---|---|---|
| `GetHotel/` | identité, devise, TVA | OK | — |
| `GetHotelDate/` | date d’exploitation | OK | — |
| `GetHotelSettings/` | réglages (champs obligatoires…) | OK | — |
| `Config/Protocols/Get` | protocoles activés sur l’hôtel | OK | 13 ligne(s) |

## Détection de changements

| Endpoint | Ce qu'on en attend | Verdict | Détail |
|---|---|---|---|
| `Config/Monitoring/Get` | tables modifiées depuis le dernier passage | OK | 0 ligne(s) |

## Chambres et gouvernante

| Endpoint | Ce qu'on en attend | Verdict | Détail |
|---|---|---|---|
| `GetRooms/` | inventaire des chambres | OK | 131 ligne(s) |
| `GetRoomTypes/` | catégories | OK | 10 ligne(s) |
| `GetRoomsStatuses/` | statuts ménage disponibles | OK | 6 ligne(s) |
| `Rooms/Class/Get` | classes de chambre | OK | 0 ligne(s) |

## Réservations

| Endpoint | Ce qu'on en attend | Verdict | Détail |
|---|---|---|---|
| `Reservations/Get/Page=1` | arrivées ±30 j | OK | 4230 ligne(s) |
| `Reservations/Get/Page=1` | modifiées depuis 7 j (pivot du polling) | OK | 1653 ligne(s) |
| `Reservations/Deleted/Page=1` | supprimées (invisibles autrement) | OK | 0 ligne(s) — Could not find any reservations. |
| `GetReservationBill/` | note d’un séjour | OK | — |
| `GetAllReservationFolios/` | folios d’un séjour | OK | — |
| `Reservations/Arrangements/Get` | arrangements (pension…) | OK | 0 ligne(s) |

## Borne, fiche de police et clefs

| Endpoint | Ce qu'on en attend | Verdict | Détail |
|---|---|---|---|
| `ReservationCanCheckIn/` | la résa est-elle enregistrable ? | OK | — |
| `GetRegistrationCardDetails/` | fiche de police pré-remplie | OK | — |
| `GetKeyAccessPoints/` | points d’accès encodables | OK | 1 ligne(s) |
| `GetPreCheckInTimeSlots/` | créneaux de pré-enregistrement | OK | 5 ligne(s) |
| `GetRegistrationCardCriteria/` | champs exigés sur la fiche | OK | — |

## Facturation, caisse et comptabilité

| Endpoint | Ce qu'on en attend | Verdict | Détail |
|---|---|---|---|
| `Folios/Get/Page=1` | TOUTES les écritures de l’hôtel sur 1 jour | OK | 326 ligne(s) |
| `GetAllAccounts/` | plan comptable (AccountExport) | OK | 786 ligne(s) |
| `GetAllProducts/` | articles POS (PLU, prix) | OK | 718 ligne(s) |
| `GetAllProductGroups/` | familles d’articles | OK | 39 ligne(s) |
| `GetAllVoucherTypes/` | types de bons | OK | 0 ligne(s) |
| `GetStatistics/` | statistiques agrégées | KO | 502 502 Proxy Error Proxy Error The proxy server received an invalid response from an upstream serve |

## Tarifs et disponibilité

| Endpoint | Ce qu'on en attend | Verdict | Détail |
|---|---|---|---|
| `GetPriceRates/` | grilles tarifaires | OK | 0 ligne(s) |
| `PriceRate/Info/Get/Page=1` | détail des tarifs | OK | 130 ligne(s) |
| `Restrictions/Get/Page=1` | restrictions (stop-sell…) | OK | 0 ligne(s) |
| `GetAvailability/` | disponibilité (⚠️ voir commentaire) | KO | 400 Request Error BODY { color: #000000; background-color: white; font-family: Verdana; margin-left: |

## Référentiels

| Endpoint | Ce qu'on en attend | Verdict | Détail |
|---|---|---|---|
| `Contacts/Get/Page=1` | contacts | OK | 60415 ligne(s) |
| `GetCountries/` | pays | OK | 249 ligne(s) |
| `GetMarketCodes/` | codes marché / segmentation | OK | 32 ligne(s) |
| `GetAllStates/` | états | OK | 33 ligne(s) |

_32/34 endpoints en succès._
