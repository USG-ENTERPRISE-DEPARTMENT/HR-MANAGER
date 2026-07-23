// Notification chime — synthesized with the Web Audio API so there's no audio
// asset to ship. Mute is a device-level preference in localStorage.

const MUTE_KEY = 'hr_notif_muted';

export function isMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export function setMuted(muted: boolean): void {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
}

let ctx: AudioContext | null = null;

/** Play a short two-tone "ding". No-op when muted or if the browser blocks audio. */
export function playChime(): void {
  if (isMuted()) return;
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    // gentle envelope
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

    // two quick notes (G5 → C6)
    [[784, 0], [1047, 0.12]].forEach(([freq, offset]) => {
      const osc = ctx!.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.4);
    });
  } catch { /* audio unavailable — silent */ }
}
