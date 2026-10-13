import { useCallback, useEffect, useRef, useState } from "react";
import { startTargetNote, type SustainedPianoNote } from "../../../audio/piano";
import type { TargetNote } from "../../../domain/types";

export interface SongRowPlaybackNote {
  durationBeats: number;
  durationTicks?: number;
  eventIndex: number;
  note: TargetNote;
  startBeat: number;
  startTick?: number;
}

export interface SongRowPlaybackTempoEvent {
  microsecondsPerQuarter: number;
  tick: number;
  trackIndex: number;
}

export interface SongRowPlaybackTiming {
  tempoBpm: number;
  tempoEvents?: readonly SongRowPlaybackTempoEvent[];
  ticksPerQuarter?: number;
}

interface ActivePlaybackNote {
  note: SustainedPianoNote;
}

interface SongRowPlaybackRuntime {
  activeNotes: ActivePlaybackNote[];
  generation: number;
  nextIndex: number;
  notes: readonly SongRowPlaybackNote[];
  releaseTimeoutIds: Set<number>;
  rowIndex: number;
  timing: SongRowPlaybackTiming;
  timeoutId?: number;
}

function hasTickTiming(note: SongRowPlaybackNote, timing: SongRowPlaybackTiming): boolean {
  return (
    Number.isFinite(note.startTick) &&
    Number.isFinite(timing.ticksPerQuarter) &&
    (timing.ticksPerQuarter ?? 0) > 0
  );
}

function millisecondsForTickRange(
  startTick: number,
  endTick: number,
  timing: SongRowPlaybackTiming
): number {
  const ticksPerQuarter = timing.ticksPerQuarter ?? 0;
  if (ticksPerQuarter <= 0 || endTick <= startTick) return 0;

  const events = [...(timing.tempoEvents ?? [])]
    .filter(
      (event) =>
        Number.isFinite(event.tick) &&
        Number.isFinite(event.microsecondsPerQuarter) &&
        event.microsecondsPerQuarter > 0
    )
    .sort((left, right) => left.tick - right.tick || left.trackIndex - right.trackIndex);
  let currentMicrosPerQuarter = 60_000_000 / Math.max(1, timing.tempoBpm);
  let cursorTick = startTick;
  let elapsedMs = 0;

  for (const event of events) {
    if (event.tick <= startTick) {
      currentMicrosPerQuarter = event.microsecondsPerQuarter;
      continue;
    }
    if (event.tick >= endTick) break;
    elapsedMs += ((event.tick - cursorTick) * currentMicrosPerQuarter) / ticksPerQuarter / 1_000;
    cursorTick = event.tick;
    currentMicrosPerQuarter = event.microsecondsPerQuarter;
  }

  elapsedMs += ((endTick - cursorTick) * currentMicrosPerQuarter) / ticksPerQuarter / 1_000;
  return elapsedMs;
}

function noteDurationMs(note: SongRowPlaybackNote, timing: SongRowPlaybackTiming): number {
  if (hasTickTiming(note, timing) && Number.isFinite(note.durationTicks)) {
    return millisecondsForTickRange(
      note.startTick as number,
      (note.startTick as number) + (note.durationTicks as number),
      timing
    );
  }
  return (Math.max(0, note.durationBeats) * 60_000) / Math.max(1, timing.tempoBpm);
}

function hasSameOnset(left: SongRowPlaybackNote, right: SongRowPlaybackNote): boolean {
  if (Number.isFinite(left.startTick) && Number.isFinite(right.startTick)) {
    return left.startTick === right.startTick;
  }
  return Math.abs(left.startBeat - right.startBeat) < 1e-6;
}

function intervalMs(
  current: SongRowPlaybackNote,
  next: SongRowPlaybackNote,
  timing: SongRowPlaybackTiming
): number {
  if (hasTickTiming(current, timing) && hasTickTiming(next, timing)) {
    return millisecondsForTickRange(current.startTick as number, next.startTick as number, timing);
  }
  return Math.max(0, next.startBeat - current.startBeat) * (60_000 / Math.max(1, timing.tempoBpm));
}

export function useSongRowPlayback(): {
  cancel: () => void;
  playingNoteIndex: number | null;
  playingRowIndex: number | null;
  toggleRow: (
    rowIndex: number,
    notes: readonly SongRowPlaybackNote[],
    timing: SongRowPlaybackTiming
  ) => void;
} {
  const [playingRowIndex, setPlayingRowIndex] = useState<number | null>(null);
  const [playingNoteIndex, setPlayingNoteIndex] = useState<number | null>(null);
  const runtimeRef = useRef<SongRowPlaybackRuntime | null>(null);

  const cancel = useCallback((expectedRuntime?: SongRowPlaybackRuntime): void => {
    const runtime = runtimeRef.current;
    if (!runtime || (expectedRuntime && runtime !== expectedRuntime)) return;
    runtime.generation += 1;
    if (runtime.timeoutId !== undefined) {
      window.clearTimeout(runtime.timeoutId);
      runtime.timeoutId = undefined;
    }
    runtime.releaseTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    runtime.releaseTimeoutIds.clear();
    runtime.activeNotes.forEach(({ note }) => note.release());
    runtime.activeNotes = [];
    runtimeRef.current = null;
    setPlayingRowIndex(null);
    setPlayingNoteIndex(null);
  }, []);

  const toggleRow = useCallback(
    (
      rowIndex: number,
      notes: readonly SongRowPlaybackNote[],
      timing: SongRowPlaybackTiming
    ): void => {
      if (runtimeRef.current?.rowIndex === rowIndex) {
        cancel();
        return;
      }
      cancel();
      if (notes.length === 0) return;

      const runtime: SongRowPlaybackRuntime = {
        activeNotes: [],
        generation: 0,
        nextIndex: 0,
        notes,
        releaseTimeoutIds: new Set(),
        rowIndex,
        timing: { ...timing, tempoBpm: Math.max(1, timing.tempoBpm) },
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
        let groupEndIndex = noteIndex + 1;
        while (
          groupEndIndex < runtime.notes.length &&
          hasSameOnset(playbackNote, runtime.notes[groupEndIndex]!)
        ) {
          groupEndIndex += 1;
        }
        const chord = runtime.notes.slice(noteIndex, groupEndIndex);

        setPlayingNoteIndex(noteIndex);
        const generation = ++runtime.generation;
        void Promise.all(chord.map(({ note }) => startTargetNote(note)))
          .then((activeNotes) => {
            if (runtimeRef.current !== runtime || runtime.generation !== generation) {
              activeNotes.forEach((note) => note.release());
              return;
            }

            const activeGroup = activeNotes.map((note) => ({ note }));
            runtime.activeNotes.push(...activeGroup);
            activeGroup.forEach((activeNote, chordIndex) => {
              const releaseAfterMs = noteDurationMs(chord[chordIndex]!, runtime.timing);
              const timeoutId = window.setTimeout(
                () => {
                  runtime.releaseTimeoutIds.delete(timeoutId);
                  activeNote.note.release();
                  runtime.activeNotes = runtime.activeNotes.filter((entry) => entry !== activeNote);
                },
                Math.max(1, releaseAfterMs)
              );
              runtime.releaseTimeoutIds.add(timeoutId);
            });

            const nextNote = runtime.notes[groupEndIndex];
            const interval = nextNote
              ? intervalMs(playbackNote, nextNote, runtime.timing)
              : Math.max(...chord.map((note) => noteDurationMs(note, runtime.timing)));
            runtime.timeoutId = window.setTimeout(
              () => {
                if (runtimeRef.current !== runtime || runtime.generation !== generation) return;
                runtime.timeoutId = undefined;
                runtime.nextIndex = groupEndIndex;
                playNext();
              },
              Math.max(0, interval)
            );
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
      runtime.releaseTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      runtime.activeNotes.forEach(({ note }) => note.release());
      runtimeRef.current = null;
    },
    []
  );

  return { cancel, playingNoteIndex, playingRowIndex, toggleRow };
}
