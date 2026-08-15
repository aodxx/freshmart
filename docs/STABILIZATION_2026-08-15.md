# FreshMart Stabilization — 15 August 2026

This checkpoint follows the current production-development baseline on `main` and focuses on checkout reliability before adding another major feature phase.

## Baseline

- Repository: `aodxx/freshmart`
- Base branch: `main`
- Base commit at branch creation: `6bc1a4b58e92512cb2bdce6e60928852dd03148e`
- Working branch: `agent/stabilize-checkout-reliability`

## Changes in this stabilization

1. Add `orders.checkout_request_id` and a unique customer/request index.
2. Add `place_liff_order_v3` with a transaction advisory lock so a retry for the same checkout request returns the existing order instead of creating another order.
3. Reuse the same checkout request ID in the browser until order creation and slip upload are both complete.
4. Delay LINE admin notification for bank transfer and PromptPay orders until the payment slip has been stored and the payment row is updated successfully.
5. Delete a newly uploaded slip if the payment database update fails, preventing orphaned storage files.
6. Require the payment update to return exactly one row before reporting slip upload success.
7. Replace broad customer-facing `select("*")` reads in LIFF bootstrap/order history with explicit field lists.
8. Add static regression tests covering request-id reuse, database idempotency, slip cleanup/notification order, and wildcard-select removal.

## Deployment order

Backend changes must be deployed before the updated checkout frontend is published:

1. Apply `supabase/migrations/20260815130000_checkout_reliability.sql` to the FreshMart Supabase project.
2. Deploy `supabase/functions/liff-api/index.ts`.
3. Run the existing test suite plus `tests/checkout-reliability.test.mjs`.
4. Smoke-test one cash order, one PromptPay order, one transfer order, and a deliberate retry using the same checkout request ID.
5. Publish/Merge the frontend only after steps 1–4 pass.

## Acceptance checks

- Retrying the same checkout request does not create a second order.
- Transfer/PromptPay does not alert Admin before slip persistence succeeds.
- Failed payment-row update removes the just-uploaded file.
- Cash/pay-at-store orders still alert Admin immediately after order creation.
- Customer order history still renders with the explicit field projection.
