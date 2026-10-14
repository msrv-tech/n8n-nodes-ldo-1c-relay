# Standalone 1C connections

This guide describes version 0.3.0 and the matching UNF 6.7.1.0 extension.
Version 0.2.0 does not include the simple credentials or pairing wizard.

Node version 2 defaults to **Standalone Queue**. It never supplies an MSRV URL,
activation key, subscription check, or Relay fallback. Your n8n and compatible
1C extension handle the exchange. MSRV services require separate, explicit
onboarding and valid service credentials.

The extension is distributed separately under its own terms. Standalone
transport requires the new extension implementation, introduced in UNF 6.7.1.0.
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

1. Create an n8n API key that can read/write Data Tables and create/activate
   workflows. Keep this key in encrypted n8n credentials; never give it to 1C.
2. Save an **LDO 1C Standalone Queue API** credential with your own n8n URL and
   API key. Set Minimum Wait to match the database polling schedule.
3. In **LDO 1C → Connection → Create Connection**, select that credential and
   give the connection a name. The node creates the table and activates a
   separate Queue Gateway workflow through the public n8n API.
4. Copy the returned pairing code. In 1C, choose the permitted objects, fields,
   print forms and operations, paste the code and choose **Подключить очередь
   по коду** (Connect queue using code). Only a 1C administrator can pair it.
   The code expires after 15 minutes. An exact retry recovers a lost response;
   the same code cannot bind another database or profile.
5. In business workflows, choose **Standalone Queue**, the saved credential,
   and the new **Connection** from the list. Database/profile/policy identifiers
   are discovered automatically. Configure the extension's polling schedule.

Use HTTPS for production. The production gateway URL must be reachable from
1C. If it differs from the credential's API URL, enter **Public n8n URL** when
creating the connection. A container's `localhost` refers to that container.

The extension generates its own persistent exchange key during pairing. The
n8n API key stays in n8n; the gateway stores only secret hashes in its connection
record. Pairing requests are handled directly without workflow executions.
Treat the pairing-code output as a secret and configure its workflow's execution
retention accordingly.

**Connection → Get Status**, **Renew Pairing Code**, and **Disconnect** manage
this connection. Disconnect before pairing a different database. If initial
workflow setup fails, the incomplete connection is unavailable; correct API
permissions and create a new connection. Its retained artifacts can be inspected
and removed through the usual n8n UI.

The native poller synchronizes changes to the local policy before fetching
commands. Credentials do not need manual revision updates. Commands still carry
the policy under which they were created: pending commands from an older policy
fail explicitly, while leased results and retained results remain available
within their original database/profile scope. No automatic write replay occurs.

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

1. Configure local permissions and choose **Enable direct HTTP exchange** in
   the compatible extension. This explicitly enables the current native user's
   access profile; merely knowing a 1C password does not enable the API.
2. Publish the extension's `ldo_n8n` HTTP service and make it reachable from n8n,
   on your LAN/VPN or over HTTPS.
3. Create **LDO 1C Direct API** using only the service URL, native 1C username
   and password. Credential testing performs read-only `GET /connection`.
   Profile ID, Policy Revision and Profile Token are not entered.
4. Choose **Direct HTTP** in the action node. The node discovers the native
   user's active profile before each command. 1C rechecks its policy, grants,
   object revision and native permissions when executing the command.

There is no separate profile token. A missing, disabled, foreign or ambiguous
profile is rejected. A policy change between discovery and execution rejects
the command instead of retrying a write with new permissions.

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
a local profile or an n8n API key grants no access to MSRV resources.
