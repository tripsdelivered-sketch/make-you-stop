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


## Commerce, product manifests and intake orchestration

The Worker now contains an additive orchestration contract for paid products. It does **not** replace Make's creative intelligence or any proven creative/render lane.

### Core product manifests

Seeded canonical product keys:

- `hooks`
- `image_words`
- `video_reel`
- `storyboard`
- `storyboard_showcase`
- `guide_ebook`
- `unboxing_product_reveal`

`video_reel` also defines a non-counting `suggested_voice_script` support job. `storyboard_showcase` remains one counted purchased deliverable and records Storyboard + Showcase as required components at the manifest level.

Bundle/package products are intentionally not guessed or auto-seeded until their exact purchased contents are approved.

### New D1 support tables

The orchestration module lazily creates:

- `product_manifests`
- `stripe_product_mappings`
- `job_context`
- `intake_tokens`
- `intake_submissions`
- `stripe_ingress_events`

`job_context` extends the existing jobs model with stable orchestration metadata including primary/support role, counted/non-counting status, parent job, lane, sequence, delivery order and manifest version. It also mirrors compatible fields into the existing `jobs` table where those columns exist.

### Product resolution

`POST /api/products/resolve`

Authenticated. Resolves an active product manifest from either:

- an explicit staged-migration `product_key`; or
- a configured Stripe price/product/payment-link mapping.

`POST /api/product-mappings`

Authenticated. Registers one Stripe price, product or payment-link ID against a canonical product key. Stripe remains the purchase identifier; Cloudflare/D1 owns the operational manifest.

### Order expansion

`POST /api/orders/{order_id}/expand`

Authenticated. Expands an existing paid order into deterministic primary/support jobs from the canonical manifest.

Properties:

- deterministic job IDs;
- parent/support relationships;
- one counted primary deliverable for single products;
- non-counting Script support job for Video/Reel;
- sequence and delivery order;
- manifest version;
- retry-safe upserts;
- updates `orders.expected_deliverables`;
- writes `expected_manifest_json` when that column exists;
- optional Stripe event recording for idempotency history.

The current Hooks-only Stripe ingress may remain as a compatibility path until this generalized contract is connected and validated.

### Secure intake tokens

`POST /api/intake-tokens`

Authenticated. Creates an opaque, expiring token tied to an order and optionally one job. Raw internal order/job/Stripe identifiers do not need to appear in a public Tally URL.

`GET /api/intake-tokens/{opaque_token}`

Authenticated backend resolution for orchestration/debugging.

`POST /intake/{opaque_token}`

Token-authorized intake submission endpoint. Stores the intake payload, consumes the token and marks the relevant canonical job context production-ready. Support jobs using the parent intake become production-ready with the parent.

### Production-ready job context

`GET /api/jobs/{job_id}/context`

Authenticated. Returns canonical job context, durable order context and the latest applicable stored intake.

`GET /api/jobs/ready`

Authenticated. Returns production-ready jobs ordered by order and sequence. This provides a clean boundary for Make to consume canonical Cloudflare job context rather than reconstructing order/job relationships from Tally fields.

### Migration safety

During migration:

1. Keep proven creative/render lanes unchanged.
2. Keep existing lane emails active.
3. Keep the Hooks-only Stripe values as fallback until generalized product resolution is verified.
4. Configure Stripe product/price mappings before removing fallback behavior.
5. Route new Storyboard, Storyboard + Showcase and Unboxing lanes only after their Make contracts are built.
6. Suggested Voice Script remains written-only, separate-scenario orchestration and non-counting.
7. Do not expose raw order IDs, job IDs, Stripe Checkout IDs, D1 identifiers or R2 keys in customer-facing intake URLs.
