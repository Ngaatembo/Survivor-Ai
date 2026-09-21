# EcoCash Instant Payment — Survivor-AI sandbox

This integration is sandbox-only. It does not enable production payments.

## Worker secrets

Configure these with Cloudflare Worker secrets; never commit them:

- `ECOCASH_BASE_URL` — sandbox base URL (defaults to `https://developers.ecocash.co.zw`)
- `ECOCASH_USERNAME`
- `ECOCASH_PASSWORD`
- `ECOCASH_MERCHANT_CODE`
- `ECOCASH_MERCHANT_PIN`
- `ECOCASH_MERCHANT_NUMBER`
- `ECOCASH_WEBHOOK_SECRET`
- `TRIGGER_SECRET`

The EcoCash portal confirms that EIP uses HTTP Basic Auth and the sandbox charge endpoint is:

`POST /sandbox/payment/v1/transactions/amount/`

## Sandbox test

After deployment and D1 migration, call the protected Worker endpoint:

`POST /payments/ecocash/sandbox-charge`

Headers:

`x-trigger-secret: <TRIGGER_SECRET>`
`content-type: application/json`

Body:

```json
{
  "endUserId": "<WHITELISTED_SANDBOX_MSISDN>",
  "amount": 2,
  "description": "Survivor AI sandbox test"
}
```

The Worker creates a payment intent first, sends the sandbox charge, and stores the provider response. A successful initial response may still be pending subscriber validation; it is **not** booked as confirmed revenue until a verified webhook reports a completed/successful state.

## Webhook

The Worker endpoint is:

`POST /payments/ecocash/webhook`

The webhook handler requires the configured HMAC secret and supports the common signature header aliases `x-ecocash-signature`, `x-webhook-signature`, `x-signature`, and `x-hmac-signature`, with SHA-256 hex or base64 signatures.

If EcoCash documents a different exact header/encoding for this product, update only `worker/src/paymentProvider.ts`.

Webhook deliveries are idempotent. A confirmed payment creates one append-only `REVENUE` transaction in the Survivor treasury ledger.

## Safety boundary

- Production EcoCash URLs are rejected by the sandbox charge function.
- No EcoCash PIN/password is stored in D1.
- The browser never receives EcoCash credentials.
- Survivor's real-money execution flag remains disabled.
- The confirmed EIP charge endpoint is a merchant collection flow; it is **not** treated as an outbound vendor-disbursement API.
