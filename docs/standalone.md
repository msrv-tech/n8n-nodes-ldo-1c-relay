# Standalone 1C connections

Node version 2 defaults to **Standalone Queue**. It never supplies an MSRV URL,
activation key, subscription check, or Relay fallback. Your n8n and compatible
1C extension handle the exchange. MSRV services require separate, explicit
onboarding and valid service credentials.

The extension is distributed separately under its own terms. Standalone
transport requires the new extension implementation, tested on UNF 6.6.1.0.
Older Relay-only extensions are not standalone-compatible. Other configurations
require their own compatible extension release and validation.

## Standalone queue

The database makes outbound HTTP requests to an activated **LDO 1C Queue Gateway
Trigger** in your n8n. It does not need a web publication. The gateway persists
commands, results and events through the supported n8n Data Tables public API.
It does not start workflow executions for queue polling or result reception.

The initial tested environment is self-hosted n8n 2.36.9. n8n Cloud and other
versions need separate validation; verification of this package is still pending.
Public API access and Data Tables must be available in the selected instance.

1. Create an n8n API key. Restrict it to the queue's Data Table operations where
   your n8n edition supports the necessary scopes. Keep it inside encrypted n8n
   credentials; never give this API key to 1C.
2. Import [Create queue table](../examples/create-queue-table.json), set the URL
   to your own n8n, choose your n8n API credential, and run it once. Copy the
   returned table ID. The table schema is included in the workflow.
3. Create an **LDO 1C Standalone Queue API** credential with your n8n URL, API key,
   table ID, database ID, local profile ID, policy revision, and a separate random
   queue token of at least 32 characters. The database ID is local; MSRV enrollment
   is not required.
4. Add **LDO 1C Queue Gateway Trigger** to a separate workflow, select that
   credential, and publish the workflow. Use its production webhook URL.
5. In the compatible extension's n8n settings, configure the permitted objects,
   fields, print forms and operations. Enter the gateway URL and queue token in
   the webhook fields, then choose **Connect your own n8n queue**. Copy the displayed
   database/profile/policy identifiers into the n8n credential. Configure the
   extension's existing command polling schedule.
6. Add **LDO 1C** to your business workflow with **Standalone Queue** and the same
   credential. Run **Get Capabilities** once while the 1C poller is running.
   Subsequent dropdowns use the retained result for that profile and revision.

Use HTTPS for production. The gateway must be reachable from the database's
network. Its credential's n8n URL must also be reachable from the process handling
webhooks; a container's `localhost` refers to that container.

When the local policy revision changes, update both action and gateway credentials.
The same encrypted credential can be shared by these nodes. The extension includes
its database/profile/revision in requests so a stale gateway configuration fails
rather than silently accepting data under an old revision.

### Waiting and recovery

By default, the action node waits for the result and occupies an execution worker.
Its minimum timeout should match the database's polling interval. For longer
intervals, disable **Wait for Result**: the node returns a retained Command ID
immediately. Continue with the built-in Wait node and **Queue → Get Result**.
Get Result returns `pending`, `leased`, `dead`, `succeeded`, or `failed`; retry
only the result lookup while the command is pending or leased.

Import [Queue with Wait](../examples/queue-with-wait.json) for this pattern. It
uses a five-minute wait so waiting executions can be persisted by n8n.
Reference-field updates using a live lookup remain synchronous because their
lookup and subsequent update depend on each other.

To recover an interrupted synchronous execution, supply its original UUID in
**Command ID**, with the original operation and payload. Do not create a new UUID
merely to retry a write. 1C atomically stores the operation result with the write;
repeating the same request restores that result. A different request with the same
ID is rejected. Replays also remain subject to the current local policy.

Queue delivery is at least once. Data Tables do not supply a unique command-ID
constraint through this API, so simultaneous submissions of the same ID may
create duplicate transport rows. The 1C transaction and receipt prevent a second
application of the same write. The queue does not claim exactly-once delivery.

### Events and delivery

The extension retains approval events until the gateway accepts them. Use a
Schedule Trigger followed by **LDO 1C → Event** to lease accepted events, then your
business action, then **Delivery → Acknowledge Event**. Pass both
`_ldo.event_id` and `_ldo.lease_token`. On failure, schedule an event retry. An old
lease cannot acknowledge a newly acquired lease.

A transport acknowledgement in 1C means the event was persisted by the gateway;
it does not mean the business action succeeded. Events with no active local
subscription remain in the 1C outbox.

### PDF and retention

Standalone PDF preparation returns the file with the command result. The node
checks its PDF header, size and SHA-256 and emits binary property `data`. It does
not upload the PDF to MSRV. The approved cycle and document revision are checked
by 1C before and after printing. The initial standalone PDF limit is 7 MiB.

The queue stores base64 PDFs in Data Table rows, so table quotas apply and base64
uses additional space. This implementation is intended for bounded exchange,
not file archiving. Persist delivered files in a destination of your choice.

Schedule **Queue → Clean Completed Entries** with your retention period. It
removes only old completed commands and acknowledged events in the credential's
current database/profile/revision. It retains pending, leased and dead entries.
Review old policy revisions separately before removing their retained data.
Execution-data retention in n8n is a separate setting.

The extension exposes the administrator-only method
`ЛДО_АвтоматизацияСервер.ОчиститьКэшАвтономныхОтветовN8N(days)` for response
retention. It removes large retained responses while keeping command receipts
and audit information. Repeating an expired command returns `result_expired`
and never reapplies the original write. Configure this on your 1C side to match
your retention policy.

## Direct HTTP

1. Configure the same local permissions and choose **Enable direct HTTP exchange**
   in the compatible extension. Save its profile ID, policy revision and profile
   token. A new token is shown only when issued.
2. Publish the extension's `ldo_n8n` HTTP service and make it reachable from n8n,
   either on your LAN/VPN or over HTTPS.
3. Create **LDO 1C Direct API** with the service URL, native 1C username/password,
   profile token, profile ID and policy revision. The profile belongs to the
   selected native user. Credential testing performs a read-only capabilities
   command directly against that database.
4. Choose **Direct HTTP** in the action node. Commands and PDFs return in the HTTP
   response. There is no Relay polling or automatic transport fallback.

Direct events use the extension's separately configured outgoing webhook
subscription. The Event and Delivery queue resources are unavailable in direct
mode. A shared MSRV bot is a separate service and must be explicitly connected.

## MSRV and existing workflows

Version 1 workflows keep the existing Relay behavior and credential IDs. New
version 2 workflows use MSRV only when **MSRV Service** is explicitly selected
and a Relay credential is supplied. An empty or broken standalone configuration
never switches to MSRV.

The native extension's standalone setup disconnects MSRV services. A customer
administrator can explicitly connect those services later, without changing the
standalone command transport. Server-side MSRV authorization remains required;
a local profile token or an n8n API key grants no access to MSRV resources.
