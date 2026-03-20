# API Contract

Base URL: `https://ledger.sainwellx.xyz`

Headers:

- `content-type: application/json`
- `authorization: Bearer ${NOMAD_API_TOKEN}`

Dev-only fallback (when backend allows bypass):

- `x-user-id: ${NOMAD_USER_ID:-1}`

## Scope

This contract is for direct transaction write flow.
Parser/model is assumed to run on user side (outside Nomad backend AI parse APIs).

## 1) Get accounts (for ID mapping)

`GET /api/v1/accounts`

Success `200`:

- Returns account array with fields including `id`, `name`, `type`, `currency`.

## 2) Get categories (for active category validation)

`GET /api/v1/categories`

Success `200`:

- Returns `{ [category_l1]: { active, l2: [{ name, active }] } }`.

## 3) Create transaction

`POST /api/v1/transactions`

Common required fields:

- `date` (YYYY-MM-DD)
- `type` (`expense` | `income` | `transfer`)
- `amount_original` (positive number)
- `currency_original` (`CNY|EUR|THB|USD|JPY|KRW`)

Optional:

- `note` (string)
- `tags` (string[])
- `fx_rate` / `amount_base` (usually omitted; backend can auto-fill)

### 3.1 Expense example

```json
{
  "date": "2026-03-21",
  "type": "expense",
  "amount_original": 220,
  "currency_original": "THB",
  "category_l1": "Lifestyle",
  "category_l2": "Dining",
  "account_from_id": 8,
  "note": "Lunch",
  "tags": ["food", "bangkok"]
}
```

Expense required:

- `account_from_id`
- `category_l1`
- `category_l2` (must be active pair under active L1)

### 3.2 Income example

```json
{
  "date": "2026-03-21",
  "type": "income",
  "amount_original": 1000,
  "currency_original": "USD",
  "account_to_id": 5,
  "note": "Salary"
}
```

Income required:

- `account_to_id`

### 3.3 Transfer examples

Normal transfer:

```json
{
  "date": "2026-03-21",
  "type": "transfer",
  "amount_original": 300,
  "currency_original": "USD",
  "account_from_id": 1,
  "account_to_id": 2,
  "transfer_reason": "normal",
  "note": "Move funds"
}
```

Loan transfer (one-sided):

```json
{
  "date": "2026-03-21",
  "type": "transfer",
  "amount_original": 200,
  "currency_original": "USD",
  "account_from_id": 1,
  "transfer_reason": "loan",
  "note": "Lend to friend"
}
```

Borrow transfer (one-sided):

```json
{
  "date": "2026-03-21",
  "type": "transfer",
  "amount_original": 200,
  "currency_original": "USD",
  "account_to_id": 2,
  "transfer_reason": "borrow",
  "note": "Borrow from friend"
}
```

Transfer rules:

- `normal`, `deposit_lock`, `deposit_release`: require both from/to and IDs must be different.
- `loan`: require only `account_from_id`.
- `borrow`: require only `account_to_id`.
- `deposit_lock`: destination account type must be `restricted_cash`.
- `deposit_release`: source account type must be `restricted_cash`.

Success `201`:

- Returns created transaction object.

## 4) Optional list/read endpoints

- `GET /api/v1/transactions?month=YYYY-MM`
- `GET /api/v1/tags`

## Common Errors and Repair

- `400 Invalid active expense category pair.`
  - Action: refetch `/api/v1/categories`, select active L1/L2 pair, retry.
- `400 account_from_id not found for user.` / `account_to_id not found for user.`
  - Action: refetch `/api/v1/accounts`, remap ID, retry.
- `400 currency_original must be one of ...`
  - Action: normalize currency to supported list and retry.
- `400 Transfer requires ...` (reason-specific)
  - Action: adjust from/to fields by transfer rule and retry.
- `401 Authentication required.`
  - Action: check `NOMAD_API_TOKEN`.
- `403 Insufficient scope.`
  - Action: token needs `transactions:write` (and read scopes for lookup endpoints).

## Confirmation Policy (skill-level)

Local parser confidence policy:

- If confidence `>= 0.85`: allow direct write.
- If confidence `< 0.85`: require explicit user confirmation before write.

Cancel policy:

- On cancel, do not call write endpoint.
