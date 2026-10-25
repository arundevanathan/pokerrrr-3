# Static players and PIN login

One private group uses one fixed roster. There is no registration, club access
code, room-code entry or membership UI. Anyone signed in can start the one active
game; all other signed-in players see it and can join. Name selection identifies
the account and the four-digit PIN authenticates it. Duplicate PINs are allowed
because identity is selected first; names are unique.

## Add a player directly to the database

1. Open the deployed app once so the existing `ClubTable` object initializes the
   additive `players` and `player_sessions` SQL tables.
2. Locally run:

   ```sh
   node scripts/create-player.mjs --name "Player name"
   ```

   Enter the initial four-digit PIN at the hidden prompt. It accepts leading
   zeroes. The command prints an SQL INSERT containing a generated UUID, display
   name, random salt and PBKDF2-SHA256 hash. It never prints or stores the plaintext
   PIN. It does not connect to Cloudflare or modify any database.
3. In Cloudflare, open **Durable Objects → the existing ClubTable namespace →
   Data Studio**. Select the object by its existing name **`dunzo-club`**. Do not
   select/create a different object: that would give the app a different roster.
4. Review and run the generated INSERT in the SQL editor. Do not insert the PIN
   itself into `pin_hash` and do not store it in Git.
5. Give that player their initial PIN privately. They can select their name and
   sign in, then use their name button → **Change PIN** to choose another.

Cloudflare Data Studio supports reads and writes for SQL-backed Durable Object
storage: [official documentation](https://developers.cloudflare.com/durable-objects/observability/data-studio/).
Only the player tables need editing; leave game, receipt and archive keys intact.

## Local development

The smoke runner seeds its own temporary SQLite file and deletes it afterward.
For a manual local preview, open the app once to initialize the schema, stop the
preview, then use a local SQLite editor to apply the helper's generated INSERT to
that preview's `ClubTable` database under `.wrangler/state/v3/do/`. Select the
object's hexadecimal `.sqlite` file, not `metadata.sqlite`, then restart the preview.
Never edit a running local SQLite file. The Cloudflare Data Studio instructions
above apply only to deployed storage.

## Existing games and identity mapping

Existing game/history data is preserved, but legacy browser UUIDs are no longer
credentials. If a legacy player must keep an occupied seat or historical identity,
use their existing player UUID when generating the account:

```sh
node scripts/create-player.mjs --name "Player name" --id "existing-player-UUID"
```

The legacy UUID was stored as `hg-player` in that player's browser. Match each
UUID to its actual owner before creating the row; never guess from names or change
stacks/balances to merge identities. If legacy identities cannot be verified, end
and reconcile the legacy game before release. Local implementation does not import,
reset or reassign live player balances automatically.

## Sessions, PIN changes and owner resets

PINs are four digits, salted and hashed with PBKDF2-SHA256 (100,000 iterations).
Five wrong PINs lock that account for 15 minutes; the failure/lockout state is
persisted, so restarting the Worker does not reset it. The session cookie is
HttpOnly, SameSite=Strict, Secure on HTTPS and expires after 30 days. Only a hash
of its random token is stored in `player_sessions`.

A PIN change requires the current PIN, preserves the player's UUID/seat and issues
a new current session while invalidating every older session. Logout revokes the
current session. Disabling a player invalidates their access on subsequent HTTP
requests or WebSocket messages/updates without deleting any game/history data:

```sql
UPDATE players SET enabled=0, auth_version=auth_version+1 WHERE id='player-UUID';
```

For a forgotten PIN, generate fresh salt/hash values with the local helper, then
use those values in an UPDATE rather than inserting a duplicate account:

```sql
UPDATE players
SET pin_salt='generated-salt', pin_hash='generated-hash',
    auth_version=auth_version+1, failed_attempts=0, locked_until=0
WHERE id='player-UUID';
```

Do not delete player IDs when retiring accounts. Existing session results and chip
accounting depend on stable identity. Keep initial PINs and resets out of chat,
issues, logs and committed files. Test fixture accounts are local-only and must
never be seeded into the deployed roster.
