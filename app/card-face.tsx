import { useId } from 'react';

// Hole cards use corner indices; community cards use corner ranks and a centre suit.
const paths: Record<string, string> = {
  '♦': 'M50 2 85 50 50 98 15 50Z',
  '♥': 'M50 94C40 80 5 57 5 32C5 0 38 0 50 23C62 0 95 0 95 32C95 57 60 80 50 94Z',
  '♠': 'M50 2C40 18 5 41 5 64C5 90 36 93 46 72C45 84 40 93 30 98H70C60 93 55 84 54 72C64 93 95 90 95 64C95 41 60 18 50 2Z',
  '♣': 'M50 4A21 21 0 0 0 33 39A23 23 0 1 0 45 76C43 88 39 94 29 98H71C61 94 57 88 55 76A23 23 0 1 0 67 39A21 21 0 0 0 50 4Z'
};
export type CardSize = 'normal' | 'small' | 'extra-small';
// Coordinates use a 70 × 100 face. Smaller cards progressively favour indices.
const profiles = {
  normal: { rank: 21, corner: 16, left: 14, top: 24, suitY: 28, bottomSuitY: 57 },
  small: { rank: 32, corner: 21, left: 20, top: 30, suitY: 33, bottomSuitY: 49 },
  'extra-small': { rank: 29, corner: 20, left: 16, top: 29, suitY: 35, bottomSuitY: 50 }
} as const;
export function CardFace({rank, suit, size = 'normal', covered = false, revealed = false, community = false}: {rank: string; suit: string; size?: CardSize; covered?: boolean; revealed?: boolean; community?: boolean}) {
  const gradientId = `suit-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const red = '♦♥'.includes(suit);
  // Local SVG gradients provide the same finish without platform emoji or filters.
  // Compact corner symbols use a gentler highlight to retain their dark silhouette.
  const tones = red
    ? (community ? ['#ff7183', '#d9092b', '#7f0016'] : ['#f64b64', '#d00026', '#8d001a'])
    : (community ? ['#777f8d', '#252b35', '#010203'] : ['#5d6572', '#1b2028', '#020304']);
  const shading = <defs><linearGradient id={gradientId} x1="0" y1="0" x2=".25" y2="1">
    <stop offset="0" stopColor={tones[0]} />
    <stop offset=".46" stopColor={tones[1]} />
    <stop offset="1" stopColor={tones[2]} />
  </linearGradient></defs>;
  // Seat reveals need a narrower index than the equally small runout cards.
  const p = revealed ? { rank: 30, corner: 20, left: 14, top: 30, suitY: 33, bottomSuitY: 54 } : profiles[size];
  // Smaller runout faces reserve more space for ranks than for the centre suit.
  const board = size === 'extra-small'
    ? { rank: 29, left: 15, top: 28, suit: 28 }
    : { rank: 28, left: 14, top: 27, suit: 34 };
  const right = 70 - p.left;
  const rankWidth = rank === '10' ? p.rank * (revealed ? .83 : .98) : undefined;
  const pip = (x: number, y: number, width: number) => <path d={paths[suit]} fill={`url(#${gradientId})`} transform={`translate(${x} ${y}) scale(${width / 100})`} />;
  if (community) return <svg className="card-face" data-card-size={size} data-card-layout="community" viewBox="0 0 70 100" aria-hidden="true" focusable="false">
    {shading}
    <g fill={'♦♥'.includes(suit) ? '#d90020' : '#080808'}>
      <text x={board.left} y={board.top} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize={board.rank} fontWeight="700" letterSpacing="-.8" textLength={rank === '10' ? board.rank * .95 : undefined} lengthAdjust="spacingAndGlyphs">{rank}</text>
      {pip((70 - board.suit) / 2, (100 - board.suit) / 2, board.suit)}
      <text x={70 - board.left} y="94" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize={board.rank} fontWeight="700" letterSpacing="-.8" textLength={rank === '10' ? board.rank * .95 : undefined} lengthAdjust="spacingAndGlyphs">{rank}</text>
    </g>
  </svg>;
  return <svg className="card-face" data-card-size={size} data-card-layout="corners" viewBox="0 0 70 100" aria-hidden="true" focusable="false">
    {shading}
    <g fill={'♦♥'.includes(suit) ? '#d90020' : '#080808'}>
      <text x={p.left} y={p.top} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize={p.rank} fontWeight="700" letterSpacing="-.8" textLength={rankWidth} lengthAdjust="spacingAndGlyphs">{rank}</text>
      {pip(p.left - p.corner / 2, p.suitY, p.corner)}
      {!covered && pip(right - p.corner / 2, p.bottomSuitY, p.corner)}
      {!covered && <text x={right} y="94" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize={p.rank} fontWeight="700" letterSpacing="-.8" textLength={rankWidth} lengthAdjust="spacingAndGlyphs">{rank}</text>}
    </g>
  </svg>;
}
