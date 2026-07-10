export type BeatHandler = (beat: { index: number; audioTime: number }) => void;
export type SoundGate = (beatIndex: number) => boolean;
export type SoundMode = 'click' | 'stomp';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.1;
const CLICK_DURATION_SECONDS = 0.035;
const STOMP_DURATION_SECONDS = 0.13;

export class MetronomeEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private timerId: number | null = null;
  private visualTimers = new Set<number>();
  private nextBeatTime = 0;
  private beatIndex = 0;
  private bpmValue: number;
  private volume = 0.9;
  private soundMode: SoundMode = 'click';
  private soundGate: SoundGate = () => true;
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

  setSoundMode(soundMode: SoundMode) {
    this.soundMode = soundMode;
  }

  setSoundGate(soundGate: SoundGate) {
    this.soundGate = soundGate;
  }

  setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.audioContext && this.masterGain && this.isRunning) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.audioContext.currentTime, 0.01);
    }
  }

  async start() {
    if (this.isRunning) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!this.audioContext) {
      this.audioContext = new AudioContextClass();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.audioContext.destination);
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.masterGain?.gain.setTargetAtTime(this.volume, this.audioContext.currentTime, 0.003);
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
      if (this.soundGate(index)) {
        this.scheduleSound(beatTime);
      }
      this.scheduleBeatEvent(beatTime, index);

      this.beatIndex += 1;
      this.nextBeatTime += 60 / this.bpmValue;
    }
  }

  private scheduleSound(time: number) {
    if (this.soundMode === 'stomp') {
      this.scheduleStomp(time);
      return;
    }

    this.scheduleClick(time);
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

  private scheduleStomp(time: number) {
    if (!this.audioContext || !this.masterGain) return;

    const bodyOscillator = this.audioContext.createOscillator();
    const bodyGain = this.audioContext.createGain();
    const bodyFilter = this.audioContext.createBiquadFilter();
    const stompBus = this.audioContext.createGain();
    const stompCompressor = this.audioContext.createDynamicsCompressor();
    const thumpBuffer = this.audioContext.createBuffer(1, Math.floor(this.audioContext.sampleRate * 0.025), this.audioContext.sampleRate);
    const thumpData = thumpBuffer.getChannelData(0);
    const thumpSource = this.audioContext.createBufferSource();
    const thumpGain = this.audioContext.createGain();
    const thumpFilter = this.audioContext.createBiquadFilter();

    for (let index = 0; index < thumpData.length; index += 1) {
      const fade = 1 - index / thumpData.length;
      thumpData[index] = (Math.random() * 2 - 1) * fade;
    }

    bodyOscillator.type = 'triangle';
    bodyOscillator.frequency.setValueAtTime(145, time);
    bodyOscillator.frequency.exponentialRampToValueAtTime(42, time + STOMP_DURATION_SECONDS);

    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.setValueAtTime(520, time);
    bodyFilter.frequency.exponentialRampToValueAtTime(105, time + STOMP_DURATION_SECONDS);
    bodyFilter.Q.value = 0.95;

    stompBus.gain.setValueAtTime(1.2, time);
    stompCompressor.threshold.setValueAtTime(-18, time);
    stompCompressor.knee.setValueAtTime(18, time);
    stompCompressor.ratio.setValueAtTime(8, time);
    stompCompressor.attack.setValueAtTime(0.001, time);
    stompCompressor.release.setValueAtTime(0.055, time);

    bodyGain.gain.setValueAtTime(0.0001, time);
    bodyGain.gain.exponentialRampToValueAtTime(2.35, time + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(0.7, time + 0.035);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + STOMP_DURATION_SECONDS);

    thumpSource.buffer = thumpBuffer;
    thumpFilter.type = 'bandpass';
    thumpFilter.frequency.setValueAtTime(950, time);
    thumpFilter.Q.value = 0.95;
    thumpGain.gain.setValueAtTime(0.0001, time);
    thumpGain.gain.exponentialRampToValueAtTime(1.15, time + 0.0015);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);

    bodyOscillator.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    bodyGain.connect(stompBus);
    thumpSource.connect(thumpFilter);
    thumpFilter.connect(thumpGain);
    thumpGain.connect(stompBus);
    stompBus.connect(stompCompressor);
    stompCompressor.connect(this.masterGain);

    bodyOscillator.start(time);
    bodyOscillator.stop(time + STOMP_DURATION_SECONDS + 0.02);
    thumpSource.start(time);
    thumpSource.stop(time + 0.03);
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
