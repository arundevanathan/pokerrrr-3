// Shared deck with a legibility-first compact face for boards and seat reveals.
// Corner groups stay upright: rank/suit at top-left, suit/rank at bottom-right.
const paths: Record<string, string> = {
  '♦': 'M50 2 85 50 50 98 15 50Z',
  '♥': 'M50 94C40 80 5 57 5 32C5 0 38 0 50 23C62 0 95 0 95 32C95 57 60 80 50 94Z',
  '♠': 'M50 2C40 18 5 41 5 64C5 90 36 93 46 72C45 84 40 93 30 98H70C60 93 55 84 54 72C64 93 95 90 95 64C95 41 60 18 50 2Z',
  '♣': 'M50 4A21 21 0 0 0 33 39A23 23 0 1 0 45 76C43 88 39 94 29 98H71C61 94 57 88 55 76A23 23 0 1 0 67 39A21 21 0 0 0 50 4Z'
};
export function CardFace({rank, suit, compact = false}: {rank: string; suit: string; compact?: boolean}) {
  const indexSize = compact ? 23 : 15;
  const left = compact ? 15 : 12;
  const right = compact ? 55 : 58;
  const pip = (x: number, y: number, size: number) => <path d={paths[suit]} transform={`translate(${x} ${y}) scale(${size / 100})`} />;
  return <svg className="card-face" viewBox="0 0 70 100" aria-hidden="true" focusable="false">
    <g fill={'♦♥'.includes(suit) ? '#d90020' : '#080808'}>
      <text x={left} y={compact ? 24 : 18} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize={indexSize} fontWeight="700" letterSpacing="-.8">{rank}</text>
      {compact ? pip(8, 27, 14) : pip(7, 21, 10)}
      {compact ? pip(22, 39, 26) : pip(18, 33, 34)}
      {compact ? pip(48, 61, 14) : pip(53, 70, 10)}
      <text x={right} y="94" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize={indexSize} fontWeight="700" letterSpacing="-.8">{rank}</text>
    </g>
  </svg>;
}
