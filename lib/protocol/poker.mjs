import { z } from 'zod';

export const PROTOCOL_VERSION = 2;
export const playerToken = z.string().uuid();
export const roomCode = z.string().regex(/^[A-Z2-9]{6}$/);
const chips = z.number().int().min(1).max(100000000);
const payloads = {
  create: z.object({ name: z.string().trim().min(1).max(24), sb: chips.optional(), bb: chips.optional(), buyin: chips.optional(), seats: z.number().int().min(2).max(8).optional(), rotation: z.number().int().min(2).max(4).optional() }),
  join: z.object({ name: z.string().trim().min(1).max(24), buyin: chips.optional() }),
  raise: z.object({ amount: chips }),
  rebuy: z.object({ amount: chips }),
  runout_vote: z.object({ choice: z.union([z.literal(1), z.literal(2)]) }),
  rotation: z.object({ rotation: z.number().int().min(2).max(4) }),
  paid: z.object({ index: z.number().int().min(0).max(100) }),
};
const types = ['create', 'join', 'raise', 'rebuy', 'runout_vote', 'rotation', 'paid', 'fold', 'call', 'check', 'deal', 'ready', 'leave', 'pause', 'end'];
const envelope = z.object({
  protocol: z.literal(PROTOCOL_VERSION),
  commandId: z.string().uuid(),
  type: z.enum(types),
  code: roomCode.optional(),
  version: z.number().int().nonnegative().optional(),
  handId: z.number().int().nonnegative().optional(),
}).passthrough();

export function parseCommand(value) {
  const base = envelope.parse(value);
  const payload = (payloads[base.type] || z.object({})).strict().parse(
    Object.fromEntries(Object.entries(value).filter(([key]) => !['protocol', 'commandId', 'type', 'code', 'version', 'handId'].includes(key))),
  );
  if (base.type !== 'create' && !base.code) throw new Error('Session code required');
  if (!['create', 'join'].includes(base.type) && base.version === undefined) throw new Error('State version required');
  return { protocol: base.protocol, commandId: base.commandId, type: base.type, ...(base.code && { code: base.code }), ...(base.version !== undefined && { version: base.version }), ...(base.handId !== undefined && { handId: base.handId }), ...payload };
}

export function commandEnvelope(input, room) {
  return { ...input, protocol: PROTOCOL_VERSION, commandId: crypto.randomUUID(), ...(room && { version: room.version, handId: room.handStartedAt || 0 }) };
}
