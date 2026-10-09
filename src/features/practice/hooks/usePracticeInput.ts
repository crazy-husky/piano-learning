import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { AnswerPitchMode, PianoKeyName } from "../../../domain/types";
import type { PracticeAnswerInput } from "../../../domain/answerInput";
import { markMidiLatencyStage } from "../../../diagnostics/midiLatencyDiagnostics";
import { markMidiLatencyAfterPaint } from "../../../diagnostics/midiLatencyPaint";
import { ANSWER_BUTTONS } from "../../../domain/notes";
import { MIDI_START_NOTE_NUMBER } from "../../../midi/midiInput";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { getPausedKeyboardAction } from "../logic/practiceKeyboard";
import { isInteractiveShortcutTarget } from "../../../shared/keyboard/keyboardShortcuts";
import { isNaturalPianoKey } from "../../../shared/components/PianoKeyboard";

type PracticeInputOptions = {
  answerPitchMode: AnswerPitchMode;
  canStartOnMidi: boolean;
  isPausedRef: MutableRefObject<boolean>;
  isRunning: boolean;
  midi: MidiInputController;
  onEscape: () => void;
  onResume: () => void;
  onStartSession: () => void;
  onSubmitAnswer: (answer: PracticeAnswerInput) => void;
  onTogglePause: () => void;
};

type PracticeInputHandlers = Pick<
  PracticeInputOptions,
  "onEscape" | "onResume" | "onStartSession" | "onSubmitAnswer" | "onTogglePause"
>;

export function usePracticeInput({
  answerPitchMode,
  canStartOnMidi,
  isPausedRef,
  isRunning,
  midi,
  onEscape,
  onResume,
  onStartSession,
  onSubmitAnswer,
  onTogglePause,
}: PracticeInputOptions) {
  const [heldComputerAnswerKeys, setHeldComputerAnswerKeys] = useState<ReadonlySet<PianoKeyName>>(() => new Set());
  const [heldMidiAnswerKeys, setHeldMidiAnswerKeys] = useState<ReadonlySet<PianoKeyName>>(() => new Set());
  const heldMidiInputsRef = useRef(new Map<string, PianoKeyName>());
  const pendingMidiPressDiagnosticSampleIdRef = useRef<number | undefined>(undefined);
  const handlersRef = useRef<PracticeInputHandlers>({ onEscape, onResume, onStartSession, onSubmitAnswer, onTogglePause });
  handlersRef.current = { onEscape, onResume, onStartSession, onSubmitAnswer, onTogglePause };

  useLayoutEffect(() => {
    const diagnosticSampleId = pendingMidiPressDiagnosticSampleIdRef.current;
    pendingMidiPressDiagnosticSampleIdRef.current = undefined;
    if (diagnosticSampleId === undefined) return undefined;
    markMidiLatencyStage(diagnosticSampleId, "pressedReactCommit");
    return markMidiLatencyAfterPaint(diagnosticSampleId, "pressedPaintApprox");
  }, [heldMidiAnswerKeys]);

  useEffect(() => {
    function syncHeldMidiKeys(): void {
      setHeldMidiAnswerKeys(new Set(heldMidiInputsRef.current.values()));
    }

    const unsubscribe = midi.subscribe((event) => {
      if (event.type === "reset") {
        pendingMidiPressDiagnosticSampleIdRef.current = undefined;
        heldMidiInputsRef.current.clear();
        syncHeldMidiKeys();
        return;
      }
      if (!isNaturalPianoKey(event.note.keyName)) return;
      if (event.type === "release") {
        pendingMidiPressDiagnosticSampleIdRef.current = undefined;
        heldMidiInputsRef.current.delete(event.note.keyId);
        syncHeldMidiKeys();
        return;
      }

      heldMidiInputsRef.current.set(event.note.keyId, event.note.keyName);
      pendingMidiPressDiagnosticSampleIdRef.current = event.note.diagnosticSampleId;
      syncHeldMidiKeys();
      const current = handlersRef.current;
      if (isRunning && answerPitchMode !== "microphone") {
        markMidiLatencyStage(event.note.diagnosticSampleId, "practiceSubscriber");
        current.onSubmitAnswer({
          diagnosticSampleId: event.note.diagnosticSampleId,
          midiNoteNumber: event.note.midiNoteNumber,
          noteName: event.note.keyName,
          octave: event.note.octave,
          source: "midi",
        });
        return;
      }
      if (
        canStartOnMidi &&
        event.note.midiNoteNumber === MIDI_START_NOTE_NUMBER &&
        answerPitchMode !== "microphone"
      ) {
        current.onStartSession();
      }
    });

    return () => {
      unsubscribe();
      pendingMidiPressDiagnosticSampleIdRef.current = undefined;
      heldMidiInputsRef.current.clear();
      setHeldMidiAnswerKeys(new Set());
    };
  }, [answerPitchMode, canStartOnMidi, isRunning, midi.subscribe]);

  useEffect(() => {
    if (!isRunning) return undefined;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.repeat) return;
      const current = handlersRef.current;
      if (event.code === "Escape") {
        event.preventDefault();
        current.onEscape();
        return;
      }
      if (event.code === "Space") {
        if (isInteractiveShortcutTarget(event.target)) return;
        event.preventDefault();
        if (isPausedRef.current) current.onResume();
        else current.onTogglePause();
        return;
      }
      if (isPausedRef.current) {
        const pausedAction = getPausedKeyboardAction({
          isEditableTarget:
            event.target instanceof Element &&
            Boolean(event.target.closest("input, select, textarea, [contenteditable='true']")),
        });
        if (pausedAction !== "allow-edit") event.preventDefault();
        return;
      }
      const answer = ANSWER_BUTTONS.find((button) => event.key === button.key);
      if (answer && answerPitchMode === "note-name") {
        event.preventDefault();
        setHeldComputerAnswerKeys((currentKeys) => new Set(currentKeys).add(answer.noteName));
        current.onSubmitAnswer({ noteName: answer.noteName, source: "computer-keyboard" });
      }
    }

    function onKeyUp(event: KeyboardEvent): void {
      const answer = ANSWER_BUTTONS.find((button) => event.key === button.key);
      if (!answer) return;
      setHeldComputerAnswerKeys((current) => {
        const next = new Set(current);
        next.delete(answer.noteName);
        return next;
      });
    }

    function releaseHeldComputerKeys(): void {
      setHeldComputerAnswerKeys(new Set());
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseHeldComputerKeys);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseHeldComputerKeys);
      releaseHeldComputerKeys();
    };
  }, [answerPitchMode, isPausedRef, isRunning]);

  const pressedAnswerKeys = useMemo(
    () => new Set<PianoKeyName>([...heldComputerAnswerKeys, ...heldMidiAnswerKeys]),
    [heldComputerAnswerKeys, heldMidiAnswerKeys],
  );

  return { heldComputerAnswerKeys, heldMidiAnswerKeys, pressedAnswerKeys };
}
