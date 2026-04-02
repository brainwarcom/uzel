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

export function playVoiceMuteToggleSound(enabled: boolean): void {
  if (enabled) {
    playToneSequence([
      { freq: 420, duration: 0.08, gain: 0.12 },
      { freq: 320, duration: 0.1, gain: 0.11 },
    ]);
    return;
  }
  playToneSequence([
    { freq: 430, duration: 0.06, gain: 0.11 },
    { freq: 620, duration: 0.08, gain: 0.13 },
  ]);
}

export function playVoiceDeafenToggleSound(enabled: boolean): void {
  if (enabled) {
    playToneSequence([
      { freq: 360, duration: 0.1, gain: 0.12 },
      { freq: 280, duration: 0.12, gain: 0.12 },
    ]);
    return;
  }
  playToneSequence([
    { freq: 380, duration: 0.07, gain: 0.11 },
    { freq: 560, duration: 0.09, gain: 0.13 },
  ]);
}

export function playVoiceCameraToggleSound(enabled: boolean): void {
  if (enabled) {
    playToneSequence([
      { freq: 560, duration: 0.06, gain: 0.11 },
      { freq: 760, duration: 0.09, gain: 0.13 },
    ]);
    return;
  }
  playToneSequence([
    { freq: 700, duration: 0.06, gain: 0.11 },
    { freq: 460, duration: 0.1, gain: 0.12 },
  ]);
}

export function playVoiceScreenshareToggleSound(enabled: boolean): void {
  if (enabled) {
    playToneSequence([
      { freq: 640, duration: 0.06, gain: 0.1 },
      { freq: 820, duration: 0.07, gain: 0.11 },
      { freq: 980, duration: 0.08, gain: 0.12 },
    ]);
    return;
  }
  playToneSequence([
    { freq: 900, duration: 0.06, gain: 0.11 },
    { freq: 680, duration: 0.07, gain: 0.1 },
    { freq: 520, duration: 0.09, gain: 0.11 },
  ]);
}
