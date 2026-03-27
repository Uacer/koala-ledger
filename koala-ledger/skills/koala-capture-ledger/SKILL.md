---
name: koala-capture-ledger
description: Record expenses, income, and transfers into Koala Ledger when the parser/model is already available on user side. Focus on request construction and validation rules for direct transaction write APIs.
allowed-tools: Bash(curl *)
---

# Koala Capture Ledger

Record financial transactions via the Koala Ledger API.
The local model/parser runs outside this skill. This skill only builds correct API requests and applies posting rules.

## Environment

Required:
- `KOALA_API_TOKEN` — Bearer token from Settings → Agent Access

Fixed server URL:
- `https://ledger.sainwellx.xyz`

## Workflow

1. Receive structured draft from local model/parser.
2. Validate required fields by `type` (expense/income/transfer).
3. If parser confidence is high (`>= 0.85`), write directly.
4. If confidence is lower, ask user confirmation before write.
5. POST `/api/v1/transactions` with normalized payload.
6. If API validation fails, fetch context and repair fields, then retry.

## Step 1 — Fetch Context (for mapping IDs/categories)

```sh
curl -s "https://ledger.sainwellx.xyz/api/v1/accounts" \
  -H "Authorization: Bearer $KOALA_API_TOKEN"
```

```sh
curl -s "https://ledger.sainwellx.xyz/api/v1/categories" \
  -H "Authorization: Bearer $KOALA_API_TOKEN"
```

Use these to map account names -> `account_from_id`/`account_to_id` and ensure category pair is active.

## Step 2 — Build Request Body

Base fields (all transaction types):
- `date` (`YYYY-MM-DD`)
- `type` (`expense` | `income` | `transfer`)
- `amount_original` (positive number)
- `currency_original` (`CNY|EUR|THB|USD|JPY|KRW`)
- `note` (optional)
- `tags` (optional string array)

Type-specific required fields:
- `expense`: `account_from_id`, `category_l1`, `category_l2`
- `income`: `account_to_id`
- `transfer`:
  - `transfer_reason=normal|deposit_lock|deposit_release`: require both `account_from_id` and `account_to_id`, and they must be different
  - `transfer_reason=loan`: require `account_from_id`, do not send `account_to_id`
  - `transfer_reason=borrow`: require `account_to_id`, do not send `account_from_id`

Restricted cash rules:
- `deposit_lock`: destination account type must be `restricted_cash`
- `deposit_release`: source account type must be `restricted_cash`

## Step 3 — Write Transaction

```sh
curl -s -X POST "https://ledger.sainwellx.xyz/api/v1/transactions" \
  -H "Authorization: Bearer $KOALA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-03-21",
    "type": "expense",
    "amount_original": 120,
    "currency_original": "THB",
    "category_l1": "Lifestyle",
    "category_l2": "Dining",
    "account_from_id": 8,
    "note": "7-Eleven",
    "tags": ["food", "bangkok"]
  }'
```

Notes:
- `fx_rate` and `amount_base` are optional. Usually omit them and let backend auto-fill.
- On success, API returns `201` and the created transaction object.

## Hard Rules

- Do not call parse endpoints from this skill.
- Treat local parser output as draft input only; still run request-shape validation.
- If local confidence `< 0.85`, require explicit user confirmation before write.
- Never write on cancel.
- On `400` validation errors, fetch accounts/categories and retry with corrected IDs/category pair.
