import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerEvent } from "../../../domain/types";
import { saveAnswerEvents } from "../../../data/db";
import type { MidiInputController } from "../../../midi/useMidiInput";
import type {
  PracticeNavigationExitRequest,
  PracticeNavigationExitTarget,
} from "../../practice/components/PracticeView";
import {
  DEFAULT_CHORD_TRAINING_CONFIG,
  type ChordTask,
  type ChordTrainingConfig,
} from "../logic/chordTraining";
import {
  readChordTrainingConfig,
  writeChordTrainingConfig,
} from "../logic/chordTrainingPreferences";
import { ChordTrainingRun } from "./ChordTrainingRun";
import { ChordTrainingSetup } from "./ChordTrainingSetup";
import { ChordTrainingSummary } from "./ChordTrainingSummary";
import {
  isInteractiveShortcutTarget,
  shouldHandleGlobalEnter,
} from "../../../shared/keyboard/keyboardShortcuts";
import { guideSetupRequirement } from "../../../shared/utils/guideSetupRequirement";

interface ChordRunSummary {
  completed: boolean;
  elapsedMs: number;
  events: AnswerEvent[];
  saved: boolean;
  task: ChordTask;
  saveError?: string;
}

export function ChordTrainingView({
  dataSetId,
  midi,
  navigationExitRequest,
  onBeforePracticeStart,
  onDataChanged,
  onNavigationExit,
  onPracticeFinished,
  onPracticeStageChange,
  onRunningChange,
}: {
  dataSetId: string;
  midi: MidiInputController;
  navigationExitRequest?: PracticeNavigationExitRequest | null;
  onBeforePracticeStart: () => Promise<{ proceed: boolean; settings?: { dataSetId: string } }>;
  onDataChanged: () => Promise<void>;
  onNavigationExit?: (targetView: PracticeNavigationExitTarget) => void;
  onPracticeFinished: () => void;
  onPracticeStageChange: (active: boolean) => void;
  onRunningChange: (running: boolean) => void;
}): JSX.Element {
  const [config, setConfig] = useState<ChordTrainingConfig>(readChordTrainingConfig);
  const [activeDataSetId, setActiveDataSetId] = useState(dataSetId);
  const [runInstance, setRunInstance] = useState(0);
  const [activeConfig, setActiveConfig] = useState<ChordTrainingConfig>(
    DEFAULT_CHORD_TRAINING_CONFIG
  );
  const [stage, setStage] = useState<"setup" | "running" | "summary">("setup");
  const [summary, setSummary] = useState<ChordRunSummary | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const handledExitRequestIdRef = useRef<number | null>(null);

  useEffect(() => writeChordTrainingConfig(config), [config]);

  const startPractice = useCallback(async (): Promise<void> => {
    if (isStarting) return;
    if (config.practiceGroupIds.length === 0) {
      setStartError("请先选择练习音区。");
      guideSetupRequirement('[data-setup-guide-target="chord-practice-range"]');
      return;
    }
    if (config.task !== "recognize" && !midi.isConnected) {
      setStartError("请先连接 MIDI 键盘，再开始弹和弦练习。");
      guideSetupRequirement('[data-setup-guide-target="chord-midi-device"]');
      return;
    }
    setIsStarting(true);
    setStartError(null);
    try {
      const preflight = await onBeforePracticeStart();
      if (!preflight.proceed) return;
      setActiveDataSetId(preflight.settings?.dataSetId ?? dataSetId);
      setActiveConfig({
        ...config,
        practiceGroupIds: [...config.practiceGroupIds],
        chordDegrees: [...config.chordDegrees],
        qualities: [...config.qualities],
      });
      setSummary(null);
      setRunInstance((current) => current + 1);
      setStage("running");
      onPracticeStageChange(true);
      onRunningChange(true);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "开始练习前检查失败，请重试。");
    } finally {
      setIsStarting(false);
    }
  }, [
    config,
    dataSetId,
    isStarting,
    midi.isConnected,
    onBeforePracticeStart,
    onPracticeStageChange,
    onRunningChange,
  ]);

  useEffect(() => {
    if (stage !== "setup") return undefined;

    function onEnter(event: KeyboardEvent): void {
      if (!shouldHandleGlobalEnter(event, isInteractiveShortcutTarget(event.target))) return;
      event.preventDefault();
      void startPractice();
    }

    window.addEventListener("keydown", onEnter);
    return () => window.removeEventListener("keydown", onEnter);
  }, [stage, startPractice]);

  useEffect(() => {
    setStartError(null);
  }, [config, midi.isConnected]);

  const finishPractice = async (result: {
    completed: boolean;
    elapsedMs: number;
    events: AnswerEvent[];
  }): Promise<void> => {
    onRunningChange(false);
    onPracticeStageChange(false);
    let saved = false;
    let saveError: string | undefined;
    if (result.completed && result.events.length > 0) {
      try {
        await saveAnswerEvents(result.events);
        saved = true;
        await onDataChanged();
      } catch (error) {
        saveError = error instanceof Error ? error.message : "保存练习结果失败。";
      }
    }
    setSummary({ ...result, saved, task: activeConfig.task, ...(saveError ? { saveError } : {}) });
    setStage("summary");
    onPracticeFinished();
  };

  useEffect(() => {
    if (
      stage !== "running" ||
      !navigationExitRequest ||
      handledExitRequestIdRef.current === navigationExitRequest.id
    ) {
      return;
    }
    handledExitRequestIdRef.current = navigationExitRequest.id;
    onRunningChange(false);
    onPracticeStageChange(false);
    onNavigationExit?.(navigationExitRequest.targetView);
  }, [navigationExitRequest, onNavigationExit, onPracticeStageChange, onRunningChange, stage]);

  if (stage === "running") {
    return (
      <ChordTrainingRun
        key={runInstance}
        config={activeConfig}
        dataSetId={activeDataSetId}
        midi={midi}
        onExit={() => {
          onRunningChange(false);
          onPracticeStageChange(false);
          setSummary(null);
          setStage("setup");
        }}
        onFinish={(result) => void finishPractice(result)}
        onPauseChange={(paused) => onRunningChange(!paused)}
        onRestart={() => setRunInstance((current) => current + 1)}
      />
    );
  }

  if (stage === "summary" && summary) {
    return (
      <>
        <ChordTrainingSummary
          completed={summary.completed}
          elapsedMs={summary.elapsedMs}
          events={summary.events}
          saved={summary.saved}
          task={summary.task}
          onReturnToSetup={() => {
            setSummary(null);
            setStage("setup");
          }}
        />
        {summary.saveError ? (
          <p aria-live="polite" className="chord-training-save-error" role="alert">
            保存失败：{summary.saveError}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div className="chord-training-page">
      <ChordTrainingSetup
        config={config}
        midi={midi}
        isStarting={isStarting}
        startError={startError}
        onChange={setConfig}
        onStart={() => void startPractice()}
      />
    </div>
  );
}
