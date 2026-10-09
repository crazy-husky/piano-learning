import { useCallback, useEffect, useRef, useState } from "react";
import { playTargetNote, startTargetNote } from "../audio/piano";
import {
  compareTargetNotePitch,
  dedupeTargetNotePitches,
  NOTE_NAME_COLUMNS,
  type NoteNameColumn,
} from "../domain/staffRecall";
import type { NoteName, TargetNote } from "../domain/types";
import {
  beginHeldNoteSequence,
  findNearestAnswerPitch,
  getListeningTargetNoteName,
  getStudyPitchPoolKey,
  recordListeningAttempt,
  releaseHeldNoteSequence,
  selectFreeSinglePitch,
  selectListeningSelfCheckTarget,
  shouldRerollListeningTarget,
  type HeldNoteSequence,
  type ListeningAttemptState,
  type ListeningSelfCheckTarget,
  type StudyPlaybackMode,
} from "./studyListeningSelfCheck";
import { STUDY_STAFF_LAYOUT } from "./staffLayoutProfiles";

const KEY_FLASH_MS = 360;
const NOTE_FLASH_MS = 260;

interface HeldKeyboardPlayback extends HeldNoteSequence {
  highlightedNoteName?: NoteName;
  kind: "answer" | "prompt";
}

interface ListeningSelfCheckSession {
  attempt: ListeningAttemptState;
  target?: ListeningSelfCheckTarget;
}

function isFormControlTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function collectHighlightedNoteNames(
  heldKeys: Map<string, HeldKeyboardPlayback>,
  flashedNoteName?: NoteName,
): Set<NoteName> {
  const noteNames = new Set<NoteName>();
  heldKeys.forEach((held) => {
    if (held.highlightedNoteName) {
      noteNames.add(held.highlightedNoteName);
    }
  });
  if (flashedNoteName) {
    noteNames.add(flashedNoteName);
  }
  return noteNames;
}

interface UseStudyPlaybackOptions {
  columns: NoteNameColumn[];
  playbackMode: StudyPlaybackMode;
  studyPitches: TargetNote[];
}

export function useStudyPlayback({ columns, playbackMode, studyPitches }: UseStudyPlaybackOptions) {
  const [highlightedNoteNames, setHighlightedNoteNames] = useState<ReadonlySet<NoteName>>(() => new Set());
  const [highlightedNoteId, setHighlightedNoteId] = useState<string | undefined>();
  const [listeningSelfCheckStarted, setListeningSelfCheckStarted] = useState(false);
  const columnFlashTimerRef = useRef<number | undefined>();
  const flashedColumnRef = useRef<NoteName | undefined>();
  const noteFlashTimerRef = useRef<number | undefined>();
  const heldKeysRef = useRef(new Map<string, HeldKeyboardPlayback>());
  const listeningSelfCheckRef = useRef<ListeningSelfCheckSession>({ attempt: "untouched" });
  const studyPitchPoolKey = getStudyPitchPoolKey(studyPitches);

  const flashColumn = useCallback((noteName: NoteName): void => {
    window.clearTimeout(columnFlashTimerRef.current);
    flashedColumnRef.current = noteName;
    setHighlightedNoteNames(collectHighlightedNoteNames(heldKeysRef.current, noteName));
    columnFlashTimerRef.current = window.setTimeout(() => {
      if (flashedColumnRef.current !== noteName) {
        return;
      }
      flashedColumnRef.current = undefined;
      setHighlightedNoteNames(collectHighlightedNoteNames(heldKeysRef.current));
    }, KEY_FLASH_MS);
  }, []);

  const flashNote = useCallback((note: TargetNote): void => {
    window.clearTimeout(noteFlashTimerRef.current);
    setHighlightedNoteId(note.id);
    noteFlashTimerRef.current = window.setTimeout(() => setHighlightedNoteId(undefined), NOTE_FLASH_MS);
  }, []);

  const playNote = useCallback(
    (note: TargetNote): void => {
      flashNote(note);
      void playTargetNote(note).catch(() => undefined);
    },
    [flashNote],
  );

  const playColumn = useCallback(
    (noteName: NoteName): void => {
      const column = columns.find((candidate) => candidate.noteName === noteName);
      if (!column) {
        return;
      }
      flashColumn(noteName);
      void (async () => {
        for (const note of dedupeTargetNotePitches(column.notes).sort(compareTargetNotePitch)) {
          void playTargetNote(note).catch(() => undefined);
          await delay(STUDY_STAFF_LAYOUT.columnNoteDelayMs);
        }
      })();
    },
    [columns, flashColumn],
  );

  const releaseHeldKey = useCallback((inputId: string): Promise<void> | undefined => {
    const held = heldKeysRef.current.get(inputId);
    if (!held) {
      return;
    }
    heldKeysRef.current.delete(inputId);
    const settled = releaseHeldNoteSequence(held);
    setHighlightedNoteNames(collectHighlightedNoteNames(heldKeysRef.current, flashedColumnRef.current));
    return settled;
  }, []);

  const releaseAllHeldKeys = useCallback((): void => {
    Array.from(heldKeysRef.current.keys()).forEach((inputId) => void releaseHeldKey(inputId));
  }, [releaseHeldKey]);

  const startHeldNotes = useCallback(
    (
      inputId: string,
      notes: readonly TargetNote[],
      kind: HeldKeyboardPlayback["kind"],
      highlightedNoteName?: NoteName,
      beforeStart: Promise<void> = Promise.resolve(),
    ): void => {
      if (heldKeysRef.current.has(inputId) || notes.length === 0) {
        return;
      }

      const held: HeldKeyboardPlayback = {
        cancelled: false,
        highlightedNoteName,
        kind,
        releases: [],
        settled: Promise.resolve(),
      };
      heldKeysRef.current.set(inputId, held);
      setHighlightedNoteNames(collectHighlightedNoteNames(heldKeysRef.current, flashedColumnRef.current));

      beginHeldNoteSequence(
        held,
        dedupeTargetNotePitches([...notes]).sort(compareTargetNotePitch),
        beforeStart,
        (note) => startTargetNote(note).catch(() => undefined),
        () =>
          STUDY_STAFF_LAYOUT.columnNoteDelayMs > 0 ? delay(STUDY_STAFF_LAYOUT.columnNoteDelayMs) : undefined,
      );
    },
    [],
  );

  const resetListeningSelfCheck = useCallback((): void => {
    listeningSelfCheckRef.current = { attempt: "untouched" };
    setListeningSelfCheckStarted(false);
  }, []);

  useEffect(() => {
    return () => {
      window.clearTimeout(columnFlashTimerRef.current);
      window.clearTimeout(noteFlashTimerRef.current);
      releaseAllHeldKeys();
    };
  }, [releaseAllHeldKeys]);

  useEffect(() => {
    releaseAllHeldKeys();
  }, [columns, releaseAllHeldKeys]);

  useEffect(() => {
    releaseAllHeldKeys();
    resetListeningSelfCheck();
  }, [playbackMode, releaseAllHeldKeys, resetListeningSelfCheck, studyPitchPoolKey]);

  useEffect(() => {
    function releaseForFocusLoss(): void {
      releaseAllHeldKeys();
    }

    function releaseForVisibilityChange(): void {
      if (document.visibilityState === "hidden") {
        releaseAllHeldKeys();
      }
    }

    window.addEventListener("blur", releaseForFocusLoss);
    document.addEventListener("visibilitychange", releaseForVisibilityChange);
    return () => {
      window.removeEventListener("blur", releaseForFocusLoss);
      document.removeEventListener("visibilitychange", releaseForVisibilityChange);
    };
  }, [releaseAllHeldKeys]);

  useEffect(() => {
    function getInputId(event: KeyboardEvent): string {
      return `keyboard:${event.code || event.key}`;
    }

    function getAnswerPlaybackNotes(noteName: NoteName): TargetNote[] {
      if (playbackMode === "octaves") {
        return studyPitches.filter((pitch) => pitch.noteName === noteName);
      }
      const target = listeningSelfCheckRef.current.target;
      const pitch =
        target?.mode === "single"
          ? findNearestAnswerPitch(noteName, target.pitch, studyPitches)
          : selectFreeSinglePitch(noteName, studyPitches);
      return pitch ? [pitch] : [];
    }

    function startListeningSelfCheck(inputId: string): void {
      const current = listeningSelfCheckRef.current;
      const needsTarget =
        !current.target ||
        current.target.mode !== playbackMode ||
        shouldRerollListeningTarget(current.attempt);
      const target = needsTarget
        ? selectListeningSelfCheckTarget(
            playbackMode,
            studyPitches,
            current.target?.mode === playbackMode ? current.target : undefined,
          )
        : current.target;
      if (!target) {
        return;
      }
      if (needsTarget) {
        listeningSelfCheckRef.current = { attempt: "untouched", target };
      }
      setListeningSelfCheckStarted(true);
      const notes =
        target.mode === "single"
          ? [target.pitch]
          : studyPitches.filter((pitch) => pitch.noteName === target.noteName);
      startHeldNotes(inputId, notes, "prompt");
    }

    function answerListeningSelfCheck(noteName: NoteName): boolean {
      const current = listeningSelfCheckRef.current;
      if (!current.target) {
        return false;
      }
      const correct = noteName === getListeningTargetNoteName(current.target);
      listeningSelfCheckRef.current = {
        ...current,
        attempt: recordListeningAttempt(current.attempt, correct),
      };
      return correct;
    }

    function releaseHeldPrompts(): Promise<void> {
      const releases = Array.from(heldKeysRef.current)
        .filter(([, held]) => held.kind === "prompt")
        .map(([inputId]) => releaseHeldKey(inputId));
      return Promise.all(releases).then(() => undefined);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (isFormControlTarget(event.target)) {
        return;
      }
      const inputId = getInputId(event);
      if (event.key === "0") {
        if (event.altKey || event.ctrlKey || event.metaKey) {
          return;
        }
        event.preventDefault();
        if (!event.repeat) {
          startListeningSelfCheck(inputId);
        }
        return;
      }
      const column = NOTE_NAME_COLUMNS.find((candidate) => candidate.answerNumber === event.key);
      if (column) {
        event.preventDefault();
        if (!event.repeat) {
          const notes = getAnswerPlaybackNotes(column.noteName);
          if (notes.length > 0) {
            const beforeStart = answerListeningSelfCheck(column.noteName)
              ? releaseHeldPrompts()
              : Promise.resolve();
            startHeldNotes(inputId, notes, "answer", column.noteName, beforeStart);
          }
        }
      }
    }

    function handleKeyUp(event: KeyboardEvent): void {
      const inputId = getInputId(event);
      if (heldKeysRef.current.has(inputId)) {
        event.preventDefault();
        releaseHeldKey(inputId);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [playbackMode, releaseHeldKey, startHeldNotes, studyPitches]);
  return {
    highlightedNoteId,
    highlightedNoteNames,
    listeningSelfCheckStarted,
    playColumn,
    playNote,
  };
}
