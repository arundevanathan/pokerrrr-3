// Shared deck with a legibility-first compact face for boards and seat reveals.
// Corner groups stay upright: rank/suit at top-left, suit/rank at bottom-right.
const paths: Record<string, string> = {
  '♦': 'M50 2 85 50 50 98 15 50Z',
  '♥': 'M50 94C40 80 5 57 5 32C5 0 38 0 50 23C62 0 95 0 95 32C95 57 60 80 50 94Z',
  '♠': 'M50 2C40 18 5 41 5 64C5 90 36 93 46 72C45 84 40 93 30 98H70C60 93 55 84 54 72C64 93 95 90 95 64C95 41 60 18 50 2Z',
  '♣': 'M50 4A21 21 0 0 0 33 39A23 23 0 1 0 45 76C43 88 39 94 29 98H71C61 94 57 88 55 76A23 23 0 1 0 67 39A21 21 0 0 0 50 4Z'
};
export type CardSize = 'normal' | 'small' | 'extra-small';
// Coordinates use a 70 × 100 face. Smaller cards progressively favour indices.
const profiles = {
  normal: { rank: 20, corner: 12, centre: 28, left: 14, top: 22, suitY: 25, bottomSuitY: 65 },
  small: { rank: 27, corner: 16, centre: 20, left: 17, top: 27, suitY: 30, bottomSuitY: 57 },
  'extra-small': { rank: 31, corner: 18, centre: 14, left: 19, top: 29, suitY: 32, bottomSuitY: 53 }
} as const;
export function CardFace({rank, suit, size = 'normal'}: {rank: string; suit: string; size?: CardSize}) {
  const p = profiles[size], right = 70 - p.left;
  const pip = (x: number, y: number, width: number) => <path d={paths[suit]} transform={`translate(${x} ${y}) scale(${width / 100})`} />;
  return <svg className="card-face" data-card-size={size} viewBox="0 0 70 100" aria-hidden="true" focusable="false">
    <g fill={'♦♥'.includes(suit) ? '#d90020' : '#080808'}>
      <text x={p.left} y={p.top} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize={p.rank} fontWeight="700" letterSpacing="-.8">{rank}</text>
      {pip(p.left - p.corner / 2, p.suitY, p.corner)}
      {pip(35 - p.centre / 2, 50 - p.centre / 2, p.centre)}
      {pip(right - p.corner / 2, p.bottomSuitY, p.corner)}
      <text x={right} y="94" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize={p.rank} fontWeight="700" letterSpacing="-.8">{rank}</text>
    </g>
  </svg>;
}
