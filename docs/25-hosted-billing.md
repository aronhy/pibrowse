# Hosted team subscriptions (Stripe Sandbox)

Fury uses the Open SaaS Checkout, Customer Portal, and verified webhook flow
with the existing team account. The subscription belongs to the organization.
The desktop opens Stripe in the system browser. After payment, open
**Settings → Team server → Team subscription** and refresh.

The standard self-hosted server and Solo mode require no billing configuration.
This implementation accepts test credentials and Stripe test events only.

## Start a test server

Use a dedicated database and a role without `SUPERUSER` or `BYPASSRLS`.
The role created by the stock Docker Compose file is a PostgreSQL bootstrap
superuser. Use a separate application role for hosted testing.

Create an active, paid, monthly price in Stripe Sandbox. Keep the configured
Price ID fixed for this pilot. Open Checkout sessions retain the original price.
Configure the sandbox Customer Portal for invoices, payment methods, and
cancellation, with plan switching disabled.

Set these values in the server environment:

| Variable | Value |
| --- | --- |
| `FURY_BILLING_MODE` | `hosted` to enable billing, `off` or unset for self-hosting |
| `STRIPE_SECRET_KEY` | Stripe Sandbox secret or restricted key with the required API access |
| `STRIPE_PRICE_ID` | The recurring monthly Sandbox Price ID |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for this Stripe destination or Stripe CLI listener |
| `FURY_BILLING_RETURN_URL` | Your HTTPS page to return to after Checkout or the Portal |

For local tests, forward Stripe CLI events to
`http://127.0.0.1:8080/v1/billing/stripe/webhook` and use the listener's
signing secret. Subscribe to `checkout.session.completed`,
`customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `customer.subscription.paused`,
`customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`,
`invoice.voided`, and `invoice.marked_uncollectible`. Checkout uses the payment
methods configured in Stripe Dashboard. The API calls pin `2026-10-28.endive`.

An Owner can pay or manage the subscription. Payment is confirmed from a signed
event and the paid monthly invoice. Opening a new profile, creating, cloning or
restoring a profile, and inviting a member require an active subscription.
Existing sessions can still heartbeat, save, and unlock after expiry.

Run database tests only against an isolated database because the suite resets
its schema. Set `DATABASE_URL` and a writable temporary `FURY_BUNDLE_DIR`, then run
`cargo test -p fury-server`. For checkout UI testing, use
[Stripe's test payment data](https://docs.stripe.com/testing).
