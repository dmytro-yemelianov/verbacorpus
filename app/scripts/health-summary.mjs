import { readFileSync, appendFileSync, existsSync } from 'node:fs';

const file = 'node_modules/.cache/verba-health/results.json';
const result = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { stats: {} };
const { expected = 0, unexpected = 0, flaky = 0, skipped = 0 } = result.stats;
const summary = !existsSync(file) ? '## Public site health\n\nBrowser results were not produced. Inspect the setup/browser steps for the failure.\n' : `## Public site health\n\nPassed: ${expected} · Failed: ${unexpected} · Retried successfully: ${flaky} · Skipped: ${skipped}\n\nChromium/WebKit check rendered content, canonical navigation, author attribution, themes, primary tools and APIs. Failure evidence is attached to this run.\n`;
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
else process.stdout.write(summary);
