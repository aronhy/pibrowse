-- Stripe state is owned by the hosted application, not by an organization
-- role. Billing handlers scope it to the authenticated org or a verified Stripe
-- customer. The lock handler may read the owner's row for a cross-org share,
-- but only after the existing share permission check.
CREATE TABLE hosted_billing_accounts (
    org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    stripe_customer_id TEXT UNIQUE,
    stripe_checkout_session_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    subscription_status TEXT NOT NULL DEFAULT 'unpaid',
    paid_through TIMESTAMPTZ
);

CREATE TABLE hosted_billing_events (
    stripe_event_id TEXT PRIMARY KEY,
    org_id UUID NOT NULL REFERENCES hosted_billing_accounts(org_id) ON DELETE CASCADE,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
