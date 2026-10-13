# Release and verification

The GitHub repository, npm package, and n8n verification are separate release stages. Publishing source does not make the package installable from npm or the n8n Cloud panel.

## Configure publishing

The `publish.yml` workflow supports npm Trusted Publishing through GitHub OIDC. Configure npm to trust owner `msrv-tech`, repository `n8n-nodes-ldo-1c-relay`, and workflow `publish.yml`. Allow direct `npm publish` and leave the environment name blank. The release uses Node.js 24 and npm 11.21.0.

Trusted Publishing was configured on 2026-10-13. Starting with version `0.1.1`, the release workflow uses OIDC only and does not read `NPM_TOKEN`. Version `0.1.0` used a granular token to bootstrap the first publication. Future releases do not depend on the lifetime of the bootstrap token. Never commit a token or `.npmrc`. See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) and [n8n publication requirements](https://docs.n8n.io/integrations/community-nodes/building-community-nodes.md).

## Publish a version

1. Run `npm ci` and `npm run check`.
2. Update `package.json`, the lockfile, and `CHANGELOG.md`.
3. Commit and push to `main`.
4. Push a tag matching the package version, such as `v0.1.0`. The workflow checks the version, runs all checks, and executes `npm publish --provenance --access public`.
5. Confirm the workflow and npm publication succeeded. Update the README status only after confirmation.

If authentication fails, correct the npm configuration and rerun the existing release job. Alternatively, run `gh workflow run publish.yml --ref v0.1.0` for that release. Manual runs from `main` are rejected; do not move a published version tag to another commit.

After publication, run `npx @n8n/scan-community-package@stable n8n-nodes-ldo-1c-relay@0.1.0` and confirm that it reports success. This checks registry provenance as well as the attested source and published JavaScript. Local static analysis alone does not verify registry provenance.

Do not use `npm run release` to publish from a local machine. The CLI script comes from the scaffold; the documented publication path is the tag-triggered workflow.

## Submit for verification

After publication, submit the package through the [n8n Creator Portal](https://creators.n8n.io/nodes). Include the public repository, English docs, requirements for testing Relay with a supported extension, and example workflows.

Check the [technical guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines) and [UX guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/ux-guidelines). Approval is subject to n8n review. Do not advertise verified status until it is confirmed.
