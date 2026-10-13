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

## Reviewer setup

1. Install the published package on a clean n8n instance.
2. Obtain an isolated test enrollment and compatible LDO extension from the service operator. Do not use customer data. No production or demo credentials are included in this repository.
3. Install the extension in the test 1C database, enable outbound polling, and publish a narrow test policy. See the connection guide.
4. Create an LDO Relay API credential with the issued database, token, profile, and policy identifiers. Match the minimum wait to the polling schedule.
5. Import `examples/get-capabilities.json`, select that credential, and execute Get Capabilities. Verify the dynamic object and field options.
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
- Creator Portal: ownership-confirmation step reached; submission is awaiting email verification. No submission identifier or n8n approval has been received.

Do not mark this package verified until n8n approves it.
