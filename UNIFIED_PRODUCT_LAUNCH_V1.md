# Unified Product Launch V1

This branch is a safe working layer on top of `selling-flow-v1`.

## Rules
- Existing creative lanes remain the production engine for custom work.
- All eight current products are explicitly `fulfillment_mode: custom`.
- Future ready-made products will use `fulfillment_mode: ready_made` and bypass Make creative production.
- Stripe sandbox is the commercial source for active product/price/payment-link values.
- The focused social page is one reusable template: `product-pages/index.html?product=<product_key>`.
- Upgrades are optional and shown after the main product decision.
- No live Stripe catalogue or production webhook is changed by this branch.

## Current prices
- hooks — US$19
- image_words — US$9
- what_to_say_guide — US$9
- storyboard — US$12
- storyboard_showcase — US$22
- unboxing_product_reveal — US$19
- guide_ebook — US$29
- video_reel — US$39

## Confirmed backend corrections in this branch
- Corrected the seeded Unboxing Stripe product ID to `prod_VaJoG1WjYBIu6L`.
- Updated stale Storyboard offer-contract prices from 19→12 and 29→22.
- Added explicit `fulfillment_mode: "custom"` to all current product manifests.
