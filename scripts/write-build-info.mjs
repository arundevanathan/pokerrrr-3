import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const git = (args, fallback) => {
  try {
    return execFileSync('git', args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).trim() || fallback;
  } catch {
    return fallback;
  }
};
const builtAt = process.env.SOURCE_DATE_EPOCH ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString() : new Date().toISOString();
const info = {
  schemaVersion: 1,
  builtAt,
  revision: git(['rev-parse', '--short', 'HEAD'], 'unknown'),
  dirty: git(['status', '--porcelain'], '') !== ''
};
writeFileSync(new URL('../public/build-info.json', import.meta.url), `${JSON.stringify(info, null, 2)}\n`);
