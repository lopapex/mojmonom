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
const STOMP_DURATION_SECONDS = 0.13;
const STOMP_SAMPLE_URL = '/audio/stomp.mp3';

export class MetronomeEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  /** Per-run bus; dropping it on stop silences sounds already scheduled ahead. */
  private runBus: GainNode | null = null;
  private stompBus: GainNode | null = null;
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
  private stompBuffer: AudioBuffer | null = null;
  private stompData: Promise<ArrayBuffer | null>;
  private noiseBuffer: AudioBuffer | null = null;

  constructor(bpm: number) {
    this.bpmValue = bpm;
    this.stompData = fetch(STOMP_SAMPLE_URL)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .catch(() => null);
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
    if (this.soundMode === 'stomp') await this.decodeStomp();
    else void this.decodeStomp();

    // stop() (or another start()) happened while awaiting
    if (runId !== this.runId || this.isRunning) return;

    this.runBus = ctx.createGain();
    this.runBus.connect(this.masterGain!);
    this.stompBus = ctx.createGain();
    this.stompBus.gain.value = 1.35;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 16;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.001;
    compressor.release.value = 0.06;
    this.stompBus.connect(compressor);
    compressor.connect(this.runBus);

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
    this.stompBus = null;
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
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass({ latencyHint: 'interactive' });
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private async decodeStomp() {
    const data = await this.stompData;
    if (!data || !this.ctx || this.stompBuffer) return;
    try {
      // decodeAudioData detaches the buffer, so hand it a copy
      this.stompBuffer = await this.ctx.decodeAudioData(data.slice(0));
    } catch {
      this.stompBuffer = null;
    }
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
    else if (this.stompBuffer) this.scheduleSampleStomp(time);
    else this.scheduleSyntheticStomp(time);
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

  private scheduleSampleStomp(time: number) {
    const source = this.ctx!.createBufferSource();
    source.buffer = this.stompBuffer;
    source.connect(this.stompBus!);
    source.start(time);
  }

  private scheduleSyntheticStomp(time: number) {
    const ctx = this.ctx!;
    const body = ctx.createOscillator();
    const bodyFilter = ctx.createBiquadFilter();
    const bodyGain = ctx.createGain();
    const thump = ctx.createBufferSource();
    const thumpFilter = ctx.createBiquadFilter();
    const thumpGain = ctx.createGain();

    body.type = 'triangle';
    body.frequency.setValueAtTime(145, time);
    body.frequency.exponentialRampToValueAtTime(42, time + STOMP_DURATION_SECONDS);

    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.setValueAtTime(520, time);
    bodyFilter.frequency.exponentialRampToValueAtTime(105, time + STOMP_DURATION_SECONDS);
    bodyFilter.Q.value = 0.95;

    bodyGain.gain.setValueAtTime(0.0001, time);
    bodyGain.gain.exponentialRampToValueAtTime(1.75, time + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(0.52, time + 0.035);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + STOMP_DURATION_SECONDS);

    thump.buffer = this.getNoiseBuffer(ctx);
    thumpFilter.type = 'bandpass';
    thumpFilter.frequency.value = 950;
    thumpFilter.Q.value = 0.95;
    thumpGain.gain.setValueAtTime(0.0001, time);
    thumpGain.gain.exponentialRampToValueAtTime(0.85, time + 0.0015);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);

    body.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    bodyGain.connect(this.stompBus!);
    thump.connect(thumpFilter);
    thumpFilter.connect(thumpGain);
    thumpGain.connect(this.stompBus!);

    body.start(time);
    body.stop(time + STOMP_DURATION_SECONDS + 0.02);
    thump.start(time);
    thump.stop(time + 0.03);
  }

  private getNoiseBuffer(ctx: AudioContext) {
    if (!this.noiseBuffer) {
      const length = Math.floor(ctx.sampleRate * 0.025);
      this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      }
    }
    return this.noiseBuffer;
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
