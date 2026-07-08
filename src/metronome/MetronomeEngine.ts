export type BeatHandler = (beat: { index: number; audioTime: number }) => void;

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.1;
const CLICK_DURATION_SECONDS = 0.035;

export class MetronomeEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private timerId: number | null = null;
  private visualTimers = new Set<number>();
  private nextBeatTime = 0;
  private beatIndex = 0;
  private bpmValue: number;
  private readonly onBeat: BeatHandler;

  constructor(bpm: number, onBeat: BeatHandler) {
    this.bpmValue = bpm;
    this.onBeat = onBeat;
  }

  get isRunning() {
    return this.timerId !== null;
  }

  setBpm(bpm: number) {
    this.bpmValue = bpm;
  }

  async start() {
    if (this.isRunning) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!this.audioContext) {
      this.audioContext = new AudioContextClass();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.9;
      this.masterGain.connect(this.audioContext.destination);
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.masterGain?.gain.setTargetAtTime(0.9, this.audioContext.currentTime, 0.003);
    this.nextBeatTime = this.audioContext.currentTime + 0.04;
    this.beatIndex = 0;
    this.schedule();
    this.timerId = window.setInterval(() => this.schedule(), LOOKAHEAD_MS);
  }

  stop() {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }

    for (const timer of this.visualTimers) {
      window.clearTimeout(timer);
    }
    this.visualTimers.clear();

    if (this.audioContext && this.masterGain) {
      this.masterGain.gain.cancelScheduledValues(this.audioContext.currentTime);
      this.masterGain.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.01);
    }
  }

  dispose() {
    this.stop();
    void this.audioContext?.close();
    this.audioContext = null;
    this.masterGain = null;
  }

  private schedule() {
    if (!this.audioContext || !this.masterGain) return;

    while (this.nextBeatTime < this.audioContext.currentTime + SCHEDULE_AHEAD_SECONDS) {
      const beatTime = this.nextBeatTime;
      const index = this.beatIndex;
      this.scheduleClick(beatTime);
      this.scheduleBeatEvent(beatTime, index);

      this.beatIndex += 1;
      this.nextBeatTime += 60 / this.bpmValue;
    }
  }

  private scheduleClick(time: number) {
    if (!this.audioContext || !this.masterGain) return;

    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1120, time);
    oscillator.frequency.exponentialRampToValueAtTime(760, time + CLICK_DURATION_SECONDS);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.8, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + CLICK_DURATION_SECONDS);

    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(time);
    oscillator.stop(time + CLICK_DURATION_SECONDS + 0.01);
  }

  private scheduleBeatEvent(audioTime: number, index: number) {
    if (!this.audioContext) return;

    const delayMs = Math.max(0, (audioTime - this.audioContext.currentTime) * 1000);
    const timer = window.setTimeout(() => {
      this.visualTimers.delete(timer);
      if (this.isRunning) {
        this.onBeat({ index, audioTime });
      }
    }, delayMs);
    this.visualTimers.add(timer);
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
