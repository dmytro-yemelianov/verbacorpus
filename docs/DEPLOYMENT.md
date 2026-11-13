# non.verba releases

Pushes to `main` run the application and data-pipeline tests, then publish
`non.verbacorpus.org`. The root-domain Worker is deployed only by an explicit
manual CI run with `target=root`; ordinary merges do not roll out the umbrella
to the root domain.

`app/content/upa-release.json` pins the exact reviewed UPA commit. The release
job checks out that private repository with `UPA_DEPLOY_KEY`, a read-only SSH
deploy key scoped to UPA. The key is stored only in Verba's Actions secrets and
is not exposed to PR jobs. Existing `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` authenticate deployment.

The job installs UPA's pinned pnpm dependencies, runs lint/type/unit checks,
builds the source-backed site, and deploys the private UPA service first. It
then builds Verba and uses its locked Wrangler CLI to upload a version and
deploy that exact CI-tagged version to 100% of traffic on the existing domain.
This follows [Cloudflare versioned deployment](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/)
and does not require permission to edit zone routes. Domain and cron changes
are separate infrastructure operations; ordinary releases retain them. HTTP smoke checks verify
the published page editor and UPA API. The public workflow can perform these
checks even while the private repository's own runners are unavailable.

To release another UPA change, merge its reviewed PR, update the pinned full
commit SHA in a Verba PR, and merge that PR. This keeps source and deployment
revisions reviewable and avoids silently following a moving private branch.
Local development may still use an explicit `UPA_REPO` checkout.

The editor at `/non/upa/page-frames` supports title/body/date/signature, document
presets, browser-local saves and font settings. Text is kept in the URL fragment;
the server receives only the frame query parameters. Its Texted/Verba font data
and full licence records are vendored in UPA, so release builds do not require a
Texted checkout or the private font-draft library.
