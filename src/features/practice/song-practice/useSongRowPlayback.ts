import { useCallback, useEffect, useRef, useState } from "react";
import { startTargetNote, type SustainedPianoNote } from "../../../audio/piano";
import type { TargetNote } from "../../../domain/types";

const SONG_TEMPO_BPM = 88;
const MINIMUM_NOTE_INTERVAL_MS = 70;

export interface SongRowPlaybackNote {
  durationBeats: number;
  note: TargetNote;
  startBeat: number;
}

interface SongRowPlaybackRuntime {
  activeNote?: SustainedPianoNote;
  generation: number;
  nextIndex: number;
  notes: readonly SongRowPlaybackNote[];
  rowIndex: number;
  timeoutId?: number;
}

export function useSongRowPlayback(): {
  cancel: () => void;
  playingRowIndex: number | null;
  toggleRow: (rowIndex: number, notes: readonly SongRowPlaybackNote[]) => void;
} {
  const [playingRowIndex, setPlayingRowIndex] = useState<number | null>(null);
  const runtimeRef = useRef<SongRowPlaybackRuntime | null>(null);

  const cancel = useCallback((expectedRuntime?: SongRowPlaybackRuntime): void => {
    const runtime = runtimeRef.current;
    if (!runtime || (expectedRuntime && runtime !== expectedRuntime)) return;
    runtime.generation += 1;
    if (runtime.timeoutId !== undefined) {
      window.clearTimeout(runtime.timeoutId);
      runtime.timeoutId = undefined;
    }
    runtime.activeNote?.release();
    runtime.activeNote = undefined;
    runtimeRef.current = null;
    setPlayingRowIndex(null);
  }, []);

  const toggleRow = useCallback(
    (rowIndex: number, notes: readonly SongRowPlaybackNote[]): void => {
      if (runtimeRef.current?.rowIndex === rowIndex) {
        cancel();
        return;
      }
      cancel();
      if (notes.length === 0) return;

      const runtime: SongRowPlaybackRuntime = {
        generation: 0,
        nextIndex: 0,
        notes,
        rowIndex,
      };
      runtimeRef.current = runtime;
      setPlayingRowIndex(rowIndex);

      const playNext = (): void => {
        if (runtimeRef.current !== runtime) return;
        const noteIndex = runtime.nextIndex;
        const playbackNote = runtime.notes[noteIndex];
        if (!playbackNote) {
          cancel(runtime);
          return;
        }

        const generation = ++runtime.generation;
        void startTargetNote(playbackNote.note)
          .then((activeNote) => {
            if (runtimeRef.current !== runtime || runtime.generation !== generation) {
              activeNote.release();
              return;
            }
            runtime.activeNote = activeNote;
            const nextNote = runtime.notes[noteIndex + 1];
            const beatDuration = nextNote
              ? Math.max(0, nextNote.startBeat - playbackNote.startBeat)
              : Math.max(0.25, playbackNote.durationBeats);
            const intervalMs = Math.max(
              MINIMUM_NOTE_INTERVAL_MS,
              (beatDuration * 60_000) / SONG_TEMPO_BPM
            );
            runtime.timeoutId = window.setTimeout(() => {
              if (runtimeRef.current !== runtime || runtime.generation !== generation) return;
              runtime.timeoutId = undefined;
              runtime.activeNote?.release();
              runtime.activeNote = undefined;
              runtime.nextIndex = noteIndex + 1;
              playNext();
            }, intervalMs);
          })
          .catch(() => cancel(runtime));
      };

      playNext();
    },
    [cancel]
  );

  useEffect(
    () => () => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      runtime.generation += 1;
      if (runtime.timeoutId !== undefined) window.clearTimeout(runtime.timeoutId);
      runtime.activeNote?.release();
      runtimeRef.current = null;
    },
    []
  );

  return { cancel, playingRowIndex, toggleRow };
}
