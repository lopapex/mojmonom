import { useEffect, useRef, useState } from 'preact/hooks';
import { MetronomeEngine, type SoundMode } from './metronome/MetronomeEngine';
import { Visual, type ViewMode } from './Visual';
import { ClickIcon, InstallIcon, StompIcon, VolumeIcon } from './icons';

type BeatSoundMode = '1x' | '2x' | '4x';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<unknown>;
};

const MIN_BPM = 40;
const MAX_BPM = 240;
const STORAGE_KEY = 'mojmonom.settings';
const BEAT_EVERY: Record<BeatSoundMode, number> = { '1x': 1, '2x': 2, '4x': 4 };
const NEXT_BEAT_SOUND: Record<BeatSoundMode, BeatSoundMode> = { '1x': '2x', '2x': '4x', '4x': '1x' };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

type Settings = { bpm: number; view: ViewMode; sound: SoundMode; beatSound: BeatSoundMode; volume: number };

function loadSettings(): Settings {
  let saved: Partial<Record<keyof Settings, unknown>> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    // ignore corrupted storage
  }
  return {
    bpm: clamp(Number(saved.bpm) || 120, MIN_BPM, MAX_BPM),
    view: saved.view === 'circle' ? 'circle' : 'needle',
    sound: saved.sound === 'stomp' ? 'stomp' : 'click',
    beatSound: saved.beatSound === '2x' || saved.beatSound === 'right' ? '2x' : saved.beatSound === '4x' ? '4x' : '1x',
    volume: clamp(Number(saved.volume ?? 90), 0, 100)
  };
}

const initial = loadSettings();

export default function App() {
  const [bpm, setBpm] = useState(initial.bpm);
  const [view, setView] = useState(initial.view);
  const [sound, setSound] = useState(initial.sound);
  const [beatSound, setBeatSound] = useState(initial.beatSound);
  const [volume, setVolume] = useState(initial.volume);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [engine] = useState(() => new MetronomeEngine(initial.bpm));
  const runningRef = useRef(false);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const volumeRef = useRef<HTMLDivElement>(null);

  useEffect(() => engine.setBpm(bpm), [bpm]);
  useEffect(() => engine.setSoundMode(sound), [sound]);
  useEffect(() => engine.setVolume(volume / 100), [volume]);
  useEffect(() => {
    const every = BEAT_EVERY[beatSound];
    engine.setSoundGate((index) => index % every === 0);
  }, [beatSound]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ bpm, view, sound, beatSound, volume }));
    }, 300);
    return () => window.clearTimeout(id);
  }, [bpm, view, sound, beatSound, volume]);

  // Screen stays awake only while the metronome plays.
  useEffect(() => {
    runningRef.current = running;
    if (!running) {
      void wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
      return;
    }

    const acquire = async () => {
      if (!runningRef.current || wakeLock.current || document.visibilityState !== 'visible') return;
      try {
        const sentinel = await navigator.wakeLock?.request('screen');
        if (!sentinel) return;
        if (!runningRef.current) return void sentinel.release();
        wakeLock.current = sentinel;
        sentinel.addEventListener('release', () => {
          if (wakeLock.current === sentinel) wakeLock.current = null;
        });
      } catch {
        // not supported or denied
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => document.removeEventListener('visibilitychange', acquire);
  }, [running]);

  useEffect(() => {
    const stop = () => {
      engine.stop();
      setRunning(false);
    };
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);

    window.addEventListener('pagehide', stop);
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      engine.stop();
      window.removeEventListener('pagehide', stop);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Close the volume popover on outside tap or Escape.
  useEffect(() => {
    if (!volumeOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!volumeRef.current?.contains(event.target as Node)) setVolumeOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setVolumeOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [volumeOpen]);

  function toggleRunning() {
    if (running) {
      engine.stop();
      setRunning(false);
      return;
    }
    setRunning(true);
    engine.start().catch(() => setRunning(false));
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  const updateBpm = (value: number) => setBpm(clamp(value, MIN_BPM, MAX_BPM));

  return (
    <main className="app-shell">
      <section className="metronome-panel" aria-label="mojmonom metronom">
        <header className="app-header">
          <img className="brand-wordmark" src="/brand/mojmonom-wordmark-white.png" alt="mojmonom" width="180" height="40" />
          <div className="header-actions">
            {installPrompt && (
              <button type="button" className="header-button" onClick={installApp} aria-label="Instalovat mojmonom">
                <InstallIcon />
              </button>
            )}
            <button
              type="button"
              className="header-button beat-sound-button"
              onClick={() => setBeatSound(NEXT_BEAT_SOUND[beatSound])}
              aria-label={`Přepnout četnost zvuku, aktuálně ${beatSound}`}
            >
              {beatSound}
            </button>
            <button
              type="button"
              className="header-button"
              onClick={() => setSound(sound === 'click' ? 'stomp' : 'click')}
              aria-label={sound === 'click' ? 'Přepnout na zvuk dupnutí' : 'Přepnout na čistý metronom'}
            >
              {sound === 'click' ? <ClickIcon /> : <StompIcon />}
            </button>
            <div className="volume-control" ref={volumeRef}>
              <button
                type="button"
                className={volumeOpen ? 'header-button is-active' : 'header-button'}
                onClick={() => setVolumeOpen(!volumeOpen)}
                aria-label={volumeOpen ? 'Zavřít hlasitost' : 'Otevřít hlasitost'}
                aria-expanded={volumeOpen}
              >
                <VolumeIcon />
              </button>
              <div className={volumeOpen ? 'volume-popover is-open' : 'volume-popover'} inert={!volumeOpen}>
                <input
                  className="volume-slider"
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  onInput={(event) => setVolume(clamp(Number(event.currentTarget.value), 0, 100))}
                  aria-label="Hlasitost"
                />
              </div>
            </div>
          </div>
        </header>

        <Visual engine={engine} view={view} running={running} bpm={bpm} />

        <div className="tempo-readout">
          <span className="tempo-unit">BPM</span>
          <span className="tempo-number">{bpm}</span>
        </div>

        <div className="tempo-control">
          <button type="button" onClick={() => updateBpm(bpm - 1)} aria-label="Snížit tempo o 1 BPM">
            −
          </button>
          <div className="slider-wrap">
            <input
              type="range"
              min={MIN_BPM}
              max={MAX_BPM}
              value={bpm}
              onInput={(event) => updateBpm(Number(event.currentTarget.value))}
              aria-label="Tempo v BPM"
            />
            <span className="slider-limits" aria-hidden="true">
              <span>{MIN_BPM}</span>
              <span>{MAX_BPM}</span>
            </span>
          </div>
          <button type="button" onClick={() => updateBpm(bpm + 1)} aria-label="Zvýšit tempo o 1 BPM">
            +
          </button>
        </div>

        <div className="mode-control" role="group" aria-label="Pohled metronomu">
          <button
            type="button"
            className={view === 'needle' ? 'is-selected' : ''}
            onClick={() => setView('needle')}
            aria-label="Pohled ručička"
            aria-pressed={view === 'needle'}
          >
            <span className="mode-icon needle-mode-icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={view === 'circle' ? 'is-selected' : ''}
            onClick={() => setView('circle')}
            aria-label="Pohled kolečko"
            aria-pressed={view === 'circle'}
          >
            <span className="mode-icon circle-mode-icon" aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          className="transport-button"
          onClick={toggleRunning}
          aria-label={running ? 'Pozastavit metronom' : 'Spustit metronom'}
        >
          <span className={running ? 'transport-icon pause-icon' : 'transport-icon play-icon'} />
        </button>
      </section>
    </main>
  );
}
