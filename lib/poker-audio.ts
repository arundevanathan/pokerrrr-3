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
    const social = Object.hasOwn(REACTIONS, kind) ? REACTIONS[kind as keyof typeof REACTIONS] : null;
    const impact = ctx.currentTime + Math.max(0, delayMs + (social?.impactAt || 0)) / 1000;
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
    const tone = (time: number, frequency: number, duration: number, volume: number, decay = 1, waveform: OscillatorType = 'sine') => {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = waveform;
      osc.frequency.setValueAtTime(frequency, time);
      osc.frequency.exponentialRampToValueAtTime(frequency * decay, time + duration);
      gain.gain.setValueAtTime(.001, time);
      gain.gain.linearRampToValueAtTime(volume, time + .004);
      gain.gain.exponentialRampToValueAtTime(.001, time + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      this.source(osc);
      osc.start(time);
      osc.stop(time + duration);
    };
    if (kind === 'chappal') {
      if (delayMs >= 0) noise(at, .08, 1400, .025);
      noise(impact, .042, 2600, .28);
      noise(impact + .006, .064, 650, .15);
      tone(impact, 115, .055, .09);
    } else if (kind === 'cheers') {
      // Glass rings at stable frequencies. The short attack is the rims touching.
      noise(impact, .015, 5100, .055);
      tone(impact, 1700, .2, .065);
      tone(impact + .005, 2920, .11, .035);
      tone(impact + .011, 2200, .15, .022);
    } else if (kind === 'laugh') {
      // Three springy, descending cartoon chuckles.
      [490, 560, 420].forEach((pitch, index) => {
        const onset = impact + index * .13;
        tone(onset, pitch, .115, .075, .67, 'triangle');
        tone(onset + .014, pitch * 2, .078, .035, .60);
        noise(onset, .055, 1400, .055);
      });
    } else if (kind === 'tomato') {
      // Initial soft crush with short, irregular wet transients and a pulp tail.
      noise(impact, .11, 580, .19);
      noise(impact + .007, .035, 1940, .12);
      noise(impact + .021, .085, 1060, .11);
      noise(impact + .048, .034, 2760, .042);
      noise(impact + .062, .13, 380, .07);
    } else if (kind === 'punch') {
      // A padded impact with a short leather transient and a damped body.
      if (delayMs >= 0) noise(at + .04, .13, 780, .025);
      noise(impact, .035, 1180, .10);
      noise(impact + .004, .10, 260, .18);
      tone(impact, 88, .075, .105, .57);
    }
  }
}
