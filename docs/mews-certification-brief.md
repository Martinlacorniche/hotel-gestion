# Mews Connector API — Certification Brief

**Integration name:** Hotel Les Voiles Integration
**Partner ID:** INT004073
**Client parameter (in every API request):** `Hotel Les Voiles Integration INT004073`
**Property:** Hôtel Les Voiles — Toulon, France · EnterpriseId `0a876d46-7b1a-4164-aafa-aaa90086e8bf`
**Contact:** direction@htbm.fr
**Webhook endpoint (live):** https://consigneshtbm.com/api/mews/webhook

---

## 1. What this is

An **in-house** integration, built and operated by Groupe Hôtels Toulon Bord de Mer for its **own single property**. Not a commercial product, not distributed, never listed on the Marketplace. Mews remains the single source of truth for reservations, billing and inventory — we read from it and write back to it.

Four internal modules:

| Module | What it does |
|---|---|
| **Self check-in kiosk** | Guest checks in and out; reads/creates reservations, prices stays, assigns rooms, posts upsells, settles and closes bills, issues the invoice |
| **Rooftop POS** | Posts F&B consumption to guest accounts, records payments captured on our own terminal, transfers charges between bills |
| **Front-desk operations tool** | Arrivals, departures, stay notes, housekeeping tasks, out-of-order rooms; reconciles the daily cash drawer against Mews payments |
| **Internal revenue management** | Reads occupancy, pushes rates, restrictions and availability adjustments back to Mews |

---

## 2. What we exercised on the demo

**128 of the 200 Connector API operations**, all under the Client parameter above, on `api.mews-demo.com`. Not isolated calls — a **full guest journey**, replayed end to end:

> customer profile → price → reservation → room assignment → room inspected → **check-in** → stay note → bar consumption → payment (terminal) → partial refund → mistaken line cancelled → bill closed → **invoice PDF** → **check-out**

plus, on a second reservation: option placed → **confirmed** → dates moved → cancelled. Plus tasks, out-of-order rooms, catalogue upsells, companions, charge transfer between accounts, key-cutter command, and the full yield cycle (rate price pushed, 2-night weekend restriction set then cleared, availability adjusted then restored).

Everything is reproducible:

```
node --env-file=.env.mews-demo scripts/mews-certif/sweep-read.mjs     # 34/35
node --env-file=.env.mews-demo scripts/mews-certif/sweep-write.mjs    # 47/47
node --env-file=.env.mews-demo scripts/mews-certif/sweep-plus.mjs     # 38/38
node --env-file=.env.mews-demo scripts/mews-certif/sweep-gaps.mjs     # 35/36
node --env-file=.env.mews-demo scripts/mews-certif/sweep-final.mjs    # 25/26
```

Full per-endpoint matrices: `docs/mews-capacites-{lecture,ecriture,complement,rattrapage,final}.md`.

---

## 3. What we need from Mews

**a) Real-time.** We subscribed to webhooks (Service Order Updated, Resource Updated, Resource Block Updated, Customer Added/Updated, Payment Updated) and websocket events (Command, Reservation, Resource, Price update). Our endpoint is live and answers 200 to both GET and POST. Without them we would have to poll — which is worse for us *and* for your rate limits.

**b) The path to production** on the real property. The connectivity add-on is confirmed enabled (Milan Bezdecka, 20 July 2026) — we need to know what remains on our side to obtain production credentials.

> **Resolved 23 July 2026 — card payments.** This section previously reported that card payments were disabled on the demo enterprise, `payments/addCreditCard` returning 403 "Invalid identifier" for every card format. That diagnosis was **wrong, and the fault was ours**: the demo enterprise's default currency is **GBP** and we were sending **EUR**, because we read `Enterprise.DefaultCurrencyCode` from `configuration/get` — a field that does not exist in the response (the default is the `IsDefault` entry of `Enterprise.Currencies[]`), so we fell back to a hard-coded EUR. With the correct currency, `payments/addCreditCard` **and** `payments/refund` both succeed. Nothing is needed from Mews here.

---

## 4. Two defects found on your side

| Operation | Symptom |
|---|---|
| `cancellationPolicies/getAll` | Returns **"Invalid ServiceIds"** even when **no** `ServiceIds` is sent — with `RateGroupIds` (ours or Mews'), with `UpdatedUtc` alone, with `CancellationPolicyIds` alone. `ServiceIds` is not among the filters its own error message lists. Re-verified 23 July 2026. Workaround: `getByRates` / `getByReservations`, which both work. |
| `fiscalMachineCommands/getAll` | Returns **"Invalid JSON"** for every body, including an empty one. |

> **Withdrawn 23 July 2026 — `accountNotes/update`.** We reported a constant 500. It was **our** payload: a note carries **one** classification, and we were setting two to `true` in the same update. Setting the previous one explicitly to `false` returns 200 (Milan Bezdecka, Mews). Only the error code was misleading — a 400 naming the constraint would have saved the round trip.

---

## 5. Notes on our call pattern

- We respect the demo interval caps (reservation windows ≤ 100 h on demo, ≤ 95 days in production) and paginate with cursors.
- Calls are spaced (300 ms) in the sweeps; production traffic is event-driven (webhooks) plus a 3-hourly occupancy refresh — not polling loops.
- All time-unit operations are anchored on the **property's local midnight** expressed in UTC (Europe/Paris), not UTC midnight.
- We do **not** request: identity documents, addresses, stored card data, guest messaging, loyalty, vouchers.
