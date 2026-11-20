import { historyRange, aggregateGames, suggestedPayments, householdPair, historyPlayerKey, publicHistory } from '../lib/game-history.mjs';
import { newRoom, command, view, tick, legal, bettingDecision, isBustedSeat } from '../lib/poker.mjs';
import { parseCommand, playerToken, roomCode } from '../lib/protocol/poker.mjs';
export class TableError extends Error {
  constructor(message, status = 400, snapshot = undefined) {
    super(message);
    this.status = status;
    this.snapshot = snapshot;
  }
}
const requireState = (condition, message, status = 409) => {
  if (!condition) throw new TableError(message, status);
};
// One Durable Object alarm represents the earliest persisted table deadline.
export function nextDeadline(room, checkBustedSeats = true) {
  if (!room || room.phase === 'closed') return null;
  const departure = room.phase === 'showdown' && room.players.some(p => p.pendingSeatAction === 'leave') ? room.payoutFinishedAt : null;
  const bustedSeatCheck = checkBustedSeats && room.phase === 'showdown' && !room.terminationPending &&
    room.bustedSeatsCheckedHand !== room.completed && room.players.some(isBustedSeat) ? room.payoutFinishedAt : null;
  const deadlines = [departure, bustedSeatCheck, room.sessionEndsAt, room.deadline, room.phase === 'runout_vote' ? room.runVote?.deadline : null, room.phase === 'showdown' ? room.rabbitHunt?.requestedBy || room.rabbitHunt?.expiredAt ? null : room.rabbitHunt?.deadline : null, room.phase === 'showdown' ? room.terminationPending ? room.payoutFinishedAt : !room.paused ? room.nextDealAt : null : null].filter(Number.isFinite);
  return deadlines.length ? Math.min(...deadlines) : null;
}
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(6))].map(n => alphabet[n % 32]).join('');
}

// Compare the durable alarm, rather than caching it: alarm delivery consumes it.
export async function scheduleAlarm(storage, deadline) {
  const current = await storage.getAlarm();
  if (deadline === current) return;
  if (deadline === null) {
    if (current !== null) await storage.deleteAlarm();
  } else await storage.setAlarm(deadline);
}

// Storage transactions include state, receipt, archive and the next alarm.
// No in-memory room cache: restart and retry always read the durable source.
export class TableService {
  constructor(storage) {
    this.storage = storage;
  }
  // Called inside the same transaction as command deduplication and acknowledgement.
  async save(tx, previous, room) {
    room.version = (previous?.version ?? -1) + 1;
    if (room.phase === 'closed') room.closedAt ??= Date.now();
    // Existing staging games get a clearly marked opening balance, not invented
    // historical transactions. The marker and first new entries commit together.
    if (!await tx.get(`accounting:${room.code}:initialized`)) {
      for (const [index, player] of (previous?.players || []).entries()) {
        await tx.put(`accounting:${room.code}:opening:${index}`, {
          kind: 'opening_balance', playerId: player.id, name: player.name,
          buyins: player.buyins, cashout: player.cashout, at: Date.now(), code: room.code
        });
      }
      await tx.put(`accounting:${room.code}:initialized`, true);
    }
    // Append-only accounting audit lives outside poker snapshots. These writes and
    // the command receipt commit atomically, so retries cannot double cash out.
    for (const [index, player] of room.players.entries()) {
      const before = previous?.players.find(p => p.id === player.id);
      const prefix = `accounting:${room.code}:${String(room.version).padStart(10, '0')}:${index}`;
      for (const [field, kind] of [['buyins', 'buy_in'], ['cashout', 'cash_out']]) {
        const amount = player[field] - (before?.[field] || 0);
        const zeroDeparture = kind === 'cash_out' && amount === 0 && before && !before.left && player.left;
        if (amount > 0 || zeroDeparture) await tx.put(`${prefix}:${kind}`, {
          kind, amount, playerId: player.id, name: player.name, at: Date.now(),
          version: room.version, hand: room.completed, code: room.code
        });
      }
    }
    const recordedReturns = previous?.handStartedAt === room.handStartedAt ? previous?.uncalledReturns?.length || 0 : 0;
    for (const [index, entry] of (room.uncalledReturns || []).entries()) {
      if (index < recordedReturns) continue;
      await tx.put(`accounting:${room.code}:${String(room.version).padStart(10, '0')}:return:${index}`, {
        kind: 'uncalled_return', amount: entry.amount, playerId: entry.id, name: entry.name,
        at: Date.now(), version: room.version, hand: room.completed + (room.phase === 'showdown' ? 0 : 1), code: room.code
      });
    }
    await tx.put(`room:${room.code}`, room);
    // A completed hand is immutable apart from voluntary reveals and Rabbit Hunt.
    // Persist those post-hand public events too, while preserving the original
    // server-only audit after the next hand begins.
    const previousHands = new Map((previous?.history || []).map(hand => [hand.number, hand]));
    for (const hand of room.history) {
      if (JSON.stringify(previousHands.get(hand.number)) === JSON.stringify(hand)) continue;
      const key = `hand:${room.code}:${String(hand.number).padStart(10, '0')}`;
      const existing = await tx.get(key);
      await tx.put(key, {
        ...hand,
        completedAt: existing?.completedAt || room.showdownAt,
        ...(room.handAudit?.number === hand.number ? { audit: room.handAudit } : existing?.audit ? { audit: existing.audit } : {})
      });
    }
    const active = await tx.get('active');
    if (room.phase === 'closed') {
      if (active === room.code) await tx.delete('active');
      if (room.completed > 0 || room.players.length > 0) await tx.put(`session:${room.code}`, {
        code: room.code,
        createdAt: room.createdAt,
        closedAt: room.closedAt,
        players: room.players.map(({
          id,
          name,
          buyins,
          cashout
        }) => ({
          id,
          name,
          buyins,
          cashout
        })),
        completed: room.completed
      });
    } else if (active !== room.code) await tx.put('active', room.code);
    // Updating a closed, historical session must not cancel the live table alarm.
    if (!active || active === room.code) {
      const deadline = nextDeadline(room);
      await scheduleAlarm(tx, deadline);
    }
  }
  // Read the full archive so settlement includes games beyond the visible UI page.
  async completedGames({
    from,
    to,
    examples
  } = {}) {
    const {
      start,
      end
    } = historyRange(from, to);
    let records = [];
    if (examples) records = examples;
  else {
      let startAfter;
      for (; ;) {
        const page = await this.storage.list({
          prefix: 'session:',
          limit: 128,
          ...(startAfter && {
            startAfter
          })
        });
        records.push(...page.values());
        if (page.size < 128) break;
        startAfter = [...page.keys()].at(-1);
      }
    }
    return records.filter(r => r.closedAt >= start && r.closedAt < end && (r.completed !== 0 || r.players?.length !== 0)).sort((a, b) => b.closedAt - a.closedAt || b.code.localeCompare(a.code));
  }
  async history({
    from,
    to,
    cursor,
    examples
  } = {}) {
    let records = await this.completedGames({
      from,
      to,
      examples
    });
    if (cursor) {
      const match = /^(\d+):([A-Z0-9-]+)$/.exec(cursor);
      if (!match) throw new TableError('Invalid history page');
      const time = Number(match[1]),
        code = match[2];
      records = records.filter(r => r.closedAt < time || r.closedAt === time && r.code.localeCompare(code) < 0);
    }
    const page = records.slice(0, 20),
      last = page.at(-1);
    return {
      games: await publicHistory(page),
      nextCursor: records.length > 20 ? `${last.closedAt}:${last.code}` : null
    };
  }
  async handHistory(code) {
    const session = await this.storage.get(`session:${code}`);
    requireState(session, 'Game history is unavailable', 404);
    const hands = [];
    let startAfter;
    for (;;) {
      const records = await this.storage.list({ prefix: `hand:${code}:`, limit: 128, ...(startAfter && { startAfter }) });
      hands.push(...records.values());
      if (records.size < 128) break;
      startAfter = [...records.keys()].at(-1);
    }
    return { code, session, hands };
  }
  async handData({ codes, from, to } = {}) {
    if (codes !== undefined) {
      requireState(!from && !to && Array.isArray(codes) && codes.length > 0 &&
        codes.every(code => typeof code === 'string' && /^[A-Z2-9]{6}$/.test(code)), 'Choose valid games', 400);
      return Promise.all([...new Set(codes)].map(code => this.handHistory(code)));
    }
    historyRange(from, to, true);
    const sessions = await this.completedGames({ from, to });
    const archives = [];
    for (const session of sessions) {
      archives.push(await this.handHistory(session.code));
    }
    return archives;
  }
  async settlement({
    from,
    to,
    examples,
    roster = []
  } = {}) {
    historyRange(from, to, true);
    const records = await this.completedGames({
      from,
      to,
      examples
    }),
      totals = aggregateGames(records);
    const payments = suggestedPayments(totals, householdPair(totals, roster));
    return {
      from,
      to,
      gameCount: records.length,
      unit: 'chips',
      suggestionsOnly: true,
      totals: await Promise.all(totals.map(async ({
        id,
        ...p
      }) => ({
        ...p,
        key: await historyPlayerKey(id)
      }))),
      payments: await Promise.all(payments.map(async ({
        from,
        to,
        ...p
      }) => ({
        ...p,
        from: await historyPlayerKey(from),
        to: await historyPlayerKey(to)
      })))
    };
  }
  async snapshot(token, code) {
    playerToken.parse(token);
    roomCode.parse(code);
    const room = await this.storage.get(`room:${code}`);
    requireState(room, 'Table not found. Check your code.', 404);
    return view(room, token, Date.now(), true);
  }
  async execute(token, raw, now = Date.now()) {
    playerToken.parse(token);
    const input = parseCommand(raw);
    const signature = await digest(JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)))));
    const receiptKey = `command:${token}:${input.commandId}`;
    return this.storage.transaction(async tx => {
      // Check receipts before state guards: a successful retry may now be stale
      // but must still return its original acknowledgement without applying again.
      const receipt = await tx.get(receiptKey);
      if (receipt) {
        requireState(receipt.signature === signature, 'Command ID already used with different content');
        const room = await tx.get(`room:${receipt.code}`);
        return {
          snapshot: view(room, token, now, true),
          ack: receipt.ack,
          replayed: true
        };
      }
      let room, previous;
      if (input.type === 'create') {
        requireState(!(await tx.get('active')), 'A game is already running. Join the current game.');
        let code;
        do {
          code = newCode();
        } while (await tx.get(`room:${code}`));
        room = newRoom(code, token, input, now);
      } else {
        previous = await tx.get(`room:${input.code}`);
        requireState(previous, 'Table not found. Check your code.', 404);
        room = structuredClone(previous);
        if (input.type === 'join' && room.phase === 'closed') {
          requireState(room.players.some(p => p.id === token), 'Only session participants can reopen its history', 403);
          const ack = {
            commandId: input.commandId,
            version: room.version,
            code: room.code
          };
          await tx.put(receiptKey, {
            signature,
            code: room.code,
            ack
          });
          return {
            snapshot: view(room, token, now, true),
            ack,
            replayed: false
          };
        }
        if (input.type !== 'join') {
          requireState(['end', 'extend_session'].includes(input.type) || room.host === token || room.players.some(p => p.id === token), 'Join this table first', 403);
          if (input.decision !== undefined) {
            if (input.handId !== room.handStartedAt || now >= room.deadline ||
                input.decision !== bettingDecision(room, legal(room, token))) {
              throw new TableError('This betting decision has changed. Review the table.', 409, view(room, token, now, true));
            }
          } else if (input.type !== 'extend_session') {
            requireState(input.version === room.version, 'The table changed. Review your turn and try again.');
            requireState(input.handId === (room.handStartedAt || 0), 'This hand has changed. Review the table.');
          }
        }
        // Presentation is a server rule, not just a disabled client button.
        if (input.type === 'deal' && room.phase === 'showdown') requireState(now >= room.payoutFinishedAt, 'Wait for payouts to finish');
        command(room, token, input, now);
        // New joins/reloads can enable a countdown without an HTTP polling loop.
        if (room.phase === 'showdown' && !room.nextDealAt) tick(room, now);
      }
      await this.save(tx, previous, room);
      const ack = {
        commandId: input.commandId,
        version: room.version,
        code: room.code
      };
      await tx.put(receiptKey, {
        signature,
        code: room.code,
        ack
      });
      return {
        snapshot: view(room, token, now, true),
        ack,
        replayed: false
      };
    });
  }
  /** @param {number} [now] @param {Set<string>} [connected] */
  async advance(now = Date.now(), connected) {
    return this.storage.transaction(async tx => {
      const code = await tx.get('active');
      if (!code) {
        await scheduleAlarm(tx, null);
        return null;
      }
      const previous = await tx.get(`room:${code}`),
        room = structuredClone(previous);
      if (tick(room, now, true, connected)) await this.save(tx, previous, room);
  else {
        const deadline = nextDeadline(room, Boolean(connected));
        await scheduleAlarm(tx, deadline === null ? null : Math.max(now + 1, deadline));
      }
      return code;
    });
  }
}
