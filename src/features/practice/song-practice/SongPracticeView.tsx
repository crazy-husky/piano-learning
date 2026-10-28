import { ArrowLeft, AudioLines, Check, Settings } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { PracticeAnswerInput } from "../../../domain/answerInput";
import type { AnswerAttempt } from "../../../domain/types";
import { MAX_PRACTICE_QUESTIONS } from "../../../domain/practiceLimits";
import { createUuid } from "../../../domain/id";
import { answerDeviceInfo, currentMicrophoneContext } from "../../../data/answerEvents";
import { saveAnswerEvents } from "../../../data/db";
import { estimateStaffGameSystemDelayMs } from "../../staff-game/logic/staffGameProficiency";
import { practiceMicrophoneDebugParametersForSensitivityLevel } from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import type {
  Octave,
  PianoKeyName,
  PitchId,
  TargetNote,
  TargetNoteId,
} from "../../../domain/types";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { MidiInputControl } from "../../../midi/MidiInputControl";
import { PracticeFullscreenToggle } from "../components/PracticeFullscreenFrame";
import { PracticeMicrophoneRetryButton } from "../../../shared/components/PracticeMicrophoneRetryButton";
import { PracticeQuestionLimitDialog } from "../../../shared/components/PracticeQuestionLimitDialog";
import type { MidiNoteInputEvent } from "../../../midi/midiInput";
import type { PracticeMicrophoneStatus } from "../../vocal-pitch/logic/usePracticeMicrophoneInput";
import { StaffPagePrompt } from "../components/StaffPagePrompt";
import { ReturnToCurrentNoteButton } from "../components/ReturnToCurrentNoteButton";
import { useNightMode } from "../../../shared/appearance/pageAppearance";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";
import { useSongRowPlayback, type SongRowPlaybackNote } from "./useSongRowPlayback";
import {
  resolveSongPracticeArrangement,
  simplifySongPracticeArrangement,
  type SongPracticeDuration,
  type SongPracticeHandMode,
  type SongPracticeInputMode,
  type SongPracticeNote,
  type SongPracticeSelection,
  type SongPracticeStaff,
  type SongPracticeTrackMode,
  type ResolvedSongPracticeArrangement,
} from "./songPracticeMaterials";
import {
  recordSongPracticeAttempt,
  recordSongPracticeSessionCompleted,
  recordSongPracticeSessionStarted,
} from "./songPracticeProgress";
import {
  DEFAULT_SONG_PRACTICE_UI_PREFERENCES,
  parseSongPracticeUiPreferences,
  SONG_PRACTICE_UI_PREFERENCES_KEY,
} from "./songPracticePreferences";
import {
  PracticeChaseSettingsDialog,
  type PracticeChaseSettings,
} from "../components/PracticeChaseSettingsDialog";
import { useSongChase } from "./useSongChase";
import { PRACTICE_PAGE_STAFF_LAYOUT } from "../../../shared/staff/staffLayoutProfiles";

const SONG_PRACTICE_STAFF_LAYOUT = {
  ...PRACTICE_PAGE_STAFF_LAYOUT,
  vertical: {
    ...PRACTICE_PAGE_STAFF_LAYOUT.vertical,
    // Keep the first row's animated cursor arc inside the SVG viewport.
    trebleOnlyYPx: 88,
    bassOnlyYPx: 88,
    viewHeightPx: 216,
  },
  multirow: {
    ...PRACTICE_PAGE_STAFF_LAYOUT.multirow,
    rowGapPx: 4,
  },
};

const MIXED_STAFF_LAYOUT = {
  ...SONG_PRACTICE_STAFF_LAYOUT,
  vertical: {
    ...SONG_PRACTICE_STAFF_LAYOUT.vertical,
    centerYPx: 124,
    gapPx: 72,
    viewHeightPx: 278,
  },
};

const NOTES_PER_ROW = 12;
const WRONG_FEEDBACK_DURATION_MS = 2000;
const WRONG_INPUT_LOCK_MS = 80;

interface SongPracticeMicrophone {
  error: string | null;
  inputLevel: number;
  isListening: boolean;
  isPreparingSwiftF0: boolean;
  start: (options?: { includeAccidentals?: boolean }) => Promise<boolean>;
  status: PracticeMicrophoneStatus;
  stop: () => void;
}

interface SongPracticeViewProps {
  midi: MidiInputController;
  microphone: SongPracticeMicrophone;
  onBack: () => void;
  onFullscreenAvailabilityChange: (active: boolean) => void;
  onInputModeChange: (mode: SongPracticeInputMode) => void;
  onRegisterMicrophoneAnswer: (handler: (answer: PracticeAnswerInput) => void) => void;
  selection: SongPracticeSelection;
}

interface AnswerFeedback {
  noteName: PianoKeyName;
  octave: number;
  type: "correct" | "wrong";
}

function resolveTargetNote(note: SongPracticeNote): TargetNote {
  const pitchId = `${note.noteName}${note.octave}` as PitchId;
  const groupId =
    note.octave <= 2
      ? "F1-F2"
      : note.octave === 3
        ? "G2-F3"
        : note.octave === 4
          ? "G3-F4"
          : note.octave === 5
            ? "G4-F5"
            : "G5-G6";
  return {
    id: `${pitchId}-${note.staff}` as TargetNoteId,
    pitchId,
    noteName: note.noteName,
    accidental: note.accidental,
    octave: note.octave as Octave,
    groupId,
    staff: note.staff,
    isInterStaffLedgerSpelling: false,
  };
}

const KEY_SEMITONES: Record<PianoKeyName, number> = {
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  A: 9,
  "A#": 10,
  B: 11,
};

function midiPitchForKey(noteName: PianoKeyName, octave: number): number {
  return (octave + 1) * 12 + KEY_SEMITONES[noteName];
}

const PIANO_KEY_BY_SEMITONE: readonly PianoKeyName[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

function resolvePianoKeyFromMidi(
  midiNoteNumber: number
): { noteName: PianoKeyName; octave: number } | null {
  if (!Number.isInteger(midiNoteNumber) || midiNoteNumber < 0 || midiNoteNumber > 127) return null;
  const noteName = PIANO_KEY_BY_SEMITONE[midiNoteNumber % 12];
  if (!noteName) return null;
  return { noteName, octave: Math.floor(midiNoteNumber / 12) - 1 };
}

function resolveStaffDuration(duration: SongPracticeDuration): SongPracticeDuration {
  return duration;
}

function sourceLabel(mode: SongPracticeInputMode): string {
  if (mode === "midi") return "MIDI 键盘";
  return "麦克风";
}

async function startMicrophoneAndGetError(
  start: () => Promise<boolean>,
  fallbackMessage: string
): Promise<string | null> {
  try {
    return (await start()) ? null : fallbackMessage;
  } catch (error) {
    return error instanceof Error && error.message ? error.message : fallbackMessage;
  }
}

function staffNotationMode(
  trackMode: SongPracticeTrackMode
): "treble-only" | "bass-only" | "grand" {
  if (trackMode === "bass") return "bass-only";
  if (trackMode === "mixed") return "grand";
  return "treble-only";
}

function absoluteBeat(
  note: { measure: number; onsetBeat: number },
  beatsPerMeasure: number
): number {
  return (note.measure - 1) * beatsPerMeasure + note.onsetBeat;
}

function mapArrangementIndex(
  previous: ReturnType<typeof resolveSongPracticeArrangement>,
  previousIndex: number,
  next: ReturnType<typeof resolveSongPracticeArrangement>,
  beatsPerMeasure: number
): number {
  if (previousIndex >= previous.targets.length) return next.targets.length;
  const currentTarget = previous.targets[previousIndex];
  if (!currentTarget) return 0;
  const currentBeat = absoluteBeat(currentTarget, beatsPerMeasure);
  const mappedIndex = next.targets.findIndex(
    (target) => absoluteBeat(target, beatsPerMeasure) >= currentBeat - 1e-6
  );
  return mappedIndex < 0 ? next.targets.length : mappedIndex;
}

function limitSongPracticeArrangement(
  arrangement: ResolvedSongPracticeArrangement
): ResolvedSongPracticeArrangement {
  if (arrangement.targets.length <= MAX_PRACTICE_QUESTIONS) return arrangement;
  const targets = arrangement.targets.slice(0, MAX_PRACTICE_QUESTIONS);
  return {
    ...arrangement,
    notes: targets.flatMap((target) => target.notes.slice(0, 1)),
    noteCount: targets.reduce((count, target) => count + target.notes.length, 0),
    targets,
  };
}

function versionLabel(selection: SongPracticeSelection): string {
  if (selection.keyVersion === "c") return "C 调版";
  if (selection.keyVersion === "original") return "原调版";
  return "来源调性";
}

export function SongPracticeView({
  midi,
  microphone,
  onBack,
  onFullscreenAvailabilityChange,
  onInputModeChange,
  onRegisterMicrophoneAnswer,
  selection,
}: SongPracticeViewProps): JSX.Element {
  const initialInputMode: SongPracticeInputMode = midi.isConnected ? "midi" : "microphone";
  const initialHandMode =
    selection.handMode === "both" && !midi.isConnected ? "right" : selection.handMode;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isCurrentTargetVisible, setIsCurrentTargetVisible] = useState(true);
  const currentTargetVisibleRef = useRef(true);
  const [activeHandMode, setActiveHandMode] = useState(initialHandMode);
  const [activeInputMode, setActiveInputMode] = useState(initialInputMode);
  useLayoutEffect(() => {
    onInputModeChange(activeInputMode);
  }, [activeInputMode, onInputModeChange]);
  const activeInputModeRef = useRef<SongPracticeInputMode>(initialInputMode);
  const activeHandModeRef = useRef<SongPracticeHandMode>(initialHandMode);
  const currentIndexRef = useRef(0);
  const pendingCorrectAdvanceRef = useRef<{
    nextIndex: number;
    targetCount: number;
  } | null>(null);
  const midiConnectionRef = useRef(midi.isConnected);
  const midiConnectionLiveRef = useRef(midi.isConnected);
  midiConnectionLiveRef.current = midi.isConnected;
  const inputTransitionTokenRef = useRef(0);
  const inputTransitionRef = useRef(false);
  const initialMicrophoneAttemptRef = useRef(false);
  const initialFallbackNoticeRef = useRef(!midi.isConnected && selection.handMode === "both");
  const [songPreferences, setSongPreferences] = useLocalStorageState(
    SONG_PRACTICE_UI_PREFERENCES_KEY,
    DEFAULT_SONG_PRACTICE_UI_PREFERENCES,
    { parse: parseSongPracticeUiPreferences }
  );
  const [isChaseSettingsOpen, setIsChaseSettingsOpen] = useState(false);
  const isNightMode = useNightMode();
  const [hasStarted, setHasStarted] = useState(true);
  const [isQuestionLimitReached, setIsQuestionLimitReached] = useState(false);
  const [initialMicrophoneStatusDelayPassed, setInitialMicrophoneStatusDelayPassed] =
    useState(false);
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const [isInputSwitching, setIsInputSwitching] = useState(false);
  const answerLockedRef = useRef(false);
  const feedbackTimerRef = useRef<number | undefined>(undefined);
  const answerUnlockTimerRef = useRef<number | undefined>(undefined);
  const pendingWrongFeedbackRef = useRef<AnswerFeedback | null>(null);
  const isWrongFeedbackVisibleRef = useRef(false);
  const heldMidiNumbersRef = useRef(new Set<number>());
  const microphoneSubmitRef = useRef<
    (
      midiNoteNumber: number,
      confidence?: number,
      clipping?: boolean,
      microphoneAlgorithm?: "swiftf0" | "yin"
    ) => void
  >(() => {});
  const playbackRowRef = useRef<number | null>(null);
  const ignoreMicrophoneUntilRef = useRef(0);
  const sessionStartedAtRef = useRef<number | null>(null);
  const songSessionIdRef = useRef("");
  const hasMoreTargetsRef = useRef(false);
  const questionLimitReachedRef = useRef(false);
  const targetStartedAtRef = useRef(performance.now());
  const targetAttemptsRef = useRef<AnswerAttempt[]>([]);
  const sessionCompletedRef = useRef(false);
  const {
    cancel: cancelRowPlayback,
    getAudioTime,
    playbackCursor,
    playingNoteIndex,
    playingRowIndex,
    toggleRow: toggleSongRow,
  } = useSongRowPlayback();
  const microphoneError = microphone.error;
  const microphoneIsListening = microphone.isListening;
  const { start: startMicrophone } = microphone;
  const microphoneStart = useCallback(
    () => startMicrophone({ includeAccidentals: true }),
    [startMicrophone]
  );
  const stopMicrophone = microphone.stop;
  const lastNotifiedMicrophoneErrorRef = useRef<string | null>(null);
  const microphoneReconnectInFlightRef = useRef(false);
  const reachQuestionLimit = useCallback((): void => {
    if (questionLimitReachedRef.current) return;
    questionLimitReachedRef.current = true;
    setIsQuestionLimitReached(true);
    answerLockedRef.current = true;
    pendingCorrectAdvanceRef.current = null;
    if (feedbackTimerRef.current !== undefined) window.clearTimeout(feedbackTimerRef.current);
    if (answerUnlockTimerRef.current !== undefined)
      window.clearTimeout(answerUnlockTimerRef.current);
    feedbackTimerRef.current = undefined;
    answerUnlockTimerRef.current = undefined;
    pendingWrongFeedbackRef.current = null;
    isWrongFeedbackVisibleRef.current = false;
    setFeedback(null);
    cancelRowPlayback();
    playbackRowRef.current = null;
    stopMicrophone();
  }, [cancelRowPlayback, stopMicrophone]);
  const beginProgressSession = useCallback((): void => {
    sessionStartedAtRef.current = Date.now();
    songSessionIdRef.current = createUuid();
    sessionCompletedRef.current = false;
    questionLimitReachedRef.current = false;
    setIsQuestionLimitReached(false);
    recordSongPracticeSessionStarted(selection.songId, selection.keyVersion);
  }, [selection.keyVersion, selection.songId]);
  const completeProgressSession = useCallback((): void => {
    if (sessionCompletedRef.current || sessionStartedAtRef.current === null) return;
    sessionCompletedRef.current = true;
    recordSongPracticeSessionCompleted(
      selection.songId,
      selection.keyVersion,
      Date.now() - sessionStartedAtRef.current
    );
  }, [selection.keyVersion, selection.songId]);
  const commitPendingCorrectAdvance = useCallback((): void => {
    const pendingAdvance = pendingCorrectAdvanceRef.current;
    if (!pendingAdvance) return;
    pendingCorrectAdvanceRef.current = null;
    if (feedbackTimerRef.current !== undefined) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = undefined;
    }
    currentIndexRef.current = pendingAdvance.nextIndex;
    setCurrentIndex(pendingAdvance.nextIndex);
    if (pendingAdvance.nextIndex >= MAX_PRACTICE_QUESTIONS && hasMoreTargetsRef.current) {
      reachQuestionLimit();
      return;
    }
    answerLockedRef.current = false;
    if (pendingAdvance.nextIndex >= pendingAdvance.targetCount) completeProgressSession();
  }, [completeProgressSession, reachQuestionLimit]);
  const sourceArrangement = useMemo(
    () => resolveSongPracticeArrangement(selection.score, activeHandMode),
    [activeHandMode, selection.score]
  );
  const simultaneousTargetCount = sourceArrangement.targets.filter(
    (target) => target.notes.length > 1
  ).length;
  const requiresMidi = activeHandMode === "both";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setInitialMicrophoneStatusDelayPassed(true);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, []);

  const reconnectMicrophone = useCallback(
    async (options: { showToast?: boolean } = {}): Promise<boolean> => {
      if (microphoneReconnectInFlightRef.current) return false;
      microphoneReconnectInFlightRef.current = true;
      try {
        const reconnectError = await startMicrophoneAndGetError(
          microphoneStart,
          "麦克风未能重新连接，请检查权限和输入设备后重试。"
        );
        if (reconnectError) {
          lastNotifiedMicrophoneErrorRef.current = reconnectError;
          if (options.showToast !== false) toast.error(reconnectError, { duration: 4000 });
          return false;
        }
        lastNotifiedMicrophoneErrorRef.current = null;
        setHasStarted(true);
        if (options.showToast !== false) {
          toast.success("麦克风已重新连接，继续当前音符。", { duration: 3000 });
        }
        return true;
      } finally {
        microphoneReconnectInFlightRef.current = false;
      }
    },
    [microphoneStart]
  );

  const notifyMicrophoneError = useCallback(
    (message: string): void => {
      const isRecoverableInterruption = /后台恢复|音频处理|连接已中断|重新连接设备/.test(message);
      const previousMessage = lastNotifiedMicrophoneErrorRef.current;
      if (
        previousMessage === message ||
        (isRecoverableInterruption &&
          previousMessage !== null &&
          /后台恢复|音频处理|连接已中断|重新连接设备/.test(previousMessage))
      ) {
        return;
      }
      if (microphoneReconnectInFlightRef.current) return;
      lastNotifiedMicrophoneErrorRef.current = message;
      if (isRecoverableInterruption) {
        void reconnectMicrophone({ showToast: false }).then((reconnected) => {
          if (reconnected) {
            toast.success("麦克风已自动恢复，继续当前音符。", { duration: 2200 });
            return;
          }
          toast.warning("麦克风未能自动恢复", {
            id: "song-practice-microphone-reconnect",
            description: "点击“重新连接”再试一次。",
            duration: 6000,
            action: { label: "重新连接", onClick: () => void reconnectMicrophone() },
          });
        });
        return;
      }
      toast.error(message, { duration: 4000 });
    },
    [reconnectMicrophone]
  );

  useEffect(() => {
    if (!microphoneError) {
      lastNotifiedMicrophoneErrorRef.current = null;
      return;
    }
    notifyMicrophoneError(microphoneError);
  }, [microphoneError, notifyMicrophoneError]);

  useEffect(() => {
    if (initialFallbackNoticeRef.current) {
      toast.warning("未检测到 MIDI，已切换到麦克风和右手单音。", {
        id: "song-practice-midi-fallback",
        duration: 3500,
      });
    }
  }, []);
  const simplifiesForSingleNoteInput =
    !requiresMidi && activeInputMode !== "midi" && simultaneousTargetCount > 0;
  const resolvedArrangement = useMemo(
    () =>
      simplifiesForSingleNoteInput
        ? simplifySongPracticeArrangement(sourceArrangement, activeHandMode)
        : sourceArrangement,
    [activeHandMode, simplifiesForSingleNoteInput, sourceArrangement]
  );
  const hasMoreTargets = resolvedArrangement.targets.length > MAX_PRACTICE_QUESTIONS;
  hasMoreTargetsRef.current = hasMoreTargets;
  const arrangement = useMemo(
    () => limitSongPracticeArrangement(resolvedArrangement),
    [resolvedArrangement]
  );
  const arrangementTargetCountRef = useRef(arrangement.targets.length);
  arrangementTargetCountRef.current = arrangement.targets.length;
  const targetNotes = useMemo(() => arrangement.notes.map(resolveTargetNote), [arrangement.notes]);
  const targetNoteGroups = useMemo(
    () => arrangement.targets.map((target) => target.notes.map(resolveTargetNote)),
    [arrangement.targets]
  );
  const currentTarget = arrangement.targets[currentIndex];
  activeInputModeRef.current = activeInputMode;
  activeHandModeRef.current = activeHandMode;
  currentIndexRef.current = currentIndex;
  const isFinished =
    hasStarted && currentIndex >= arrangement.targets.length && !isQuestionLimitReached;
  const meter = selection.score.meter;
  useEffect(() => {
    onFullscreenAvailabilityChange(hasStarted && !isFinished && !isQuestionLimitReached);
    return () => onFullscreenAvailabilityChange(false);
  }, [hasStarted, isFinished, isQuestionLimitReached, onFullscreenAvailabilityChange]);
  useEffect(() => {
    targetStartedAtRef.current = performance.now();
    targetAttemptsRef.current = [];
  }, [currentIndex, activeHandMode, arrangement]);
  const tempoBpm = selection.score.tempoBpm;
  const {
    cursor: songChaseCursor,
    recordCorrectTarget: recordSongChaseCorrectTarget,
    reset: resetSongChase,
  } = useSongChase({
    enabled: songPreferences.chaseEnabled && hasStarted && !isFinished && !isQuestionLimitReached,
    beatsPerMeasure: selection.score.meter.quarterBeatsPerMeasure,
    getAudioTime,
    handMode: activeHandMode,
    paused: !hasStarted || isFinished || isQuestionLimitReached || playingRowIndex !== null,
    speedMultiplier: songPreferences.chaseSpeedMultiplier,
    startCount: songPreferences.chaseStartCount,
    tempoEvents: selection.score.source.sourceTempoEvents,
    ticksPerQuarter: selection.score.source.ticksPerQuarter,
    targets: arrangement.targets,
    tempoBpm,
  });
  const scoreRowCount = Math.max(1, Math.ceil(arrangement.targets.length / NOTES_PER_ROW));
  const scoreChaseCursor =
    !songChaseCursor || playingRowIndex !== null || playbackCursor !== null
      ? null
      : songChaseCursor;
  const animatedCursorRows = [
    ...Object.values(playbackCursor?.staffCursors ?? {}).flatMap((staffCursor) =>
      staffCursor ? [staffCursor.rowIndex] : []
    ),
    ...Object.values(scoreChaseCursor?.staffCursors ?? {}).flatMap((staffCursor) =>
      staffCursor?.currentEventIndices[0] === undefined
        ? []
        : [Math.floor(staffCursor.currentEventIndices[0] / NOTES_PER_ROW)]
    ),
  ];
  const followRowIndex = Math.min(
    animatedCursorRows.length > 0
      ? Math.max(...animatedCursorRows)
      : Math.floor(currentIndex / NOTES_PER_ROW),
    scoreRowCount - 1
  );
  const handleCurrentTargetVisibilityChange = useCallback(
    (isVisible: boolean): void => {
      if (!hasStarted || isFinished || !currentTarget) {
        currentTargetVisibleRef.current = true;
        setIsCurrentTargetVisible(true);
        return;
      }
      if (currentTargetVisibleRef.current === isVisible) return;

      currentTargetVisibleRef.current = isVisible;
      setIsCurrentTargetVisible(isVisible);
      if (!isVisible) heldMidiNumbersRef.current.clear();
      toast.message(
        isVisible ? "当前音符已回到视野，可以继续弹奏。" : "当前音符已滚出视野，输入已暂停。",
        { id: "song-practice-current-note-visibility", duration: 2000 }
      );
    },
    [currentTarget, hasStarted, isFinished]
  );
  const getCurrentNoteTarget = useCallback((): SVGElement | null => {
    const currentNoteHead = document.querySelector<SVGElement>(
      `.song-practice-prompt-wrap [data-staff-page-note-index="${currentIndex}"]`
    );
    const rowIndex = Math.floor(currentIndex / NOTES_PER_ROW);
    const currentRow = document.querySelector<SVGGElement>(
      `.song-practice-prompt-wrap .staff-page-system[data-staff-row-index="${rowIndex}"]`
    );
    return currentNoteHead ?? currentRow ?? null;
  }, [currentIndex]);
  const scoreMeasures = useMemo(
    () => arrangement.targets.map((target) => target.measure),
    [arrangement.targets]
  );
  const scoreOnsets = useMemo(
    () =>
      arrangement.targets.map((target) =>
        absoluteBeat(target, selection.score.meter.quarterBeatsPerMeasure)
      ),
    [arrangement.targets, selection.score.meter.quarterBeatsPerMeasure]
  );
  const scoreDurations = useMemo(
    () => arrangement.targets.map((target) => resolveStaffDuration(target.duration)),
    [arrangement.targets]
  );
  const scoreStaffNoteDurations = useMemo(
    () =>
      arrangement.targets.map((target) => {
        const longestDurationForStaff = (
          staff: SongPracticeStaff
        ): SongPracticeDuration | undefined => {
          const staffNotes = target.notes.filter((note) => note.staff === staff);
          if (staffNotes.length === 0) return undefined;
          return staffNotes.reduce((longest, note) =>
            note.durationBeats > longest.durationBeats ? note : longest
          ).duration;
        };
        return {
          treble: longestDurationForStaff("treble"),
          bass: longestDurationForStaff("bass"),
        };
      }),
    [arrangement.targets]
  );
  const scoreLyrics = useMemo(
    () => arrangement.targets.map(() => [] as string[]),
    [arrangement.targets]
  );
  const scorePlaybackRows = useMemo(() => {
    const scoreTargets = arrangement.targets;
    const rows: SongRowPlaybackNote[][] = [];
    for (let rowStart = 0; rowStart < scoreTargets.length; rowStart += NOTES_PER_ROW) {
      const row = scoreTargets.slice(rowStart, rowStart + NOTES_PER_ROW);
      const firstMeasure = row[0]?.measure ?? 1;
      rows.push(
        row.flatMap((target, index) =>
          target.notes.map((note) => ({
            durationBeats: note.durationBeats,
            durationTicks: note.sourceMidiLocation?.durationTicks,
            eventIndex: rowStart + index,
            note: resolveTargetNote(note),
            startBeat:
              (target.measure - firstMeasure) * selection.score.meter.quarterBeatsPerMeasure +
              target.onsetBeat,
            startTick: note.sourceMidiLocation?.onsetTick,
          }))
        )
      );
    }
    return rows;
  }, [arrangement.targets, selection.score.meter.quarterBeatsPerMeasure]);
  const barlineAfterNoteIndices = useMemo(() => {
    return arrangement.targets.flatMap((target, index) =>
      arrangement.targets[index + 1] && arrangement.targets[index + 1].measure !== target.measure
        ? [index]
        : []
    );
  }, [arrangement.targets]);
  const subscribeMidi = midi.subscribe;

  useEffect(() => {
    const wasConnected = midiConnectionRef.current;
    if (wasConnected === midi.isConnected) return;
    midiConnectionRef.current = midi.isConnected;
    const transitionToken = ++inputTransitionTokenRef.current;
    const previousInputMode = activeInputModeRef.current;

    commitPendingCorrectAdvance();
    inputTransitionRef.current = true;
    setIsInputSwitching(true);
    answerLockedRef.current = false;
    heldMidiNumbersRef.current.clear();
    if (feedbackTimerRef.current !== undefined) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = undefined;
    }
    if (answerUnlockTimerRef.current !== undefined) {
      window.clearTimeout(answerUnlockTimerRef.current);
      answerUnlockTimerRef.current = undefined;
    }
    pendingWrongFeedbackRef.current = null;
    isWrongFeedbackVisibleRef.current = false;
    setFeedback(null);
    cancelRowPlayback();
    playbackRowRef.current = null;
    ignoreMicrophoneUntilRef.current = Date.now() + 400;

    if (midi.isConnected) {
      if (previousInputMode === "microphone") stopMicrophone();
      const nextMidiArrangement = resolveSongPracticeArrangement(
        selection.score,
        activeHandModeRef.current
      );
      const cappedNextMidiArrangement = limitSongPracticeArrangement(nextMidiArrangement);
      const nextIndex = mapArrangementIndex(
        arrangement,
        currentIndexRef.current,
        cappedNextMidiArrangement,
        selection.score.meter.quarterBeatsPerMeasure
      );
      currentIndexRef.current = nextIndex;
      setCurrentIndex(nextIndex);
      if (nextIndex < cappedNextMidiArrangement.targets.length) setHasStarted(true);
      activeInputModeRef.current = "midi";
      setActiveInputMode("midi");
      setSongPreferences((current) => ({ ...current, inputMode: "midi" }));
      inputTransitionRef.current = false;
      setIsInputSwitching(false);
      return;
    }

    if (previousInputMode !== "midi") {
      inputTransitionRef.current = false;
      setIsInputSwitching(false);
      return;
    }

    const previousHandMode = activeHandModeRef.current;
    const nextHandMode = previousHandMode === "both" ? "right" : previousHandMode;
    const previousArrangement = arrangement;
    const nextSourceArrangement = resolveSongPracticeArrangement(selection.score, nextHandMode);
    const nextArrangement = limitSongPracticeArrangement(
      simplifySongPracticeArrangement(nextSourceArrangement, nextHandMode)
    );
    const nextIndex = mapArrangementIndex(
      previousArrangement,
      currentIndexRef.current,
      nextArrangement,
      selection.score.meter.quarterBeatsPerMeasure
    );
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    setActiveHandMode(nextHandMode);
    activeHandModeRef.current = nextHandMode;
    activeInputModeRef.current = "microphone";
    initialMicrophoneAttemptRef.current = true;
    setActiveInputMode("microphone");
    setSongPreferences((current) => ({
      ...current,
      handMode: nextHandMode,
      inputMode: "microphone",
    }));

    const shouldResumeListening =
      hasStarted && currentIndexRef.current < previousArrangement.targets.length;
    void (async () => {
      let started = true;
      let microphoneStartFailure: string | null = null;
      try {
        started = shouldResumeListening ? await microphoneStart() : true;
      } catch (error) {
        started = false;
        microphoneStartFailure = error instanceof Error ? error.message : null;
      }
      if (transitionToken !== inputTransitionTokenRef.current) {
        if (started && midiConnectionLiveRef.current) stopMicrophone();
        return;
      }
      inputTransitionRef.current = false;
      setIsInputSwitching(false);
      if (!started) {
        setHasStarted(false);
        notifyMicrophoneError(
          microphoneStartFailure ??
            microphone.error ??
            "MIDI 已断开，麦克风也无法使用。请检查麦克风权限和输入设备后重试。"
        );
        return;
      }
      toast.success(
        previousHandMode === "both" ? "已切换到麦克风和右手单音。" : "已切换到麦克风。",
        { duration: 3000 }
      );
    })();
  }, [
    cancelRowPlayback,
    beginProgressSession,
    arrangement,
    commitPendingCorrectAdvance,
    hasStarted,
    midi.isConnected,
    midi.selectedInput?.name,
    microphone.error,
    microphoneStart,
    notifyMicrophoneError,
    selection.score,
    setSongPreferences,
    stopMicrophone,
  ]);

  useEffect(() => {
    if (sessionStartedAtRef.current === null) beginProgressSession();
  }, [beginProgressSession]);

  useEffect(() => {
    if (isFinished) completeProgressSession();
  }, [completeProgressSession, isFinished]);

  const clearFeedbackTimer = useCallback((): void => {
    if (feedbackTimerRef.current !== undefined) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = undefined;
    }
    if (answerUnlockTimerRef.current !== undefined) {
      window.clearTimeout(answerUnlockTimerRef.current);
      answerUnlockTimerRef.current = undefined;
    }
    pendingWrongFeedbackRef.current = null;
    isWrongFeedbackVisibleRef.current = false;
  }, []);

  const finishAttempt = useCallback(
    (
      correct: boolean,
      noteName: PianoKeyName,
      octave: number,
      metadata: {
        confidence?: number;
        clipping?: boolean;
        microphoneAlgorithm?: "swiftf0" | "yin";
      } = {}
    ): void => {
      if (
        questionLimitReachedRef.current ||
        !currentTarget ||
        !currentTargetVisibleRef.current ||
        answerLockedRef.current
      ) {
        return;
      }
      answerLockedRef.current = true;
      const inputMode = activeInputModeRef.current === "midi" ? "midi" : "microphone";
      const atMs = Math.max(0, performance.now() - targetStartedAtRef.current);
      const midi = midiPitchForKey(noteName, octave);
      targetAttemptsRef.current.push({
        midi,
        noteName: noteName.replace("#", "") as never,
        atMs,
        inputMode,
        isCorrect: correct,
        confidence: metadata.confidence,
        clipping: metadata.clipping ?? false,
        microphoneAlgorithm: metadata.microphoneAlgorithm,
      });
      recordSongPracticeAttempt(selection.songId, selection.keyVersion, activeHandMode, correct);
      if (correct) {
        const microphoneContext = currentMicrophoneContext();
        const microphoneAlgorithm =
          metadata.microphoneAlgorithm ?? microphoneContext.microphoneAlgorithm;
        const estimatedSystemDelayMs =
          inputMode === "microphone"
            ? estimateStaffGameSystemDelayMs(
                "microphone",
                practiceMicrophoneDebugParametersForSensitivityLevel(
                  microphoneAlgorithm ?? "swiftf0",
                  microphoneContext.sensitivityLevel ?? 3
                ),
                microphoneAlgorithm ?? "swiftf0"
              )
            : 0;
        const rawResponseTimeMs = atMs;
        void saveAnswerEvents([
          {
            id: `${songSessionIdRef.current}:${currentIndex}`,
            dataSetId: "",
            sessionId: songSessionIdRef.current,
            eventIndex: currentIndex,
            occurredAt: new Date().toISOString(),
            promptStartedAt: new Date(Date.now() - rawResponseTimeMs).toISOString(),
            promptEndedAt: new Date().toISOString(),
            mode: "song",
            inputMode,
            deviceInfo: answerDeviceInfo(),
            ...(inputMode === "microphone" ? { ...microphoneContext, microphoneAlgorithm } : {}),
            targetMidi: currentTarget.notes[0]?.midiPitch,
            recognizedMidi: midi,
            confidence: targetAttemptsRef.current.at(-1)?.confidence,
            attempts: targetAttemptsRef.current,
            isCorrectFirstTry: targetAttemptsRef.current.length === 1,
            isCorrectFinal: true,
            rawResponseTimeMs,
            estimatedSystemDelayMs,
            responseTimeMs: Math.max(0, rawResponseTimeMs - estimatedSystemDelayMs),
            activeMs: rawResponseTimeMs,
            wrongAttempts: targetAttemptsRef.current.filter(
              (attempt) => !attempt.isCorrect && !attempt.isLateForPrevious
            ).length,
            isExtraNote: false,
            isMissed: false,
            songId: selection.songId,
            difficulty: selection.keyVersion,
          },
        ]).catch(() => undefined);
        clearFeedbackTimer();
        const completedIndex = currentIndexRef.current;
        const targetCount = arrangementTargetCountRef.current;
        recordSongChaseCorrectTarget(completedIndex);
        pendingCorrectAdvanceRef.current = {
          nextIndex: completedIndex + 1,
          targetCount,
        };
        setFeedback({ noteName, octave, type: "correct" });
        feedbackTimerRef.current = window.setTimeout(() => {
          feedbackTimerRef.current = undefined;
          if (!pendingCorrectAdvanceRef.current) return;
          commitPendingCorrectAdvance();
          setFeedback(null);
          heldMidiNumbersRef.current.clear();
        }, 160);
        return;
      }

      const nextFeedback: AnswerFeedback = { noteName, octave, type: "wrong" };
      if (isWrongFeedbackVisibleRef.current) {
        // Keep the visible error readable; collapse rapid repeats to the latest note.
        pendingWrongFeedbackRef.current = nextFeedback;
      } else {
        setFeedback(nextFeedback);
        isWrongFeedbackVisibleRef.current = true;
        const showLatestPendingWrongFeedback = (): void => {
          feedbackTimerRef.current = window.setTimeout(() => {
            const pendingFeedback = pendingWrongFeedbackRef.current;
            pendingWrongFeedbackRef.current = null;
            if (pendingFeedback) {
              setFeedback(pendingFeedback);
              showLatestPendingWrongFeedback();
              return;
            }
            feedbackTimerRef.current = undefined;
            isWrongFeedbackVisibleRef.current = false;
            setFeedback(null);
          }, WRONG_FEEDBACK_DURATION_MS);
        };
        showLatestPendingWrongFeedback();
      }

      heldMidiNumbersRef.current.clear();
      answerUnlockTimerRef.current = window.setTimeout(() => {
        answerLockedRef.current = false;
        answerUnlockTimerRef.current = undefined;
      }, WRONG_INPUT_LOCK_MS);
    },
    [
      activeHandMode,
      clearFeedbackTimer,
      commitPendingCorrectAdvance,
      currentIndex,
      currentTarget,
      recordSongChaseCorrectTarget,
      selection.keyVersion,
      selection.songId,
    ]
  );

  const submitPitch = useCallback(
    (noteName: PianoKeyName, octave: number): void => {
      if (
        !hasStarted ||
        !currentTargetVisibleRef.current ||
        inputTransitionRef.current ||
        !currentTarget ||
        answerLockedRef.current ||
        playbackRowRef.current !== null
      ) {
        return;
      }
      const requiredMidiNumbers = [...new Set(currentTarget.notes.map((note) => note.midiPitch))];
      if (requiredMidiNumbers.length > 1) {
        finishAttempt(false, noteName, octave);
        return;
      }
      finishAttempt(
        midiPitchForKey(noteName, octave) === currentTarget.notes[0]?.midiPitch,
        noteName,
        octave
      );
    },
    [currentTarget, finishAttempt, hasStarted]
  );

  const submitMidiPitch = useCallback(
    (
      midiNoteNumber: number,
      confidence?: number,
      clipping?: boolean,
      microphoneAlgorithm?: "swiftf0" | "yin"
    ): void => {
      const answerKey = resolvePianoKeyFromMidi(midiNoteNumber);
      if (
        !answerKey ||
        !hasStarted ||
        !currentTargetVisibleRef.current ||
        inputTransitionRef.current ||
        !currentTarget ||
        answerLockedRef.current ||
        playbackRowRef.current !== null
      ) {
        return;
      }
      const requiredMidiNumbers = [...new Set(currentTarget.notes.map((note) => note.midiPitch))];
      finishAttempt(
        requiredMidiNumbers.length === 1 && requiredMidiNumbers[0] === midiNoteNumber,
        answerKey.noteName,
        answerKey.octave,
        { confidence, clipping, microphoneAlgorithm }
      );
    },
    [currentTarget, finishAttempt, hasStarted]
  );

  const handleMidiEvent = useCallback(
    (event: MidiNoteInputEvent): void => {
      if (
        inputTransitionRef.current ||
        activeInputModeRef.current !== "midi" ||
        !currentTargetVisibleRef.current
      ) {
        return;
      }
      if (event.type === "reset") {
        heldMidiNumbersRef.current.clear();
        return;
      }
      if (event.type === "release") {
        heldMidiNumbersRef.current.delete(event.note.midiNoteNumber);
        return;
      }
      if (
        !hasStarted ||
        !currentTarget ||
        answerLockedRef.current ||
        playbackRowRef.current !== null
      ) {
        return;
      }
      const requiredMidiNumbers = [...new Set(currentTarget.notes.map((note) => note.midiPitch))];
      if (requiredMidiNumbers.length <= 1) {
        submitPitch(event.note.keyName, event.note.octave);
        return;
      }
      heldMidiNumbersRef.current.add(event.note.midiNoteNumber);
      const isRequiredPitch = requiredMidiNumbers.includes(event.note.midiNoteNumber);
      const chordComplete = requiredMidiNumbers.every((pitch) =>
        heldMidiNumbersRef.current.has(pitch)
      );
      if (!isRequiredPitch) {
        finishAttempt(false, event.note.keyName, event.note.octave);
      } else if (chordComplete) {
        finishAttempt(true, event.note.keyName, event.note.octave);
      }
    },
    [currentTarget, finishAttempt, hasStarted, submitPitch]
  );

  const handleMicrophoneAnswer = useCallback((answer: PracticeAnswerInput): void => {
    if (
      inputTransitionRef.current ||
      activeInputModeRef.current !== "microphone" ||
      !currentTargetVisibleRef.current ||
      playbackRowRef.current !== null ||
      Date.now() < ignoreMicrophoneUntilRef.current
    ) {
      return;
    }
    if (answer.midiNoteNumber !== undefined) {
      microphoneSubmitRef.current(
        answer.midiNoteNumber,
        answer.confidence,
        answer.clipping,
        answer.microphoneAlgorithm
      );
    } else if (answer.octave !== undefined) {
      microphoneSubmitRef.current(
        midiPitchForKey(answer.noteName, answer.octave),
        answer.confidence,
        answer.clipping,
        answer.microphoneAlgorithm
      );
    }
  }, []);

  useEffect(() => {
    onRegisterMicrophoneAnswer(handleMicrophoneAnswer);
    return () => onRegisterMicrophoneAnswer(() => undefined);
  }, [handleMicrophoneAnswer, onRegisterMicrophoneAnswer]);

  const toggleRowPlayback = useCallback(
    (rowIndex: number): void => {
      if (playbackRowRef.current === rowIndex) {
        playbackRowRef.current = null;
        ignoreMicrophoneUntilRef.current = Date.now() + 400;
      } else {
        playbackRowRef.current = rowIndex;
        ignoreMicrophoneUntilRef.current = Number.POSITIVE_INFINITY;
      }
      toggleSongRow(rowIndex, scorePlaybackRows[rowIndex] ?? [], {
        tempoBpm,
        tempoEvents: selection.score.source.sourceTempoEvents,
        ticksPerQuarter: selection.score.source.ticksPerQuarter,
      });
    },
    [scorePlaybackRows, selection.score.source, tempoBpm, toggleSongRow]
  );

  useEffect(() => {
    if (playingRowIndex === null && playbackRowRef.current !== null) {
      playbackRowRef.current = null;
      ignoreMicrophoneUntilRef.current = Date.now() + 400;
    }
  }, [playingRowIndex]);

  useEffect(
    () => () => {
      cancelRowPlayback();
      if (playbackRowRef.current !== null) {
        playbackRowRef.current = null;
        ignoreMicrophoneUntilRef.current = Date.now() + 400;
      }
    },
    [cancelRowPlayback]
  );

  microphoneSubmitRef.current = submitMidiPitch;

  useEffect(() => {
    if (activeInputMode !== "midi") return undefined;
    return subscribeMidi(handleMidiEvent);
  }, [activeInputMode, handleMidiEvent, subscribeMidi]);

  useEffect(() => {
    if (
      activeInputMode !== "microphone" ||
      microphoneIsListening ||
      initialMicrophoneAttemptRef.current
    ) {
      return;
    }
    initialMicrophoneAttemptRef.current = true;
    void microphoneStart()
      .then((started) => {
        if (midiConnectionLiveRef.current) {
          if (started) stopMicrophone();
          return;
        }
        if (!started) {
          setHasStarted(false);
          notifyMicrophoneError(
            microphone.error ?? "麦克风无法启动。请检查麦克风权限和输入设备后重试。"
          );
        }
      })
      .catch((error: unknown) => {
        if (midiConnectionLiveRef.current) return;
        setHasStarted(false);
        notifyMicrophoneError(
          error instanceof Error
            ? error.message
            : "麦克风无法启动。请检查麦克风权限和输入设备后重试。"
        );
      });
  }, [
    activeInputMode,
    microphone.error,
    microphoneIsListening,
    microphoneStart,
    notifyMicrophoneError,
    stopMicrophone,
  ]);

  useEffect(() => {
    if (activeInputMode === "midi") stopMicrophone();
  }, [activeInputMode, stopMicrophone]);

  useEffect(
    () => () => {
      clearFeedbackTimer();
      if (activeInputMode === "microphone") stopMicrophone();
      answerLockedRef.current = false;
    },
    [activeInputMode, clearFeedbackTimer, stopMicrophone]
  );

  useEffect(() => {
    if (isFinished && activeInputMode === "microphone") stopMicrophone();
  }, [activeInputMode, isFinished, stopMicrophone]);

  const changeHandMode = (nextMode: SongPracticeHandMode): void => {
    if (nextMode === activeHandMode || isInputSwitching || inputTransitionRef.current) return;
    resetSongChase();
    commitPendingCorrectAdvance();
    if (nextMode === "both" && !midi.isConnected) {
      toast.error("混弹需要连接 MIDI 键盘。当前手型和进度已保留。", { duration: 3500 });
      return;
    }
    const nextSourceArrangement = resolveSongPracticeArrangement(selection.score, nextMode);
    const nextRequiresMidi = nextMode === "both";
    const resolvedNextArrangement =
      nextRequiresMidi || activeInputMode === "midi"
        ? nextSourceArrangement
        : simplifySongPracticeArrangement(nextSourceArrangement, nextMode);
    const nextArrangement = limitSongPracticeArrangement(resolvedNextArrangement);
    const nextIndex = mapArrangementIndex(
      arrangement,
      currentIndexRef.current,
      nextArrangement,
      selection.score.meter.quarterBeatsPerMeasure
    );

    cancelRowPlayback();
    playbackRowRef.current = null;
    ignoreMicrophoneUntilRef.current = Date.now() + 400;
    clearFeedbackTimer();
    pendingCorrectAdvanceRef.current = null;
    answerLockedRef.current = false;
    heldMidiNumbersRef.current.clear();
    setFeedback(null);
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    setActiveHandMode(nextMode);
    activeHandModeRef.current = nextMode;

    if (nextRequiresMidi) {
      inputTransitionRef.current = true;
      setIsInputSwitching(true);
      if (activeInputMode === "microphone") stopMicrophone();
      activeInputModeRef.current = "midi";
      setActiveInputMode("midi");
      setSongPreferences((current) => ({ ...current, handMode: nextMode, inputMode: "midi" }));
      inputTransitionRef.current = false;
      setIsInputSwitching(false);
    } else {
      setSongPreferences((current) => ({ ...current, handMode: nextMode }));
    }
    const handLabel = nextMode === "right" ? "右手" : nextMode === "left" ? "左手" : "混弹";
    toast.success(
      `已切换到${handLabel}（${sourceLabel(nextRequiresMidi ? "midi" : activeInputMode)}）。`,
      {
        duration: 3000,
      }
    );
  };

  const saveChaseSettings = (settings: PracticeChaseSettings): void => {
    if (isInputSwitching || inputTransitionRef.current) {
      toast.message("输入方式正在切换，请稍后再保存追赶设置。", { duration: 2500 });
      return;
    }
    if (settings.handMode === "both" && !midi.isConnected) {
      toast.error("双手追赶需要连接 MIDI 键盘。", { duration: 3500 });
      return;
    }
    if (settings.handMode !== activeHandMode) changeHandMode(settings.handMode);
    setSongPreferences((current) => ({
      ...current,
      chaseEnabled: settings.enabled,
      chaseSpeedMultiplier: settings.speedMultiplier,
      chaseStartCount: settings.startCount,
    }));
  };

  const chaseCursors = Object.values(songChaseCursor?.staffCursors ?? {}).filter(
    (staffCursor) => staffCursor !== undefined
  );
  const chaseStatusText = !songPreferences.chaseEnabled
    ? null
    : !isNightMode
      ? "追赶模式仅在夜间模式运行"
      : chaseCursors.some((staffCursor) => staffCursor.caught)
        ? "追上了，继续弹奏开始下一轮"
        : chaseCursors.length > 0
          ? "追赶中"
          : `答对 ${songPreferences.chaseStartCount} 个目标后开始追赶`;

  const feedbackText = isInputSwitching
    ? "正在切换输入方式…"
    : isFinished
      ? "整首练习完成了，可以重新开始。"
      : !hasStarted || !isCurrentTargetVisible
        ? ""
        : feedback?.type === "correct"
          ? "正确，继续看下一个目标。"
          : feedback?.type === "wrong"
            ? `刚才弹的是 ${feedback.noteName}${feedback.octave}，看准当前音再试一次。`
            : activeInputMode === "microphone" && microphoneIsListening
              ? "麦克风已就绪，按谱弹奏当前单音。"
              : (currentTarget?.notes.length ?? 0) > 1
                ? "看准当前和弦，同时按下目标音；全部按对后会自动前进。"
                : "看谱弹奏当前音；弹对后会自动前进。";
  const keyLabel = selection.score.practiceKey;
  const keyName =
    keyLabel.includes("major") || keyLabel.includes("minor")
      ? keyLabel.replace(/ major| minor/, "")
      : keyLabel;
  return (
    <section className="practice-shell song-practice-shell">
      <div className="practice-topline song-practice-topline">
        <div className="topline-actions">
          <button className="practice-return-home" type="button" onClick={onBack}>
            <ArrowLeft aria-hidden="true" size={18} />
            返回配置
          </button>
        </div>
      </div>

      <div className="song-practice-content">
        <section className="panel song-practice-panel">
          <header className="song-practice-heading">
            <div className="song-practice-heading-row">
              <div className="song-practice-heading-controls">
                <div className="song-practice-hand-switch" role="group" aria-label="切换演奏手型">
                  {(
                    [
                      ["left", "左手"],
                      ["right", "右手"],
                      ["both", "混弹"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      aria-pressed={activeHandMode === mode}
                      className={activeHandMode === mode ? "is-active" : ""}
                      disabled={isInputSwitching}
                      key={mode}
                      type="button"
                      onClick={() => changeHandMode(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  aria-label="追逐游戏设置"
                  className="song-chase-settings-button"
                  title="追逐游戏设置"
                  type="button"
                  onClick={() => setIsChaseSettingsOpen(true)}
                >
                  <Settings aria-hidden="true" size={15} />
                  追逐游戏设置
                  <span aria-hidden="true" className="song-chase-new-badge">
                    NEW
                  </span>
                </button>
              </div>
              <div className="song-practice-heading-main">
                <h1>{selection.score.title}</h1>
                <div className="song-practice-tags">
                  <span>
                    {versionLabel(selection)} · {keyName} 调
                  </span>
                  <span>{arrangement.partName}</span>
                </div>
              </div>
              <MidiInputControl
                ariaLabel="歌曲跟弹 MIDI 输入设备"
                className="song-practice-midi-control"
                disabled={isInputSwitching}
                midi={midi}
              />
              <PracticeFullscreenToggle />
            </div>
            <p className="song-practice-reading-note">
              <span>本模式只判断音高顺序，不评节奏。谱面上的时值和间距用于熟悉真实乐谱；</span>
              <span>
                按顺序弹出对应音符即可。原谱速度仅供跟弹参考，不影响练习结果。切换手型会沿当前乐曲位置继续。
              </span>
            </p>
            <div className="song-practice-score-meta" aria-label="乐谱信息">
              <strong>♩ = {tempoBpm}</strong>
              <span>
                {meter.numerator}/{meter.denominator} 拍
              </span>
              {activeInputMode === "midi" ? (
                <span className="song-practice-current-input is-midi" role="status">
                  当前输入方式：MIDI
                </span>
              ) : microphone.status === "requesting" ? (
                <span className="song-practice-current-input" role="status">
                  <AudioLines aria-hidden="true" size={15} />
                  {microphone.isPreparingSwiftF0
                    ? "当前输入方式：正在准备识别模型"
                    : "当前输入方式：麦克风（连接中）"}
                  <PracticeMicrophoneRetryButton
                    isConnecting
                    isPreparingModel={microphone.isPreparingSwiftF0}
                    onRetry={() => reconnectMicrophone()}
                  />
                </span>
              ) : !microphoneIsListening ? (
                initialMicrophoneStatusDelayPassed ? (
                  <span className="song-practice-current-input is-error">
                    <AudioLines aria-hidden="true" size={15} />
                    <span>当前输入方式：麦克风未连接，</span>
                    <PracticeMicrophoneRetryButton
                      isConnecting={false}
                      onRetry={() => reconnectMicrophone()}
                    />
                  </span>
                ) : null
              ) : (
                <span className="song-practice-current-input is-listening" role="status">
                  <AudioLines aria-hidden="true" size={15} />
                  <span>当前输入方式：麦克风</span>
                  <progress
                    aria-label="麦克风输入电平"
                    className="song-practice-mic-level"
                    max={1}
                    value={Math.max(0, Math.min(1, microphone.inputLevel))}
                  />
                </span>
              )}
            </div>
          </header>

          <div className="song-practice-status" aria-live="polite" role="status">
            <span className={`song-practice-feedback${feedback ? ` is-${feedback.type}` : ""}`}>
              {feedbackText}
            </span>
            {chaseStatusText ? <span className="song-chase-status">{chaseStatusText}</span> : null}
          </div>

          <div
            className={`song-practice-prompt-wrap${
              arrangement.trackMode === "mixed" ? " is-grand-staff" : ""
            }`}
          >
            {targetNotes.length > 0 ? (
              <StaffPagePrompt
                barlineAfterNoteIndices={barlineAfterNoteIndices}
                completedCount={Math.max(0, Math.min(targetNotes.length, currentIndex))}
                breakBeamsAtStaffChange={arrangement.trackMode === "mixed"}
                lyrics={scoreLyrics}
                noteMeasures={scoreMeasures}
                noteOnsets={scoreOnsets}
                beatsPerMeasure={selection.score.meter.quarterBeatsPerMeasure}
                followRowIndex={followRowIndex}
                isFiniteScore
                trackedNoteIndex={currentIndex}
                onTrackedNoteVisibilityChange={handleCurrentTargetVisibilityChange}
                maxRowCount={scoreRowCount}
                noteDuration="quarter"
                noteDurations={scoreDurations}
                staffNoteDurations={scoreStaffNoteDurations}
                notes={targetNotes}
                noteGroups={targetNoteGroups}
                notesPerRow={NOTES_PER_ROW}
                useInvisibleGapRests
                onToggleRowPlayback={toggleRowPlayback}
                playingRowIndex={playingRowIndex}
                playbackCursor={playbackCursor}
                chaseCursor={scoreChaseCursor}
                getAudioTime={getAudioTime}
                playbackProgressIndex={
                  playingRowIndex !== null && playingNoteIndex !== null
                    ? (scorePlaybackRows[playingRowIndex]?.[playingNoteIndex]?.eventIndex ?? null)
                    : null
                }
                staffNotationMode={staffNotationMode(arrangement.trackMode)}
                layout={
                  arrangement.trackMode === "mixed"
                    ? MIXED_STAFF_LAYOUT
                    : SONG_PRACTICE_STAFF_LAYOUT
                }
                useLedgerGap={false}
                visibleRowCount={scoreRowCount}
                wrongIndex={feedback?.type === "wrong" ? currentIndex : undefined}
              />
            ) : (
              <div className="song-practice-finished" role="status">
                <Check aria-hidden="true" size={34} />
                <strong>这首曲子的谱面已经弹完</strong>
                <span>返回配置可以更换歌曲或练习设置。</span>
              </div>
            )}
          </div>
        </section>
      </div>
      {!isFinished && hasStarted && currentTarget && !isCurrentTargetVisible ? (
        <ReturnToCurrentNoteButton getTarget={getCurrentNoteTarget} />
      ) : null}
      <PracticeChaseSettingsDialog
        isMidiConnected={midi.isConnected}
        isOpen={isChaseSettingsOpen}
        settings={{
          enabled: songPreferences.chaseEnabled,
          handMode: activeHandMode,
          speedMultiplier: songPreferences.chaseSpeedMultiplier,
          startCount: songPreferences.chaseStartCount,
        }}
        onClose={() => setIsChaseSettingsOpen(false)}
        onSave={saveChaseSettings}
      />
      {isQuestionLimitReached ? (
        <PracticeQuestionLimitDialog
          onEnd={() => {
            cancelRowPlayback();
            stopMicrophone();
            setIsQuestionLimitReached(false);
            questionLimitReachedRef.current = false;
            onBack();
          }}
        />
      ) : null}
    </section>
  );
}
