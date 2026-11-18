export type SoundGate = (beatIndex: number) => boolean;
export type SoundMode = 'click' | 'stomp';

export type ScheduledBeat = { index: number; time: number; audible: boolean };

export type VisualState = {
  /** Audio-clock time of what is audible right now (output latency compensated). */
  now: number;
  /** Time the current run started (before the first beat). */
  startTime: number;
  /** Last beat that has already sounded, or null during the lead-in. */
  prev: ScheduledBeat | null;
  /** Next upcoming beat. */
  next: ScheduledBeat | null;
};

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.1;
const LEAD_IN_SECONDS = 0.1;
const CLICK_DURATION_SECONDS = 0.035;
const KICK_DURATION_SECONDS = 0.45;

export class MetronomeEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  /** Per-run bus; dropping it on stop silences sounds already scheduled ahead. */
  private runBus: GainNode | null = null;
  private timerId: number | null = null;
  private runId = 0;
  private nextBeatTime = 0;
  private beatIndex = 0;
  private startTime = 0;
  private beats: ScheduledBeat[] = [];
  private bpmValue: number;
  private volume = 0.9;
  private soundMode: SoundMode = 'click';
  private soundGate: SoundGate = () => true;
  private kickBuffer: AudioBuffer | null = null;

  constructor(bpm: number) {
    this.bpmValue = bpm;
  }

  get isRunning() {
    return this.timerId !== null;
  }

  setBpm(bpm: number) {
    this.bpmValue = bpm;
  }

  setSoundMode(soundMode: SoundMode) {
    this.soundMode = soundMode;
  }

  setSoundGate(soundGate: SoundGate) {
    this.soundGate = soundGate;
  }

  setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
    }
  }

  async start() {
    if (this.isRunning) return;
    const runId = ++this.runId;

    const ctx = this.ensureContext();
    if (ctx.state !== 'running') await ctx.resume();

    // stop() (or another start()) happened while awaiting
    if (runId !== this.runId || this.isRunning) return;

    this.runBus = ctx.createGain();
    this.runBus.connect(this.masterGain!);
    this.getKickBuffer(ctx);

    this.startTime = ctx.currentTime;
    this.nextBeatTime = this.startTime + LEAD_IN_SECONDS;
    this.beatIndex = 0;
    this.beats = [];
    this.schedule();
    this.timerId = window.setInterval(() => this.schedule(), LOOKAHEAD_MS);
  }

  stop() {
    this.runId += 1;
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }

    const bus = this.runBus;
    if (bus && this.ctx) {
      bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.005);
      window.setTimeout(() => bus.disconnect(), 100);
    }
    this.runBus = null;
    this.beats = [];
  }

  dispose() {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
  }

  getVisualState(): VisualState | null {
    if (!this.ctx || !this.isRunning) return null;

    const now = this.audibleTime(this.ctx);
    let prev: ScheduledBeat | null = null;
    let next: ScheduledBeat | null = null;
    for (const beat of this.beats) {
      if (beat.time <= now) prev = beat;
      else {
        next = beat;
        break;
      }
    }
    return { now, startTime: this.startTime, prev, next };
  }

  private audibleTime(ctx: AudioContext) {
    const stamp = ctx.getOutputTimestamp?.();
    if (stamp?.contextTime && stamp.performanceTime) {
      return stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
    }
    return ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
  }

  private ensureContext() {
    if (!this.ctx) {
      // iOS: play through the silent switch like a media app (Safari 16.4+)
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'playback';

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass({ latencyHint: 'interactive' });
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private schedule() {
    if (!this.ctx) return;

    while (this.nextBeatTime < this.ctx.currentTime + SCHEDULE_AHEAD_SECONDS) {
      const time = this.nextBeatTime;
      const index = this.beatIndex;
      const audible = this.soundGate(index);
      if (audible) this.scheduleSound(time);
      this.beats.push({ index, time, audible });

      this.beatIndex += 1;
      this.nextBeatTime += 60 / this.bpmValue;
    }

    // keep only the last few beats around for the visuals
    if (this.beats.length > 8) this.beats.splice(0, this.beats.length - 8);
  }

  private scheduleSound(time: number) {
    if (this.soundMode === 'click') this.scheduleClick(time);
    else this.scheduleKick(time);
  }

  private scheduleClick(time: number) {
    const ctx = this.ctx!;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1120, time);
    oscillator.frequency.exponentialRampToValueAtTime(760, time + CLICK_DURATION_SECONDS);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.8, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + CLICK_DURATION_SECONDS);

    oscillator.connect(gain);
    gain.connect(this.runBus!);
    oscillator.start(time);
    oscillator.stop(time + CLICK_DURATION_SECONDS + 0.01);
  }

  private scheduleKick(time: number) {
    const source = this.ctx!.createBufferSource();
    source.buffer = this.getKickBuffer(this.ctx!);
    source.connect(this.runBus!);
    source.start(time);
  }

  /**
   * Kick drum rendered once: a sine whose pitch drops fast from ~170 Hz to
   * ~48 Hz (the drum head), a short beater click on top and gentle saturation.
   */
  private getKickBuffer(ctx: AudioContext) {
    if (this.kickBuffer) return this.kickBuffer;

    const rate = ctx.sampleRate;
    const length = Math.floor(rate * KICK_DURATION_SECONDS);
    const buffer = ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    const drive = 1.8;
    let phase = 0;
    let lastNoise = 0;
    let peak = 0;

    for (let i = 0; i < length; i += 1) {
      const t = i / rate;
      const frequency = 48 + 122 * Math.exp(-t / 0.032);
      phase += (2 * Math.PI * frequency) / rate;
      const body = Math.sin(phase) * Math.exp(-t / 0.17);

      // high-passed noise burst = beater hitting the head
      const noise = Math.random() * 2 - 1;
      const beater = (noise - lastNoise) * 0.22 * Math.exp(-t / 0.0025);
      lastNoise = noise;

      const attack = Math.min(1, t / 0.0008);
      const sample = Math.tanh(drive * (body + beater) * attack) / Math.tanh(drive);
      data[i] = sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    // fade the tail to avoid a cut-off click, then normalise
    const fade = Math.floor(rate * 0.03);
    for (let i = 0; i < length; i += 1) {
      const tail = i > length - fade ? (length - i) / fade : 1;
      data[i] = (data[i] / peak) * 0.95 * tail;
    }

    this.kickBuffer = buffer;
    return buffer;
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
