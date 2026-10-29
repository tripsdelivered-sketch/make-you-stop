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
- `what_to_say_guide`
- `storyboard`
- `storyboard_showcase`
- `guide_ebook`
- `unboxing_product_reveal`

`what_to_say_guide` is a standalone counted product for written natural communication guidance: what to say, how to say it naturally, scene/image talking cues, delivery/tone guidance, payoff/CTA and estimated speaking time where relevant. It is written guidance only and does not sell or generate customer audio.

`video_reel` currently retains the legacy non-counting `suggested_voice_script` support job for compatibility. That legacy support capability is the predecessor/alias of the customer-facing **What to Say Guide** and can later be normalised to the same component contract when the separate Make scenario is integrated. When included inside another purchased product it remains non-counting; when purchased as `what_to_say_guide` it is one primary counted deliverable.

`storyboard_showcase` remains one counted purchased deliverable and records Storyboard + Showcase as required components at the manifest level.

Bundle/package products are intentionally not guessed or auto-seeded until their exact purchased contents are approved.

### New D1 support tables

The orchestration module lazily creates:

- `product_manifests`
- `stripe_product_mappings`
- `job_context`
- `intake_tokens`
- `intake_submissions`
- `stripe_ingress_events`

`job_context` extends the existing jobs model with stable orchestration metadata including primary/support role, counted/non-counting status, parent job, canonical `deliverable_id`, lane, sequence, delivery order and manifest version. Primary jobs receive a deterministic deliverable ID. Support jobs inherit the canonical parent deliverable ID so `/api/components` can attach support output to the correct purchased deliverable without Make inventing IDs. Compatible fields are also mirrored into the existing `jobs` table where those columns exist.

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

Authenticated. Returns production-ready jobs ordered by order and sequence. This provides a clean boundary for Make to consume canonical Cloudflare job context rather than reconstructing order/job relationships from Tally fields. The queue can now be narrowed with `product_key` and `requested_lane` query parameters, in addition to the existing `role` and `component_type` filters, so a lane-specific Make scenario can consume only its own jobs.

When a normalized job is durably stored through `POST /api/deliverables/complete` or `POST /api/components`, the Worker now marks the matching `job_context.status` as `complete`. This prevents completed normalized jobs from remaining in the production-ready queue and being repeatedly picked up by Make.

### Migration safety

During migration:

1. Keep proven creative/render lanes unchanged.
2. Keep existing lane emails active.
3. Keep the Hooks-only Stripe values as fallback until generalized product resolution is verified.
4. Configure Stripe product/price mappings before removing fallback behavior.
5. Route new Storyboard, Storyboard + Showcase and Unboxing lanes only after their Make contracts are built.
6. Customer-facing **What to Say Guide** remains written-only. It may be purchased standalone as one counted primary deliverable, or included inside another product as a non-counting supporting component. No customer AI voice/audio is sold. The existing separate Suggested Voice Script scenario is retained as the legacy implementation to be normalised later.
7. Do not expose raw order IDs, job IDs, Stripe Checkout IDs, D1 identifiers or R2 keys in customer-facing intake URLs.

## Storyboard commercial contracts

The active product manifests distinguish two paid products and their exact launch promises:

- `storyboard` / **Storyboard Pack** — USD 19. One counted primary deliverable. Produces 2 storyboard directions, each with hook + emotional angle, a 5-stage story flow, shot/visual direction, payoff + CTA, and simple filming notes. No showcase frames are included.
- `storyboard_showcase` / **Storyboard + Showcase** — USD 29. One counted primary deliverable with required non-counting `storyboard` and `showcase` components. Produces the same 2 storyboard directions, selects the strongest direction, then creates 3–5 showcase frames mapped to meaningful story beats, plus camera/shot guidance, phone filming/framing tips, and payoff + CTA direction.

For Storyboard + Showcase, storyboard and showcase components do not increment `expected_deliverables`; the purchase counts once. The Showcase is downstream of the Storyboard intelligence and must reuse the selected strongest direction rather than generating an unrelated concept.


## Universal customer-supplied media contract

Customer-supplied media is a cross-lane capability, not a Video/Reel-only feature.

The existing private Cloudflare upload system already accepts images, MP4/MOV video and PDFs. Canonical asset identity, provenance, reuse permission and private storage remain owned by Cloudflare/R2/D1. Make remains responsible for deciding how an asset is used creatively.

### Universal intake rule

Every sellable lane may receive customer/brand/creator-supplied media when it is relevant, including:

- product photos and multiple product angles;
- packaging;
- logos and brand assets;
- screenshots;
- MP4/MOV footage already filmed by the customer, creator, UGC creator or brand;
- reference PDFs and supporting files.

A lane must not reject supplied video merely because its final output is not a video. Instead, the lane contract or output adapter must classify the asset's purpose as one of:

- **production footage** — directly usable in the finished output;
- **creative reference** — informs creative intelligence, structure, hooks, story, tone or execution;
- **supporting source** — useful for product/brand truth or presentation but not necessarily embedded;
- **not applicable** — retained in the canonical asset manifest but not used for that deliverable.

### Lane behavior

- **Video/Reel**: may use supplied footage directly as production footage where appropriate.
- **Unboxing/Product Reveal**: may use supplied product footage, creator footage, packaging footage or multiple product assets directly in video production, or as source/reference for image-slide output.
- **Image/Words**: supplied video may be used as creative/reference input; converting arbitrary video into still frames is a separate production capability and must not be assumed unless explicitly implemented.
- **Storyboard / Storyboard + Showcase**: supplied footage may be analysed as reference for what has already been filmed and for planning the next shots/story beats.
- **What to Say Guide**: supplied footage may inform natural delivery, current messaging and product handling; the purchased output remains written guidance.
- **Guide/Mini eBook**: supplied footage may be source/reference material; the purchased output remains the guide/eBook format.
- **Hooks**: supplied footage may be analysed as creative context; the purchased output remains hooks/copy.

### Asset-policy preservation

Existing asset-use policy remains authoritative across lanes:

- supplied_only
- supplied_plus_supporting
- create_visuals

supplied_only must not silently replace real supplied products or footage with generated alternatives. supplied_plus_supporting may add supporting visuals while preserving supplied product truth. create_visuals may generate visuals but must not invent unsupported product claims or substitute a different real product identity.

### Single-product and multi-product rule

A Product Reveal/Unboxing job may represent:

- one product;
- multiple angles of one product;
- packaging plus one product;
- multiple variants;
- multiple separate products;
- a complete product collection or brand range.

Canonical asset metadata should preserve enough grouping/provenance for Make to distinguish those cases. Cloudflare stores identity/provenance/grouping; Make/#525 decides the creative reveal sequence, hook, emotional angle, payoff and CTA.

### Output-format independence

The same canonical asset manifest may feed different finished outputs, including:

- 9:16 short-form MP4 for TikTok, Instagram Reels or YouTube Shorts;
- TikTok photo slides;
- Instagram carousel/image slides;
- creator/UGC treatment;
- polished brand/product reveal treatment.

Creative intelligence should be reusable across output formats. Production/presentation adapters may crop, position, sequence or otherwise prepare assets for the selected format without changing their provenance or inventing claims.

### Protection rule

Do not rebuild upload storage per lane. Reuse the shared Cloudflare/R2 asset system, carry the canonical asset manifest into Make, and let each lane decide whether each asset is production footage, creative reference, supporting source or not applicable.
