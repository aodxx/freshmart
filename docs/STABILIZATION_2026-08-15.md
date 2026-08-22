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

## Validation record

| Check | Result |
|---|---|
| Source test suite | Passed 93/93, with no failures or skipped tests |
| Request-id database smoke test | Passed in a production transaction that rolled back; duplicate calls returned the same order and decremented stock once only |
| Migration deployment | `checkout_reliability` applied to production; the request-id column, partial unique index, and service-role-only `place_liff_order_v3` were verified |
| Backend deployment | `liff-api` version 10 is active; the previous checkout client remains supported through `place_liff_order_v2` until the frontend is published |
| Payment-slip failure recovery | Non-browser harness verifies that an upload is removed before a payment-update failure is surfaced; no notification is sent on that path |
| Notification timing | Non-browser harness verifies immediate notification eligibility for cash/pay-at-store and delayed eligibility for bank transfer/PromptPay |

### Remaining external integration evidence

The verification above does not send a live LINE push or use a real customer session. These external effects remain intentionally untriggered because the available environment has no test LINE session and no browser fallback. The implementation keeps the pre-existing custom LINE-token verification, and the Edge Function rejects unauthenticated requests.

## Merge gate

PR #24 remains open. The frontend must not be published or merged until the designated Technical Lead approves the Stabilization report and the remaining external-integration evidence is accepted.
