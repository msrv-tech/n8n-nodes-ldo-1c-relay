# Verification submission details

## Package identity

- npm package: `n8n-nodes-ldo-1c-relay`
- Initial release version: `0.1.0`
- Node: **LDO Relay for 1C**
- Credential: **LDO Relay API**
- Repository: https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay
- Documentation: https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay#readme
- Connection guide: https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/docs/connection.md
- Support: https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/issues
- License: MIT for this node package

## Integration description

LDO Relay for 1C connects n8n to an administrator-configured 1C database through the LDO Relay API. The 1C extension makes outbound requests to Relay, executes permitted operations, and returns correlated results. The node supports document and catalog reads and controlled field updates, reference selection, PDF retrieval and delivery confirmation, approval events, and external process lifecycles.

The package integrates one service, LDO Relay. The 1C extension and Relay enrollment are separate prerequisites. Operations are restricted by the database's published object catalog, profile, grants, policy revision, and object revision. The node accepts no arbitrary BSL, SQL, or HTTP execution input.

## Authentication and data access

The operator issues a token scoped to one enrolled database. The credential also identifies the local profile and policy revision, which the extension validates. n8n stores the token as an encrypted password field. Credentials can be rotated or revoked by the operator.

Requests use Bearer authentication to the configured Relay URL. The node reads no environment variables or local files and declares no runtime dependencies. PDF data uses n8n's binary-data helpers; size, header, and SHA-256 are checked before returning a file.

## Standalone reviewer setup for 0.2.0

Use self-hosted n8n 2.36.9 and the separately supplied UNF extension 6.6.1.0.
Follow [Standalone connection setup](standalone.md) to create your own Data Table,
API credential and authenticated queue gateway. MSRV enrollment is unnecessary.
Review the queue's production webhook and the action node as distinct nodes.

Test Get Capabilities, document read/update and PDF on disposable native fixtures.
Exercise event lease/retry/acknowledgement and the Wait/Get Result pattern. Connect
the action node as an AI tool to your own model. Repeat using Direct HTTP when the
test database has a publication. Update both gateway and action credentials after
changing the local policy revision.

Actual standalone workflows passed for capabilities, native invoice reads, PDF,
events, a persisted 65-second Wait and an AI Agent using local Ollama. Eight
competing Data Table lease requests produced one owner, retained results survived
an n8n restart, and queue gateway polling created zero workflow executions.
These checks used self-hosted n8n; they do not establish n8n Cloud compatibility
or manual verification of version 0.2.0.

## Historical Relay reviewer setup for 0.1.x

1. Install the published package on a clean n8n instance.
2. Obtain an isolated test enrollment and compatible LDO extension from the service operator. Do not use customer data. No production or demo credentials are included in this repository.
3. Install the extension in the test 1C database, enable outbound polling, and publish a narrow test policy. See the connection guide.
4. Create an LDO Relay API credential with the issued database, token, profile, and policy identifiers. Match the minimum wait to the polling schedule.
5. Import the Get Capabilities example from the reviewed 0.1.x package, select that credential, and execute Get Capabilities. With the 0.2.0 example, explicitly select MSRV Service. Verify the dynamic object and field options.
6. Test a document read and a permitted field update on an unposted fixture. Confirm that an unknown field and stale revision are rejected.
7. Exercise an external process with start, transition, process-field update, and get. Check the local process state and audit; process fields must remain separate from document fields.
8. Remove fixtures and revoke the test enrollment token after review.

## Validation evidence

Prepublication checks on 2026-10-13 passed:

- `npm ci`, `npm run check`, and inspection of the npm archive.
- Static source and packaged-JavaScript analysis using the official `@n8n/scan-community-package` scanner, stable version `0.35.1`.
- Eleven node test scenarios covering credentials, dynamic capabilities, references, document/catalog updates, external processes, PDFs, events, acknowledgements, and retries.
- Registration, encrypted credential storage, and authenticated workflow execution in a disposable n8n 2.36.9 instance.
- A real n8n 2.36.9 workflow through Relay to an isolated 1C database with LDO 6.5.1.0. Seven operations completed: process start, transition, process-field update, final transition, document read, document-field update, and process get. The final process was approved at revision 4, four audit events matched, the document comment changed, and fixtures were removed.

Registry provenance and the full published-package scan were confirmed on 2026-10-13. These results do not constitute n8n verification.

## Publication record

- Package: [n8n-nodes-ldo-1c-relay@0.1.0](https://www.npmjs.com/package/n8n-nodes-ldo-1c-relay/v/0.1.0).
- Release tag: [v0.1.0](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/tree/v0.1.0), commit `2ebfe727aea675c9f01d06f9be330f3e2dc0f96c`.
- Successful [Publish workflow, attempt 2](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/actions/runs/38346000876/attempts/2).
- [npm provenance attestation](https://registry.npmjs.org/-/npm/v1/attestations/n8n-nodes-ldo-1c-relay@0.1.0) and [Sigstore transparency entry](https://search.sigstore.dev/?logIndex=3241217395).
- Official `@n8n/scan-community-package` stable `0.35.1` full registry scan: `passed: true`. The scanner verified provenance, fetched the attested source commit, and analyzed both source and published JavaScript.
- [Creator Portal submission](https://creators.n8n.io/nodes/n8n-nodes-ldo-1c-relay/integration): ownership confirmed and automated review completed successfully on 2026-10-13. Manual review is awaiting a demonstration video. Final n8n approval has not been received.

Do not mark this package verified until n8n approves it.

## Token-free release 0.1.1

Version `0.1.1` includes updated release and verification documentation; node behavior and credential format are unchanged.

- [npm package version](https://www.npmjs.com/package/n8n-nodes-ldo-1c-relay/v/0.1.1).
- [Release tag v0.1.1](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/tree/v0.1.1), commit `5b30a9e792bf243ea6fb06ad681325fb92c630c8`.
- [Successful Publish workflow](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/actions/runs/38349546873): GitHub OIDC authentication; no npm publish secret is read by this workflow.
- npm Trusted Publisher connection: **Valid**, owner `msrv-tech`, repository `n8n-nodes-ldo-1c-relay`, workflow `publish.yml`, direct publication allowed, no GitHub environment constraint.
- [npm provenance](https://registry.npmjs.org/-/npm/v1/attestations/n8n-nodes-ldo-1c-relay@0.1.1) and [Sigstore transparency entry](https://search.sigstore.dev/?logIndex=3241662450).
- Published archive integrity matches the registry metadata. Official full registry scan (`@n8n/scan-community-package` stable `0.35.1`): `passed: true`, including provenance, attested TypeScript source, and published JavaScript.

The existing Creator Portal submission passed automated review for the initial release and awaits its demonstration video. This patch release does not confer n8n verification.

## Required manual-review demonstration

The Creator Portal requests an uninterrupted screen recording of five minutes or less. Install version `0.1.0` from npm in n8n, add the node to a new workflow, configure a credential and show a successful credential test, then execute common operations. If treated as an app node, also show one action used as an AI agent tool. Record only an isolated demo with disposable credentials and fixtures; do not expose tokens or customer data.


## Standalone publication record

- [npm 0.2.0](https://www.npmjs.com/package/n8n-nodes-ldo-1c-relay/v/0.2.0).
- [Tag v0.2.0](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/tree/v0.2.0), commit `9f75265383e95ae26d13f8f5eab9be754b88ad17`.
- [Successful OIDC Publish workflow](https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/actions/runs/38382483325).
- Full official published-package scan passed, including provenance, attested source and npm JavaScript, on 2026-10-13.
- Creator Portal still displays Manual Review: Awaiting Video. The package is not verified for n8n Cloud.
