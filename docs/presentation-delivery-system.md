# Make You Stop — Presentation & Delivery System

Status: controlled preview architecture on `selling-flow-v1`.

## Goal

Every paid product receives a lane-specific, premium Make You Stop presentation without manually redesigning each customer order.

The creative engine remains the source of truth for approved customer content. The presentation layer may organise, frame and visually explain that content, but must not rewrite approved deliverables or invent claims.

## Shared brand system

- Ink: #111111
- Cream: #F4EEE5
- Coral: #FF5F4A
- Soft cream: #FFF8F2
- Mobile-first presentation: 1080×1920 / 9:16
- Delivery email: black/coral Make You Stop system
- Niche-specific hero media is variable.
- Core layout and hierarchy are locked per paid lane.

## Product template registry

| product_key | template_key | hero media | intended delivery |
|---|---|---|---|
| hooks | hook_pack_social_first_v1 | niche image / creator mobile visual | PDF |
| image_words | image_words_social_first_v1 | finished Image / Words creative | PDF or image |
| video_reel | video_reel_social_first_v1 | finished vertical video / motion preview | MP4 + companion presentation |
| what_to_say_guide | what_to_say_social_first_v1 | niche creator / speaking visual | PDF |
| storyboard | storyboard_social_first_v1 | storyboard frames / niche visual | PDF |
| storyboard_showcase | storyboard_showcase_social_first_v1 | showcase frames | PDF |
| guide_ebook | guide_ebook_editorial_v1 | editorial niche cover visual | PDF |
| unboxing_product_reveal | unboxing_reveal_social_first_v1 | product reveal visual / motion preview | PDF or video companion |

## Worker endpoints

- `GET /api/presentations/registry`
  - Returns the locked brand system and all lane templates.
- `POST /api/presentations/build`
  - Generic presentation builder.
  - Required: `order_id`, `job_id`, `product_key`.
  - Accepts customer/niche context plus the approved lane output.
- `POST /api/presentations/hooks/build`
  - Backward-compatible Hook Pack builder.
  - Fails closed unless exactly 10 approved hooks are supplied.
- Existing Canva bridge:
  - `POST /api/canva/autofills`
  - `POST /api/canva/exports`
  - `GET /api/canva/exports/{id}/wait`
  - `POST /api/canva/exports/{id}/store`
- Existing secure delivery:
  - `POST /api/download-tokens`
  - `POST /api/return-tokens`
  - `POST /api/delivery-email/build`
  - `GET /api/orders/{order_id}/trace`

## Automation handoff

1. Paid order resolves to canonical `product_key`.
2. Creative Engine produces approved lane output.
3. Make sends the approved output + customer context to `POST /api/presentations/build`.
4. Worker selects the locked lane template contract.
5. Niche-specific hero media is selected/generated only where appropriate.
6. Canva receives the approved presentation fields; Canva must not rewrite approved content.
7. Export is stored in R2.
8. Secure download/open link and return token are created.
9. `POST /api/delivery-email/build` produces the branded customer email.
10. Customer delivery-open and upgrade clicks are tracked.
11. Return/upgrade flow sends the customer back to the Make You Stop landing shop with returned product context highlighted.
12. Order trace keeps jobs, deliverables, events, links and reusable creator/brand context together.

## Hook Pack contract

Paid promise remains:
- 10 personalised hooks
- Different creative angles
- Emotion + curiosity + tension mix
- Top 3 highlighted
- CTA starters + usage direction
- Make You Stop Bonus: Top 3 highlighted + CTA starters + quick usage notes

Presentation may add non-promised supporting value:
- niche hero visual
- your-brief page
- why the hooks are built this way
- first-seconds guidance
- creative-angle explanation
- quick test plan
- clearer, larger hook pages
- CTA and usage pages

These supporting pages are there to improve usability and perceived value. They do not replace or alter the paid 10-hook deliverable.

## Tracking and return flow

Delivery email creates tracked links for:
- opening the finished deliverable
- taking the work further / upgrade return

The secure return page uses the delivered product type to offer relevant next actions. Examples:
- Hook Pack → another Hook Pack / Storyboard / Image-Words / Video-Reel
- Storyboard → Showcase / Video-Reel
- Image-Words → Video-Reel / Storyboard
- Video-Reel → another concept / Storyboard
- all products → different niche or campaign

The landing page reads `return_token` and optional `product`, shows a returning-customer state, and highlights the relevant product. New payment remains a new order.

## Safety / launch rule

Do not mark an order delivered until the real send succeeds.

Do not expose customer email, order ID, job ID or Stripe IDs in public return links.

Do not treat a template contract as proof that an unproven creative lane is production-ready. Presentation support can exist before lane production is proven.

## Current deployment note

These changes live on the protected `selling-flow-v1` preview branch. They are not proof of deployment to production or of a live Make handoff. The protected Make scenarios were not edited or run during this update.
