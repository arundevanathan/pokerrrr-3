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
    for await (const [key, archive] of entries(tx, 'session:')) {
      if (Number.isFinite(archive.closedAt) && archive.closedAt <= cutoff) closed.add(key.slice(8));
    }
    for await (const [key, room] of entries(tx, 'room:')) {
      if (room.phase === 'closed' && Number.isFinite(room.closedAt) && room.closedAt <= cutoff) closed.add(key.slice(5));
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
    for await (const [, archive] of entries(tx, 'session:')) {
      if (Number.isFinite(archive.closedAt) && archive.closedAt <= cutoff) remaining++;
    }
    if (remaining) throw new Error('Completed games remain before the cutoff');
    const result = { removed: closed.size, remaining, active: Boolean(active) };
    await tx.put(receiptKey, result);
    return result;
  });
}
