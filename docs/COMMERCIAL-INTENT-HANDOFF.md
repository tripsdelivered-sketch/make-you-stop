# Make You Stop — Commercial Intent Handoff

Status: implementation branch only. Do not deploy until the Stripe, Tally and Make mappings below are configured and checked.

## Goal

Preserve the customer's lightweight storefront selections and combine them with the paid product and the deeper Tally brief before the existing Make production router.

Target:

Landing page intent
→ Stripe Payment Link
→ canonical Cloudflare order/job
→ customer-specific Tally intake
→ Cloudflare production context
→ existing Make pre-router/router
→ existing product lane

## 1. Storefront intent

Before redirecting to Stripe, POST to:

`POST https://make-you-stop-upload.tripsdelivered.workers.dev/api/shop-intents`

Example:

```json
{
  "audience": "creator",
  "niches": ["Creator / Personal Brand"],
  "needs": ["help_planning_content"],
  "goal": "Build consistent social content",
  "product_key": "guide_ebook",
  "source": "website"
}
```

Response includes `intent_id`.

Append that ID to the selected Stripe Payment Link as:

`?client_reference_id=<intent_id>`

Stripe returns `client_reference_id` on the completed Checkout Session.

## 2. Stripe post-payment redirect

Configure the Payment Link after-completion redirect as:

`https://make-you-stop-upload.tripsdelivered.workers.dev/intake-start?session_id={CHECKOUT_SESSION_ID}`

The redirect is not the fulfilment trigger. Stripe/Make remains responsible for creating the canonical order/job from the paid event.

The intake-start route waits until the paid checkout session has been attached to an order, then creates a short-lived intake token and redirects the customer to the existing Tally form.

## 3. Make — Stripe Order Ingress

Keep the current dynamic product resolver/order expansion.

Module #8 Order Expansion must additionally pass:

- `client_reference_id = {{2.body.client_reference_id}}`
- `checkout_session_id = {{2.body.id}}`
- existing `product_key = {{7.data.product_key}}`
- existing request/customer/brand fields

Recommended body shape:

```json
{
  "product_key": "{{7.data.product_key}}",
  "request_type": "new",
  "customer_id": "cust_{{substring(sha256(ifempty(2.body.customer;2.body.customer_details.email));0;24)}}",
  "brand_id": "{{ifempty(2.body.metadata.brand_id;null)}}",
  "client_reference_id": "{{2.body.client_reference_id}}",
  "checkout_session_id": "{{2.body.id}}",
  "stripe_event_id": "{{1.id}}",
  "stripe_event_type": "{{1.type}}"
}
```

Do not hard-code product or lane values.

## 4. Tally hidden context

Existing Creative Marketing Request remains the customer-facing intake.

Add hidden fields only:

- `intake_token`
- `order_id`
- `job_id`
- `product_key`

Do not ask the customer to re-enter these.

The intake-start route populates them through the Tally URL.

## 5. Tally submission binding

On Tally webhook receipt, use the hidden `intake_token` to POST the customer submission payload to:

`POST https://make-you-stop-upload.tripsdelivered.workers.dev/intake/<intake_token>`

Cloudflare stores the submission against the canonical order/job and marks the job `production_ready`.

## 6. Combined production context

Before the existing Make pre-router, retrieve:

`GET /api/jobs/<job_id>/production-context`

using the existing Worker Upload API-key connection.

The response combines:

- canonical job/product/lane
- customer/order context
- storefront `shopping_intent`
  - audience
  - niches
  - needs
  - goal
  - source
- Tally intake payload
- approved/uploaded assets

This joined object is the source of truth presented to the existing creative intelligence/router.

## 7. What stays unchanged

Do not redesign the product lanes.

Preserve:

- shared pre-router #142
- router #158
- Hooks #160
- Image / Words #193
- Video / Reel #23
- Storyboard / Showcase #159
- existing Guide / Mini eBook production path
- Creatomate video spine
- Canva presentation/render paths where already proven

## 8. Safety rule

The storefront intent is routing/context, not permission to invent customer facts.

The engine may use it to understand who the customer is, their niche, stated need and purpose. Detailed claims, exact topic/content, CTA, assets and other facts still come from the customer brief or approved sources.

## Current implementation branch

`commercial-intent-handoff`

Backend code on this branch now supports:

- shopping-intent creation
- Stripe client-reference binding during order expansion
- shopping intent in production context
- paid checkout-session → canonical Tally intake redirect

No production deployment has been performed.
