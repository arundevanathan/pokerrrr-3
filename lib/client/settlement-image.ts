import { settlementDate } from '../game-history.mjs';

type Settlement = {
  from: string; to: string; gameCount: number; demo?: boolean;
  totals: { name: string; games: number; net: number }[];
  payments: { fromName: string; toName: string; amount: number }[];
};

// Draw from structured settlement data, never screenshots of the on-screen modal.
export async function settlementImage(result: Settlement): Promise<File> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image unavailable');
  const ink = '#eeeae1', muted = '#a9b9ae', gold = '#d9bb82';
  const number = (n: number) => new Intl.NumberFormat('en-IN').format(n);
  const font = (size: number, weight = 400) => `${weight} ${size}px Arial, sans-serif`;
  const wrap = (text: string, width: number, size: number, weight = 400) => {
    ctx.font = font(size, weight);
    const lines = [''];
    for (const char of text) {
      const last = lines.length - 1;
      if (lines[last] && ctx.measureText(lines[last] + char).width > width) lines.push(char);
      else lines[last] += char;
    }
    return lines;
  };
  const totals = result.totals.map(p => ({ ...p, lines: wrap(p.name, 590, 32, 600) }));
  const payments = result.payments.map(p => ({ ...p,
    from: wrap(p.fromName, 295, 30, 600), to: wrap(p.toName, 295, 30, 600) }));
  const totalHeight = totals.reduce((sum, p) => sum + Math.max(78, p.lines.length * 38 + 32), 0);
  const paymentHeight = payments.length ? payments.reduce((sum, p) => sum + Math.max(106, Math.max(p.from.length, p.to.length) * 36 + 52), 0) : 100;
  canvas.height = 650 + totalHeight + paymentHeight;
  const text = (value: string, x: number, y: number, size: number, color = ink, weight = 400, align: CanvasTextAlign = 'left') => {
    ctx.font = font(size, weight); ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(value, x, y);
  };
  const line = (y: number) => {
    ctx.strokeStyle = '#34483e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(1120, y); ctx.stroke();
  };
  const bg = ctx.createLinearGradient(0, 0, 1200, canvas.height);
  bg.addColorStop(0, '#203d30'); bg.addColorStop(0.4, '#14271f'); bg.addColorStop(1, '#0d1c17');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1200, canvas.height);
  ctx.strokeStyle = '#65704b'; ctx.lineWidth = 2; ctx.strokeRect(28, 28, 1144, canvas.height - 56);
  ctx.fillStyle = gold; ctx.fillRect(80, 65, 56, 4);
  text('♠', 80, 154, 72, gold);
  text('Dunzo Club.', 158, 151, 58, ink, 700);
  text(result.demo ? 'SIMULATED SETTLEMENT' : 'SETTLEMENT', 80, 219, 22, gold, 700);
  text(`${settlementDate(result.from)} – ${settlementDate(result.to)}`, 80, 278, 38, ink, 600);
  text(`${result.gameCount} completed ${result.gameCount === 1 ? 'game' : 'games'} · India time · 1 chip = Rs.1`, 80, 323, 25, muted);
  line(359);
  text('PLAYER RESULTS', 80, 408, 22, gold, 700);
  text('GAMES', 865, 408, 20, muted, 400, 'right');
  text('NET CHIPS', 1120, 408, 20, muted, 400, 'right');
  let y = 435;
  for (const p of totals) {
    const height = Math.max(78, p.lines.length * 38 + 32);
    p.lines.forEach((v, i) => text(v, 80, y + 43 + i * 38, 32, ink, 600));
    text(String(p.games), 865, y + 43, 27, muted, 400, 'right');
    text(`${p.net > 0 ? '+' : ''}${number(p.net)}`, 1120, y + 43, 34, p.net > 0 ? '#a7ddba' : p.net < 0 ? '#e5a69a' : muted, 600, 'right');
    y += height; line(y);
  }
  y += 62;
  text('SUGGESTED PAYMENTS', 80, y, 22, gold, 700);
  y += 28;
  if (!payments.length) { text('All square. Nothing to settle.', 104, y + 58, 32, ink, 600); y += 100; }
  for (const p of payments) {
    const height = Math.max(106, Math.max(p.from.length, p.to.length) * 36 + 52);
    ctx.fillStyle = '#223a2e'; ctx.beginPath(); ctx.roundRect(80, y, 1040, height - 12, 14); ctx.fill();
    p.from.forEach((v, i) => text(v, 104, y + 48 + i * 36, 30, ink, 600));
    text('→', 425, y + 48, 32, gold);
    p.to.forEach((v, i) => text(v, 482, y + 48 + i * 36, 30, ink, 600));
    text(`Rs.${number(p.amount)}`, 1092, y + 48, 32, gold, 700, 'right');
    y += height;
  }
  text('Suggested transfers · Please confirm payments with each other.', 80, canvas.height - 65, 22, muted);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Image unavailable')), 'image/png'));
  return new File([blob], `dunzo-club-settlement-${result.from}-to-${result.to}.png`, { type: 'image/png' });
}
