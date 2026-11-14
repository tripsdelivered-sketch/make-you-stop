# Make You Stop — Selling Flow V1

## Purpose
Get the first real products selling without rebuilding the creative engine.

Customer flow:
Social hook / landing page -> niche -> product -> short intelligent brief -> payment -> canonical Cloudflare order/job -> existing Make lane -> Canva/Creatomate where appropriate -> Cloudflare/R2 -> final delivery.

## Fixed rule
Niche changes creative context, not production architecture. A Beauty Hooks order and a Travel Hooks order both route to the same Hooks lane; the niche and brief change the output.

## Landing-page production brief
Every direct-sale product starts with three shared questions:
- What are you promoting?
- Tell us a little about your brand, business or page.
- What would you like people to know?

The storefront then shows only product-specific fields.

Structured storefront brief fields:
- promotion_subject
- brand_summary
- key_message
- platforms[]
- cta
- destination_url
- asset_status
- filming_plan
- guide_outcome
- must_include
- template_key
- extra_notes

## Canonical product keys
- hooks
- image_words
- what_to_say_guide
- storyboard
- storyboard_showcase
- unboxing_product_reveal
- video_reel
- guide_ebook

Do not use storefront aliases such as hook, what_to_say, or unboxing at the checkout/backend boundary.

## Cloudflare
POST /api/shop-intents stores:
- audience
- niches[]
- selected product key
- structured brief
- source

Stripe client_reference_id carries the returned intent_id.

Order Expansion binds the intent to the canonical order/job.

GET /api/jobs/{job_id}/production-context returns:
- canonical job/order identity
- customer context
- shopping intent
- storefront brief
- later intake submission if required
- asset manifest

## First sale shortcut
For these tested text-based products:
- hooks
- what_to_say_guide

If the storefront brief contains promotion_subject + brand_summary + key_message, Order Expansion converts it into a canonical intake submission and marks the primary job production_ready.

The customer therefore does not need to complete the old generic Tally after payment.

For products that still need protected uploads or extra post-payment information, /intake-start remains available.

## Launch safety
Selling Flow V1 is intentionally one product per checkout. Multi-item cart/order support comes later after package/multi-line manifests are finalized.

Do not activate live checkout until:
1. approved Stripe Product/Price/Payment Link exists for the product;
2. Stripe -> Cloudflare product mapping is confirmed;
3. Payment Link carries client_reference_id;
4. post-payment redirect points to /intake-start?session_id={CHECKOUT_SESSION_ID};
5. Worker branch is deployed;
6. Make Stripe Order Ingress #8 passes client_reference_id and checkout_session_id to Order Expansion;
7. one controlled sandbox purchase reaches production_ready.

## Canva
Canva remains the premium downstream presentation/render layer where proven and appropriate. It does not replace Make creative intelligence or routing.

## First recommended paid path
Hooks first, then What to Say Guide. Both use already-tested lanes and can avoid the old long Tally when the storefront brief is complete.


## Legacy key protection
Cloudflare canonicalizes older storefront/catalogue aliases before routing so historic purchase-key names cannot send the order to the wrong lane:
- hook / hook_pack / personalised_hook -> hooks
- image_words_pack -> image_words
- what_to_say -> what_to_say_guide
- storyboard_pack -> storyboard
- unboxing -> unboxing_product_reveal

New storefront and Stripe mappings should still use the canonical keys.
