import { useId } from 'react';
import { type ComponentType } from 'react';
import { type PokerSound } from '../lib/poker-audio';
const svgProps = { viewBox: '0 0 100 100', fill: 'none', 'aria-hidden': true as const };
function Glass() {
  const glass = useId();
  const wine = useId();
  return <g>
    <defs>
      <linearGradient id={glass}><stop stopColor="#e8eee3" stopOpacity=".35" /><stop offset=".42" stopColor="#e8eee3" stopOpacity=".04" /><stop offset="1" stopColor="#e8eee3" stopOpacity=".38" /></linearGradient>
      <linearGradient id={wine} x2="0" y2="1"><stop stopColor="#98424d" /><stop offset="1" stopColor="#431d29" /></linearGradient>
    </defs>
    <path d="M33 13C30 24 26 34 27 42Q29 57 50 59Q71 57 73 42C74 34 70 24 67 13Z" fill={`url(#${glass})`} stroke="#dedfd0" strokeWidth="1.6" />
    <path d="M29 38Q49 42 71 38Q73 55 50 57Q28 55 29 38Z" fill={`url(#${wine})`} />
    <ellipse cx="50" cy="38" rx="21" ry="2.7" fill="#853846" stroke="#b27075" strokeWidth=".8" />
    <ellipse cx="50" cy="13" rx="17" ry="2.5" stroke="#f1eee0" strokeWidth="1.4" />
    <path d="M36 19Q30 35 33 42M50 59V81" stroke="#f1eee0" strokeWidth="1.6" strokeLinecap="round" />
    <ellipse cx="50" cy="82" rx="13" ry="2.2" fill="#d5dbcb49" stroke="#e0dfce" />
  </g>;
}
export function CheersArt() {
  return <svg {...svgProps}><g transform="translate(-14 0) rotate(14 50 52)"><Glass /></g><g transform="translate(14 0) rotate(-14 50 52)"><Glass /></g></svg>;
}
function SingleGlass() {
  return <svg {...svgProps}><Glass /></svg>;
}
function TomatoArt() {
  const skin = useId();
  const leaf = useId();
  return <svg {...svgProps}>
    <defs>
      <radialGradient id={skin} cx=".32" cy=".25" r=".78">
        <stop stopColor="#ff8b62" /><stop offset=".44" stopColor="#db402b" /><stop offset=".82" stopColor="#ae251a" /><stop offset="1" stopColor="#751b18" />
      </radialGradient>
      <linearGradient id={leaf} x2=".5" y2="1"><stop stopColor="#849053" /><stop offset="1" stopColor="#31452a" /></linearGradient>
    </defs>
    <path d="M49 31C31 23 17 32 15 48C10 69 24 85 43 87C62 91 83 81 86 64C92 41 73 22 49 31Z" fill={`url(#${skin})`} />
    <path d="M41 37C33 36 25 42 23 50" stroke="#ffd2af" strokeWidth="2.5" opacity=".48" strokeLinecap="round" />
    <path d="M51 29C47 19 49 12 55 12C54 17 54 24 56 28L68 25L61 32L75 37L59 36L64 45L52 37L43 44L45 35L32 38L43 30L34 25Z" fill={`url(#${leaf})`} />
    <path d="M52 29L52 21" stroke="#b6a572" strokeWidth="1.5" />
  </svg>;
}

function TomatoSplat() {
  const pulp = useId();
  return <svg {...svgProps}>
    <defs><radialGradient id={pulp}><stop stopColor="#f36d50" /><stop offset=".56" stopColor="#b8372a" /><stop offset="1" stopColor="#742524" stopOpacity=".65" /></radialGradient></defs>
    <path d="M46 31C53 25 66 32 69 39L91 32L75 47C74 53 89 57 96 59L73 60C70 69 75 72 77 79L63 71C53 77 42 75 36 69L15 77L27 62L5 57L26 52L11 42L32 44C32 36 37 34 46 31Z" fill={`url(#${pulp})`} />
    <path d="M36 45Q51 36 65 47M40 62Q50 67 62 59" stroke="#ffab83" strokeWidth="2" opacity=".52" strokeLinecap="round" />
    <path d="M17 27L20 31M84 22L81 28M19 84L24 78M90 75L85 70" stroke="#a5382a" strokeWidth="4" strokeLinecap="round" />
    <g fill="#e9bc7c"><ellipse cx="48" cy="47" rx="2" ry="1" transform="rotate(-30 48 47)" /><ellipse cx="60" cy="53" rx="2.7" ry="1.2" /><ellipse cx="45" cy="59" rx="2.6" ry="1.1" transform="rotate(25 45 59)" /><ellipse cx="70" cy="45" rx="2" ry="1" /></g>
  </svg>;
}
export function LaughArt() {
  return <svg {...svgProps}><circle cx="50" cy="49" r="35" fill="#bc9254" stroke="#81613a" strokeWidth="2" /><path d="M26 39Q34 29 42 39M58 39Q66 29 74 39" stroke="#54382c" strokeWidth="5" strokeLinecap="round" /><path d="M29 50Q50 62 72 50Q68 80 50 80Q32 80 29 50Z" fill="#613427" /><path d="M33 53Q50 61 68 53L65 61H37Z" fill="#fff2cf" /><path d="M39 74Q50 64 61 74" fill="#e87d77" /><path className="laugh-tear" d="M17 44Q2 57 11 65Q22 70 24 58Z" fill="#9cbbb8" /><path className="laugh-tear" d="M83 44Q98 57 89 65Q78 70 76 58Z" fill="#9cbbb8" /></svg>;
}
function PunchArt() {
  const leather = useId();
  const cuff = useId();
  return <svg {...svgProps}>
    <defs>
      <radialGradient id={leather} cx=".35" cy=".25" r=".78"><stop stopColor="#e78872" /><stop offset=".42" stopColor="#aa483c" /><stop offset=".84" stopColor="#712923" /><stop offset="1" stopColor="#4d201e" /></radialGradient>
      <linearGradient id={cuff}><stop stopColor="#332722" /><stop offset=".45" stopColor="#5e4b40" /><stop offset="1" stopColor="#281d19" /></linearGradient>
    </defs>
    <path d="M26 66C15 60 13 48 17 36C16 24 25 14 39 11C56 7 74 12 82 24C91 37 88 53 81 63C77 70 71 73 65 77L60 87L25 79Z" fill={`url(#${leather})`} stroke="#532522" strokeWidth="1.4" />
    <path d="M20 51C22 41 31 40 38 47C43 53 46 63 52 65C43 71 39 76 30 72C23 69 18 60 20 51Z" fill="#923e35" stroke="#632924" strokeWidth="1.4" />
    <path d="M24 72L66 77L62 91Q42 94 22 86Z" fill={`url(#${cuff})`} stroke="#281b17" strokeWidth="1.4" />
    <path d="M28 77L61 81M29 84L58 88M35 41Q44 45 47 54M66 20Q80 27 82 42" stroke="#d6ac99" strokeWidth="1" strokeDasharray="2 2" opacity=".64" />
    <path d="M29 26Q42 16 60 19" stroke="#f8b3a3" strokeWidth="2" opacity=".5" strokeLinecap="round" />
  </svg>;
}
function CheersAnimation() {
  return <>
    <div className="cheers-glass cheers-sender"><SingleGlass /></div>
    <div className="cheers-glass cheers-receiver"><SingleGlass /></div>
  </>;
}
function TomatoAnimation() { return <><div className="social-flight tomato-flight"><TomatoArt /></div><div className="reaction-at-target tomato-splat"><TomatoSplat /></div></>; }
function LaughAnimation() { return <div className="social-flight laugh-flight"><div className="laugh-bounce"><LaughArt /></div></div>; }
function PunchAnimation() { return <><div className="social-flight punch-flight"><PunchArt /></div></>; }
export const reactionRenderers: Record<string, { Icon: ComponentType; Animation: ComponentType; sound: PokerSound }> = {
  cheers: { Icon: CheersArt, Animation: CheersAnimation, sound: 'cheers' },
  tomato: { Icon: TomatoArt, Animation: TomatoAnimation, sound: 'tomato' },
  laugh: { Icon: LaughArt, Animation: LaughAnimation, sound: 'laugh' },
  punch: { Icon: PunchArt, Animation: PunchAnimation, sound: 'punch' }
};
