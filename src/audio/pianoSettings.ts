import { DEFAULT_PIANO_VOLUME, normalizePianoVolume } from "../domain/settings";

let pianoVolume = DEFAULT_PIANO_VOLUME;

export function getPianoVolume(): number {
  return pianoVolume;
}

export function setPianoVolume(volume: number): void {
  pianoVolume = normalizePianoVolume(volume);
}
