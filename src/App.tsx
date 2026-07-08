import { useEffect, useMemo, useRef, useState } from 'react';
import { MetronomeEngine } from './metronome/MetronomeEngine';

type ViewMode = 'circle' | 'needle';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const MIN_BPM = 40;
const MAX_BPM = 240;
const VIBRATION_MS = 35;
const STORAGE_KEY = 'mojmonom.settings';

type SavedSettings = {
  bpm?: number;
  view?: ViewMode;
  vibration?: boolean;
};

function loadSettings(): Required<SavedSettings> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as SavedSettings;
    return {
      bpm: clampBpm(parsed.bpm ?? 120),
      view: parsed.view === 'circle' ? 'circle' : 'needle',
      vibration: Boolean(parsed.vibration)
    };
  } catch {
    return { bpm: 120, view: 'needle', vibration: false };
  }
}

function clampBpm(value: number) {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(value)));
}

function supportsVibration() {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator;
}

function isMobileLikeDevice() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches
  );
}

function isStandalonePwa() {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

export default function App() {
  const initialSettings = useMemo(loadSettings, []);
  const [bpm, setBpm] = useState(initialSettings.bpm);
  const [view, setView] = useState<ViewMode>(initialSettings.view);
  const [vibration, setVibration] = useState(initialSettings.vibration);
  const [isRunning, setIsRunning] = useState(false);
  const [lastBeatAt, setLastBeatAt] = useState<number | null>(null);
  const [beatIndex, setBeatIndex] = useState(0);
  const [now, setNow] = useState(() => performance.now());
  const [isMobileDevice, setIsMobileDevice] = useState(isMobileLikeDevice);
  const [vibrationAvailable, setVibrationAvailable] = useState(supportsVibration);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(isStandalonePwa);
  const vibrationSupported = vibrationAvailable && isMobileDevice;
  const engineRef = useRef<MetronomeEngine | null>(null);
  const vibrationRef = useRef(vibration);

  useEffect(() => {
    vibrationRef.current = vibration && vibrationSupported;
  }, [vibration, vibrationSupported]);

  useEffect(() => {
    const media = window.matchMedia('(hover: none) and (pointer: coarse)');
    const updateMobileState = () => setIsMobileDevice(media.matches);
    updateMobileState();
    media.addEventListener('change', updateMobileState);

    return () => media.removeEventListener('change', updateMobileState);
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => {
    const engine = new MetronomeEngine(bpm, ({ index }) => {
      setLastBeatAt(performance.now());
      setBeatIndex(index);
      if (vibrationRef.current) {
        const didVibrate = navigator.vibrate(VIBRATION_MS);
        if (!didVibrate) {
          vibrationRef.current = false;
          setVibration(false);
          setVibrationAvailable(false);
        }
      }
    });
    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setBpm(bpm);
  }, [bpm]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bpm, view, vibration }));
  }, [bpm, view, vibration]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setNow(performance.now());
      frame = requestAnimationFrame(tick);
    };

    if (isRunning) {
      frame = requestAnimationFrame(tick);
    }

    return () => cancelAnimationFrame(frame);
  }, [isRunning]);

  const beatDurationMs = 60000 / bpm;
  const hasBeat = lastBeatAt !== null;
  const elapsed = hasBeat ? Math.max(0, now - lastBeatAt) : 0;
  const progress = hasBeat ? Math.min(1, elapsed / beatDurationMs) : 0;
  const pulse = hasBeat ? Math.max(0, 1 - progress) : 0;
  const circleScale = 1 + Math.pow(pulse, 2.5) * 0.28;
  const circleOpacity = 0.22 + pulse * 0.22;
  const fromAngle = beatIndex % 2 === 0 ? -34 : 34;
  const toAngle = beatIndex % 2 === 0 ? 34 : -34;
  const easedProgress = 0.5 - Math.cos(progress * Math.PI) / 2;
  const needleAngle = hasBeat ? fromAngle + (toAngle - fromAngle) * easedProgress : -34;

  async function toggleRunning() {
    const engine = engineRef.current;
    if (!engine) return;

    if (isRunning) {
      engine.stop();
      setIsRunning(false);
      return;
    }

    await engine.start();
    setLastBeatAt(null);
    setBeatIndex(0);
    setIsRunning(true);
  }

  function updateBpm(value: number) {
    setBpm(clampBpm(value));
  }

  function toggleVibration() {
    if (!vibrationSupported) return;

    const nextVibration = !vibration;
    if (nextVibration) {
      const didVibrate = navigator.vibrate(VIBRATION_MS);
      if (!didVibrate) {
        setVibration(false);
        setVibrationAvailable(false);
        return;
      }
    } else {
      navigator.vibrate(0);
    }

    setVibration(nextVibration);
  }

  async function installApp() {
    if (isStandalone || !installPrompt) return;

    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <main className="app-shell">
      <section className="metronome-panel" aria-label="mojmonom metronom">
        <header className="app-header">
          <img className="brand-wordmark" src="/brand/mojmonom-wordmark-transparent.png" alt="mojmonom" />
          <div className="header-actions">
            {vibrationSupported && (
              <button
                type="button"
                className={vibration ? 'header-icon-button is-active' : 'header-icon-button'}
                onClick={toggleVibration}
                aria-pressed={vibration}
                aria-label={vibration ? 'Vypnout vibrace' : 'Zapnout vibrace'}
                title={vibration ? 'Vypnout vibrace' : 'Zapnout vibrace'}
              >
                <img className="vibration-icon" src="/visuals/vibration.png" alt="" draggable="false" />
              </button>
            )}
            {!isStandalone && installPrompt && (
              <button
                type="button"
                className="header-icon-button"
                onClick={installApp}
                aria-label="Instalovat mojmonom jako PWA"
              >
                <svg className="install-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3v11" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M5 19h14" />
                </svg>
              </button>
            )}
          </div>
        </header>

        <div className="visual-stage" aria-hidden="true">
          {view === 'circle' ? (
            <div key="circle" className="circle-view visual-mode">
              <div
                className={isRunning ? 'pulse-ring is-active' : 'pulse-ring'}
                style={{
                  transform: `scale(${isRunning ? circleScale : 1})`,
                  opacity: isRunning ? circleOpacity : 0.18
                }}
              />
              <div className="pulse-core" />
            </div>
          ) : (
            <div key="needle" className="needle-view visual-mode">
              <div
                className="needle"
                style={{ transform: `translateX(-50%) rotate(${isRunning ? needleAngle : 0}deg)` }}
              />
              <div className="needle-base" />
            </div>
          )}
        </div>

        <div className="tempo-readout">
          <span className="tempo-unit">BPM</span>
          <span className="tempo-number">{bpm}</span>
        </div>

        <div className="tempo-control">
          <button type="button" onClick={() => updateBpm(bpm - 1)} aria-label="Snížit tempo o 1 BPM">
            -
          </button>
          <label className="slider-wrap">
            <span className="sr-only">Tempo v BPM</span>
            <input
              type="range"
              min={MIN_BPM}
              max={MAX_BPM}
              step="1"
              value={bpm}
              onChange={(event) => updateBpm(Number(event.target.value))}
              aria-valuemin={MIN_BPM}
              aria-valuemax={MAX_BPM}
              aria-valuenow={bpm}
              aria-label="Tempo v BPM"
            />
            <span className="slider-limits" aria-hidden="true">
              <span>{MIN_BPM}</span>
              <span>{MAX_BPM}</span>
            </span>
          </label>
          <button type="button" onClick={() => updateBpm(bpm + 1)} aria-label="Zvýšit tempo o 1 BPM">
            +
          </button>
        </div>

        <div
          className="mode-control"
          role="group"
          aria-label="Nastaveni metronomu"
        >
          <button
            type="button"
            className={view === 'needle' ? 'is-selected' : ''}
            onClick={() => setView('needle')}
            aria-label="Pohled ručička"
          >
            <img className="mode-image-icon" src="/visuals/needle.png" alt="" draggable="false" />
          </button>
          <button
            type="button"
            className={view === 'circle' ? 'is-selected' : ''}
            onClick={() => setView('circle')}
            aria-label="Pohled kolečko"
          >
            <span className="mode-icon circle-mode-icon" aria-hidden="true" />
          </button>
        </div>

        <div className="bottom-controls">
          <button
            type="button"
            className={isRunning ? 'transport-button is-stopping' : 'transport-button'}
            onClick={toggleRunning}
            aria-label={isRunning ? 'Pozastavit metronom' : 'Spustit metronom'}
          >
            <span className={isRunning ? 'transport-icon pause-icon' : 'transport-icon play-icon'} />
          </button>

        </div>
      </section>
    </main>
  );
}
