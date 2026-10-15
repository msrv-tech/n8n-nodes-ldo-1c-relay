# Connection and extension setup

For the complete operation reference, transport matrix and validation evidence, see the [capabilities registry](capabilities/README.md).

This page describes the managed Relay mode. For your own queue or direct HTTP without MSRV, see [Standalone connections](standalone.md).

## Prerequisites

You need an LDO Relay enrollment provisioned by the service operator, a supported 1C database, and the LDO extension supplied for that configuration. Obtain the compatible extension and enrollment details from your LDO provider. This repository distributes the n8n node only and does not distribute a CFE binary.

## Set up the database

1. Install the compatible LDO extension using your provider's procedure. Hosted databases may require extension approval and installation by the hosting provider.
2. Enroll the database with Relay. The operator issues a database ID, profile ID, policy revision, and scoped n8n API token.
3. Configure outbound access to Relay and enable the extension polling job.
4. Publish a local policy that permits the document types, fields, print forms, and process operations needed by your workflows. The extension enforces these permissions.

## Set up n8n

1. Add **LDO Relay for 1C** and create an **LDO Relay API** credential.
2. Enter the issued values. Use the Relay service URL, not a 1C web client URL. Use HTTPS for remote connections.
3. Match **Minimum Wait (Seconds)** to the database polling schedule. The default is 900.
4. Test the credential. This reads cached capabilities and does not queue a command or modify the database. An empty cache may still require the next step.
5. Execute **1C Operation → Get Capabilities** to refresh capabilities. After completion, reopen the dynamic selectors.

## Token handling

Use a scoped token for this database/profile. Store it in credentials, not workflow expressions, JSON exports, or source control. Rotate it when enrollment changes. Update profile and policy revision after publishing a new policy.

## Troubleshooting

| Symptom                       | Check                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Credential test fails         | Relay URL, token validity, profile, policy revision, and network reachability                                                   |
| Selectors are empty           | Get Capabilities has completed and the policy publishes the requested objects                                                   |
| Operation times out           | The extension polling job is enabled and the timeout permits its schedule; inspect the original command before rerunning writes |
| Revision conflict             | Read the object again and review concurrent changes                                                                             |
| Reference lookup is ambiguous | Refine the query until exactly one permitted reference is returned                                                              |
