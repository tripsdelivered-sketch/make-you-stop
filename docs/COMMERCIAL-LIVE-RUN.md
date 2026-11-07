# Make You Stop — Commercial Live-Run Rule

## Purpose
Prove every customer-purchasable item through the real commercial path. Do not manually feed isolated production modules just to create a passing test.

## Locked customer flow
Landing page → product selection → Stripe → Cloudflare canonical order/job context → existing Creative Marketing Request intake → correct Make lane → finished output → customer delivery.

## Tally rule
Do not redesign the Creative Marketing Request for each product. The purchased product must come from the canonical order/job context. Tally collects the creative brief, customer facts, CTA, platform and permitted assets.

## Per-product proof
For each product:
1. Confirm its canonical product_key in `config/product-catalogue.json`.
2. Add the Stripe Product ID and Price ID.
3. Confirm Cloudflare resolver/order expansion maps that key to the expected job.
4. Make one customer-style purchase.
5. Complete the existing intake as a customer.
6. Let Make route and execute naturally.
7. Verify the finished customer deliverable and delivery.
8. Record checkout session, order_id, customer_id, job_id, parent_job_id if used, deliverable_id and Tally submission ID in the master tracker.
9. Mark approved_for_live_sale only after the real path passes.

## First product
Guide / Mini eBook — `guide_ebook`

First commercial proof brief:
**7-Day Content Reset for Creators**
A simple plan to stop posting randomly and know what to create this week.

Expected storefront promise currently under proof:
- Approx. 5–8 pages
- Cover + structured content
- Polished layout
- Ready-to-send PDF

## Important
Current displayed prices are pre-launch values and are not final economics until explicitly locked.
Upsells, bundles and recurring recommendations come after individual products have passed.
