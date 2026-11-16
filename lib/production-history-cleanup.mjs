async function* entries(tx, prefix) {
  let startAfter;
  for (;;) {
    const page = await tx.list({prefix, limit: 128, ...(startAfter && {startAfter})});
    yield* page;
    if (page.size < 128) return;
    startAfter = [...page.keys()].at(-1);
  }
}

export async function clearCompletedHistory(storage, cutoff) {
  if (!Number.isSafeInteger(cutoff) || cutoff <= 0) throw new Error('Invalid cleanup cutoff');
  const receiptKey = `maintenance:history-cleanup:${cutoff}`;
  return storage.transaction(async tx => {
    const previous = await tx.get(receiptKey);
    if (previous) return previous;
    const active = await tx.get('active');
    const closed = new Set();
    const archives = new Map();
    for await (const [key, archive] of entries(tx, 'session:')) {
      if (Number.isFinite(archive.closedAt) && archive.closedAt <= cutoff) archives.set(key.slice(8), archive);
    }
    const newest = [...archives].sort((a,b) => b[1].closedAt - a[1].closedAt);
    if (!newest.length || newest[0][1].closedAt === newest[1]?.[1].closedAt) throw new Error('Cannot identify one latest completed game');
    const [kept, latest] = newest[0];
    const preservedRoom = await tx.get(`room:${kept}`);
    if (!preservedRoom || preservedRoom.phase !== 'closed' || preservedRoom.closedAt !== latest.closedAt) throw new Error('Latest game room does not match its archive');
    for (const [code] of newest.slice(1)) closed.add(code);
    for await (const [key, room] of entries(tx, 'room:')) {
      if (Number.isFinite(room.closedAt) && room.phase === 'closed' && room.closedAt < latest.closedAt) closed.add(key.slice(5));
    }
    if (closed.has(active)) throw new Error('Active table cannot be purged');
    for (const code of closed) {
      const room = await tx.get(`room:${code}`);
      if (room && room.phase !== 'closed') throw new Error('Archive refers to an open table');
      await tx.delete(`session:${code}`);
      await tx.delete(`room:${code}`);
      for (const prefix of [`hand:${code}:`, `accounting:${code}:`, `social:${code}:`]) {
        for await (const [key] of entries(tx, prefix)) await tx.delete(key);
      }
    }
    let remaining = 0;
    for await (const [key, archive] of entries(tx, 'session:')) {
      if (key !== `session:${kept}` && Number.isFinite(archive.closedAt) && archive.closedAt <= cutoff) remaining++;
    }
    if (remaining) throw new Error('Completed games remain before the cutoff');
    const result = { removed: closed.size, remaining, active: Boolean(active), kept, closedAt: latest.closedAt, hands: latest.completed };
    await tx.put(receiptKey, result);
    return result;
  });
}
