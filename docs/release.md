# Release and verification

The GitHub repository, npm package, and n8n verification are separate release stages. Publishing source does not make the package installable from npm or the n8n Cloud panel.

## Configure publishing

The `publish.yml` workflow supports npm Trusted Publishing through GitHub OIDC. Configure npm to trust owner `msrv-tech`, repository `n8n-nodes-ldo-1c-relay`, and workflow `publish.yml`. Allow direct `npm publish` and leave the environment name blank. The release uses Node.js 24 and npm 11.21.0.

Trusted Publishing was configured and validated by a successful `0.1.1` release on 2026-10-13. npm reports the connection status as **Valid**. Starting with version `0.1.1`, the release workflow uses OIDC only and does not read `NPM_TOKEN`. Version `0.1.0` used a granular token to bootstrap the first publication. Future releases do not depend on the lifetime of the bootstrap token. Never commit a token or `.npmrc`. See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) and [n8n publication requirements](https://docs.n8n.io/integrations/community-nodes/building-community-nodes.md).

## Publish a version

1. Run `npm ci` and `npm run check`.
2. Update `package.json`, the lockfile, and `CHANGELOG.md`.
   Also update `docs/capabilities/release.json` with the exact version, required
   core, date and concise user-facing changes. Update both `README.md` and
   `README.ru.md`, including their current node/core pair. Every new operation or feature
   needs `introducedIn.nodeVersion` and `introducedIn.coreVersion` in the registry;
   preserve these values on later releases. Run `npm run docs:build`.
3. Commit and push to `main`.
4. Push a tag matching the package version, such as `v0.1.0`. The workflow checks the version, runs all checks, and executes `npm publish --provenance --access public`.
5. Confirm the workflow and npm publication succeeded. Update the README status only after confirmation.

If authentication fails, correct the npm configuration and rerun the existing release job. Alternatively, run `gh workflow run publish.yml --ref v0.1.0` for that release. Manual runs from `main` are rejected; do not move a published version tag to another commit.

After publication, run `npx @n8n/scan-community-package@stable n8n-nodes-ldo-1c-relay@0.1.0` and confirm that it reports success. This checks registry provenance as well as the attested source and published JavaScript. Local static analysis alone does not verify registry provenance.

Complete the release from the release PC with the local LDO documentation publisher:

```bash
bash /home/alex/bsl/ldo/cloud/landing-tools/publish-node-knowledge.sh --publish
```

It reads the published npm package, checks explicit compatibility against CORE
release tags, then updates HTML, Markdown, JSON and the user-facing release history
in one delivery. The command commits the generated snapshot and deploys only the
website to the LAN host. A missing compatible core or release record stops the
update and preserves the previous site. Run without `--publish` for a preview.
The wrapper creates an ignored local Python environment and installs its dependencies.
No additional GitHub Actions, cron job, npm token or cross-repository secret is used
for website publication. The existing npm Trusted Publishing workflow is unchanged.

Updating public documentation does not upgrade managed MSRV instances or imply
n8n verification. See the LDO `docs/node-knowledge-publication.md` runbook.

## Submit for verification

After publication, submit the package through the [n8n Creator Portal](https://creators.n8n.io/nodes). Include the public repository, English docs, requirements for testing Relay with a supported extension, and example workflows.

Check the [technical guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines) and [UX guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/ux-guidelines). Approval is subject to n8n review. Do not advertise verified status until it is confirmed.
