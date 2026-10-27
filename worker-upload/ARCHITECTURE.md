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


## Canva production bridge

Canva is an optional downstream production/presentation service. It does not replace or modify Make's creative intelligence or proven render lanes.

Worker routes are authenticated with the existing backend Authorization connection except for Canva's OAuth callback:

- `GET /api/canva/status`
- `POST /api/canva/auth/start`
- `GET /canva/oauth/callback`
- `POST /api/canva/designs`
- `GET /api/canva/brand-templates`
- `GET /api/canva/brand-templates/{id}/dataset`
- `POST /api/canva/autofills`
- `POST /api/canva/exports`
- `GET /api/canva/exports/{id}`

The OAuth flow uses PKCE. Access and refresh tokens are encrypted before D1 storage using AES-GCM with a key derived from the existing Worker backend secret. Canva app credentials themselves must be configured as Cloudflare Worker secrets:

- `CANVA_CLIENT_ID`
- `CANVA_CLIENT_SECRET`

No Make lane is connected to Canva automatically. This lets Storyboard, Showcase, Image/Words or other presentation steps adopt Canva one at a time after their existing successful output point.

Canva use should prioritise polished branded presentation, brand-template autofill, design creation and export. Existing Creatomate/video generation paths remain authoritative until a replacement is separately proven.

## Visual memory / anti-repeat layer

Cloudflare can remember visual assets independently of Make and rank reusable assets without repeatedly selecting the same image.

D1 tables:

- `visual_assets`
- `visual_usage`

Authenticated Worker routes:

- `POST /api/visuals` registers customer-supplied, generated, licensed, Canva or partner imagery and its metadata.
- `POST /api/visuals/used` records an actual scene/slide use.
- `GET /api/visuals/candidates?brand_id=...` returns allowed candidates using an unused-first, then least-used, then least-recent policy.
- `GET /api/visuals/recent-usage?brand_id=...` exposes recent usage to the creative engine for anti-repeat decisions.

The first version deliberately handles exact asset reuse rather than claiming perceptual similarity. A later vision/embedding layer can add near-duplicate composition detection without changing Make's creative contracts.

## Safe adoption rule

Every new backend capability is additive:

`proven Make creative lane -> optional presentation/asset service -> R2/D1 -> final delivery`

Do not insert Canva, visual-memory calls, or other backend services into the middle of a proven creative/render spine until a parallel test has passed.
