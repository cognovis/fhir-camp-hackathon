# GOZ fee catalog as FHIR

**Generated for the hackathon, not a billing-grade catalog.** Do not use it to bill
patients. Check every number against the statutory text before relying on it.

| File | What it is |
|---|---|
| `goz-catalog.bundle.json` | The catalog the kit loads: a FHIR R4 transaction Bundle with 215 GOZ `ChargeItemDefinition`s, the GOZ `CodeSystem`, the hackathon rule set and the catalog edition (both `Library`). `npm run setup` loads it into Aidbox; the billing check reads it as a file. |
| `source/goz-adapter-output.json` | The output of one run of the cognovis GOZ converter, wrapped in a collection Bundle; only the internal `meta.source` and tag system identifiers were renamed to `urn:cognovis:*`. Kept so the conversion step below can be followed and repeated. |

## Where the data comes from

The source is the official GOZ text as XML from the German Federal Ministry of Justice
(<https://www.gesetze-im-internet.de/goz_1987/xml.zip>, build 20260506175028,
zip sha256 `93e6165f5a8342fed1fe3f61a4bebb2df3e7643c3c407b77a23edbe77733a805`).
The cognovis converter decoded Anlage 1 (numbers, descriptions, points) into FHIR. Only its
output is in this repository; the converter itself is not public.

`billing/build-catalog.mjs` turns that output into `goz-catalog.bundle.json`
(`npm run build-catalog`). It changes the price representation, ids and versions, and adds
the rule set, as described below.

## How a price is represented

GOZ § 5 prices a service as *points x point value (5.62421 cent) x multiplier*, rounded to
cents. Each `ChargeItemDefinition` carries:

```json
"priceComponent": [
  { "type": "base", "amount": { "value": 11.25, "currency": "EUR" } },
  { "type": "informational", "code": { "coding": [{ "code": "points" }] }, "factor": 200 },
  { "type": "informational", "code": { "coding": [{ "code": "point-value" }] }, "factor": 0.0562421 }
]
```

- `base.amount` is the single fee (points x point value, at multiplier 1.0), rounded to cents.
  This is what the Billing SDK reports as a line's `unitPrice`.
- The `points` and `point-value` components keep the exact inputs. For the exact fee at a
  multiplier, compute `round(points x point value x multiplier, 2)` yourself, as
  `billing/cost-plan.mjs` does. Multiplying the rounded single fee instead can be off by
  a cent.
- The multiplier is not in the catalog. A planned `ChargeItem` carries it in
  `factorOverride` (typically 2.3).
- Six numbers have no points of their own (0120, 2230, 2240, 5050, 5060, 5240: GOZ prices
  them as a share of another number). They have no price, and the SDK answers
  `unavailable` for a line that uses them.

Example, GOZ 0030 (cost plan), 200 points: single fee 11.25 EUR; at multiplier 2.3,
round(200 x 0.0562421 x 2.3, 2) = 25.87 EUR.

### Why not the converter's representation

The converter writes the points as `factor` and the point value as `amount`
(`{ "type": "base", "factor": 200, "amount": { "value": 0.0562421 } }`). Billing SDK 0.35.0
reads that differently from what it means:

1. The SDK accepts money values with at most two decimals. 0.0562421 has seven, so every
   line evaluates to `unavailable` with `SNAPSHOT_MALFORMED` (`money-invalid`).
2. With the point value rounded to cents, the SDK reports `unitPrice` = 0.06 EUR and
   ignores the points `factor`. That is wrong by a factor of 200.

So the kit puts the single fee in `amount` and moves the points and point value to
informational components, which the SDK ignores.

## Other changes compared with the converter output

- Ids become `goz-<number>`. The canonical `url` is kept; the `version` gets the suffix
  `-hackathon.1`, because the content is no longer the converter's.
- Each `ChargeItemDefinition` gets the identifier
  `https://fhir.cognovis.de/billing-core/sid/catalog-digest`, which the SDK checks against
  the catalog edition (`DIGEST_MISMATCH` without it).
- The converter's catalog-edition and per-number multiplier-bound `Library` resources are
  replaced by one edition (`Library/goz-hackathon-edition`) that lists every definition plus
  the hand-written rule set (`Library/goz-hackathon-rules`, see `billing/README.md`). The
  multiplier bounds (1.0 to 3.5, justification above 2.3) are one rule of that rule set.
- Every resource carries the meta tag `HTEST` (test health data).
