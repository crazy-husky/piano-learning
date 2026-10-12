import { ArrowLeft, Check, Mic, Music2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PracticeAnswerInput } from "../../../domain/answerInput";
import type {
  Octave,
  PianoKeyName,
  PitchId,
  TargetNote,
  TargetNoteId,
} from "../../../domain/types";
import type { MidiInputController } from "../../../midi/useMidiInput";
import {
  NATURAL_PIANO_KEYS,
  PianoKeyboard,
  isNaturalPianoKey,
} from "../../../shared/components/PianoKeyboard";
import type { PracticeMicrophoneStatus } from "../../vocal-pitch/logic/usePracticeMicrophoneInput";
import { StaffPagePrompt } from "../components/StaffPagePrompt";
import { useSongRowPlayback, type SongRowPlaybackNote } from "./useSongRowPlayback";
import type {
  SongPracticeDuration,
  SongPracticeSelection,
  SongPracticeTrackMode,
} from "./songPracticeMaterials";
import { PRACTICE_PAGE_STAFF_LAYOUT } from "../../../shared/staff/staffLayoutProfiles";

const MIXED_STAFF_LAYOUT = {
  ...PRACTICE_PAGE_STAFF_LAYOUT,
  vertical: { ...PRACTICE_PAGE_STAFF_LAYOUT.vertical, gapPx: 112 },
};

const NOTES_PER_PAGE = 24;
const NOTES_PER_ROW = 12;
// Measure 10 is where the supplied score moves from the instrumental intro into the sung section.
const MAIN_SONG_START_MEASURE = 10;

interface SongPracticeMicrophone {
  error: string | null;
  isListening: boolean;
  start: () => Promise<boolean>;
  status: PracticeMicrophoneStatus;
  stop: () => void;
}

interface SongPracticeViewProps {
  midi: MidiInputController;
  microphone: SongPracticeMicrophone;
  onBack: () => void;
  onRegisterMicrophoneAnswer: (handler: (answer: PracticeAnswerInput) => void) => void;
  selection: SongPracticeSelection;
}

interface AnswerFeedback {
  noteName: PianoKeyName;
  octave: number;
  type: "correct" | "wrong";
}

function resolveTargetNote(note: SongPracticeSelection["notes"][number]): TargetNote {
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
    id: `${pitchId}-treble` as TargetNoteId,
    pitchId,
    noteName: note.noteName,
    octave: note.octave as Octave,
    groupId,
    staff: note.staff,
    isInterStaffLedgerSpelling: false,
  };
}

function resolveStaffDuration(duration: SongPracticeDuration): SongPracticeDuration {
  return duration;
}

function durationInQuarterBeats(duration: SongPracticeDuration): number {
  switch (duration) {
    case "whole":
      return 4;
    case "dotted-whole":
      return 6;
    case "half":
      return 2;
    case "dotted-half":
      return 3;
    case "quarter":
      return 1;
    case "dotted-quarter":
      return 1.5;
    case "eighth":
      return 0.5;
    case "dotted-eighth":
      return 0.75;
    case "sixteenth":
      return 0.25;
    case "dotted-sixteenth":
      return 0.375;
  }
}

function sourceLabel(mode: SongPracticeSelection["inputMode"]): string {
  if (mode === "midi") return "MIDI 键盘";
  if (mode === "microphone") return "麦克风";
  return "虚拟键盘";
}

function staffNotationMode(
  trackMode: SongPracticeTrackMode
): "treble-only" | "bass-only" | "grand" {
  if (trackMode === "bass") return "bass-only";
  if (trackMode === "mixed") return "grand";
  return "treble-only";
}

export function SongPracticeView({
  midi,
  microphone,
  onBack,
  onRegisterMicrophoneAnswer,
  selection,
}: SongPracticeViewProps): JSX.Element {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(true);
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [pageInputValue, setPageInputValue] = useState("1");
  const answerLockedRef = useRef(false);
  const feedbackTimerRef = useRef<number | undefined>(undefined);
  const microphoneSubmitRef = useRef<(noteName: PianoKeyName, octave: number) => void>(() => {});
  const playbackRowRef = useRef<number | null>(null);
  const ignoreMicrophoneUntilRef = useRef(0);
  const {
    cancel: cancelRowPlayback,
    playingRowIndex,
    toggleRow: toggleSongRow,
  } = useSongRowPlayback();
  const microphoneError = microphone.error;
  const microphoneIsListening = microphone.isListening;
  const microphoneStart = microphone.start;
  const stopMicrophone = microphone.stop;
  const targetNotes = useMemo(() => selection.notes.map(resolveTargetNote), [selection.notes]);
  const currentNote = selection.notes[currentIndex];
  const isFinished = hasStarted && currentIndex >= selection.notes.length;
  const mainSongStartIndex = useMemo(
    () => selection.notes.findIndex((note) => note.measure >= MAIN_SONG_START_MEASURE),
    [selection.notes]
  );
  const pageStarts = useMemo(() => {
    if (selection.notes.length === 0) return [0];
    const boundaries =
      mainSongStartIndex > 0 && mainSongStartIndex < selection.notes.length
        ? [0, mainSongStartIndex, selection.notes.length]
        : [0, selection.notes.length];
    const starts: number[] = [];
    for (let segmentIndex = 0; segmentIndex < boundaries.length - 1; segmentIndex += 1) {
      const segmentStart = boundaries[segmentIndex];
      const segmentEnd = boundaries[segmentIndex + 1];
      for (let start = segmentStart; start < segmentEnd; start += NOTES_PER_PAGE) {
        starts.push(start);
      }
    }
    return starts.length > 0 ? starts : [0];
  }, [mainSongStartIndex, selection.notes.length]);
  const activeNoteIndex = Math.min(currentIndex, Math.max(0, selection.notes.length - 1));
  const pageIndex = Math.max(
    0,
    pageStarts.reduce(
      (lastPageIndex, start, index) => (start <= activeNoteIndex ? index : lastPageIndex),
      0
    )
  );
  const pageStartIndex = pageStarts[pageIndex] ?? 0;
  const pageEndIndex = pageStarts[pageIndex + 1] ?? selection.notes.length;
  const pageNotes = targetNotes.slice(pageStartIndex, pageEndIndex);
  const pageMeasures = useMemo(
    () => selection.notes.slice(pageStartIndex, pageEndIndex).map((note) => note.measure),
    [pageEndIndex, pageStartIndex, selection.notes]
  );
  const pageOnsets = useMemo(
    () => selection.notes.slice(pageStartIndex, pageEndIndex).map((note) => note.onset),
    [pageEndIndex, pageStartIndex, selection.notes]
  );
  const pageDurations = useMemo(
    () =>
      selection.notes
        .slice(pageStartIndex, pageEndIndex)
        .map((note) => resolveStaffDuration(note.duration)),
    [pageEndIndex, pageStartIndex, selection.notes]
  );
  const pageLyrics = useMemo(
    () => selection.notes.slice(pageStartIndex, pageEndIndex).map((note) => note.lyrics ?? []),
    [pageEndIndex, pageStartIndex, selection.notes]
  );
  const pagePlaybackRows = useMemo(() => {
    const pageSourceNotes = selection.notes.slice(pageStartIndex, pageEndIndex);
    const rows: SongRowPlaybackNote[][] = [];
    for (let rowStart = 0; rowStart < pageSourceNotes.length; rowStart += NOTES_PER_ROW) {
      const row = pageSourceNotes.slice(rowStart, rowStart + NOTES_PER_ROW);
      const firstMeasure = row[0]?.measure ?? 1;
      rows.push(
        row.map((note, index) => ({
          durationBeats: durationInQuarterBeats(note.duration),
          note: targetNotes[pageStartIndex + rowStart + index],
          startBeat: (note.measure - firstMeasure) * 4 + note.onset * 4,
        }))
      );
    }
    return rows;
  }, [pageEndIndex, pageStartIndex, selection.notes, targetNotes]);
  const barlineAfterNoteIndices = useMemo(() => {
    const pageSourceNotes = selection.notes.slice(pageStartIndex, pageEndIndex);
    return pageSourceNotes.flatMap((note, index) =>
      pageSourceNotes[index + 1] && pageSourceNotes[index + 1].measure !== note.measure
        ? [index]
        : []
    );
  }, [pageEndIndex, pageStartIndex, selection.notes]);
  const currentPageNumber = pageIndex + 1;
  const totalPages = pageStarts.length;
  const mainSongPageIndex = mainSongStartIndex >= 0 ? pageStarts.indexOf(mainSongStartIndex) : -1;
  const keyboardOctave = currentNote?.octave ?? selection.notes.at(-1)?.octave ?? 4;
  const subscribeMidi = midi.subscribe;

  const clearFeedbackTimer = useCallback((): void => {
    if (feedbackTimerRef.current !== undefined) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = undefined;
    }
  }, []);

  const submitPitch = useCallback(
    (noteName: PianoKeyName, octave: number): void => {
      if (!hasStarted || !currentNote || answerLockedRef.current) return;
      answerLockedRef.current = true;
      const correct =
        isNaturalPianoKey(noteName) &&
        noteName === currentNote.noteName &&
        octave === currentNote.octave;
      setFeedback({ noteName, octave, type: correct ? "correct" : "wrong" });
      clearFeedbackTimer();
      feedbackTimerRef.current = window.setTimeout(
        () => {
          if (correct) setCurrentIndex((index) => index + 1);
          answerLockedRef.current = false;
          feedbackTimerRef.current = undefined;
          setFeedback(null);
        },
        correct ? 160 : 360
      );
    },
    [clearFeedbackTimer, currentNote, hasStarted]
  );
  const handleMicrophoneAnswer = useCallback((answer: PracticeAnswerInput): void => {
    if (playbackRowRef.current !== null || Date.now() < ignoreMicrophoneUntilRef.current) {
      return;
    }
    if (answer.octave !== undefined) microphoneSubmitRef.current(answer.noteName, answer.octave);
  }, []);
  useEffect(() => {
    onRegisterMicrophoneAnswer(handleMicrophoneAnswer);
    return () => onRegisterMicrophoneAnswer(() => undefined);
  }, [handleMicrophoneAnswer, onRegisterMicrophoneAnswer]);

  useEffect(() => {
    setPageInputValue(String(currentPageNumber));
  }, [currentPageNumber]);

  const toggleRowPlayback = useCallback(
    (rowIndex: number): void => {
      if (playbackRowRef.current === rowIndex) {
        playbackRowRef.current = null;
        ignoreMicrophoneUntilRef.current = Date.now() + 400;
      } else {
        playbackRowRef.current = rowIndex;
        ignoreMicrophoneUntilRef.current = Number.POSITIVE_INFINITY;
      }
      toggleSongRow(rowIndex, pagePlaybackRows[rowIndex] ?? []);
    },
    [pagePlaybackRows, toggleSongRow]
  );

  useEffect(() => {
    if (playingRowIndex === null && playbackRowRef.current !== null) {
      playbackRowRef.current = null;
      ignoreMicrophoneUntilRef.current = Date.now() + 400;
    }
  }, [playingRowIndex]);

  useEffect(() => {
    return () => {
      cancelRowPlayback();
      if (playbackRowRef.current !== null) {
        playbackRowRef.current = null;
        ignoreMicrophoneUntilRef.current = Date.now() + 400;
      }
    };
  }, [cancelRowPlayback, pageIndex]);

  microphoneSubmitRef.current = submitPitch;

  useEffect(() => {
    if (selection.inputMode !== "midi") return undefined;
    return subscribeMidi((event) => {
      if (event.type === "press") submitPitch(event.note.keyName, event.note.octave);
    });
  }, [selection.inputMode, subscribeMidi, submitPitch]);

  useEffect(
    () => () => {
      clearFeedbackTimer();
      if (selection.inputMode === "microphone") stopMicrophone();
      answerLockedRef.current = false;
    },
    [clearFeedbackTimer, selection.inputMode, stopMicrophone]
  );

  useEffect(() => {
    if (isFinished && selection.inputMode === "microphone") stopMicrophone();
  }, [isFinished, selection.inputMode, stopMicrophone]);

  const startPractice = async (): Promise<void> => {
    setStartError(null);
    if (selection.inputMode === "microphone" && !microphoneIsListening) {
      const started = await microphoneStart();
      if (!started) {
        setStartError(microphoneError ?? "麦克风未能启动，请检查权限后重试。");
        setHasStarted(false);
        return;
      }
    }
    answerLockedRef.current = false;
    setFeedback(null);
    setHasStarted(true);
  };

  const goToPage = useCallback(
    async (targetPageIndex: number): Promise<void> => {
      const nextPageIndex = Math.max(0, Math.min(totalPages - 1, targetPageIndex));
      const nextStartIndex = pageStarts[nextPageIndex] ?? 0;
      if (selection.inputMode === "microphone" && !microphoneIsListening) {
        const started = await microphoneStart();
        if (!started) {
          setStartError(microphoneError ?? "麦克风未能启动，请检查权限后重试。");
          setHasStarted(false);
          return;
        }
        setHasStarted(true);
      }
      clearFeedbackTimer();
      answerLockedRef.current = false;
      setFeedback(null);
      setStartError(null);
      setCurrentIndex(nextStartIndex);
    },
    [
      clearFeedbackTimer,
      microphoneError,
      microphoneIsListening,
      microphoneStart,
      pageStarts,
      selection.inputMode,
      totalPages,
    ]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement)
      ) {
        return;
      }
      if (event.key === "ArrowLeft" && pageIndex > 0) {
        event.preventDefault();
        void goToPage(pageIndex - 1);
      } else if (event.key === "ArrowRight" && pageIndex < totalPages - 1) {
        event.preventDefault();
        void goToPage(pageIndex + 1);
      } else if (event.key.toLowerCase() === "m" && mainSongPageIndex >= 0) {
        event.preventDefault();
        void goToPage(mainSongPageIndex);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToPage, mainSongPageIndex, pageIndex, totalPages]);

  const restart = async (): Promise<void> => {
    cancelRowPlayback();
    playbackRowRef.current = null;
    ignoreMicrophoneUntilRef.current = Date.now() + 400;
    clearFeedbackTimer();
    answerLockedRef.current = false;
    setCurrentIndex(0);
    setFeedback(null);
    setStartError(null);
    if (selection.inputMode === "microphone") {
      stopMicrophone();
      const started = await microphoneStart();
      if (!started) {
        setHasStarted(false);
        setStartError("麦克风未能启动，请检查权限后重试。");
        return;
      }
    }
    setHasStarted(true);
  };

  const feedbackText = isFinished
    ? "整首练习完成了，可以重新开始。"
    : feedback?.type === "correct"
      ? "正确，继续看下一个音。"
      : feedback?.type === "wrong"
        ? `刚才弹的是 ${feedback.noteName}${feedback.octave}，看准当前音再试一次。`
        : !hasStarted
          ? "练习暂时停止，请检查输入设备后重试。"
          : selection.inputMode === "microphone" && microphoneIsListening
            ? "麦克风已就绪，按谱弹奏当前单音。"
            : "看谱弹奏当前单音；弹对后会自动前进。";

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
            <div>
              <span className="song-practice-eyebrow">
                <Music2 aria-hidden="true" size={15} /> 歌曲 · {sourceLabel(selection.inputMode)}
              </span>
              <h1>{selection.scoreTitle}</h1>
              <p>{selection.partName} · C 调自然音单音 · 前奏与正歌分开分页</p>
            </div>
            <span className="song-practice-key-badge">C 调</span>
          </header>

          <div className="song-practice-prompt-wrap">
            <div className="song-practice-status" aria-live="polite" role="status">
              <span className={`song-practice-feedback${feedback ? ` is-${feedback.type}` : ""}`}>
                {feedbackText}
              </span>
              {selection.inputMode === "midi" ? (
                <span>
                  {midi.isConnected
                    ? `MIDI 已连接：${midi.selectedInput?.name ?? "设备"}`
                    : "MIDI 连接已断开"}
                </span>
              ) : null}
              {selection.inputMode === "microphone" && microphone.status === "listening" ? (
                <span>
                  <Mic aria-hidden="true" size={14} /> 麦克风正在监听
                </span>
              ) : null}
              {startError ? <span className="song-practice-error">{startError}</span> : null}
              {selection.inputMode === "microphone" && microphoneError ? (
                <span className="song-practice-error">{microphoneError}</span>
              ) : null}
            </div>
            {pageNotes.length > 0 ? (
              <StaffPagePrompt
                barlineAfterNoteIndices={barlineAfterNoteIndices}
                completedCount={Math.max(
                  0,
                  Math.min(pageNotes.length, currentIndex - pageStartIndex)
                )}
                breakBeamsAtStaffChange={selection.trackMode === "mixed"}
                lyrics={pageLyrics}
                noteMeasures={pageMeasures}
                noteOnsets={pageOnsets}
                maxRowCount={2}
                noteDuration="quarter"
                noteDurations={pageDurations}
                notes={pageNotes}
                notesPerRow={NOTES_PER_ROW}
                onToggleRowPlayback={toggleRowPlayback}
                playingRowIndex={playingRowIndex}
                staffNotationMode={staffNotationMode(selection.trackMode)}
                layout={selection.trackMode === "mixed" ? MIXED_STAFF_LAYOUT : undefined}
                useLedgerGap={false}
                visibleRowCount={2}
                wrongIndex={feedback?.type === "wrong" ? currentIndex - pageStartIndex : undefined}
              />
            ) : (
              <div className="song-practice-finished" role="status">
                <Check aria-hidden="true" size={34} />
                <strong>这首曲子的谱面已经弹完</strong>
                <span>可以再练一次，或返回歌曲列表。</span>
              </div>
            )}
          </div>

          {currentNote && selection.inputMode === "virtual" ? (
            <>
              <PianoKeyboard
                ariaLabel={`虚拟键盘，从 C${keyboardOctave} 到 C${keyboardOctave + 1}`}
                className="practice-piano-keyboard song-practice-keyboard"
                enabledKeys={NATURAL_PIANO_KEYS}
                feedback={
                  feedback ? { keyName: feedback.noteName, type: feedback.type } : undefined
                }
                includeUpperC
                keyOctave={keyboardOctave}
                onKeyPress={(key) => {
                  if (isNaturalPianoKey(key.keyName)) {
                    submitPitch(key.keyName, keyboardOctave + key.octaveOffset);
                  }
                }}
                scale={0.76}
                touchLabels
              />
              <p className="song-practice-keyboard-range">
                屏幕琴键：C{keyboardOctave}–C{keyboardOctave + 1}
              </p>
            </>
          ) : null}

          <div className="song-practice-actions">
            {!hasStarted || isFinished ? (
              <button
                className="primary"
                type="button"
                onClick={() => void (isFinished ? restart() : startPractice())}
              >
                {isFinished ? <RotateCcw aria-hidden="true" size={16} /> : null}
                {isFinished ? "重新练习" : "重试输入"}
              </button>
            ) : null}
            {hasStarted && !isFinished ? (
              <button
                className="song-practice-restart"
                type="button"
                onClick={() => void restart()}
              >
                <RotateCcw aria-hidden="true" size={15} />
                从头开始
              </button>
            ) : null}
            {currentNote ? (
              <span>
                当前目标：{currentNote.noteName}
                {currentNote.octave}
              </span>
            ) : null}
          </div>

          <nav className="song-page-navigation" aria-label="乐谱分页">
            <button
              aria-label="上一页"
              disabled={pageIndex <= 0}
              type="button"
              onClick={() => void goToPage(pageIndex - 1)}
            >
              上一页
            </button>
            <form
              className="song-page-jump"
              onSubmit={(event) => {
                event.preventDefault();
                const requestedPage = Number(pageInputValue);
                if (Number.isFinite(requestedPage)) {
                  const clampedPage = Math.max(1, Math.min(totalPages, Math.trunc(requestedPage)));
                  setPageInputValue(String(clampedPage));
                  void goToPage(clampedPage - 1);
                }
              }}
            >
              <label className="sr-only" htmlFor="song-page-number">
                跳转到第几页
              </label>
              <input
                id="song-page-number"
                max={totalPages}
                min={1}
                type="number"
                value={pageInputValue}
                onChange={(event) => setPageInputValue(event.target.value)}
              />
              <span>/ {totalPages}</span>
              <button type="submit">跳转</button>
            </form>
            <button
              aria-label="下一页"
              disabled={pageIndex >= totalPages - 1}
              type="button"
              onClick={() => void goToPage(pageIndex + 1)}
            >
              下一页
            </button>
            {mainSongPageIndex >= 0 ? (
              <button
                aria-keyshortcuts="M"
                className="song-main-section-jump"
                type="button"
                onClick={() => void goToPage(mainSongPageIndex)}
              >
                正歌
              </button>
            ) : null}
            <span className="song-page-shortcuts">← / → 翻页 · M 正歌</span>
          </nav>
        </section>
      </div>
    </section>
  );
}
