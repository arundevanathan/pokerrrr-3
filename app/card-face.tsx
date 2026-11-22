// Shared deck with a legibility-first compact face for boards and seat reveals.
// Hole/revealed cards use corner groups; community cards retain a central suit.
const paths: Record<string, string> = {
  '♦': 'M50 2 85 50 50 98 15 50Z',
  '♥': 'M50 94C40 80 5 57 5 32C5 0 38 0 50 23C62 0 95 0 95 32C95 57 60 80 50 94Z',
  '♠': 'M50 2C40 18 5 41 5 64C5 90 36 93 46 72C45 84 40 93 30 98H70C60 93 55 84 54 72C64 93 95 90 95 64C95 41 60 18 50 2Z',
  '♣': 'M50 4A21 21 0 0 0 33 39A23 23 0 1 0 45 76C43 88 39 94 29 98H71C61 94 57 88 55 76A23 23 0 1 0 67 39A21 21 0 0 0 50 4Z'
};
export type CardSize = 'normal' | 'small' | 'extra-small';
export type CardLayout = 'corners' | 'community';
// Coordinates use a 70 × 100 face. Smaller cards progressively favour indices.
const profiles = {
  normal: { rank: 27, corner: 20, centre: 24, left: 18, top: 27, suitY: 31, bottomSuitY: 50 },
  small: { rank: 32, corner: 21, centre: 29, left: 20, top: 30, suitY: 33, bottomSuitY: 49 },
  'extra-small': { rank: 35, corner: 22, centre: 27, left: 21, top: 32, suitY: 33, bottomSuitY: 49 }
} as const;
export function CardFace({rank, suit, size = 'normal', layout = 'corners', covered = false}: {rank: string; suit: string; size?: CardSize; layout?: CardLayout; covered?: boolean}) {
  const p = profiles[size], right = 70 - p.left;
  const pip = (x: number, y: number, width: number) => <path d={paths[suit]} transform={`translate(${x} ${y}) scale(${width / 100})`} />;
  return <svg className="card-face" data-card-size={size} data-card-layout={layout} viewBox="0 0 70 100" aria-hidden="true" focusable="false">
    <g fill={'♦♥'.includes(suit) ? '#d90020' : '#080808'}>
      <text x={p.left} y={p.top} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize={p.rank} fontWeight="700" letterSpacing="-.8">{rank}</text>
      {layout === 'corners' && pip(p.left - p.corner / 2, p.suitY, p.corner)}
      {layout === 'community' && pip(35 - p.centre / 2, 50 - p.centre / 2, p.centre)}
      {!covered && layout === 'corners' && pip(right - p.corner / 2, p.bottomSuitY, p.corner)}
      {!covered && <text x={right} y="94" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize={p.rank} fontWeight="700" letterSpacing="-.8">{rank}</text>}
    </g>
  </svg>;
}
