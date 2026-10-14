# Changelog

## 0.3.0 — 2026-10-14

- Simplify direct credentials to 1C service URL, username and password; discover
  the explicitly enabled native access profile through read-only `/connection`.
- Remove the separate profile token and manual standalone scope/revision fields.
- Add Connection operations that create a durable queue table and activate its
  gateway through the public n8n API, then return a 15-minute pairing code.
- Generate the permanent exchange key in 1C; store only hashes in the gateway.
  Enforce one-time binding with atomic comparison and recover exact retries.
- Synchronize native policy revisions automatically; reject stale policy updates
  and pending commands, while accepting leased results and retaining old results.
- Add connection status, disconnect and renewed pairing for another database.
- Breaking standalone setup change: recreate demo connections using this wizard.
  Matching extension release is required (UNF 6.7.1.0).

## 0.2.0 — 2026-10-13

- Add version 2 with standalone queue as the default and explicit direct/MSRV modes.
- Persist queue commands, leases, results and events through the n8n Data Tables public API.
- Add an authenticated gateway for outbound polling from closed 1C databases.
- Add command submission without waiting, retained result lookup and queue retention.
- Add direct credentials and integrity-checked standalone PDF results.
- Preserve version 1 Relay workflows; remove the default MSRV URL from new credentials.


## 0.1.1

- Publish releases through npm Trusted Publishing (GitHub Actions OIDC), without a stored publish token.
- Include npm provenance, scanner results, and n8n review status in the English documentation.
- Node behavior and credential format are unchanged.

## 0.1.0

- Initial standalone community node for the LDO Relay API.
- n8n credentials, dynamic capabilities, document and catalog operations, PDF delivery, events, and external processes.
