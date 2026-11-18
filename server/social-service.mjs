import { z } from 'zod';
import { roomCode } from '../lib/protocol/poker.mjs';
import { historyPlayerKey } from '../lib/game-history.mjs';
import { reactionDefinition, REACTION_COOLDOWN_MS, REACTION_LEAD_MS } from '../lib/reactions.mjs';
import { TableError } from './table-service.mjs';

const base = { code: roomCode, requestId: z.string().uuid() };
const messageInput = z.object({ ...base, text: z.string().trim().min(1).max(500) }).strict();
const reactionInput = z.object({ ...base, reaction: z.string().max(32), targetSeat: z.number().int().min(0).max(7) }).strict();
const metadataKey = code => `social:${code}:meta`;
const itemPrefix = code => `social:${code}:item:`;
const empty = () => ({ sequence: 0, queue: [], playing: [] });
const blocked = (room, now) => room.phase === 'runout_vote' || room.phase === 'showdown' && now < room.payoutFinishedAt;
const fail = (condition, message, status = 409) => { if (!condition) throw new TableError(message, status); };

// Social state has its own sequence, receipts and storage keys. It never writes
// the room, poker version, betting deadline or accounting records.
export class SocialService {
  constructor(storage) { this.storage = storage; }
  async room(tx, code, writing = false) {
    const room = await tx.get(`room:${code}`);
    fail(room, 'Game not found', 404);
    if (writing) fail(room.phase !== 'closed' && await tx.get('active') === code, 'This game has ended');
    return room;
  }
  async append(tx, meta, code, data) {
    const entry = { ...data, code, sequence: ++meta.sequence };
    await tx.put(`${itemPrefix(code)}${String(entry.sequence).padStart(12, '0')}`, entry);
    return entry;
  }
  async history(code, before) {
    roomCode.parse(code);
    if (before != null) fail(/^\d{1,12}$/.test(String(before)) && Number(before) > 0, 'Invalid chat cursor', 400);
    await this.room(this.storage, code);
    const prefix = itemPrefix(code);
    const rows = await this.storage.list({ prefix, reverse: true, limit: 51,
      ...(before != null && { end: `${prefix}${String(before).padStart(12, '0')}` }) });
    const page = [...rows.values()].slice(0, 50);
    return { entries: page.reverse(), nextCursor: rows.size > 50 ? String(page[0].sequence) : null };
  }
  async send(player, raw, kind = 'message', now = Date.now()) {
    const input = (kind === 'message' ? messageInput : reactionInput).parse(raw);
    const senderKey = await historyPlayerKey(player.id);
    const signature = JSON.stringify(input);
    return this.storage.transaction(async tx => {
      const receiptKey = `social:${input.code}:receipt:${player.id}:${input.requestId}`;
      const receipt = await tx.get(receiptKey);
      if (receipt) {
        fail(receipt.signature === signature && receipt.kind === kind, 'Message request already used');
        return { entry: receipt.entry, replayed: true, queued: kind === 'reaction' };
      }
      const room = await this.room(tx, input.code, true);
      const from = room.players.find(p => p.id === player.id && !p.left);
      const sender = { key: senderKey, name: player.name, seat: from?.seat ?? null };
      const rateKey = `social:${input.code}:rate:${player.id}:${kind}`;
      const previous = await tx.get(rateKey);
      fail(previous == null || now >= previous + (kind === 'message' ? 1000 : REACTION_COOLDOWN_MS), 'Wait a moment before sending another', 429);
      const meta = await tx.get(metadataKey(input.code)) || empty();
      let data;
      if (kind === 'message') {
        // Plain text only. React renders this as text, never markup.
        const text = input.text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
        fail(text.trim().length > 0, 'Write a message first', 400);
        data = { kind, text, sender, at: now, id: crypto.randomUUID() };
      } else {
        const definition = reactionDefinition(input.reaction);
        fail(definition, 'Unknown reaction', 400);
        const to = room.players.find(p => p.seat === input.targetSeat && !p.left);
        fail(to && to.id !== player.id, 'Choose another seated player', 400);
        meta.queue = meta.queue.filter(q => reactionDefinition(q.reaction) && q.expiresAt > now);
        fail(meta.queue.length < 12, 'Reaction queue is full. Try again shortly.', 429);
        data = { kind, reaction: definition.id, sender, to: { name: to.name, seat: to.seat }, at: now, id: crypto.randomUUID() };
        meta.queue.push({ id: data.id, code: input.code, reaction: definition.id, from: sender,
          to: data.to, targetId: to.id, expiresAt: now + 5000 });
      }
      const entry = await this.append(tx, meta, input.code, data);
      await tx.put(metadataKey(input.code), meta);
      await tx.put(rateKey, now);
      await tx.put(receiptKey, { signature, kind, entry });
      return { entry, replayed: false, queued: kind === 'reaction' };
    });
  }
  async drain(code, now = Date.now()) {
    if (!code) return [];
    return this.storage.transaction(async tx => {
      const room = await tx.get(`room:${code}`);
      const meta = await tx.get(metadataKey(code));
      if (!room || !meta) return [];
      meta.playing = meta.playing.filter(until => until > now);
      meta.queue = meta.queue.filter(q => reactionDefinition(q.reaction) && q.expiresAt > now && room.phase !== 'closed'
        && room.players.some(p => !p.left && p.id === q.targetId && p.seat === q.to.seat));
      const events = [];
      if (!blocked(room, now)) while (meta.queue.length && meta.playing.length < 2) {
        const queued = meta.queue.shift();
        const event = { id: queued.id, code: queued.code, reaction: queued.reaction, from: queued.from, to: queued.to, startedAt: 0 };
        event.startedAt = now + REACTION_LEAD_MS;
        events.push(event);
        meta.playing.push(event.startedAt + reactionDefinition(event.reaction).duration);
      }
      await tx.put(metadataKey(code), meta);
      return events;
    });
  }
  async deadline(code, now = Date.now()) {
    if (!code) return null;
    const meta = await this.storage.get(metadataKey(code));
    if (!meta?.queue.length) return null;
    const room = await this.storage.get(`room:${code}`);
    if (!room || room.phase === 'closed') return null;
    const expiry = Math.min(...meta.queue.map(q => q.expiresAt));
    if (blocked(room, now)) return Math.min(expiry, room.phase === 'showdown' ? room.payoutFinishedAt : room.runVote?.deadline || expiry);
    const slots = meta.playing.filter(t => t > now);
    return Math.min(expiry, slots.length >= 2 ? Math.min(...slots) : now + 1);
  }
}
