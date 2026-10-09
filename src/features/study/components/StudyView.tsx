import { useCallback, useEffect, useMemo, useState } from "react";
import { getNotesForGroups } from "../../../domain/notes";
import {
  buildNoteNameColumns,
  NOTE_NAME_COLUMNS,
  type NoteNameColumnDefinition,
} from "../../../domain/staffRecall";
import type { AppSettings, StaffRecallRunRecord } from "../../../domain/types";
import { GlobalRangeControls } from "../../../shared/components/GlobalRangeControls";
import {
  StudyDisplayControls,
  STUDY_COLUMN_ORDER_OPTIONS,
  type StudyColumnOrderId,
} from "./StudyDisplayControls";
import {
  getUniqueStudyPitches,
  type StudyPlaybackMode,
} from "../logic/studyListeningSelfCheck";
import { StaffRecallView } from "../../staff-recall/components/StaffRecallView";
import { useStudyPlayback } from "../hooks/useStudyPlayback";
import { StudyNoteMap } from "./StudyNoteMap";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";
import { useDelayedBusy } from "../../../shared/hooks/useDelayedBusy";

type FixedStudyColumnOrderId = Exclude<StudyColumnOrderId, "random">;
interface StudyUiPreferences {
  columnOrderId: StudyColumnOrderId;
  isColumnOrderReversed: boolean;
  playbackMode: StudyPlaybackMode;
  showLabels: boolean;
}

const STUDY_UI_PREFERENCES_KEY = "anki-note.studyUiPreferences";
const FIXED_STUDY_COLUMN_ANSWER_NUMBERS: Record<FixedStudyColumnOrderId, readonly string[]> = {
  circle: ["4", "1", "5", "2", "6", "3", "7"],
  scale: ["1", "2", "3", "4", "5", "6", "7"],
  thirds: ["1", "3", "5", "7", "2", "4", "6"],
};
const DEFAULT_STUDY_UI_PREFERENCES: StudyUiPreferences = {
  columnOrderId: "circle",
  isColumnOrderReversed: false,
  playbackMode: "octaves",
  showLabels: true,
};

interface StudyMapContentProps {
  settings: AppSettings;
}

export interface StaffRecallStartPreflightResult {
  proceed: boolean;
}

interface StudyViewProps {
  onBeforeStaffRecallStart: () => Promise<StaffRecallStartPreflightResult>;
  onDataChanged: () => void | Promise<void>;
  onStaffRecallFinished?: () => void;
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
  settings: AppSettings;
  staffRecallRuns: StaffRecallRunRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStudyColumnOrderId(value: unknown): value is StudyColumnOrderId {
  return (
    typeof value === "string" &&
    STUDY_COLUMN_ORDER_OPTIONS.some((option) => option.id === value)
  );
}

function isStudyPlaybackMode(value: unknown): value is StudyPlaybackMode {
  return value === "single" || value === "octaves";
}

function parseStudyUiPreferences(value: unknown, fallback: StudyUiPreferences): StudyUiPreferences {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    columnOrderId: isStudyColumnOrderId(value.columnOrderId) ? value.columnOrderId : fallback.columnOrderId,
    isColumnOrderReversed:
      typeof value.isColumnOrderReversed === "boolean"
        ? value.isColumnOrderReversed
        : fallback.isColumnOrderReversed,
    playbackMode: isStudyPlaybackMode(value.playbackMode) ? value.playbackMode : fallback.playbackMode,
    showLabels: typeof value.showLabels === "boolean" ? value.showLabels : fallback.showLabels,
  };
}

function shuffleStudyAnswerNumbers(): string[] {
  const answerNumbers = NOTE_NAME_COLUMNS.map((column) => column.answerNumber);
  for (let index = answerNumbers.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [answerNumbers[index], answerNumbers[swapIndex]] = [answerNumbers[swapIndex], answerNumbers[index]];
  }
  return answerNumbers;
}

function getStudyColumnDefinitions(
  orderId: StudyColumnOrderId,
  isReversed: boolean,
  randomAnswerNumbers: readonly string[],
): NoteNameColumnDefinition[] {
  const answerNumbers = orderId === "random" ? randomAnswerNumbers : FIXED_STUDY_COLUMN_ANSWER_NUMBERS[orderId];
  const orderedAnswerNumbers = isReversed ? [...answerNumbers].reverse() : answerNumbers;
  return orderedAnswerNumbers.map((answerNumber) => {
    const column = NOTE_NAME_COLUMNS.find((candidate) => candidate.answerNumber === answerNumber);
    if (!column) {
      throw new Error(`Unknown study column number: ${answerNumber}`);
    }
    return column;
  });
}

function StudyMapContent({ settings }: StudyMapContentProps): JSX.Element {
  const [studyUiPreferences, setStudyUiPreferences] = useLocalStorageState(
    STUDY_UI_PREFERENCES_KEY,
    DEFAULT_STUDY_UI_PREFERENCES,
    { parse: parseStudyUiPreferences },
  );
  const [randomAnswerNumbers, setRandomAnswerNumbers] = useState(() => shuffleStudyAnswerNumbers());
  const columnOrderId = studyUiPreferences.columnOrderId;
  const isColumnOrderReversed = studyUiPreferences.isColumnOrderReversed;
  const playbackMode = studyUiPreferences.playbackMode;
  const showLabels = studyUiPreferences.showLabels;
  const setColumnOrderId = (nextColumnOrderId: StudyColumnOrderId): void => {
    if (nextColumnOrderId === "random") {
      setRandomAnswerNumbers(shuffleStudyAnswerNumbers());
    }
    setStudyUiPreferences((current) => ({ ...current, columnOrderId: nextColumnOrderId }));
  };
  const setIsColumnOrderReversed = (nextIsColumnOrderReversed: boolean): void => {
    setStudyUiPreferences((current) => ({ ...current, isColumnOrderReversed: nextIsColumnOrderReversed }));
  };
  const setPlaybackMode = (nextPlaybackMode: StudyPlaybackMode): void => {
    setStudyUiPreferences((current) => ({ ...current, playbackMode: nextPlaybackMode }));
  };
  const setShowLabels = (nextShowLabels: boolean): void => {
    setStudyUiPreferences((current) => ({ ...current, showLabels: nextShowLabels }));
  };
  const columnDefinitions = useMemo(
    () => getStudyColumnDefinitions(columnOrderId, isColumnOrderReversed, randomAnswerNumbers),
    [columnOrderId, isColumnOrderReversed, randomAnswerNumbers],
  );
  const staffNotationMode = settings.staffNotationMode;
  const studyNotes = useMemo(
    () => getNotesForGroups(settings.enabledGroupIds, settings.includeInterStaffLedgerSpellings, staffNotationMode),
    [settings.enabledGroupIds, settings.includeInterStaffLedgerSpellings, staffNotationMode],
  );
  const studyPitches = useMemo(() => getUniqueStudyPitches(studyNotes), [studyNotes]);
  const columns = useMemo(() => buildNoteNameColumns(studyNotes, columnDefinitions), [columnDefinitions, studyNotes]);
  const showInterStaffLedger = studyNotes.some((note) => note.isInterStaffLedgerSpelling);

  const {
    highlightedNoteId,
    highlightedNoteNames,
    listeningSelfCheckStarted,
    playColumn,
    playNote,
  } = useStudyPlayback({ columns, playbackMode, studyPitches });

  return (
    <>
      <StudyDisplayControls
        columnOrderId={columnOrderId}
        isColumnOrderReversed={isColumnOrderReversed}
        label="学习页设置"
        onColumnOrderChange={setColumnOrderId}
        onColumnOrderReversedChange={setIsColumnOrderReversed}
        onShowLabelsChange={setShowLabels}
        showLabels={showLabels}
      />
      <div className="study-playback-row">
        <div className="study-control-block">
          <span className="control-label">按键播放</span>
          <div className="segmented study-playback-options">
            <button
              className={playbackMode === "single" ? "active" : ""}
              onClick={() => setPlaybackMode("single")}
              type="button"
            >
              单音
            </button>
            <button
              className={playbackMode === "octaves" ? "active" : ""}
              onClick={() => setPlaybackMode("octaves")}
              type="button"
            >
              八度
            </button>
          </div>
        </div>
        <p aria-live="polite" className="study-listening-hint">
          {listeningSelfCheckStarted ? (
            <>
              按<kbd>0</kbd>听音，按其它键作答。未作答/答对后会换音
            </>
          ) : (
            <>
              按 <kbd>0</kbd> 开始听音自测
            </>
          )}
        </p>
      </div>
      <div className="study-map-frame" aria-label="学习页音位图">
        <figure className="study-figure">
          {studyNotes.length > 0 ? (
            <StudyNoteMap
              columns={columns}
              highlightedNoteId={highlightedNoteId}
              highlightedNoteNames={highlightedNoteNames}
              label="F1-G6 音符位置"
              onPlayColumn={playColumn}
              onPlayNote={playNote}
              showLabels={showLabels}
              staffNotationMode={staffNotationMode}
              useLedgerGap={showInterStaffLedger}
            />
          ) : (
            <div className="staff-notation-empty">
              请选择至少一个音域组
            </div>
          )}
        </figure>
      </div>
    </>
  );
}

export function StudyView({
  onBeforeStaffRecallStart,
  onDataChanged,
  onSettingsSaved,
  onStaffRecallFinished,
  settings,
  staffRecallRuns,
}: StudyViewProps): JSX.Element {
  const [mode, setMode] = useState<"study" | "staff-recall">("study");
  const { isBusyVisible: showEnteringStaffRecallStatus, run: runStaffRecallEntry } = useDelayedBusy();
  const [staffRecallRangeLocked, setStaffRecallRangeLocked] = useState(false);

  const enterStaffRecall = useCallback(async (): Promise<void> => {
    if (mode === "staff-recall") {
      return;
    }
    await runStaffRecallEntry(async () => {
      const result = await onBeforeStaffRecallStart();
      if (result.proceed) {
        setMode("staff-recall");
      }
    });
  }, [mode, onBeforeStaffRecallStart, runStaffRecallEntry]);

  const enterStudy = useCallback((): void => {
    setStaffRecallRangeLocked(false);
    setMode("study");
  }, []);

  useEffect(() => {
    if (mode !== "staff-recall") {
      return;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        enterStudy();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enterStudy, mode]);

  return (
    <section className="study-shell">
      <GlobalRangeControls
        disabled={mode === "staff-recall" && staffRecallRangeLocked}
        settings={settings}
        onSettingsSaved={onSettingsSaved}
      />
      <div className="study-header">
        <h1 className="sr-only">学习</h1>
        <div className="segmented study-mode-options" aria-label="学习模式">
          <button
            aria-keyshortcuts={mode === "staff-recall" ? "Escape" : undefined}
            className={mode === "study" ? "active" : ""}
            onClick={enterStudy}
            type="button"
          >
            学习
            {mode === "staff-recall" ? <kbd>Esc</kbd> : null}
          </button>
          <button
            className={mode === "staff-recall" ? "active" : ""}
            disabled={showEnteringStaffRecallStatus}
            onClick={() => void enterStaffRecall()}
            type="button"
          >
            {showEnteringStaffRecallStatus ? "检查中" : "默写"}
          </button>
        </div>
        {mode === "staff-recall" && staffRecallRangeLocked ? (
          <span className="study-range-lock-hint">完成本轮或切回学习后可调整音域</span>
        ) : null}
      </div>
      {mode === "study" ? (
        <StudyMapContent settings={settings} />
      ) : (
        <StaffRecallView
          onDataChanged={onDataChanged}
          onFinished={onStaffRecallFinished}
          onRangeLockedChange={setStaffRecallRangeLocked}
          runs={staffRecallRuns}
          settings={settings}
        />
      )}
    </section>
  );
}
