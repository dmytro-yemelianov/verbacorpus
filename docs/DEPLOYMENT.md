# Coordinated Verba releases

Public addresses follow one rule: directions have their own subdomains and do
not repeat their names in the path.

| Site | Canonical address |
| --- | --- |
| Umbrella | `https://verbacorpus.org/` |
| Proverbs | `https://pro.verbacorpus.org/` |
| Dictionary | `https://contra.verbacorpus.org/` |
| Editorial | `https://re.verbacorpus.org/` |
| Typography | `https://para.verbacorpus.org/` |
| Visual collections | `https://non.verbacorpus.org/` |
| UPA collection | `https://non.verbacorpus.org/upa/` |
| Alphabet laboratory | `https://para.verbacorpus.org/letters-lab` |

Main releases publish one gateway revision to the shared root/direction Worker
and the non Worker. The domain list is recorded in the Wrangler configurations;
`scripts/ensure-domains.mjs` verifies or attaches exact custom domains using the
Workers Domains API. It refuses to move a domain owned by another Worker.
Existing root/section paths and repeated direction prefixes redirect directly
to the final address. Query parameters and document fragments remain intact;
legacy archive context paths are migrated. Legacy POST bodies are forwarded
internally without changing their methods or payloads.

Manual workflows can still target `all` (default), `root` (including pro,
contra, re and para), or `non`. The public URL and redirect policy lives in
`app/src/shared/site-addresses.ts`; local previews retain explicit direction
paths while keeping UPA at `/upa/` and the alphabet laboratory at `/letters-lab`.

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

## Post-publication browser gate

Every successful deployment runs the integrated Chromium suite again with
`VERBA_INTEGRATION_URL=https://non.verbacorpus.org`. This reaches the actual
Cloudflare domains, service binding, assets, redirects and public APIs. The
production-only address case verifies ten one-hop legacy redirects and the
canonical metadata/navigation on all six site roots plus the archive and tools.
The same run checks editor exports, fonts, language changes, mobile layouts,
shared theme and the proverbs offline cache. A failed public check fails the
release job; retained traces and screenshots are uploaded as
`integrated-browser-failures`. No additional credentials are used for browsing.

A four-minute Playwright global timeout leaves time for failure evidence before
the five-minute CI step timeout. Main releases remain serialized so another
release cannot replace the deployed code while these checks are running.
