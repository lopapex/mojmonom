import { useEffect, useRef } from 'preact/hooks';

const HOLD_DELAY_MS = 380;
const REPEAT_START_MS = 110;
const REPEAT_MIN_MS = 35;

/**
 * Press-and-hold auto-repeat: steps once on press, then repeats faster the
 * longer the button is held. Keyboard activation still works through onClick.
 */
export function useHoldRepeat(step: () => void) {
  const stepRef = useRef(step);
  stepRef.current = step;
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => stop, []);

  const start = (event: PointerEvent) => {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    stop();
    stepRef.current();
    let interval = REPEAT_START_MS;
    const repeat = () => {
      stepRef.current();
      interval = Math.max(REPEAT_MIN_MS, interval * 0.9);
      timer.current = window.setTimeout(repeat, interval);
    };
    timer.current = window.setTimeout(repeat, HOLD_DELAY_MS);
  };

  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerCancel: stop,
    onLostPointerCapture: stop,
    onContextMenu: (event: Event) => event.preventDefault(),
    // keyboard (Enter/Space) activation has detail === 0
    onClick: (event: MouseEvent) => {
      if (event.detail === 0) stepRef.current();
    }
  };
}

const TAP_RESET_MS = 2000;
const TAP_SAMPLES = 4;

/** Returns a tap handler that reports the averaged tempo after the second tap. */
export function useTapTempo(onTempo: (bpm: number) => void) {
  const taps = useRef<number[]>([]);

  return () => {
    const now = performance.now();
    const list = taps.current;
    if (list.length && now - list[list.length - 1] > TAP_RESET_MS) list.length = 0;
    list.push(now);
    if (list.length > TAP_SAMPLES + 1) list.shift();
    if (list.length < 2) return;
    const average = (list[list.length - 1] - list[0]) / (list.length - 1);
    onTempo(60000 / average);
  };
}
