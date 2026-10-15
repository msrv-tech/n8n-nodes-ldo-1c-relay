# n8n-nodes-ldo-1c-relay

**English** · [Русский](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/README.ru.md)

Connect 1C to n8n using your own queue, a published 1C HTTP service, or an enrolled MSRV service. Read and find documents and catalog items, update permitted fields, retrieve PDFs, and automate approval events and external processes.

**Current release: [npm 0.4.0](https://www.npmjs.com/package/n8n-nodes-ldo-1c-relay/v/0.4.0) · LDO core 6.8 · command contract 1.0.** Version 0.4.0 adds universal document/catalog search by metadata. The separately distributed LDO extension is required; choose a build for your 1C configuration and a compatible core version.

[Documentation and operation catalog (Russian)](https://ldo.msrv.tech/docs/n8n/) · [Compatibility](https://ldo.msrv.tech/docs/n8n/compatibility/) · [Release history](https://ldo.msrv.tech/docs/n8n/updates/) · [Get the 1C extension](https://gitsell.ru/msrv-tech/ldo)

## Choose a connection

| Transport | When to use it | Connection settings |
| --- | --- | --- |
| **Your own queue** | Your 1C database is not published. The extension polls your n8n using outgoing requests. | n8n URL and API key in the Queue credential; a one-time pairing code in 1C. |
| **Direct HTTP** | The extension's `ldo_n8n` HTTP service is published and reachable from n8n. | Service URL, 1C username and password in the Direct credential. |
| **MSRV Relay** | You have enrolled in a managed MSRV service. | Service address and scoped credentials supplied for that connection. |

**Your own queue and Direct do not contact MSRV or require MSRV activation.** MSRV services are provided separately to enrolled customers. Installing this public node does not grant access to them.

The current node interface defaults to your own queue. Existing version 1 workflows retain their Relay transport. See the [English standalone setup guide](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/docs/standalone.md) or [MSRV connection guide](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/docs/connection.md).

## Installation and first connection

1. In self-hosted n8n, open **Settings → Community nodes → Install** and enter `n8n-nodes-ldo-1c-relay`. See [n8n's installation guide](https://docs.n8n.io/integrations/community-nodes/installation-and-management/).
2. Install the LDO extension separately in 1C. Select the appropriate configuration and installation environment; the core is not a universal installable CFE.
3. Choose the transport and create its credential:
   - **LDO 1C Standalone Queue API:** your n8n root URL and API key. Run **Create Connection**, then paste its one-time code into the extension's standalone **Queue** settings. The gateway address is carried inside the code; the n8n API key is not sent to 1C.
   - **LDO 1C Direct API:** published service URL, 1C username and password. Enable direct access in the extension; its access profile is discovered automatically.
   - **LDO Relay API:** explicitly enrolled MSRV service URL, scoped Relay token and the supplied database/profile/policy identifiers.
4. Permit the required objects and actions in 1C. For a queue, ensure scheduled polling works. Execute **Get Capabilities**, then your first permitted operation.

Credential secrets are password fields stored in encrypted n8n credentials. The node does not read environment variables or local files.

Publishing on npm and verification by n8n are separate stages. npm availability does not imply availability in the n8n Cloud node panel. The demonstration of version 0.3.0 was submitted for manual review on 2026-10-14; see [verification information](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/docs/verification.md).

## What the node can do

| Resource | Actions |
| --- | --- |
| **1C Operation** | Get capabilities; search documents and catalog items; get/update their fields; find reference values and update a reference field; prepare a document PDF; start/get/transition/update/cancel an external process. |
| **Event** | Lease approval-started, document-approved and document-rejected events. |
| **Delivery** | Acknowledge an event, schedule a retry, or confirm PDF delivery through MSRV Relay. |
| **Connection** | Create a queue connection, check status, renew its pairing code, disconnect. |
| **Queue** | Retrieve a retained command result and clean old completed entries. |

The node can also be connected as a tool to an **AI Agent**. The agent uses the same credentials and local permissions; it does not gain arbitrary access to 1C.

Types, fields, print forms, process profiles and transitions come from the connected database's **capabilities**. Names and business values remain in their original language. A search result can feed the next workflow step, without manually copying an object ID. Do not automatically select the first result of an ambiguous search.

[Browse all operations](https://ldo.msrv.tech/docs/n8n/) · [Search guide](https://ldo.msrv.tech/docs/n8n/search/) · [Additional capabilities](https://ldo.msrv.tech/docs/n8n/features/)

## Example workflows

- [Get capabilities](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/examples/get-capabilities.json): Manual Trigger → Get Capabilities.
- [Create a queue connection](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/examples/create-queue-connection.json): create the gateway and pair it with 1C.
- Search → Get Fields: find the document or catalog item by its permitted attributes, then pass the returned object type and ID using n8n expressions.
- [Queue with Wait](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/examples/queue-with-wait.json): submit without waiting, persist the wait, retrieve the result.
- Approval events: Schedule Trigger → Event → your business logic → Delivery: Acknowledge Event. Preserve `_ldo.event_id` and, for your own queue, `_ldo.lease_token`.
- PDF delivery: Prepare Document PDF → email/storage node with binary property `data`. Acknowledge delivery only after the destination accepts the file. For MSRV Relay, use Confirm PDF Delivery and preserve `_ldo.event_id`, `_ldo.file_id` and `_ldo.sha256`.

## Compatibility and limits

- **Node 0.4.0 pairs with LDO core 6.8.** Core means the first two components of the extension version. Adaptations for different 1C configurations are distributed separately. See the [supported pairs](https://ldo.msrv.tech/docs/n8n/compatibility/) and [component updates](https://ldo.msrv.tech/docs/n8n/updates/).
- Requires Node.js **22.22.0+**, command contract **1.0**, and a self-hosted n8n compatible with the package. Your own queue also requires n8n Public API/Data Tables and a gateway reachable from the 1C server. MSRV operations require support by the connected service.
- Event/Delivery polling uses queues. Direct HTTP can receive business events through a separately configured outgoing webhook.
- Updates require the expected object revision and local write permission. Updating external process fields does not update the source document. Arbitrary BSL, SQL and HTTP execution against 1C are not supported.
- Creating new documents/catalog items, posting/unposting/deleting documents and universal tabular-section editing are not supported.
- Queue timing depends on 1C polling. **Minimum Wait (Seconds)** defaults to 900; lower it only when the polling schedule supports it. Operation timeouts can reach 1800 seconds; configure n8n execution limits accordingly.
- A timed-out command may still be queued. Retrieve its retained result or retry the **same Command ID and original payload**. A new ID represents a new operation. Delivery is at least once; 1C write receipts prevent the same write being applied again.
- Standalone PDF results are limited to **7 MiB** and occupy Data Table space. Configure retention for queue data, n8n execution data and files.

## Development and release

```sh
npm ci
npm run check
npm run dev
```

The programmatic node coordinates dependent requests: enqueue, poll a correlated result, acknowledge it, and optionally retrieve and verify a PDF. Scaffolded with the official `n8n-node` tool.

`npm run check` covers the registry, lint, build and synthetic-response tests. The separate [server suite](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/test/integration/README.md) checks installed nodes against disposable test data. Developer reports and the [capability registry](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/docs/capabilities/README.md) record their original versions and scope.

See [Release and verification](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/docs/release.md). Maintain both README languages when changing installation, transports, compatibility or available operations.

## License

[MIT](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/LICENSE) covers this n8n node. The separately distributed 1C extension and MSRV services have their own terms.
