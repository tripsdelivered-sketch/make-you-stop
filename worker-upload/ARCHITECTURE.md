# Make You Stop Cloudflare backend

Cloudflare is the durable business layer. Make remains the creative/intelligence engine.

## Responsibilities

- **D1**: customers, orders, jobs, purchased deliverables, supporting components, completion state, return tokens, download tokens.
- **R2**: durable PDFs, images, videos, storyboards and showcase assets.
- **Worker**: authenticated upload, D1 completion, non-counting components, order manifest, secure downloads, return/upgrade entry.
- **Make**: creative intelligence, generation, rendering, orchestration and ongoing tuning.

## Existing upload compatibility

The original Guide path remains compatible:

`PUT /`

Headers:
- `Authorization: Bearer <UPLOAD_SECRET>`
- `X-Object-Key: guides/{order_id}/{job_id}/{deliverable_id}.pdf`
- `Content-Type: application/pdf`

The same endpoint now accepts these durable file families:

- `guides/.../*.pdf`
- `images/.../*.(png|jpg|jpeg|webp)`
- `videos/.../*.mp4`
- `storyboards/.../*.pdf`
- `showcases/.../*.(pdf|png|jpg|jpeg|webp)`

## Authenticated Make endpoints

All use the same saved Worker API-key connection and `Authorization` header.

### Complete a purchased deliverable

`POST /api/deliverables/complete`

Upserts the deterministic deliverable, then recounts `COUNT(DISTINCT deliverable_id)` in D1 and updates the order without changing `delivery_email_sent_at`.

### Store a non-counting component

`POST /api/components`

Use for included/supporting output such as Suggested Voice Script, or component assets that must not increase `expected_deliverables`.

### Read final order manifest

`GET /api/orders/{order_id}/manifest`

Returns order readiness, completed purchased deliverables and supporting components. Intended for the one-final-email aggregator.

### Recount order

`POST /api/orders/{order_id}/recount`

Canonical D1 completion recount.

### Create safe return/upgrade link

`POST /api/return-tokens`

Returns an opaque Worker return URL. Only a SHA-256 hash is persisted. The public return page exposes no order ID, email, Stripe ID or file identifiers.

### Create secure download link

`POST /api/download-tokens`

Only creates a token when the R2 key belongs to a completed deliverable/component on that order.

## Public endpoints

- `GET /return/{opaque_token}`: safe next-step page; does not provide private file access.
- `GET /download/{opaque_token}`: retrieves one approved private R2 object.
- `GET /health`: non-sensitive service status.

Return tokens and download tokens are intentionally separate.

## Supporting D1 tables

Created lazily by the Worker when first needed:

- `deliverable_components`
- `return_tokens`
- `download_tokens`

Supporting components are non-counting. Purchased deliverables remain the only rows counted toward `orders.expected_deliverables`.

## One-order rule

The final email should be sent only when the manifest reports:

- order status is `complete`
- completed purchased deliverables >= expected deliverables
- `delivery_email_sent_at` is blank

The final email can then contain every purchased output plus non-counting supporting components.
