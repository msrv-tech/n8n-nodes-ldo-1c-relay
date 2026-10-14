# n8n-nodes-ldo-1c-relay

Connect a 1C database to n8n using your own **standalone queue**, **direct HTTP**, or an explicitly enrolled **MSRV Relay service**. Node version 2 defaults to the standalone queue: the separately installed extension polls your n8n, so the database does not need an inbound web publication. Standalone operation does not contact MSRV.

**Release 0.3.0** simplifies standalone setup: direct HTTP uses URL/user/password, and queues connect using one pairing code. Version 0.2.0 introduced the original standalone transports. [Standalone connection setup](docs/standalone.md) documents their requirements and limitations. Existing version 1 workflows retain their Relay transport; npm 0.1.1 and earlier remain Relay-only.

**Publication:** [version 0.3.0 is available on npm](https://www.npmjs.com/package/n8n-nodes-ldo-1c-relay/v/0.3.0), published through [GitHub Actions](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/actions/runs/38507750466) with npm provenance. The full official published-package scanner passed on 2026-10-14.

**Verification status:** this node has not been verified by n8n. The earlier Relay submission passed automated review on 2026-10-13 and is awaiting a demonstration video. Version 0.3.0 requires review of its standalone transports and simplified connection setup. Installing through the n8n Cloud node panel requires verification.

[n8n](https://n8n.io/) is a workflow automation platform.

## Installation

For local development, see [Development](#development). Install `n8n-nodes-ldo-1c-relay` through **Settings → Community Nodes** on a self-hosted instance, following the [n8n installation guide](https://docs.n8n.io/integrations/community-nodes/installation-and-management).

The extension is installed separately. Follow [Standalone connection setup](docs/standalone.md) for your own queue or direct HTTP, or [MSRV connection setup](docs/connection.md) for an enrolled Relay service.

## Credentials

Choose the credential for the selected transport:

- **LDO 1C Standalone Queue API**: your n8n URL and API key; create a connection and pair it with 1C using a one-time code.
- **LDO 1C Direct API**: your published 1C service URL, native username and password; the access profile is discovered automatically.
- **LDO Relay API**: an explicitly enrolled MSRV service URL, scoped Relay token and its database/profile/policy identifiers.

Sensitive values are password fields stored in encrypted n8n credentials. The node does not read environment variables or local files.

The credential's **Minimum Wait (Seconds)** defaults to 900 for a database that polls every 15 minutes. Lower it only when the database polling schedule supports shorter waits. Each operation's timeout is at least this minimum.

## Operations

| Resource     | Operations                                                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1C Operation | Get capabilities; get/update document fields; get/update catalog fields; search references; update a reference field; prepare a document PDF; start/get/transition/update/cancel an external process |
| Event        | Lease approval-started, document-approved, or document-rejected events                                                                                                                               |
| Delivery     | Acknowledge an event; confirm PDF delivery and acknowledge its event; schedule an event retry                                                                                                        |
| Connection   | Create connection; get status; renew pairing code; disconnect |
| Queue        | Get a retained standalone command result; clean old completed entries                                                                                                                              |

Event and Delivery resources apply to queue transports. Direct HTTP receives events through a separately configured outgoing webhook. PDF delivery confirmation through Relay applies only to MSRV; standalone PDF commands return the binary file with their result.

Types, fields, print forms, process profiles, transitions, and reference values are loaded from the capabilities published by the local database policy. Business names and values are returned in their original language.

Updates require the expected object revision. References can be supplied as an ID, resolved with a live search that must return exactly one match, or selected from the bounded policy cache. The node does not execute arbitrary BSL, SQL, or HTTP requests against the database.

External process fields belong to the process instance. Updating a process does not update the source document fields.

## Example workflows

- [Get capabilities](examples/get-capabilities.json): Manual Trigger → Get Capabilities. Select your standalone queue credential, or explicitly change the transport and select its credential.
- [Create queue connection](examples/create-queue-connection.json): create and activate a connection, then paste its pairing code into 1C.
- [Queue with Wait](examples/queue-with-wait.json): submit without waiting, persist the wait and retrieve the retained result.
- Event automation: Schedule Trigger → Event → your business logic → Delivery: Acknowledge Event. Preserve `_ldo.event_id` and, for a standalone queue, `_ldo.lease_token`.
- Standalone PDF delivery: Prepare Document PDF → your email/storage node, using binary property `data`. For MSRV Relay, add Delivery: Confirm PDF Delivery and preserve `_ldo.event_id`, `_ldo.file_id`, and `_ldo.sha256` through the destination node.

Confirm delivery only after the destination accepts the file. If delivery fails, schedule a retry rather than acknowledging the event. PDF bytes are checked against size, PDF header, and SHA-256 before being returned as n8n binary data.

## Compatibility and limitations

- Simple connection setup tested in self-hosted n8n 2.36.9 against registered UNF with LDO 6.7.1.0: actual gateway creation, native pairing, queued read/write, automatic policy changes, old-result lookup and restart. Earlier 0.2.0 transport tests included real PDF, event, persisted Wait and AI tool workflows. Queue results survived a restart and eight competing leases produced one owner. n8n Cloud is not validated.
- Earlier Relay releases were tested in n8n 2.36.9 and 2.42.7, including workflow operations against LDO 6.5.1.0. Version 1 workflows retain that transport.
- Node.js 22.22.0 or later. The tested `n8n-workflow` version is recorded in `package-lock.json`; host compatibility is declared in `peerDependencies`.
- Requires command contract `1.0` and an extension compatible with the selected transport and operation. Available operations depend on the configuration and local policy.
- An operation may wait up to 1800 seconds. Your n8n execution timeout must permit the polling schedule. PDF preparation may wait separately for the result and the file.
- After a timeout, the original command may still be queued. In standalone mode, retrieve its result or reuse its Command ID and original payload. A new Command ID represents a new operation.
- Standalone PDFs are limited to 7 MiB and consume Data Table space when queued. Delivery is at least once; simultaneous submissions can create duplicate transport rows, while 1C receipts prevent repeating the same write.
- Configure execution-data retention in your n8n instance for business data and PDF files.

## Development

```sh
npm ci
npm run check
npm run dev
```

Scaffolded with the official `n8n-node` tool. The programmatic node is necessary because operations require dependent requests: enqueue a command, poll its correlated result, acknowledge it, and optionally retrieve and verify a PDF.

Tests use synthetic responses and never contact a database or Relay service. They cover authentication, contracts, options, reference selection, document/catalog writes, processes, PDF verification, acknowledgements, and retries.

## Release

For standalone queue and direct credentials, see [Standalone connection setup](docs/standalone.md).

See [Release and verification](docs/release.md) and the [verification submission details](docs/verification.md). GitHub Actions builds and tests the package and publishes it with npm provenance. Publishing and n8n verification are separate stages.

## License

This repository is licensed under [MIT](LICENSE). This covers the n8n node; the separately distributed extension and Relay service have their own terms.
