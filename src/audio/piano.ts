import * as Tone from "tone";
import { noteToToneName } from "../domain/notes";
import type { NoteName, Octave, PianoKeyName, TargetNote } from "../domain/types";
import { getPianoVolume } from "./pianoSettings";
export { setPianoVolume } from "./pianoSettings";

const PIANO_SAMPLE_BASE_URL = `${import.meta.env.BASE_URL}audio/salamander/`;
const PIANO_SAMPLE_LOAD_TIMEOUT_MS = 15_000;
const PIANO_SAMPLE_URLS = {
  A0: "A0.mp3",
  C1: "C1.mp3",
  "D#1": "Ds1.mp3",
  "F#1": "Fs1.mp3",
  A1: "A1.mp3",
  C2: "C2.mp3",
  "D#2": "Ds2.mp3",
  "F#2": "Fs2.mp3",
  A2: "A2.mp3",
  C3: "C3.mp3",
  "D#3": "Ds3.mp3",
  "F#3": "Fs3.mp3",
  A3: "A3.mp3",
  C4: "C4.mp3",
  "D#4": "Ds4.mp3",
  "F#4": "Fs4.mp3",
  A4: "A4.mp3",
  C5: "C5.mp3",
  "D#5": "Ds5.mp3",
  "F#5": "Fs5.mp3",
  A5: "A5.mp3",
  C6: "C6.mp3",
  "D#6": "Ds6.mp3",
  "F#6": "Fs6.mp3",
  A6: "A6.mp3",
  C7: "C7.mp3",
} as const;

type SamplerStatus = "idle" | "loading" | "loaded" | "failed";
interface GetSamplerOptions {
  retryFailed?: boolean;
}

export interface SustainedPianoNote {
  release: () => void;
}

let sampler: Tone.Sampler | undefined;
let samplerLoadPromise: Promise<void> | undefined;
let samplerStatus: SamplerStatus = "idle";
let samplerLoadError: Error | null = null;
let fallbackSynth: Tone.PolySynth | undefined;
let pianoOutput: Tone.Gain | null = null;

function getPianoOutput(): Tone.Gain | Tone.DestinationInstance {
  return pianoOutput ?? Tone.getDestination();
}

/** Route the shared piano voices through a screen-specific mix while that screen is mounted. */
export function setPianoOutput(output: Tone.Gain | null): void {
  pianoOutput = output;
  const destination = getPianoOutput();
  sampler?.disconnect();
  sampler?.connect(destination);
  fallbackSynth?.disconnect();
  fallbackSynth?.connect(destination);
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function getFallbackSynth(): Tone.PolySynth {
  fallbackSynth ??= new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.18, sustain: 0.35, release: 0.6 },
  }).connect(getPianoOutput());
  return fallbackSynth;
}

function resetFailedSampler(): void {
  sampler?.dispose();
  sampler = undefined;
  samplerLoadPromise = undefined;
  samplerStatus = "idle";
  samplerLoadError = null;
}

export function getPianoSampleLoadError(): Error | null {
  return samplerLoadError;
}

function getSampler({ retryFailed = false }: GetSamplerOptions = {}): Tone.Sampler | undefined {
  if (samplerStatus === "failed") {
    if (!retryFailed) {
      return undefined;
    }
    resetFailedSampler();
  }
  if (sampler) {
    return sampler;
  }

  samplerStatus = "loading";
  samplerLoadPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: number | undefined;
    const clearLoadTimeout = (): void => {
      if (timeout !== undefined && typeof window !== "undefined") window.clearTimeout(timeout);
    };
    const markLoaded = (): void => {
      if (settled) return;
      settled = true;
      clearLoadTimeout();
      samplerStatus = "loaded";
      samplerLoadError = null;
      resolve();
    };
    const markFailed = (error: unknown): void => {
      if (settled) return;
      settled = true;
      clearLoadTimeout();
      samplerStatus = "failed";
      samplerLoadError = normalizeError(error);
      sampler?.dispose();
      sampler = undefined;
      reject(samplerLoadError);
    };

    try {
      // Salamander Grand Piano samples by Alexander Holm, CC BY 3.0. See THIRD_PARTY_AUDIO.md.
      if (typeof window !== "undefined") {
        timeout = window.setTimeout(
          () => markFailed(new Error("Timed out while loading piano samples")),
          PIANO_SAMPLE_LOAD_TIMEOUT_MS
        );
      }
      sampler = new Tone.Sampler({
        urls: PIANO_SAMPLE_URLS,
        baseUrl: PIANO_SAMPLE_BASE_URL,
        release: 0.8,
        onload: markLoaded,
        onerror: markFailed,
      }).connect(getPianoOutput());
    } catch (error) {
      markFailed(error);
    }
  });
  samplerLoadPromise.catch(() => undefined);

  return sampler;
}

function getLoadedSampler(): Tone.Sampler | undefined {
  const currentSampler = getSampler();
  if (!currentSampler || samplerStatus === "failed") {
    return undefined;
  }
  if (currentSampler.loaded || samplerStatus === "loaded") {
    return currentSampler;
  }
  return undefined;
}

export async function preloadPianoSamples(): Promise<boolean> {
  const currentSampler = getSampler({ retryFailed: true });
  if (!currentSampler || !samplerLoadPromise) return false;
  try {
    await samplerLoadPromise;
    return samplerStatus === "loaded";
  } catch {
    // A basic synth remains available when the local sample bank cannot load.
    return false;
  }
}

export async function unlockAudio(): Promise<void> {
  await Tone.start();
  getSampler({ retryFailed: true });
}

const NATURAL_NOTE_SEMITONES: Record<NoteName, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function targetNoteToToneName(note: TargetNote): string {
  if (!note.accidental) return noteToToneName(note.noteName, note.octave);
  const midi =
    (note.octave + 1) * 12 +
    NATURAL_NOTE_SEMITONES[note.noteName] +
    (note.accidental === "sharp" ? 1 : -1);
  return Tone.Frequency(midi, "midi").toNote();
}

async function playToneName(note: string): Promise<void> {
  await unlockAudio();
  const sampledPiano = getLoadedSampler();
  if (sampledPiano) {
    sampledPiano.triggerAttackRelease(note, "8n", undefined, getPianoVolume());
    return;
  }
  getFallbackSynth().triggerAttackRelease(note, "8n", undefined, getPianoVolume());
}

export async function playPianoNote(noteName: PianoKeyName, octave: Octave): Promise<void> {
  await playToneName(noteToToneName(noteName, octave));
}

async function startToneNote(note: string): Promise<SustainedPianoNote> {
  await unlockAudio();
  const sampledPiano = getLoadedSampler();
  let released = false;

  if (sampledPiano) {
    sampledPiano.triggerAttack(note, undefined, getPianoVolume());
    return {
      release: () => {
        if (released) return;
        released = true;
        sampledPiano.triggerRelease(note);
      },
    };
  }

  const synth = getFallbackSynth();
  synth.triggerAttack(note, undefined, getPianoVolume());
  return {
    release: () => {
      if (released) return;
      released = true;
      synth.triggerRelease(note);
    },
  };
}

export async function startPianoMidi(midi: number): Promise<SustainedPianoNote> {
  return startToneNote(Tone.Frequency(midi, "midi").toNote());
}

export async function startPianoNote(
  noteName: PianoKeyName,
  octave: Octave
): Promise<SustainedPianoNote> {
  return startToneNote(noteToToneName(noteName, octave));
}

export async function playTargetNote(note: TargetNote): Promise<void> {
  await playToneName(targetNoteToToneName(note));
}

export async function startTargetNote(note: TargetNote): Promise<SustainedPianoNote> {
  return startToneNote(targetNoteToToneName(note));
}
