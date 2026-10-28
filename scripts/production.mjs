import { spawnSync } from 'node:child_process';
import { validateProductionArtifact } from '../lib/production-artifact.mjs';

const [command, ...extra] = process.argv.slice(2);
if (extra.length || !['build', 'check', 'deploy', 'upload'].includes(command)) {
  throw new Error('Usage: node scripts/production.mjs build|check|deploy|upload');
}
function run(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (command === 'build') {
  run(['scripts/write-build-info.mjs']);
  run(['node_modules/vinext/dist/cli.js', 'build'], {
    ...process.env,
    POKER_DEPLOY_TARGET: 'production',
    CLOUDFLARE_ENV: 'production'
  });
}
validateProductionArtifact();
if (command === 'deploy' || command === 'upload') {
  run(['node_modules/wrangler/bin/wrangler.js',
    ...(command === 'upload' ? ['versions', 'upload'] : ['deploy']),
    '--config', 'dist/server/wrangler.json']);
} else {
  console.log('Verified isolated production artifact for dunzo-club.');
}
