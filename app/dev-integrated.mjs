import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const app = import.meta.dirname;
const upa = resolve(process.env.UPA_REPO || resolve(app, '../../upa-archive'));
await access(resolve(upa, 'site/wrangler.jsonc'));
const wrangler = resolve(upa, 'node_modules/wrangler/bin/wrangler.js');
await access(wrangler);
for (const [command, args, cwd] of [
  ['pnpm', ['site:build', '--sources'], upa],
  ['npm', ['run', 'build'], app],
]) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const state = resolve(app, process.env.VERBA_STATE_DIR || '.wrangler/integrated');
const server = spawn(process.execPath, [wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', process.env.VERBA_PORT || '8793', '--persist-to', state, '-c', resolve(app, 'wrangler.jsonc'), '-c', resolve(upa, 'site/wrangler.jsonc')], {
  cwd: app, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('error', error => { console.error(error); process.exitCode = 1; });
server.on('exit', code => { process.exitCode = code ?? 0; });
