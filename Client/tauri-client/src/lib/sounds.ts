import { createLogger } from "./logger";

const log = createLogger("sounds");

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  try {
    if (audioCtx === null) {
      audioCtx = new AudioContext();
    }
    return audioCtx;
  } catch {
    log.debug("AudioContext unavailable");
    return null;
  }
}

function playToneSequence(
  tones: ReadonlyArray<{ freq: number; duration: number; gain: number }>,
): void {
  const ctx = getAudioCtx();
  if (ctx === null) return;

  let cursor = ctx.currentTime;
  for (const tone of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.setValueAtTime(tone.freq, cursor);
    gain.gain.setValueAtTime(Math.max(0.001, tone.gain), cursor);
    gain.gain.exponentialRampToValueAtTime(0.01, cursor + tone.duration);

    osc.start(cursor);
    osc.stop(cursor + tone.duration);
    cursor += tone.duration + 0.03;
  }
}

export function playMessageSound(): void {
  playToneSequence([
    { freq: 900, duration: 0.08, gain: 0.18 },
    { freq: 680, duration: 0.12, gain: 0.12 },
  ]);
}

export function playVoiceJoinSound(): void {
  playToneSequence([
    { freq: 520, duration: 0.08, gain: 0.14 },
    { freq: 780, duration: 0.12, gain: 0.16 },
  ]);
}

export function playVoiceLeaveSound(): void {
  playToneSequence([
    { freq: 780, duration: 0.08, gain: 0.14 },
    { freq: 500, duration: 0.14, gain: 0.14 },
  ]);
}
