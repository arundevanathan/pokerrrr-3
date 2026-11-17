import { REACTIONS } from './reactions.mjs';
const gameSamples = {
  call: '/sounds/call.wav',
  check: '/sounds/check.wav',
  deal: '/sounds/deal.wav',
  win: '/sounds/win.wav',
  'your-turn': '/sounds/your-turn.wav',
} as const;
type GameSample = keyof typeof gameSamples;

export type PokerSound = GameSample | 'raise' | 'allin' | keyof typeof REACTIONS;
export class PokerAudio {
  private context: AudioContext | null = null;
  private nodes = new Set<AudioScheduledSourceNode>();
  private samples = new Map<GameSample, Promise<AudioBuffer | null>>();
  enabled = true;
  constructor(private readonly preloadGameSounds = false) {}
  private generation = 0;
  unlock() {
    if (!this.enabled) return;
    try {
      const C = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return;
      this.context ??= new C();
      if (this.preloadGameSounds) {
        for (const kind of Object.keys(gameSamples) as GameSample[]) void this.loadSample(this.context, kind);
      }
      if (this.context?.state === 'suspended') void this.context.resume().catch(() => { });
    } catch {/* Audio is optional on browsers without Web Audio. */ }
  }
  setEnabled(value: boolean) {
    this.enabled = value;
    if (!value) this.cancel();
  }
  cancel() {
    this.generation++;
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch { }
    }
    this.nodes.clear();
  }
  private source(node: AudioScheduledSourceNode) {
    this.nodes.add(node);
    node.onended = () => this.nodes.delete(node);
  }
  private loadSample(ctx: AudioContext, kind: GameSample) {
    let pending = this.samples.get(kind);
    if (!pending) {
      pending = fetch(gameSamples[kind]).then(response => {
        if (!response.ok) throw new Error('Game audio unavailable');
        return response.arrayBuffer();
      }).then(bytes => ctx.decodeAudioData(bytes)).catch(() => {
        this.samples.delete(kind);
        return null;
      });
      this.samples.set(kind, pending);
    }
    return pending;
  }
  play(kind: PokerSound, delayMs = 0) {
    const ctx = this.context;
    if (!this.enabled || !ctx || document.hidden) return;
    if (ctx.state === 'suspended') {
      const generation = this.generation,
        target = performance.now() + delayMs;
      void ctx.resume().then(() => {
        if (this.generation === generation) this.play(kind, Math.max(0, target - performance.now()));
      }).catch(() => { });
      return;
    }
    if (ctx.state !== 'running') return;
    const at = ctx.currentTime + Math.max(0, delayMs) / 1000;
    const sample = kind === 'raise' || kind === 'allin' ? 'call' : kind;
    if (Object.hasOwn(gameSamples, sample)) {
      const generation = this.generation;
      void this.loadSample(ctx, sample as GameSample).then(buffer => {
        if (!buffer || generation !== this.generation || !this.enabled ||
            document.hidden || ctx.state !== 'running' || ctx.currentTime > at + .35) return;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        this.source(src);
        src.start(Math.max(at, ctx.currentTime));
      });
      return;
    }
    const noise = (time: number, duration: number, frequency: number, volume: number) => {
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate),
        data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(),
        filter = ctx.createBiquadFilter(),
        gain = ctx.createGain();
      src.buffer = buffer;
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(frequency, time);
      filter.Q.value = .7;
      gain.gain.setValueAtTime(.001, time);
      gain.gain.linearRampToValueAtTime(volume, time + .006);
      gain.gain.exponentialRampToValueAtTime(.001, time + duration);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      this.source(src);
      src.start(time);
      src.stop(time + duration);
    };
    const tone = (time: number, frequency: number, duration: number, volume: number) => {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, time);
      osc.frequency.exponentialRampToValueAtTime(frequency * .78, time + duration);
      gain.gain.setValueAtTime(.001, time);
      gain.gain.linearRampToValueAtTime(volume, time + .004);
      gain.gain.exponentialRampToValueAtTime(.001, time + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      this.source(osc);
      osc.start(time);
      osc.stop(time + duration);
    };
    const voice = (time: number, frequency: number, duration: number, volume: number) => {
      const osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(frequency, time);
      osc.frequency.exponentialRampToValueAtTime(frequency * .65, time + duration);
      filter.type = 'bandpass'; filter.frequency.setValueAtTime(frequency * 3.5, time); filter.Q.value = 2;
      gain.gain.setValueAtTime(.001, time); gain.gain.linearRampToValueAtTime(volume, time + .025);
      gain.gain.exponentialRampToValueAtTime(.001, time + duration);
      osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      this.source(osc); osc.start(time); osc.stop(time + duration);
    };
    const social = Object.hasOwn(REACTIONS, kind) ? REACTIONS[kind as keyof typeof REACTIONS] : null;
    const impact = ctx.currentTime + Math.max(0, delayMs + (social?.impactAt || 0)) / 1000;
    if (kind === 'chappal') {
      const impact = ctx.currentTime + Math.max(0, delayMs + REACTIONS.chappal.impactAt) / 1000;
      if (delayMs >= 0) noise(at, .10, 1400, .045);
      // A dry broadband crack, a very short low thud and a tiny second skin
      // contact. No musical pitch or long tail: all three land with the flick.
      noise(impact, .048, 2600, .48);
      noise(impact + .006, .075, 650, .22);
      tone(impact, 115, .055, .19);
      noise(impact + .014, .028, 3600, .13);
    } else if (kind === 'cheers') {
      // Two bright glass resonances meet at the visual clink.
      tone(impact, 2200, .36, .13); tone(impact + .018, 3300, .28, .065);
      noise(impact, .018, 4700, .09);
    } else if (kind === 'money') {
      for (let i = 0; i < 6; i++) noise(impact + i * .065, .055, 1200 + i * 180, .055);
      [920, 1380, 1840].forEach((frequency, i) => tone(impact + .08 + i * .07, frequency, .12, .045));
    } else if (kind === 'tomato') {
      if (delayMs >= 0) noise(at, .13, 1000, .04);
      tone(impact, 95, .14, .2); noise(impact, .17, 420, .23);
      noise(impact + .035, .12, 1700, .1);
    } else if (kind === 'crown') {
      [523, 659, 784, 1047].forEach((frequency, i) => tone(impact + i * .065, frequency, .28, .07));
    } else if (kind === 'laugh') {
      [155, 185, 150, 175].forEach((frequency, i) => voice(impact + i * .12, frequency, .105, .13));
    } else if (kind === 'duck') {
      voice(impact, 280, .15, .14); voice(impact + .19, 245, .18, .14);
    } else if (kind === 'punch') {
      if (delayMs >= 0) noise(at, .13, 850, .06);
      noise(impact, .055, 1800, .29); tone(impact, 72, .13, .24);
      noise(impact + .012, .09, 300, .15);
    }
  }
}
