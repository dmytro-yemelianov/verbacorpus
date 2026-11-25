# Site reliability

The shared release runs the complete integrated browser suite in Chromium and
WebKit before and after publication. WebKit is an engine check, not a substitute
for testing a particular installed Safari version. Browser-generated PDF byte
assertions use Chromium's PDF API; WebKit still exercises print CSS, PNG/SVG
exports, document persistence, navigation, fonts and the offline proverb view.

## Scheduled public checks

[Site health](../.github/workflows/site-health.yml) runs at minutes 17 and 47 of
each UTC hour, after successful main CI releases, and on manual dispatch.
GitHub schedules can be delayed; this is a periodic synthetic check, not a
continuous availability guarantee. It needs no Cloudflare token, private UPA
checkout or deploy key.

Each engine checks all six canonical roots, visible content, canonical metadata,
shared direction links, the author link to `https://yemelianov.dev/`, theme changes
and persistence after reload, return navigation, UPA/catalogue/editor and alphabet
tool entry links, proverb search and both public APIs. Uncaught JavaScript errors,
failed same-site assets and HTTP errors fail the check. Initial network activity
settles before reload/navigation so cancelled background requests are not treated
as page-load failures.

Failed runs remain visible in Actions. JSON results and failure screenshots/traces
are uploaded as `site-health-chromium` and `site-health-webkit` for 14 days. A run
summary distinguishes a first-pass result from a retry that recovered. Notification
delivery follows the repository's existing GitHub Actions notification settings.

Run the same checks from `app`:

```sh
npm ci
npx playwright install chromium webkit
npm run test:health
# One engine:
npm run test:health -- --project=webkit
```

Local artifacts are under `app/node_modules/.cache/verba-health/`; the health
suite never rebuilds or publishes the corpus.

## Early browser diagnostics

The Worker injects a small inline listener before external assets, with a fresh
CSP nonce wherever the source response has a script policy. Existing CSP
restrictions remain in place. The normal shared shell script remains deferred.
`npm run build` compiles `src/client/diagnostics.ts` into the committed
`content/diagnostics-bootstrap.json`; CI checks that this generated file matches
its source. UTF-8 is explicit in transformed HTML response headers.

The listener sends a same-origin JSON POST to `/_diagnostics` for:

- Script exceptions and unhandled promise rejections.
- Failed same-origin scripts, stylesheets and images.
- Missing visible main content/navigation after 15 seconds on a visible page.
  Print views and background tabs are excluded from this check.

It sends at most six distinct events per page, without persistent identifiers or
an offline queue. Delivery is best effort. The Worker validates the origin,
limits each body to 4 KiB (including streamed requests), accepts only known event
kinds and fields, and uses a Cloudflare rate-limit binding (20 requests per 60
seconds per IP/location). The IP is used as a limiter key, not added to the
application's diagnostic payload. Rate-limit binding failures return 503 and do
not affect page rendering.

Accepted events appear in the existing Cloudflare Workers Logs for
`ukr-proverbs-corpus` or `non-verba`. Search for `verba_client_diagnostic`.
Fields include site, browser family and major version, event kind, pathname, same-origin resource
pathname, allowlisted error name, line/column, document readiness, elapsed time,
online state and service-worker control. The collector drops query strings,
fragments, arbitrary messages/stacks and unknown fields. It does not read form
values, document text, cookies or local storage.

A failure before the HTML/bootstrap arrives cannot report itself; the scheduled
browser checks cover that case. Fault-injection integration tests verify that
reports survive a failed shell request, detect removed content, omit private
URL/document strings, respect the source CSP, and reach the actual local Worker
intake. Controlled synthetic payloads are not sent to public logs by CI.
