import { newRoom, command, view, tick } from '../lib/poker.mjs';
import { parseCommand, playerToken, roomCode } from '../lib/protocol/poker.mjs';

export class TableError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const requireState = (condition, message, status = 409) => { if (!condition) throw new TableError(message, status); };
export function nextDeadline(room) {
  if (!room || room.phase === 'closed') return null;
  const deadlines = [room.deadline, room.phase === 'runout_vote' ? room.runVote?.deadline : null, room.phase === 'showdown' && !room.paused ? room.nextDealAt : null].filter(Number.isFinite);
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
  constructor(storage) { this.storage = storage; }

  async save(tx, previous, room) {
    room.version = (previous?.version ?? -1) + 1;
    if (room.phase === 'closed') room.closedAt ??= Date.now();
    await tx.put(`room:${room.code}`, room);
    if (!previous || previous.phase !== room.phase || previous.completed !== room.completed) {
      for (const hand of room.history.filter(h => h.number > (previous?.completed || 0))) {
        await tx.put(`hand:${room.code}:${String(hand.number).padStart(10, '0')}`, { ...hand, completedAt: room.showdownAt });
      }
    }
    const active = await tx.get('active');
    if (room.phase === 'closed') {
      if (active === room.code) await tx.delete('active');
      await tx.put(`session:${room.code}`, { code: room.code, createdAt: room.createdAt, closedAt: room.closedAt, players: room.players.map(({ id, name, buyins, cashout }) => ({ id, name, buyins, cashout })), completed: room.completed });
    } else await tx.put('active', room.code);
    // Updating a closed, historical session must not cancel the live table alarm.
    if (!active || active === room.code) {
      const deadline = nextDeadline(room);
      if (deadline !== null) await tx.setAlarm(deadline);
      else await tx.deleteAlarm();
    }
  }

  async snapshot(token, code) {
    playerToken.parse(token); roomCode.parse(code);
    const room = await this.storage.get(`room:${code}`);
    requireState(room, 'Table not found. Check your code.', 404);
    return view(room, token);
  }

  async execute(token, raw, now = Date.now()) {
    playerToken.parse(token);
    const input = parseCommand(raw);
    const signature = await digest(JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)))));
    const receiptKey = `command:${token}:${input.commandId}`;
    return this.storage.transaction(async tx => {
      const receipt = await tx.get(receiptKey);
      if (receipt) {
        requireState(receipt.signature === signature, 'Command ID already used with different content');
        const room = await tx.get(`room:${receipt.code}`);
        return { snapshot: view(room, token, now), ack: receipt.ack, replayed: true };
      }
      let room, previous;
      if (input.type === 'create') {
        requireState(!(await tx.get('active')), 'A game is already running. Join the current game.');
        let code;
        do { code = newCode(); } while (await tx.get(`room:${code}`));
        room = newRoom(code, token, input, now);
      } else {
        previous = await tx.get(`room:${input.code}`);
        requireState(previous, 'Table not found. Check your code.', 404);
        room = structuredClone(previous);
        if (input.type === 'join' && room.phase === 'closed') {
          requireState(room.players.some(p => p.id === token), 'Only session participants can reopen its history', 403);
          const ack = { commandId: input.commandId, version: room.version, code: room.code };
          await tx.put(receiptKey, { signature, code: room.code, ack });
          return { snapshot: view(room, token, now), ack, replayed: false };
        }
        if (input.type !== 'join') {
          requireState(room.players.some(p => p.id === token), 'Join this table first', 403);
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
      const ack = { commandId: input.commandId, version: room.version, code: room.code };
      await tx.put(receiptKey, { signature, code: room.code, ack });
      return { snapshot: view(room, token, now), ack, replayed: false };
    });
  }

  async advance(now = Date.now()) {
    return this.storage.transaction(async tx => {
      const code = await tx.get('active');
      if (!code) { await tx.deleteAlarm(); return null; }
      const previous = await tx.get(`room:${code}`), room = structuredClone(previous);
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
