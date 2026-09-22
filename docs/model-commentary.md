# Model commentary

Curated public posts sit under a model page, below the square logo card. They are quotations, not AI Charts measurements.

## Why a checked store

v1 does not scrape X, load `widgets.js`, or keep X API secrets in CI. Official embed scripts would also break the cookieless analytics contract. The checked JSON is an allowlist: each tweet is copied once from a public status and reviewed with the rest of the catalog.

## How to add a note

1. Confirm the model has a catalog identity in `data/model-card-catalog.json` (or an Index-only page whose `canonicalModelId` matches).
2. Open the public status on `x.com` or `twitter.com`. Copy the handle, numeric status id, author display name, UTC timestamp, and exact tweet text. Do not invent or paraphrase.
3. Add or extend one note in `data/model-commentary.json`:

```json
{
  "canonicalModelId": "xiaomi/mimo-v2-6-pro",
  "tweets": [
    {
      "authorHandle": "deedydas",
      "authorName": "Deedy",
      "lang": "en",
      "postedAt": "2026-09-22T07:07:27.000Z",
      "statusId": "2102293684767412393",
      "text": "Exact public text…",
      "url": "https://x.com/deedydas/status/2102293684767412393"
    }
  ]
}
```

4. Keep at most five tweets per model. The URL must be the public status for that handle and id, with no query or hash.
5. Run the commentary tests. The page and Markdown surfaces read the same store.

## Seed

The first note is Deedy's 22 September 2026 post on Xiaomi MiMo-V2.6-Pro: <https://x.com/deedydas/status/2102293684767412393>.
