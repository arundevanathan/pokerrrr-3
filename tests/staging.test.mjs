import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stagingResponse } from '../lib/staging-handler.mjs';
import { validateStagingArtifact } from '../lib/staging-artifact.mjs';
test('health identifies Dunzo Club and reports actual runtime readiness', async () => {
  for (const ready of [true, false]) {
    const r = stagingResponse(new Request('https://example.test/api/health'), 'staging', 'a'.repeat(40), ready);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await r.json(), {
      app: 'Dunzo Club',
      environment: 'staging',
      version: 'a'.repeat(40),
      mode: 'multiplayer',
      multiplayerReady: ready
    });
  }
  assert.equal(stagingResponse(new Request('https://example.test/api/poker'), 'staging', 'commit'), null);
});
test('deploy guard requires the intended coordinator and rejects other persistent/service bindings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dunzo-staging-')),
    path = join(directory, 'wrangler.json');
  const valid = {
    name: 'dunzo-club-staging',
    vars: {
      APP_ENV: 'staging'
    },
    durable_objects: {
      bindings: [{
        name: 'CLUB_TABLE',
        class_name: 'ClubTable'
      }]
    },
    migrations: [{
      tag: 'dunzo-club-v1',
      new_sqlite_classes: ['ClubTable']
    }]
  };
  try {
    for (const invalid of [{
      ...valid,
      name: 'dunzo-club-prod'
    }, {
      ...valid,
      vars: {
        APP_ENV: 'production'
      }
    }, ...['d1_databases', 'r2_buckets', 'services'].map(key => ({
      ...valid,
      [key]: [{}]
    })), {
      ...valid,
      durable_objects: {
        bindings: []
      }
    }, {
      ...valid,
      durable_objects: {
        bindings: [{
          name: 'CLUB_TABLE',
          class_name: 'Other'
        }]
      }
    }, {
      ...valid,
      durable_objects: {
        bindings: [{
          name: 'CLUB_TABLE',
          class_name: 'ClubTable',
          script_name: 'production'
        }]
      }
    }, {
      ...valid,
      migrations: []
    }, {
      ...valid,
      previews: {
        vars: {
          APP_ENV: 'production'
        },
        durable_objects: valid.durable_objects
      }
    }, {
      ...valid,
      previews: {
        vars: {
          APP_ENV: 'staging'
        },
        durable_objects: {
          bindings: [{
            name: 'CLUB_TABLE',
            class_name: 'ClubTable',
            script_name: 'production'
          }]
        }
      }
    }, {
      ...valid,
      previews: {
        vars: {
          APP_ENV: 'staging'
        },
        durable_objects: valid.durable_objects,
        services: [{}]
      }
    }]) {
      writeFileSync(path, JSON.stringify(invalid));
      assert.throws(() => validateStagingArtifact(path));
    }
    writeFileSync(path, JSON.stringify(valid));
    assert.equal(validateStagingArtifact(path).name, valid.name);
    writeFileSync(path, JSON.stringify({
      ...valid,
      previews: {
        vars: {
          APP_ENV: 'staging'
        },
        durable_objects: valid.durable_objects
      }
    }));
    assert.equal(validateStagingArtifact(path).previews.durable_objects.bindings[0].class_name, 'ClubTable');
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});
