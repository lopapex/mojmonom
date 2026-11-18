import { useEffect, useRef } from 'preact/hooks';
import type { MetronomeEngine } from './metronome/MetronomeEngine';

export type ViewMode = 'circle' | 'needle';

const SWING = 18;
const MIN_BPM = 40;
const MAX_BPM = 240;

type Props = {
  engine: MetronomeEngine;
  view: ViewMode;
  running: boolean;
  bpm: number;
};

const easeInOut = (p: number) => 0.5 - Math.cos(p * Math.PI) / 2;
const easeOut = (p: number) => 1 - (1 - p) * (1 - p);
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));
/** Even beats sound on the right extreme, odd ones on the left. */
const angleAt = (index: number) => (index % 2 === 0 ? SWING : -SWING);

/**
 * Animation is driven straight from the audio clock and written to the DOM
 * by ref, so nothing re-renders while the metronome plays.
 */
export function Visual({ engine, view, running, bpm }: Props) {
  const needle = useRef<HTMLDivElement>(null);
  const halo = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const core = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;

  useEffect(() => {
    if (!running) return;

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const state = engine.getVisualState();
      if (!state) return;
      const { now, startTime, prev, next } = state;

      let pulse = 0;
      if (prev) {
        const nextTime = next?.time ?? prev.time + 60 / bpmRef.current;
        pulse = (1 - clamp01((now - prev.time) / (nextTime - prev.time))) * (prev.audible ? 1 : 0.42);
      }

      if (needle.current) {
        let angle = 0;
        if (!prev && next) {
          angle = angleAt(next.index) * easeOut(clamp01((now - startTime) / (next.time - startTime)));
        } else if (prev) {
          const nextTime = next?.time ?? prev.time + 60 / bpmRef.current;
          const p = easeInOut(clamp01((now - prev.time) / (nextTime - prev.time)));
          const from = angleAt(prev.index);
          angle = from + (angleAt(prev.index + 1) - from) * p;
        }
        needle.current.style.transform = `rotate(${angle.toFixed(2)}deg)`;
        tip.current?.style.setProperty('transform', `scale(${(1 + Math.pow(pulse, 3) * 0.45).toFixed(4)})`);
      }

      if (ring.current && halo.current && core.current) {
        halo.current.style.transform = `scale(${(0.92 + Math.pow(pulse, 1.6) * 0.72).toFixed(4)})`;
        halo.current.style.opacity = (pulse * 0.24).toFixed(3);
        ring.current.style.transform = `scale(${(1 + Math.pow(pulse, 2.35) * 0.38).toFixed(4)})`;
        ring.current.style.opacity = (0.28 + pulse * 0.38).toFixed(3);
        core.current.style.transform = `scale(${(1 + Math.pow(pulse, 2.2) * 0.55).toFixed(4)})`;
      }
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      // drop inline styles; the CSS rest state + transition eases everything back
      for (const el of [needle.current, tip.current, halo.current, ring.current, core.current]) {
        el?.style.removeProperty('transform');
        el?.style.removeProperty('opacity');
      }
    };
  }, [running, engine]);

  return (
    <div className={running ? 'visual-stage is-running' : 'visual-stage'} aria-hidden="true">
      {view === 'circle' ? (
        <div key="circle" className="circle-view visual-mode">
          <div ref={halo} className="pulse-halo" />
          <div ref={ring} className="pulse-ring" />
          <div ref={core} className="pulse-core" />
        </div>
      ) : (
        <div
          key="needle"
          className="needle-view visual-mode"
          style={{ '--weight': ((bpm - MIN_BPM) / (MAX_BPM - MIN_BPM)).toFixed(3) }}
        >
          <div className="needle-arc" />
          <div ref={needle} className="needle">
            <div ref={tip} className="needle-tip" />
            <div className="needle-weight" />
          </div>
          <div className="needle-base" />
        </div>
      )}
    </div>
  );
}
