# Mews — matrice de capacités (lecture)

Balayage du Connector API sur la **démo publique** (`api.mews-demo.com`), client
`Hotel Les Voiles Integration INT004073`. Les dumps JSON complets sont dans `scripts/mews-certif/dumps/`.

```
node --env-file=.env.mews-demo scripts/mews-certif/sweep-read.mjs
```

⚠️ La démo plafonne les fenêtres de réservation à **100 heures** ; la prod tolère
95 jours. Ne pas conclure de l'une sur l'autre.

## Socle (configuration, chambres, entreprise)

| Opération | Verdict | Objets | Champs renvoyés |
|---|---|---|---|
| `configuration/get` | OK | — | NowUtc, Enterprise, Service, PaymentCardStorage, IsIdentityDocumentNumberRequired |
| `services/getAll` | OK | 495 | Id, EnterpriseId, IsActive, Name, Names, StartTime, EndTime, Options |
| `resources/getAll` | OK | 100 | Id, EnterpriseId, IsActive, ParentResourceId, Name, State, Descriptions, CreatedUtc |
| `resourceCategories/getAll` | OK | 20 | Id, EnterpriseId, ServiceId, IsActive, Type, Classification, Names, ShortNames |
| `resourceBlocks/getAll` | OK | 5 | Id, EnterpriseId, AssignedResourceId, IsActive, Type, StartUtc, EndUtc, CreatedUtc |
| `companies/getAll` | OK | 50 | Id, ChainId, Name, MotherCompanyId, InvoicingEmail, WebsiteUrl, InvoiceDueInterval, NchClassifications |
| `counters/getAll` | OK | 11 | Id, EnterpriseId, Name, IsDefault, Value, Format, Type, CreatedUtc |
| `outlets/getAll` | OK | 50 | Id, IsActive, Name, EnterpriseId, CreatedUtc, UpdatedUtc |

## Borne de self check-in

| Opération | Verdict | Objets | Champs renvoyés |
|---|---|---|---|
| `reservations/getAll` | OK | 100 | Id, ServiceId, GroupId, Number, ChannelNumber, ChannelManagerNumber, ChannelManagerGroupNumber, ChannelManager |
| `reservationGroups/getAll` | OK | 20 | Id, Name, ChannelManager, ChannelManagerGroupNumber, EnterpriseId |
| `customers/getAll` | OK | 50 | Id, ChainId, Number, Title, Sex, Gender, FirstName, LastName |
| `customers/search` | OK | 2071 | Customer, Reservation, Id, FirstName, LastName, RoomNumber, ResourceName |
| `cancellationPolicies/getAll` | KO (400) | — | Invalid ServiceIds. |
| `ageCategories/getAll` | OK | 6 | Id, ServiceId, MinimalAge, MaximalAge, Names, ShortNames, CreatedUtc, UpdatedUtc |

## Yield / RMS interne

| Opération | Verdict | Objets | Champs renvoyés |
|---|---|---|---|
| `rateGroups/getAll` | OK | 18 | Id, ServiceId, IsActive, CreatedUtc, UpdatedUtc, Ordering, Names, ShortNames |
| `rates/getAll` | OK | 100 | Id, GroupId, ServiceId, BaseRateId, IsBaseRate, BusinessSegmentId, IsActive, IsEnabled |
| `rates/getPricing` | OK | 5 | Currency, DatesUtc, TimeUnitStartsUtc, BasePrices, BaseAmountPrices, CategoryPrices, CategoryAdjustments, AgeCategoryAdjustments |
| `restrictions/getAll` | OK | 1 | Id, ServiceId, ExternalIdentifier, Origin, Conditions, Exceptions |
| `services/getAvailability` | OK | 5 | DatesUtc, TimeUnitStartsUtc, CategoryAvailabilities |
| `availabilityBlocks/getAll` | OK | — | AvailabilityBlocks, ServiceOrders, Adjustments, Rates, Cursor |
| `businessSegments/getAll` | OK | 3 | Id, ServiceId, IsActive, Name, CreatedUtc, UpdatedUtc |
| `sources/getAll` | OK | 50 | Id, Name, Type, UpdatedUtc, Code |
| `rules/getAll` | OK | 11 | Id, ServiceId, Conditions, CreatedUtc, UpdatedUtc |

## POS Rooftop / facturation

| Opération | Verdict | Objets | Champs renvoyés |
|---|---|---|---|
| `bills/getAll` | OK | 50 | Id, Name, EnterpriseId, AccountId, AccountType, CustomerId, CompanyId, AssociatedAccountIds |
| `orderItems/getAll` | OK | 100 | Id, EnterpriseId, AccountId, AccountType, ServiceId, ServiceOrderId, Notes, BillId |
| `payments/getAll` | OK | 100 | Id, EnterpriseId, AccountId, AccountType, PaymentRequestId, BillId, ReservationId, AccountingCategoryId |
| `accountingCategories/getAll` | OK | 100 | Id, EnterpriseId, IsActive, Name, Code, ExternalCode, LedgerAccountCode, PostingAccountCode |
| `products/getAll` | OK | 100 | Id, ServiceId, CategoryId, AccountingCategoryId, IsActive, IsDefault, Name, Names |
| `outletItems/getAll` | OK | 50 | Id, EnterpriseId, BillId, AccountingCategoryId, Type, Name, UnitCount, UnitAmount |
| `routingRules/getAll` | OK | 0 | RoutingRules, Cursor |

## Outil réception / consignes

| Opération | Verdict | Objets | Champs renvoyés |
|---|---|---|---|
| `serviceOrderNotes/getAll` | OK | 6 | Id, OrderId, Text, Type, CreatedUtc, UpdatedUtc |
| `tasks/getAll` | OK | 50 | Id, EnterpriseId, Name, State, Description, DepartmentId, ServiceOrderId, CreatedUtc |
| `cashiers/getAll` | OK | 11 | Id, EnterpriseId, IsActive, Name, CreatedUtc, UpdatedUtc |
| `cashierTransactions/getAll` | OK | 0 | CashierTransactions, Cursor |
| `exchangeRates/getAll` | OK | 50 | Id, EnterpriseId, SourceCurrency, TargetCurrency, Value |

_34/35 opérations en succès._
