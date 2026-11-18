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
    const tone = (time: number, frequency: number, duration: number, volume: number, decay = 1) => {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = 'sine';
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
    const voice = (time: number, frequency: number, duration: number, volume: number) => {
      const osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.setValueAtTime(frequency, time);
      osc.frequency.exponentialRampToValueAtTime(frequency * .85, time + duration);
      filter.type = 'bandpass'; filter.frequency.setValueAtTime(frequency * 3.5, time); filter.Q.value = 1.2;
      gain.gain.setValueAtTime(.001, time); gain.gain.linearRampToValueAtTime(volume, time + .025);
      gain.gain.exponentialRampToValueAtTime(.001, time + duration);
      osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      this.source(osc); osc.start(time); osc.stop(time + duration);
    };
    const social = Object.hasOwn(REACTIONS, kind) ? REACTIONS[kind as keyof typeof REACTIONS] : null;
    const impact = ctx.currentTime + Math.max(0, delayMs + (social?.impactAt || 0)) / 1000;
    if (kind === 'chappal') {
      if (delayMs >= 0) noise(at, .08, 1400, .025);
      noise(impact, .042, 2600, .28);
      noise(impact + .006, .064, 650, .15);
      tone(impact, 115, .055, .09);
    } else if (kind === 'cheers') {
      // Glass rings at stable frequencies. The short attack is the rims touching.
      noise(impact, .015, 5100, .055);
      tone(impact, 2348, .24, .065);
      tone(impact + .005, 3817, .13, .035);
      tone(impact + .011, 2910, .19, .022);
    } else if (kind === 'money') {
      for (let i = 0; i < 5; i++) {
        noise(impact + i * .042, .06, 1900 + i * 310, .071 - i * .007);
      }
    } else if (kind === 'tomato') {
      tone(impact, 96, .095, .08, .65);
      noise(impact, .12, 540, .21);
      noise(impact + .014, .065, 1560, .092);
    } else if (kind === 'crown') {
      noise(impact, .022, 3600, .045);
      tone(impact, 1481, .24, .05);
      tone(impact + .008, 2581, .17, .034);
    } else if (kind === 'laugh') {
      [159, 164, 142].forEach((frequency, i) => {
        const onset = impact + i * .102;
        voice(onset, frequency, .094, .067 - i * .009);
        noise(onset, .085, 1050, .065 - i * .01);
      });
    } else if (kind === 'duck') {
      voice(impact, 194, .12, .085);
      noise(impact, .11, 1350, .083);
      voice(impact + .14, 179, .10, .062);
    } else if (kind === 'punch') {
      if (delayMs >= 0) noise(at, .10, 890, .028);
      noise(impact, .045, 1500, .15);
      tone(impact, 76, .10, .15, .65);
      noise(impact + .009, .06, 360, .09);
    }
  }
}
