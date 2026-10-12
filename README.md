# n8n-nodes-ldo-1c-relay

Connect a 1C database to n8n through the **LDO Relay API**. The separately installed 1C extension polls Relay using outbound HTTP(S), executes operations permitted by the local administrator, and returns results, events, and files. The database does not need an inbound web publication.

This package integrates LDO Relay. It requires an enrolled 1C database, the compatible LDO extension, and Relay access. It does not connect directly to a database or provide generic access to unrelated APIs.

**Release status:** initial public source release. The npm package has not yet been published, and this node has not been verified by n8n. Installing through the n8n Cloud node panel requires verification.

[n8n](https://n8n.io/) is a workflow automation platform.

## Installation

For local development, see [Development](#development). Once the package is published to npm, install `n8n-nodes-ldo-1c-relay` through **Settings → Community Nodes** on a self-hosted instance, following the [n8n installation guide](https://docs.n8n.io/integrations/community-nodes/installation-and-management).

The extension is installed separately. Follow [Connection and extension setup](docs/connection.md) before executing workflows.

## Credentials

Create an **LDO Relay API** credential with the Relay URL, scoped API token, database ID, profile ID, and policy revision issued during enrollment. The token is a password field stored by n8n in its encrypted credentials. The node does not read environment variables or local files.

The credential's **Minimum Wait (Seconds)** defaults to 900 for a database that polls every 15 minutes. Lower it only when the database polling schedule supports shorter waits. Each operation's timeout is at least this minimum.

## Operations

| Resource     | Operations                                                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1C Operation | Get capabilities; get/update document fields; get/update catalog fields; search references; update a reference field; prepare a document PDF; start/get/transition/update/cancel an external process |
| Event        | Lease approval-started, document-approved, or document-rejected events                                                                                                                               |
| Delivery     | Acknowledge an event; confirm PDF delivery and acknowledge its event; schedule an event retry                                                                                                        |

Types, fields, print forms, process profiles, transitions, and reference values are loaded from the capabilities published by the local database policy. Business names and values are returned in their original language.

Updates require the expected object revision. References can be supplied as an ID, resolved with a live search that must return exactly one match, or selected from the bounded policy cache. The node does not execute arbitrary BSL, SQL, or HTTP requests against the database.

External process fields belong to the process instance. Updating a process does not update the source document fields.

## Example workflows

- [Get capabilities](examples/get-capabilities.json): Manual Trigger → Get Capabilities. Import it into n8n and select your LDO Relay API credential.
- Event automation: Schedule Trigger → Event → your business logic → Delivery: Acknowledge Event. Set Event ID to `={{$json._ldo.event_id}}` if the previous node preserves this field.
- PDF delivery: Prepare Document PDF → email/storage node → Delivery: Confirm PDF Delivery. Use the binary property `data`. Preserve `_ldo.event_id`, `_ldo.file_id`, and `_ldo.sha256` through the destination node and map them to the confirmation parameters.

Confirm delivery only after the destination accepts the file. If delivery fails, schedule a retry rather than acknowledging the event. PDF bytes are checked against size, PDF header, and SHA-256 before being returned as n8n binary data.

## Compatibility and limitations

- Node.js 22.22.0 or later. The tested `n8n-workflow` version is recorded in `package-lock.json`; host compatibility is declared in `peerDependencies`.
- Requires LDO Relay command contract `1.0` and an extension that supports the selected operation. Available operations depend on the configuration and policy.
- An operation may wait up to 1800 seconds. Your n8n execution timeout must permit the polling schedule. PDF preparation may wait separately for the result and the file.
- After a timeout, the original command may still be queued. Check its result before rerunning a write: rerunning the node creates a new command ID.
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

See [Release and verification](docs/release.md). GitHub Actions builds and tests the package and publishes it with npm provenance. Publishing and n8n verification are separate stages.

## License

This repository is licensed under [MIT](LICENSE). This covers the n8n node; the separately distributed extension and Relay service have their own terms.
