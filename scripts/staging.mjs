import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { validateStagingArtifact } from '../lib/staging-artifact.mjs';
const [command, ...extra] = process.argv.slice(2);
if (extra.length && command !== 'dev' || !['build', 'check', 'preview', 'deploy', 'dev'].includes(command)) {
  throw new Error('Usage: node scripts/staging.mjs build|check|preview|deploy|dev (overrides only for local dev)');
}
function run(args, environment = process.env) {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: environment
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (command === 'dev') {
  run(['node_modules/vite/bin/vite.js', ...extra], {
    ...process.env,
    POKER_DEPLOY_TARGET: 'staging',
    CLOUDFLARE_ENV: 'staging'
  });
  process.exit(0);
}
if (command === 'build') {
  run(['scripts/write-build-info.mjs']);
  run(['node_modules/vinext/dist/cli.js', 'build'], {
    ...process.env,
    POKER_DEPLOY_TARGET: 'staging',
    CLOUDFLARE_ENV: 'staging'
  });
  // Preview bindings are intentionally separate from the main Worker settings.
  const path = 'dist/server/wrangler.json',
    config = JSON.parse(readFileSync(path, 'utf8'));
  config.previews = {
    vars: {
      APP_ENV: 'staging'
    },
    durable_objects: {
      bindings: [{
        name: 'CLUB_TABLE',
        class_name: 'ClubTable'
      }]
    }
  };
  writeFileSync(path, JSON.stringify(config, null, 2));
}
validateStagingArtifact();
if (command === 'deploy') run(['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'dist/server/wrangler.json']); else if (command === 'preview') run(['node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'dist/server/wrangler.json', '--local', '--ip', '127.0.0.1', '--port', '8787', '--inspector-port', '0']); else console.log('Verified Dunzo Club multiplayer artifact for dunzo-club-staging.');
