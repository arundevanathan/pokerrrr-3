# Production release

Production is `dunzo-club`, at https://dunzo-club.arun-devanathan.workers.dev/.
It serves the same client and multiplayer server as staging, built with
`NEXT_PUBLIC_APP_ENV=production` and `APP_ENV=production`. Both environments serve live multiplayer tables.

## Isolation

`wrangler.production.jsonc` declares a local `ClubTable` binding with its own
SQLite namespace, created on first deployment by `dunzo-club-v1`. The object name
is still `dunzo-club`, but namespaces are separate between Workers. Never add
`script_name` pointing at staging, rename the production Worker/namespace, delete
its storage, or import staging games. Only the initial production setup starts with an empty roster and history;
subsequent releases preserve the existing roster, balances and games. Provision real players using [PLAYERS.md](PLAYERS.md) against the
**production** namespace. Do not copy browser sessions, test accounts or game data.

## Validation

```sh
pnpm test
pnpm test:staging
pnpm test:production
pnpm typecheck
pnpm build:production
pnpm check:production
pnpm test:production:smoke
```

The production smoke test uses disposable local storage and cannot target remote
URLs. It checks the actual production artifact, login, private WebSockets,
reconnect/restart, chip reconciliation, no practice button in the rendered lobby,
403 responses for simulated history/settlement, and absence of staging-only tables.
CI builds and dry-runs production; it does not deploy.

## Cloudflare Builds

Connect `arundevanathan/pokerrrr-3`, branch `main`, root `/`, Node >=22.13.0 and
pnpm 11.25.0. Build command: `pnpm run build:production`.

Use `pnpm run deploy:production` only for the initial deployment (which creates
the namespace), or an explicitly approved migration release. After initial setup,
set the Cloudflare deploy command to `pnpm run upload:production`: pushes save a
candidate version without replacing the live version. Disable branch Preview
builds. Staging continues deploying automatically with its existing commands.

To release, identify and test the exact commit in staging, select the corresponding
production version under Deployments, and promote it to 100% traffic. Avoid
splitting traffic between game-server versions. If a namespace migration is needed,
review its compatibility separately; versions upload does not apply migrations.
Always build the intended environment immediately before upload/deploy because
both builds overwrite `dist/`. Guards reject the wrong environment or shared
storage bindings. The generated config already selects the environment; do not
pass `--env` to the generated artifact.

Verify `/api/health` reports environment `production`, the expected commit and
`multiplayerReady: true`. Before inviting players, verify login from two devices,
phone background/reconnect and the installed app at the production URL. An empty
roster is intentional until player records are provisioned.

For recovery, redeploy a known compatible previous version, preserving the Durable
Object namespace. Code rollback does not undo saved games or database migrations.
Keep release commit/version identifiers for support and reconciliation.

## Versioned releases

Maintain package.json, CHANGELOG.md and docs/releases/vX.Y.Z.md together.
Merge the reviewed release PR, build that exact main commit for production and
upload it without moving live traffic. The production Workers Builds trigger
uses build:production and upload:production on main; preview builds are disabled.
Promote the verified candidate to 100% traffic and confirm the live health commit.
After verification, commit docs/releases/vX.Y.Z-deployment.json with tag, commit,
workerVersion, rollbackVersion and verifiedAt fields. The release workflow checks
the live production health against that exact commit and publishes its GitHub
release/tag, including Worker and rollback identifiers. Only a deployment receipt
change on main starts publication; code merges alone do not publish a release. Never treat the staging artifact as
a production artifact or copy staging state into production.
