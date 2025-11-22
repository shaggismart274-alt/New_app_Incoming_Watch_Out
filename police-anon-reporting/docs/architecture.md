# State Police Neighbourhood Watch – Architecture Documentary

This document explains the design of the **police-anon-reporting** Clarinet project. The goal is to let citizens anonymously report incidents and chat with police officers in different regions of a state, without exposing the citizen's identity at the smart-contract state level.

> Important: On a public blockchain, **transaction senders are always visible on-chain**. This contract is designed so that it does not store citizen principals in its own state. However, a strong anonymity story for real-world deployments still requires additional off-chain measures (relays, mixers, or privacy-preserving networking).

## High-level idea

- Any account can open an incident case for a region (e.g. `CENTRAL`, `LAGOS-ISLAND`).
- Admin registers police officers and assigns them to regions.
- Officers can be assigned to specific cases.
- Citizens and officers exchange chat messages on-chain inside each case.
- Contract state never stores citizen principals, only a **reporter hash** derived from a user-chosen salt.

The project includes:

- A non-trivial **Clarity contract**: `contracts/police-chat.clar`.
- **Clarinet tests** under `tests/` using `vitest` and `vitest-environment-clarinet`.
- A small **UI prototype** under `ui/` that shows how a frontend could call the contract functions.

## Roles and permissions

### Admin / contract owner

- The deployer (`contract-owner`) is the admin.
- Can register police officers and manage their active status.
- Can assign cases to officers.
- Can close cases (in addition to assigned officers).

### Police officers

- Represented by principals registered in the `police-officers` map.
- Each officer is tied to a textual **region** and an `active` flag.
- Only active officers (or admin) can send `send-police-message`.
- Assigned officers (or admin) can close a case.

### Citizens

- Any principal that calls `open-case`.
- Contract state does **not** persist their principal. Instead, a `reporter-hash` is stored.
- Citizens can send `send-citizen-message` on any open case (the dApp can restrict this off-chain if desired).

## On-chain data model

### Data variables and maps

- `var next-case-id: uint`
  - Global counter for case IDs, starting at `u1`.

- `map police-officers` keyed by `{ officer: principal }`
  - Value: `{ region: (string-ascii 32), active: bool }`.
  - Used to check officer region and whether they are allowed to act.

- `map cases` keyed by `{ case-id: uint }`
  - Value:
    - `region: (string-ascii 32)` – region label.
    - `subject: (string-ascii 64)` – short title.
    - `details: (string-utf8 256)` – short incident description.
    - `reporter-hash: (buff 32)` – hash of a user-supplied salt (no principal stored).
    - `assigned-officer: (optional principal)` – officer currently in charge, if any.
    - `status: (string-ascii 16)` – currently `"open"` or `"closed"`.

- `map case-message-counts` keyed by `{ case-id: uint }`
  - Value: `{ count: uint }`.
  - Tracks how many messages have been stored for a given case.

- `map case-messages` keyed by `{ case-id: uint, index: uint }`
  - Value:
    - `from-role: (string-ascii 8)` – `"citizen"` or `"police"`.
    - `from-officer: (optional principal)` – only set for police messages.
    - `content: (string-utf8 256)` – message body.
    - `timestamp: uint` – `block-height` when the message was recorded.

### Error codes

- `ERR_UNAUTHORIZED (err u100)` – caller lacks permission.
- `ERR_NOT_OFFICER (err u101)` – principal is not registered as officer.
- `ERR_OFFICER_INACTIVE (err u102)` – officer exists but is not active.
- `ERR_CASE_NOT_FOUND (err u200)` – case ID does not exist.
- `ERR_CASE_CLOSED (err u201)` – attempted to modify a closed case.
- `ERR_REGION_MISMATCH (err u202)` – officer region does not match case region.

## Contract functions

### Admin functions

- `register-police (officer principal) (region (string-ascii 32))`
  - Only admin.
  - Registers or updates a police officer profile with region and sets `active = true`.

- `set-officer-active (officer principal) (active bool)`
  - Only admin.
  - Toggles the `active` flag for an existing officer.

- `assign-case (case-id uint) (officer principal)`
  - Only admin.
  - Requires officer to exist and be `active`.
  - Requires officer's region to match the case region.
  - Sets `assigned-officer` for the case.

### Citizen and officer functions

- `open-case (region (string-ascii 32)) (subject (string-ascii 64)) (details (string-utf8 256)) (salt (buff 32))`
  - Any caller.
  - Uses the current `next-case-id` as the new case ID, then increments the counter.
  - Stores `reporter-hash = sha256(salt)` along with region, subject, and details.
  - Returns `(ok case-id)`.

- `send-citizen-message (case-id uint) (content (string-utf8 256))`
  - Checks that the case exists and is `STATUS_OPEN`.
  - Appends a new message entry with `from-role = "citizen"` and `from-officer = none`.

- `send-police-message (case-id uint) (content (string-utf8 256))`
  - Only active officers (from `police-officers`) or admin.
  - Checks that the case exists and is open.
  - Appends a new message with `from-role = "police"` and `from-officer` set to the officer principal.
  - If admin sends the message, the contract attempts to tag the currently assigned officer; otherwise `none`.

- `close-case (case-id uint)`
  - Only the assigned officer or admin.
  - Case must be open.
  - Sets `status = STATUS_CLOSED`.

### Read-only functions

- `get-next-case-id` – returns the current `next-case-id`.
- `get-officer (officer principal)` – returns officer tuple (or `none`) for a principal.
- `get-case (case-id uint)` – returns the case tuple (or `none`).
- `get-message-count (case-id uint)` – returns the number of messages stored for a case (default `u0`).
- `get-message (case-id uint) (index uint)` – returns a single message at index (or `none`).

These are enough to power both admin and officer UIs using either direct map access (via an indexer) or read-only calls.

## Typical flows

### Citizen anonymous report

1. Citizen opens the dApp and selects their region.
2. They fill in a short subject and description, and optionally a secret salt.
3. Frontend converts those values to Clarity values and calls `open-case`.
4. Contract:
   - Uses `next-case-id` as the new case ID.
   - Computes `reporter-hash = sha256(salt)` and stores it.
   - Marks the case as `open`.
5. Off-chain indexers can list new open cases per region, without revealing the citizen principal.

### Officer handling a case

1. Admin registers officers with `register-police` and assigns them to regions.
2. Admin assigns a case to an officer with `assign-case`.
3. Officer opens their dashboard and filters cases by region and assignment.
4. Officer and citizen send messages via `send-police-message` and `send-citizen-message` respectively.
5. When resolved, officer (or admin) calls `close-case`.

## Anonymity and security considerations

- The contract intentionally **does not store citizen principals** in `cases` or `case-messages`.
- `reporter-hash` is derived only from a user-chosen salt; if the salt is unpredictable and never reused, it is hard to link multiple cases together from contract state alone.
- However:
  - The blockchain still reveals each transaction sender.
  - Network-level metadata (IP address, timing) can leak information.
  - For strong anonymity, a production deployment should use:
    - Off-chain relays or gateways that aggregate citizen reports.
    - Mixers, Tor, or other privacy-preserving channels.
    - Possibly encryption of message content, with keys shared with officers only.

## Tests

Tests live in `tests/police-chat.test.ts` and use `vitest` + `vitest-environment-clarinet`.

They cover:

- Admin registering officers and reading them via `get-officer`.
- Citizen opening cases and verifying that `next-case-id` increments.
- Admin assigning cases to officers.
- Citizen and officer messaging via `send-citizen-message` / `send-police-message`.
- Unauthorized operations:
  - Citizens cannot assign cases.
  - Random citizens cannot send police messages.
- Closed-case behaviour: messages cannot be sent after `close-case` and return the error code `ERR_CASE_CLOSED (err u201)`.

### How to run tests

From the `police-anon-reporting` directory:

```bash
npm install
npm test
```

This will run Vitest using the Clarinet simnet environment, compiling the `police-chat` contract and exercising the flows described above.

## UI prototype

The `ui/` folder contains a small, hand-written UI prototype:

- `ui/index.html` – three-column layout:
  - **Anonymous citizen report** – form to open a case.
  - **Officer case board** – list of cases for a region (currently sample data).
  - **Case chat** – view and send messages as citizen or officer.
- `ui/app.ts` – minimal TypeScript logic that:
  - Binds DOM forms to conceptual contract calls
    - `open-case`
    - `send-citizen-message`
    - `send-police-message`
  - Builds Clarity values using `Cl.*` helpers from `@stacks/transactions`.
  - Provides clear TODOs where you would integrate a real Stacks wallet and network configuration.

To use this UI in a full dApp, you would typically:

1. Add a bundler (e.g. Vite) and configure an entry point at `ui/app.ts`.
2. Install `@stacks/connect` and wire `callContractFunction` to `showContractCall`.
3. Decide which network you are targeting (Devnet, Testnet, or Mainnet) and set `CONTRACT_ADDRESS` / `CONTRACT_NAME` accordingly.
4. Optionally extend the contract with additional read-only helpers or use an indexer to list all open cases for an officer.

## Possible extensions

- Stronger anonymity via relayers that submit transactions on behalf of citizens.
- Richer status model for cases (e.g. `in-review`, `escalated`).
- Region hierarchy (state → city → precinct) and cross-region coordination.
- Rate limiting and spam prevention mechanisms for case creation.
- Encryption of messages so that only officers can read case details, while still keeping minimal metadata on-chain.
