import { useEffect, useMemo, useRef, useState } from 'react';
import { MetronomeEngine } from './metronome/MetronomeEngine';

type ViewMode = 'circle' | 'needle';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type WakeLockSentinel = EventTarget & {
  released: boolean;
  release: () => Promise<void>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinel>;
  };
};

const MIN_BPM = 40;
const MAX_BPM = 240;
const STORAGE_KEY = 'mojmonom.settings';

type SavedSettings = {
  bpm?: number;
  view?: ViewMode;
  keepAwake?: boolean;
};

function loadSettings(): Required<SavedSettings> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as SavedSettings;
    return {
      bpm: clampBpm(parsed.bpm ?? 120),
      view: parsed.view === 'circle' ? 'circle' : 'needle',
      keepAwake: Boolean(parsed.keepAwake)
    };
  } catch {
    return { bpm: 120, view: 'needle', keepAwake: false };
  }
}

function clampBpm(value: number) {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(value)));
}

function supportsWakeLock() {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
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
  const [keepAwake, setKeepAwake] = useState(initialSettings.keepAwake);
  const [isRunning, setIsRunning] = useState(false);
  const [lastBeatAt, setLastBeatAt] = useState<number | null>(null);
  const [beatIndex, setBeatIndex] = useState(0);
  const [now, setNow] = useState(() => performance.now());
  const [isMobileDevice, setIsMobileDevice] = useState(isMobileLikeDevice);
  const [wakeLockAvailable, setWakeLockAvailable] = useState(supportsWakeLock);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(isStandalonePwa);
  const wakeLockSupported = wakeLockAvailable && isMobileDevice;
  const engineRef = useRef<MetronomeEngine | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const keepAwakeRef = useRef(keepAwake);

  useEffect(() => {
    keepAwakeRef.current = keepAwake && wakeLockSupported;
  }, [keepAwake, wakeLockSupported]);

  async function requestWakeLock() {
    if (!wakeLockSupported || wakeLockRef.current || document.visibilityState !== 'visible') return false;

    try {
      const sentinel = await (navigator as WakeLockNavigator).wakeLock?.request('screen');
      if (!sentinel) return false;

      wakeLockRef.current = sentinel;
      sentinel.addEventListener('release', () => {
        wakeLockRef.current = null;
      });
      return true;
    } catch {
      wakeLockRef.current = null;
      setWakeLockAvailable(false);
      setKeepAwake(false);
      return false;
    }
  }

  async function releaseWakeLock() {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    await sentinel?.release().catch(() => undefined);
  }

  useEffect(() => {
    if (keepAwake && wakeLockSupported) {
      void requestWakeLock();
    } else {
      void releaseWakeLock();
    }
  }, [keepAwake, wakeLockSupported]);

  useEffect(() => {
    const restoreWakeLock = () => {
      if (document.visibilityState === 'visible' && keepAwakeRef.current) {
        void requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', restoreWakeLock);
    return () => {
      document.removeEventListener('visibilitychange', restoreWakeLock);
      void releaseWakeLock();
    };
  }, []);

  useEffect(() => {
    const stopForBackground = () => {
      engineRef.current?.stop();
      setIsRunning(false);
      setLastBeatAt(null);
      setBeatIndex(0);
      void releaseWakeLock();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (keepAwakeRef.current) return;
        stopForBackground();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', stopForBackground);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', stopForBackground);
    };
  }, []);

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bpm, view, keepAwake }));
  }, [bpm, view, keepAwake]);

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
  const circleScale = 1 + Math.pow(pulse, 2.35) * 0.38;
  const circleOpacity = 0.28 + pulse * 0.38;
  const haloScale = 0.92 + Math.pow(pulse, 1.6) * 0.72;
  const haloOpacity = pulse * 0.24;
  const coreScale = 1 + Math.pow(pulse, 2.2) * 0.55;
  const needleSwingAngle = 22;
  const fromAngle = beatIndex % 2 === 0 ? -needleSwingAngle : needleSwingAngle;
  const toAngle = beatIndex % 2 === 0 ? needleSwingAngle : -needleSwingAngle;
  const easedProgress = 0.5 - Math.cos(progress * Math.PI) / 2;
  const needleAngle = hasBeat ? fromAngle + (toAngle - fromAngle) * easedProgress : -needleSwingAngle;

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

  async function toggleKeepAwake() {
    if (!wakeLockSupported) return;

    if (keepAwake) {
      setKeepAwake(false);
      await releaseWakeLock();
      return;
    }

    setKeepAwake(true);
    const didLock = await requestWakeLock();
    if (!didLock) {
      setKeepAwake(false);
    }
  }

  async function installApp() {
    if (isStandalone || !installPrompt) return;

    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <main className="app-shell">
      <section
        className="metronome-panel"
        aria-label="mojmonom metronom"
      >
        <header className="app-header">
          <img className="brand-wordmark" src="/brand/mojmonom-wordmark-transparent.png" alt="mojmonom" />
          <div className="header-actions">
            {wakeLockSupported && (
              <button
                type="button"
                className={keepAwake ? 'header-icon-button is-active' : 'header-icon-button'}
                onClick={toggleKeepAwake}
                aria-pressed={keepAwake}
                aria-label={keepAwake ? 'Povolit zamykani telefonu' : 'Nechat displej zapnuty'}
                title={keepAwake ? 'Povolit zamykani telefonu' : 'Nechat displej zapnuty'}
              >
                <img className="wake-lock-icon" src="/visuals/wake-lock.png" alt="" draggable="false" />
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
                className="pulse-halo"
                style={{
                  transform: `scale(${isRunning ? haloScale : 0.92})`,
                  opacity: isRunning ? haloOpacity : 0
                }}
              />
              <div
                className={isRunning ? 'pulse-ring is-active' : 'pulse-ring'}
                style={{
                  transform: `scale(${isRunning ? circleScale : 1})`,
                  opacity: isRunning ? circleOpacity : 0.24
                }}
              />
              <div
                className="pulse-core"
                style={{
                  transform: `scale(${isRunning ? coreScale : 1})`
                }}
              />
            </div>
          ) : (
            <div key="needle" className="needle-view visual-mode">
              <div className="needle-symbol">
                <div
                  className="needle"
                  style={{ transform: `translateX(-50%) rotate(${isRunning ? needleAngle : 0}deg)` }}
                />
                <div className="needle-base" />
              </div>
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
