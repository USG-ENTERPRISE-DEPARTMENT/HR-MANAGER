import { useEffect, useRef, useState } from 'react';

/**
 * Sign the user out after a period of no interaction.
 *
 * This is an HR system holding payroll, salary and medical data, and it runs on shared office
 * machines — an unattended logged-in session is a realistic exposure, more so than anything about
 * how fast the logout transition is. The refresh token keeps a session alive indefinitely while the
 * tab is open, so without this a walked-away-from desk stays logged in until the browser closes.
 *
 * Activity is any of the listed DOM events. They are registered as passive, capture-phase listeners
 * on `window` so a component calling stopPropagation cannot accidentally starve the timer.
 *
 * Cross-tab: activity in ANY tab should keep every tab alive, otherwise a background tab logs the
 * user out while they are working in the foreground one. A BroadcastChannel spreads the reset, and
 * is rate-limited so a busy mouse does not flood it.
 */

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'wheel', 'pointerdown'] as const;

/** Don't rebroadcast activity to other tabs more than once per this interval. */
const BROADCAST_THROTTLE_MS = 5_000;

export interface IdleTimeoutOptions {
  /** Total inactivity before logout. */
  timeoutMs: number;
  /** How long before that to show a warning. Set 0 to disable the warning. */
  warnMs: number;
  /** Called when the timeout expires. */
  onIdle: () => void;
  /** When false the timer is not armed at all (e.g. nobody is logged in). */
  enabled: boolean;
}

export function useIdleTimeout({ timeoutMs, warnMs, onIdle, enabled }: IdleTimeoutOptions) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  // Held in a ref so changing the callback does not tear down and re-arm the timers.
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick      = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSent  = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const channel: BroadcastChannel | null =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('hr-idle') : null;

    const clearAll = () => {
      if (warnTimer.current) clearTimeout(warnTimer.current);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (tick.current) clearInterval(tick.current);
      warnTimer.current = idleTimer.current = tick.current = null;
    };

    const arm = () => {
      clearAll();
      setSecondsLeft(null);

      if (warnMs > 0 && warnMs < timeoutMs) {
        warnTimer.current = setTimeout(() => {
          // Count down in the warning window so the user can see how long they have.
          const deadline = Date.now() + warnMs;
          setSecondsLeft(Math.ceil(warnMs / 1000));
          tick.current = setInterval(() => {
            const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            setSecondsLeft(left);
          }, 1000);
        }, timeoutMs - warnMs);
      }

      idleTimer.current = setTimeout(() => {
        clearAll();
        onIdleRef.current();
      }, timeoutMs);
    };

    const onActivity = () => {
      const now = Date.now();
      if (now - lastSent.current > BROADCAST_THROTTLE_MS) {
        lastSent.current = now;
        channel?.postMessage('active');
      }
      arm();
    };

    // A tab that was asleep (laptop closed, tab discarded) can come back with its timers long
    // overdue; re-arming on visibility change keeps the deadline honest.
    const onVisible = () => { if (document.visibilityState === 'visible') arm(); };

    if (channel) channel.onmessage = () => arm();
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, onActivity, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onVisible);
    arm();

    return () => {
      clearAll();
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, onActivity, { capture: true }));
      document.removeEventListener('visibilitychange', onVisible);
      channel?.close();
    };
  }, [enabled, timeoutMs, warnMs]);

  /** Seconds remaining in the warning window, or null when not warning. */
  return { secondsLeft, dismissWarning: () => setSecondsLeft(null) };
}
