# Coordinated Verba releases

Pushes to `main` publish the same gateway revision to both `verbacorpus.org`
and `non.verbacorpus.org`. The root opens the five-direction umbrella; the
proverb application is at `/pro/`. The non domain opens its own direction and
serves UPA at `/non/upa/`. Existing proverb APIs, short links and social cards
retain their routes. A manual workflow may select `all` (default), `root`, or
`non` for an intentionally limited release.

`app/content/upa-release.json` pins the exact reviewed UPA commit. The release
job checks out that private repository using `UPA_DEPLOY_KEY`, a read-only SSH
deploy key scoped to UPA. The key is stored in Verba Actions secrets and is not
exposed to PR jobs. `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
authenticate publication.

Before publishing, the job runs Verba and Python tests, UPA lint/type/unit
checks, builds both sites and runs integrated Chromium checks. These cover
all five directions, shared navigation/theme on desktop and mobile, the
proverb offline view, mounted UPA APIs, frames, fonts and alphabet provenance.
Browser failure evidence is retained as an Actions artifact.

UPA is deployed first. The gateway uses its locked CLI to upload a version,
then deploy that exact CI run/attempt tag at 100% on each selected domain.
This follows [Cloudflare versioned deployment](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/)
and retains existing domain routes and cron schedules. Final HTTP checks
verify both public hosts and the mounted editor and API. The private repo's
own runner availability is not required by this public release workflow.

To release future UPA work, merge its reviewed PR, update the pinned full SHA
in a Verba PR, and merge it. Runtime and builds use vendored font and alphabet
data; no Texted checkout or private draft library is needed.

The shared shell is injected by `app/src/site-shell.ts` for every HTML entry,
including mounted UPA, proverb detail pages and editorial pages. Assets and
API payloads retain their original bytes. A non-sensitive domain-wide theme
preference keeps the umbrella and non subdomain aligned. Integrated local
previews explicitly keep navigation on localhost, even when Wrangler supplies
a production hostname internally.
