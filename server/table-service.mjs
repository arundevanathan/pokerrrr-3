import { historyRange, aggregateGames, suggestedPayments, householdPair, historyPlayerKey, publicHistory } from '../lib/game-history.mjs';
import { newRoom, command, view, tick } from '../lib/poker.mjs';
import { parseCommand, playerToken, roomCode } from '../lib/protocol/poker.mjs';
import { publicHandRecord, viewerHandRecord } from '../lib/hand-history.mjs';
export class TableError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const requireState = (condition, message, status = 409) => {
  if (!condition) throw new TableError(message, status);
};
// One Durable Object alarm represents the earliest persisted table deadline.
export function nextDeadline(room) {
  if (!room || room.phase === 'closed') return null;
  const departure = room.phase === 'showdown' && room.players.some(p => p.pendingSeatAction === 'leave') ? room.payoutFinishedAt : null;
  const deadlines = [departure, room.deadline, room.phase === 'runout_vote' ? room.runVote?.deadline : null, room.phase === 'showdown' ? room.terminationPending ? room.payoutFinishedAt : !room.paused ? room.nextDealAt : null : null].filter(Number.isFinite);
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
    if (!previous || previous.phase !== room.phase || previous.completed !== room.completed || room.history.some(hand => {
      const before = previous?.history?.find(item => item.number === hand.number);
      return before?.updatedAt !== hand.updatedAt;
    })) {
      for (const hand of room.history.filter(hand => {
        const before = previous?.history?.find(item => item.number === hand.number);
        return !before || before.updatedAt !== hand.updatedAt;
      })) {
        await tx.put(`hand:${room.code}:${String(hand.number).padStart(10, '0')}`, {
          ...hand,
          completedAt: room.showdownAt
        });
      }
    }
    const active = await tx.get('active');
    if (room.phase === 'closed') {
      if (active === room.code) await tx.delete('active');
      await tx.put(`session:${room.code}`, {
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
    } else await tx.put('active', room.code);
    // Updating a closed, historical session must not cancel the live table alarm.
    if (!active || active === room.code) {
      const deadline = nextDeadline(room);
      if (deadline !== null) await tx.setAlarm(deadline);
  else await tx.deleteAlarm();
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
    return records.filter(r => r.closedAt >= start && r.closedAt < end).sort((a, b) => b.closedAt - a.closedAt || b.code.localeCompare(a.code));
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
  async handHistory(token, code) {
    playerToken.parse(token);
    if (code) roomCode.parse(code);
    const records = [];
    let startAfter;
    const prefix = code ? `hand:${code}:` : 'hand:';
    for (;;) {
      const page = await this.storage.list({ prefix, limit: 128, ...(startAfter && { startAfter }) });
      for (const [key, hand] of page) {
        const ownCards = hand.privateCards?.find(player => player.id === token);
        if (!ownCards) continue;
        const sessionCode = key.split(':')[1];
        records.push(viewerHandRecord(publicHandRecord(sessionCode, hand), ownCards));
      }
      if (page.size < 128) break;
      startAfter = [...page.keys()].at(-1);
    }
    // A player may download only hands in which they were dealt.  Sorting is
    // stable across sessions and works even while the current game is live.
    return records.sort((a, b) => b.completedAt - a.completedAt || b.sessionCode.localeCompare(a.sessionCode) || b.handNumber - a.handNumber);
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
          requireState(input.type === 'end' || room.host === token || room.players.some(p => p.id === token), 'Join this table first', 403);
          requireState(input.version === room.version, 'The table changed. Review your turn and try again.');
          requireState(input.handId === (room.handStartedAt || 0), 'This hand has changed. Review the table.');
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
  async advance(now = Date.now()) {
    return this.storage.transaction(async tx => {
      const code = await tx.get('active');
      if (!code) {
        await tx.deleteAlarm();
        return null;
      }
      const previous = await tx.get(`room:${code}`),
        room = structuredClone(previous);
      if (tick(room, now)) await this.save(tx, previous, room);
  else {
        const deadline = nextDeadline(room);
        if (deadline !== null) await tx.setAlarm(Math.max(now + 1, deadline));
  else await tx.deleteAlarm();
      }
      return code;
    });
  }
}
