import { Check, Download, Mic, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { applyPracticeMicrophoneAnalysisGain } from "../../vocal-pitch/logic/practiceMicrophoneCapture";
import {
  PRACTICE_MICROPHONE_ANALYSIS_GAINS,
  practiceMicrophoneAlgorithmLabel,
  practiceMicrophoneDebugParametersForSensitivityLevel,
  practiceMicrophoneSensitivityLevelLabel,
  resolvePracticeMicrophoneConfiguration,
  type PracticeMicrophonePreferences,
} from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import {
  createMicrophoneBenchmarkConfigurations,
  createMicrophoneBenchmarkTargetSequence,
  detectMicrophoneBenchmarkOnsets,
  encodeMicrophoneBenchmarkWav,
  MICROPHONE_BENCHMARK_ALGORITHMS,
  MICROPHONE_BENCHMARK_CONFIDENCE_THRESHOLDS,
  MICROPHONE_BENCHMARK_FRAME_INTERVALS,
  MICROPHONE_BENCHMARK_RMS_THRESHOLDS,
  MICROPHONE_BENCHMARK_STABLE_DURATIONS,
  MICROPHONE_BENCHMARK_STABLE_FRAME_COUNTS,
  summarizeMicrophoneBenchmarkSignal,
  type MicrophoneBenchmarkAlgorithm,
  type MicrophoneBenchmarkConfiguration,
  type MicrophoneBenchmarkResult,
} from "../../vocal-pitch/logic/microphoneParameterBenchmark";
import { MicrophoneBenchmarkResultTable } from "./MicrophoneBenchmarkResultTable";
import { MicrophoneBenchmarkWaveform } from "./MicrophoneBenchmarkWaveform";
import {
  useMicrophoneParameterBenchmarkRecording,
  type MicrophoneParameterBenchmarkTake,
} from "./useMicrophoneParameterBenchmarkRecording";

interface MicrophoneParameterBenchmarkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: PracticeMicrophonePreferences;
}

interface BenchmarkEnvironment {
  browser: string;
  device: string;
  inputGain: (typeof PRACTICE_MICROPHONE_ANALYSIS_GAINS)[number];
  sampleRate: number;
  trackSampleRate: number | null;
  userAgent: string;
  sensitivityLevel: PracticeMicrophonePreferences["sensitivityLevel"];
  debugMode: boolean;
  fixedYinThreshold: number;
}

interface CompletedBenchmarkRecording {
  environment: BenchmarkEnvironment;
  markersMs: number[];
  signal: ReturnType<typeof summarizeMicrophoneBenchmarkSignal>;
  take: MicrophoneParameterBenchmarkTake;
}

type RecordingSlots = [CompletedBenchmarkRecording | null, CompletedBenchmarkRecording | null];
type RecordingIndex = 1 | 2;
interface ScanTask {
  algorithm: MicrophoneBenchmarkAlgorithm;
  recordingIndex: RecordingIndex;
}

type BenchmarkWorkerMessage =
  | { id: number; type: "preparing" }
  | { completed: number; id: number; progress: number; type: "progress" }
  | { id: number; results: MicrophoneBenchmarkResult[]; type: "complete" }
  | { error: string; id: number; type: "error" };

function detectBrowser(userAgent: string): string {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/FxiOS\//.test(userAgent)) return "Firefox iOS";
  if (/CriOS\//.test(userAgent)) return "Chrome iOS";
  if (/EdgiOS\//.test(userAgent)) return "Edge iOS";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Chrome\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "未知浏览器";
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function formatMidiNote(midi: number): string {
  const noteNames = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const noteName = noteNames[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${midi}(${noteName}${octave})`;
}

function formatElapsed(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)} 秒`;
}

function benchmarkAlgorithmLabel(algorithm: MicrophoneBenchmarkAlgorithm): string {
  return practiceMicrophoneAlgorithmLabel(algorithm);
}

function benchmarkResultKey(
  result: Pick<
    MicrophoneBenchmarkResult,
    | "algorithm"
    | "confidenceThreshold"
    | "frameIntervalMs"
    | "inputRmsThresholdId"
    | "recordingIndex"
    | "requiredStableFrames"
    | "requiredStableMs"
  >
): string {
  return [
    result.recordingIndex,
    result.algorithm,
    result.frameIntervalMs,
    result.confidenceThreshold,
    result.inputRmsThresholdId,
    result.requiredStableFrames,
    result.requiredStableMs,
  ].join("|");
}

function hasExpectedConfigurationRows(
  rows: readonly MicrophoneBenchmarkResult[],
  algorithm: MicrophoneBenchmarkAlgorithm,
  recordingIndex: RecordingIndex,
  configurations: readonly MicrophoneBenchmarkConfiguration[]
): boolean {
  const actualRows = rows.filter(
    (row) => row.algorithm === algorithm && row.recordingIndex === recordingIndex
  );
  if (actualRows.length !== configurations.length) return false;
  const actualKeys = new Set(actualRows.map(benchmarkResultKey));
  if (actualKeys.size !== configurations.length) return false;
  return configurations.every((configuration) =>
    actualKeys.has(benchmarkResultKey({ ...configuration, recordingIndex }))
  );
}

function audioFileExtension(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取录音文件。"));
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") {
        reject(new Error("无法编码录音文件。"));
        return;
      }
      const separator = dataUrl.indexOf(",");
      resolve(dataUrl.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function toggleSelection<T extends number | string>(
  values: T[],
  setValues: Dispatch<SetStateAction<T[]>>,
  value: T
): void {
  setValues((current) =>
    current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
  );
}

export function MicrophoneParameterBenchmarkDialog({
  isOpen,
  onClose,
  preferences,
}: MicrophoneParameterBenchmarkDialogProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);
  const recordingRunIdRef = useRef(0);
  const recordingTargetIndexRef = useRef<RecordingIndex>(1);
  const captureInputGainRef = useRef<(typeof PRACTICE_MICROPHONE_ANALYSIS_GAINS)[number]>(1);
  const scanTasksRef = useRef<ScanTask[]>([]);
  const scanTaskIndexRef = useRef(0);
  const scanCompletedBaseRef = useRef(0);
  const scanTotalRef = useRef(0);
  const resultsRef = useRef<MicrophoneBenchmarkResult[]>([]);
  const recording = useMicrophoneParameterBenchmarkRecording();
  const cancelRecording = recording.cancel;
  const [algorithms, setAlgorithms] = useState<MicrophoneBenchmarkAlgorithm[]>([
    ...MICROPHONE_BENCHMARK_ALGORITHMS,
  ]);
  const [selectedIntervals, setSelectedIntervals] = useState<number[]>([
    ...MICROPHONE_BENCHMARK_FRAME_INTERVALS,
  ]);
  const [selectedConfidence, setSelectedConfidence] = useState<number[]>([
    ...MICROPHONE_BENCHMARK_CONFIDENCE_THRESHOLDS,
  ]);
  const [selectedRmsIds, setSelectedRmsIds] = useState<string[]>(
    MICROPHONE_BENCHMARK_RMS_THRESHOLDS.map((threshold) => threshold.id)
  );
  const [selectedStableFrames, setSelectedStableFrames] = useState<number[]>([
    ...MICROPHONE_BENCHMARK_STABLE_FRAME_COUNTS,
  ]);
  const [selectedStableMs, setSelectedStableMs] = useState<number[]>([
    ...MICROPHONE_BENCHMARK_STABLE_DURATIONS,
  ]);
  const [completedRecordings, setCompletedRecordings] = useState<RecordingSlots>([null, null]);
  const [activeRecordingIndex, setActiveRecordingIndex] = useState<RecordingIndex>(1);
  const [results, setResults] = useState<MicrophoneBenchmarkResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [isPreparingAlgorithm, setIsPreparingAlgorithm] = useState(false);
  const [isScanComplete, setIsScanComplete] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedMarkerIndex, setSelectedMarkerIndex] = useState(0);
  const [addMarkerMode, setAddMarkerMode] = useState(false);

  const systemConfiguration = useMemo(
    () => resolvePracticeMicrophoneConfiguration(preferences),
    [preferences]
  );
  const fixedAlgorithmParameters = useMemo(() => {
    const yinProfile = practiceMicrophoneDebugParametersForSensitivityLevel(
      "yin",
      preferences.sensitivityLevel
    );
    return {
      yinThreshold: preferences.debugMode
        ? preferences.debugParameters.yinThreshold
        : yinProfile.yinThreshold,
    };
  }, [preferences]);
  const expectedMidi = useMemo(() => createMicrophoneBenchmarkTargetSequence(), []);
  const selections = useMemo(
    () => ({
      confidenceThresholds: selectedConfidence,
      frameIntervals: selectedIntervals,
      inputRmsThresholdIds: selectedRmsIds,
      requiredStableFrames: selectedStableFrames,
      requiredStableMs: selectedStableMs,
    }),
    [selectedConfidence, selectedIntervals, selectedRmsIds, selectedStableFrames, selectedStableMs]
  );
  const configurationsPerAlgorithm = useMemo(
    () => createMicrophoneBenchmarkConfigurations("swiftf0", selections).length,
    [selections]
  );
  const totalConfigurations = configurationsPerAlgorithm * algorithms.length;
  const totalEvaluations = totalConfigurations * 2;
  const completedRecording = completedRecordings[activeRecordingIndex - 1];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog?.open) dialog.close();
  }, [isOpen]);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      cancelRecording();
    },
    [cancelRecording]
  );

  if (!isOpen) return null;

  function clearResults(): void {
    resultsRef.current = [];
    setResults([]);
    setProgress(0);
    setCompletedCount(0);
    setScanError(null);
    setIsScanning(false);
    setIsPreparingAlgorithm(false);
    setIsScanComplete(false);
    workerRef.current?.terminate();
    workerRef.current = null;
    runIdRef.current += 1;
  }

  function updateRecordingAt(
    recordingIndex: RecordingIndex,
    update: (current: CompletedBenchmarkRecording | null) => CompletedBenchmarkRecording | null
  ): void {
    setCompletedRecordings((current) => {
      const next: RecordingSlots = [...current];
      next[recordingIndex - 1] = update(current[recordingIndex - 1]);
      return next;
    });
  }

  function handleClose(): void {
    runIdRef.current += 1;
    recordingRunIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    recording.cancel();
    setCompletedRecordings([null, null]);
    clearResults();
    onClose();
  }

  async function startRecording(
    recordingIndex: RecordingIndex = activeRecordingIndex
  ): Promise<void> {
    if (recording.isStarting || recording.isRecording || isScanning) return;
    const targetIndex = recordingIndex;
    setActiveRecordingIndex(targetIndex);
    recordingTargetIndexRef.current = targetIndex;
    recordingRunIdRef.current += 1;
    updateRecordingAt(targetIndex, () => null);
    clearResults();
    captureInputGainRef.current = systemConfiguration.analysisGain;
    await recording.start();
  }

  async function stopRecording(): Promise<void> {
    const recordingRunId = recordingRunIdRef.current;
    const targetIndex = recordingTargetIndexRef.current;
    const take = await recording.stop();
    if (!take || recordingRunIdRef.current !== recordingRunId) return;
    const inputGain = captureInputGainRef.current;
    const signal = summarizeMicrophoneBenchmarkSignal(take.samples, inputGain);
    updateRecordingAt(targetIndex, () => ({
      environment: {
        browser: detectBrowser(navigator.userAgent),
        device: `${navigator.platform || "未知平台"} · ${take.deviceLabel}`,
        inputGain,
        sampleRate: take.sampleRate,
        trackSampleRate: take.trackSampleRate,
        userAgent: navigator.userAgent,
        sensitivityLevel: preferences.sensitivityLevel,
        debugMode: preferences.debugMode,
        fixedYinThreshold: fixedAlgorithmParameters.yinThreshold,
      },
      markersMs: detectMicrophoneBenchmarkOnsets(take.samples, take.sampleRate),
      signal,
      take,
    }));
    if (targetIndex === 1 && !completedRecordings[1]) setActiveRecordingIndex(2);
    setSelectedMarkerIndex(0);
    setAddMarkerMode(false);
  }

  function updateSelectedRecording(
    update: (current: CompletedBenchmarkRecording) => CompletedBenchmarkRecording
  ): void {
    clearResults();
    updateRecordingAt(activeRecordingIndex, (current) => (current ? update(current) : current));
  }

  function updateMarker(index: number, value: number): void {
    if (!completedRecording) return;
    updateSelectedRecording((current) => {
      const sorted = [...current.markersMs];
      const minimum = Math.max(0, sorted[index - 1] ?? 0) + 1;
      const maximum =
        Math.min(current.take.durationMs, sorted[index + 1] ?? current.take.durationMs) - 1;
      sorted[index] = Math.max(minimum, Math.min(maximum, value));
      return { ...current, markersMs: sorted };
    });
  }

  function addMarker(timeMs: number): void {
    if (!completedRecording) return;
    updateSelectedRecording((current) => ({
      ...current,
      markersMs: [...current.markersMs, timeMs].sort((left, right) => left - right),
    }));
    const nextIndex = completedRecording.markersMs.filter((marker) => marker < timeMs).length;
    setSelectedMarkerIndex(nextIndex);
    setAddMarkerMode(false);
  }

  function deleteSelectedMarker(): void {
    if (!completedRecording || completedRecording.markersMs.length === 0) return;
    updateSelectedRecording((current) => ({
      ...current,
      markersMs: current.markersMs.filter((_, index) => index !== selectedMarkerIndex),
    }));
    setSelectedMarkerIndex((index) => Math.max(0, index - 1));
  }

  function handleScanFailure(worker: Worker, id: number, error: unknown): void {
    if (runIdRef.current !== id) return;
    setScanError(error instanceof Error ? error.message : "算法扫描失败，请重试。");
    setIsScanning(false);
    setIsPreparingAlgorithm(false);
    setIsScanComplete(false);
    worker.terminate();
    if (workerRef.current === worker) workerRef.current = null;
  }

  async function prepareAndPostTask(worker: Worker, id: number, task: ScanTask): Promise<void> {
    const current = completedRecordings[task.recordingIndex - 1];
    if (!current) throw new Error(`录音 ${task.recordingIndex} 尚未完成。`);
    setIsPreparingAlgorithm(task.algorithm === "swiftf0");

    const configurations = createMicrophoneBenchmarkConfigurations(task.algorithm, selections);
    const transferableSamples = current.take.samples.slice();
    setIsPreparingAlgorithm(false);
    worker.postMessage(
      {
        algorithm: task.algorithm,
        configurations,
        expectedMidi,
        fixedParameters: {
          analysisGain: current.environment.inputGain,
          yinThreshold: current.environment.fixedYinThreshold,
        },
        id,
        onsetMarkersMs: current.markersMs,
        recordingIndex: task.recordingIndex,
        sampleRate: current.take.sampleRate,
        samples: transferableSamples.buffer,
        type: "scan",
      },
      [transferableSamples.buffer]
    );
  }

  async function startScan(): Promise<void> {
    if (
      completedRecordings.some((item) => item === null) ||
      algorithms.length === 0 ||
      configurationsPerAlgorithm === 0
    ) {
      return;
    }
    workerRef.current?.terminate();
    const worker = new Worker(
      new URL("../../vocal-pitch/logic/microphoneParameterBenchmark.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;
    const id = ++runIdRef.current;
    const tasks = ([1, 2] as const).flatMap((recordingIndex) =>
      algorithms.map((algorithm) => ({ algorithm, recordingIndex }))
    );
    scanTasksRef.current = tasks;
    scanTaskIndexRef.current = 0;
    scanCompletedBaseRef.current = 0;
    scanTotalRef.current = totalEvaluations;
    resultsRef.current = [];
    setScanError(null);
    setResults([]);
    setProgress(0);
    setCompletedCount(0);
    setIsScanning(true);
    setIsPreparingAlgorithm(false);
    setIsScanComplete(false);

    worker.addEventListener("message", (event: MessageEvent<BenchmarkWorkerMessage>) => {
      const message = event.data;
      if (message.id !== id || runIdRef.current !== id) return;
      if (message.type === "preparing") {
        setIsPreparingAlgorithm(true);
      } else if (message.type === "progress") {
        setIsPreparingAlgorithm(false);
        const completed = scanCompletedBaseRef.current + message.completed;
        setCompletedCount(completed);
        setProgress(completed / Math.max(1, scanTotalRef.current));
      } else if (message.type === "complete") {
        const activeTask = scanTasksRef.current[scanTaskIndexRef.current];
        if (!activeTask) {
          handleScanFailure(worker, id, new Error("扫描任务序列异常，无法确认结果完整性。"));
          return;
        }
        const expectedConfigurations = createMicrophoneBenchmarkConfigurations(
          activeTask.algorithm,
          selections
        );
        if (
          !hasExpectedConfigurationRows(
            message.results,
            activeTask.algorithm,
            activeTask.recordingIndex,
            expectedConfigurations
          )
        ) {
          handleScanFailure(
            worker,
            id,
            new Error(
              `${benchmarkAlgorithmLabel(activeTask.algorithm)} 的录音 ${activeTask.recordingIndex} 结果不完整或有重复，本次 CSV 已禁用。`
            )
          );
          return;
        }
        const combined = [...resultsRef.current, ...message.results];
        resultsRef.current = combined;
        setResults(combined);
        scanCompletedBaseRef.current += message.results.length;
        scanTaskIndexRef.current += 1;
        const nextTask = scanTasksRef.current[scanTaskIndexRef.current];
        if (nextTask) {
          void prepareAndPostTask(worker, id, nextTask).catch((error: unknown) =>
            handleScanFailure(worker, id, error)
          );
        } else {
          if (resultsRef.current.length !== scanTotalRef.current) {
            handleScanFailure(worker, id, new Error("扫描结果总数与预期不符，本次 CSV 已禁用。"));
            return;
          }
          setProgress(1);
          setCompletedCount(scanTotalRef.current);
          setIsScanning(false);
          setIsPreparingAlgorithm(false);
          setIsScanComplete(true);
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
        }
      } else {
        handleScanFailure(worker, id, new Error(message.error));
      }
    });
    worker.addEventListener("error", (event: ErrorEvent) => {
      handleScanFailure(worker, id, new Error(event.message || "Worker 扫描失败，请重试。"));
    });

    try {
      await prepareAndPostTask(worker, id, tasks[0]!);
    } catch (error) {
      handleScanFailure(worker, id, error);
    }
  }

  function cancelScan(): void {
    runIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setIsScanning(false);
    setIsPreparingAlgorithm(false);
    setIsScanComplete(false);
  }

  function createCsvContent(rowsToExport: readonly MicrophoneBenchmarkResult[] = results): string {
    const usedRecordingIndices = new Set(rowsToExport.map((result) => result.recordingIndex));
    const metadataRows = completedRecordings.flatMap((item, index) => {
      const recordingIndex = (index + 1) as RecordingIndex;
      if (!item || !usedRecordingIndices.has(recordingIndex)) return [];
      const takeLabel = `录音 ${index + 1} · `;
      const environment = item.environment;
      return [
        [`${takeLabel}设备`, environment.device],
        [`${takeLabel}浏览器`, environment.browser],
        [`${takeLabel}User-Agent`, environment.userAgent],
        [`${takeLabel}采样率（解码）`, environment.sampleRate],
        [`${takeLabel}采样率（麦克风轨道）`, environment.trackSampleRate ?? "不可用"],
        [`${takeLabel}原始 RMS`, item.signal.rawRms],
        [`${takeLabel}输入放大倍数`, `${environment.inputGain}×`],
        [`${takeLabel}放大后 RMS`, item.signal.amplifiedRms],
        [`${takeLabel}敏感度档位（固定上下文）`, environment.sensitivityLevel],
        [`${takeLabel}系统详细参数覆盖`, environment.debugMode ? "开启" : "关闭"],
        [`${takeLabel}YIN threshold（固定）`, environment.fixedYinThreshold],
        [`${takeLabel}原始削波比例`, item.signal.rawClippedRatio],
        [`${takeLabel}放大后削波比例`, item.signal.amplifiedClippedRatio],
        [`${takeLabel}录音时长 ms`, item.take.durationMs],
        [`${takeLabel}自动/修正起音点数量`, item.markersMs.length],
        [`${takeLabel}录音格式`, item.take.mimeType],
      ];
    });
    const header = [
      "录音轮次",
      "算法",
      "帧间隔 ms",
      "实测帧间隔 ms",
      "置信度阈值",
      "RMS 档位",
      "RMS 门槛",
      "稳定帧数",
      "最短稳定时间 ms",
      "准确率",
      "正确数",
      "错音率",
      "错音数",
      "误报率",
      "误报数",
      "漏音率",
      "漏音数",
      "漏音目标 MIDI（音名）",
      "错音目标→识别 MIDI（音名）",
      "起音标记数",
      "延迟样本数",
      "延迟覆盖率",
      "平均识别延迟 ms",
      "Worker 处理耗时 ms",
    ];
    const csvRows = rowsToExport.map((result) => [
      `录音 ${result.recordingIndex}`,
      benchmarkAlgorithmLabel(result.algorithm),
      result.frameIntervalMs,
      result.actualFrameIntervalMs,
      result.confidenceThreshold,
      result.inputRmsThresholdLabel,
      result.inputRmsThreshold,
      result.requiredStableFrames,
      result.requiredStableMs,
      result.score.accuracy,
      result.score.correct,
      result.score.wrongRate,
      result.score.wrong,
      result.score.falsePositiveRate,
      result.score.extra,
      result.score.missedRate,
      result.score.missed,
      result.score.missedMidi.map(formatMidiNote).join(";"),
      result.score.wrongNotes
        .map(
          ({ expectedMidi, predictedMidi }) =>
            `${formatMidiNote(expectedMidi)}→${formatMidiNote(predictedMidi)}`
        )
        .join(";"),
      result.score.onsetMarkerCount,
      result.score.latencySampleCount,
      result.score.latencyCoverage,
      result.score.meanLatencyMs ?? "",
      result.workerProcessingMs,
    ]);
    return [
      ...metadataRows.map((row) => row.map((cell) => csvCell(cell)).join(",")),
      "",
      header.map((cell) => csvCell(cell)).join(","),
      ...csvRows.map((row) => row.map((cell) => csvCell(cell)).join(",")),
    ].join("\r\n");
  }

  async function exportBenchmarkJsonBundle(): Promise<void> {
    if (!isScanComplete || results.length === 0) return;
    const timestamp = new Date().toISOString();
    try {
      const recordings = [];
      for (const [index, item] of completedRecordings.entries()) {
        if (!item) continue;
        const recordingIndex = (index + 1) as RecordingIndex;
        const originalFilename = `microphone-benchmark-take-${recordingIndex}-original.${audioFileExtension(item.take.mimeType)}`;
        const analysisFilename = `microphone-benchmark-take-${recordingIndex}-analysis.wav`;
        const gainedSamples = applyPracticeMicrophoneAnalysisGain(
          item.take.samples,
          item.environment.inputGain
        );
        const analysisWav = encodeMicrophoneBenchmarkWav(gainedSamples, item.take.sampleRate);
        const originalAudioBase64 = await readBlobAsBase64(item.take.originalRecording);
        const analysisWavBase64 = await readBlobAsBase64(analysisWav);
        recordings.push({
          recordingIndex,
          environment: item.environment,
          signal: item.signal,
          markersMs: item.markersMs,
          durationMs: item.take.durationMs,
          decodedSampleRate: item.take.sampleRate,
          trackSampleRate: item.take.trackSampleRate,
          originalAudio: {
            filename: originalFilename,
            mimeType: item.take.mimeType,
            encoding: "base64",
            data: originalAudioBase64,
          },
          analysisWav: {
            filename: analysisFilename,
            mimeType: analysisWav.type,
            encoding: "base64",
            data: analysisWavBase64,
          },
        });
      }
      const csvContent = createCsvContent(results);
      const bundle = {
        schemaVersion: 1,
        type: "piano-learning-microphone-benchmark",
        exportedAt: timestamp,
        scan: {
          algorithms,
          selections,
          results,
        },
        csv: {
          filename: `microphone-benchmark-${timestamp.replaceAll(":", "-")}.csv`,
          mimeType: "text/csv;charset=utf-8",
          content: csvContent,
        },
        recordings,
      };
      downloadBlob(
        new Blob([JSON.stringify(bundle)], { type: "application/json;charset=utf-8" }),
        `microphone-benchmark-${timestamp.replaceAll(":", "-")}.json`
      );
    } catch (error) {
      setScanError(
        error instanceof Error ? `导出 JSON 失败：${error.message}` : "导出 JSON 失败，请重试。"
      );
    }
  }

  const selectedTakeCount = completedRecordings.filter(Boolean).length;
  const allRecordingsComplete = selectedTakeCount === 2;
  const nextRecordingIndex: RecordingIndex | null = completedRecordings[0]
    ? completedRecordings[1]
      ? null
      : 2
    : 1;
  return (
    <dialog
      aria-labelledby="microphone-benchmark-title"
      className="microphone-benchmark-dialog"
      onCancel={(event) => {
        event.preventDefault();
        handleClose();
      }}
      ref={dialogRef}
    >
      <header className="microphone-benchmark-header">
        <div>
          <h2 id="microphone-benchmark-title">麦克风参数基准测试</h2>
          <p>录制两段标准音序，离线跑参数矩阵，寻找最优解。</p>
        </div>
        <button
          aria-label="关闭麦克风参数基准测试"
          className="microphone-benchmark-close"
          onClick={handleClose}
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>
      </header>

      <nav aria-label="测试步骤" className="microphone-benchmark-stepper">
        <div
          aria-current={!allRecordingsComplete ? "step" : undefined}
          className={`microphone-benchmark-step${selectedTakeCount > 0 ? " is-started" : ""}${allRecordingsComplete ? " is-complete" : " is-current"}`}
        >
          <span>1</span>
          <strong>录制两段音序</strong>
          <small>{selectedTakeCount} / 2</small>
        </div>
        <span aria-hidden="true" className="microphone-benchmark-step-connector" />
        <div
          aria-current={allRecordingsComplete ? "step" : undefined}
          className={`microphone-benchmark-step${allRecordingsComplete ? " is-current" : " is-locked"}`}
        >
          <span>2</span>
          <strong>离线参数扫描</strong>
        </div>
      </nav>

      <div className="microphone-benchmark-body">
        <section
          aria-labelledby="microphone-benchmark-recording-title"
          className="microphone-benchmark-section microphone-benchmark-wizard-card microphone-benchmark-recording-card"
        >
          <div className="microphone-benchmark-card-heading">
            <div>
              <span className="microphone-benchmark-step-label">第一步</span>
              <h3 id="microphone-benchmark-recording-title">录制标准音序</h3>
            </div>
            <span className="microphone-benchmark-gain-tag">
              输入放大 · 录音一{" "}
              {completedRecordings[0]?.environment.inputGain ?? systemConfiguration.analysisGain}× ·
              录音二{" "}
              {completedRecordings[1]?.environment.inputGain ?? systemConfiguration.analysisGain}×
            </span>
          </div>
          <p className="microphone-benchmark-instructions">
            每段先留约 1 秒安静底噪，再从左向右弹完 C2–B6 的白键、再弹黑键，共 {expectedMidi.length}{" "}
            个音。
          </p>
          <aside aria-label="录音提示" className="microphone-benchmark-take-reminder">
            <strong>录音提示</strong>
            <span>
              两遍都录同一段音序，不限定快慢；如果想比较速度影响，可以尝试用不同速度各录一遍。
            </span>
          </aside>
          <div className="microphone-benchmark-recording-progress" role="status">
            <span>当前进度</span>
            <strong>{selectedTakeCount} / 2 段</strong>
            <span>目标 {expectedMidi.length} 个音 / 段</span>
          </div>
          <div aria-label="录音轮次状态与操作" className="microphone-benchmark-recording-actions">
            {([1, 2] as const).map((recordingIndex) => {
              const isComplete = Boolean(completedRecordings[recordingIndex - 1]);
              const isActiveTake = recordingTargetIndexRef.current === recordingIndex;
              const isRecordingThisTake = recording.isRecording && isActiveTake;
              const isPreparingThisTake = recording.isStarting && isActiveTake;
              const isNextTake = nextRecordingIndex === recordingIndex;
              return (
                <button
                  className={
                    isRecordingThisTake
                      ? "is-recording"
                      : isComplete
                        ? "is-complete"
                        : isNextTake
                          ? "primary"
                          : "is-pending"
                  }
                  disabled={
                    isComplete ||
                    (!isNextTake && !isRecordingThisTake && !isPreparingThisTake) ||
                    isPreparingThisTake ||
                    isScanning ||
                    (recording.isRecording && !isRecordingThisTake)
                  }
                  key={recordingIndex}
                  onClick={() =>
                    void (isRecordingThisTake ? stopRecording() : startRecording(recordingIndex))
                  }
                  type="button"
                >
                  {isRecordingThisTake ? (
                    <Square aria-hidden="true" size={17} />
                  ) : isComplete ? (
                    <Check aria-hidden="true" size={17} />
                  ) : (
                    <Mic aria-hidden="true" size={17} />
                  )}
                  {isPreparingThisTake
                    ? "正在连接麦克风…"
                    : isRecordingThisTake
                      ? `结束录音 ${recordingIndex} · ${formatElapsed(recording.elapsedMs)}`
                      : isComplete
                        ? `录音 ${recordingIndex} 已完成`
                        : isNextTake
                          ? `开始录制录音 ${recordingIndex}`
                          : `录音 ${recordingIndex} 待录制`}
                </button>
              );
            })}
          </div>
          {allRecordingsComplete ? (
            <p className="microphone-benchmark-ready-message" role="status">
              <Check aria-hidden="true" size={17} /> 两段录音均已完成，可以进行扫描
            </p>
          ) : null}
          {recording.error ? (
            <p className="microphone-benchmark-error" role="alert">
              {recording.error}
            </p>
          ) : null}
          <details className="microphone-benchmark-details">
            <summary>查看录音环境、音频文件与起音校正</summary>
            <div className="microphone-benchmark-details-content">
              <div aria-label="录音轮次" className="microphone-benchmark-recording-tabs">
                {([1, 2] as const).map((recordingIndex) => {
                  const isComplete = Boolean(completedRecordings[recordingIndex - 1]);
                  return (
                    <button
                      aria-pressed={activeRecordingIndex === recordingIndex}
                      className={activeRecordingIndex === recordingIndex ? "is-active" : ""}
                      disabled={
                        !isComplete || recording.isStarting || recording.isRecording || isScanning
                      }
                      key={recordingIndex}
                      onClick={() => {
                        setActiveRecordingIndex(recordingIndex);
                        setSelectedMarkerIndex(0);
                        setAddMarkerMode(false);
                      }}
                      type="button"
                    >
                      {isComplete ? <Check aria-hidden="true" size={15} /> : null}
                      录音 {recordingIndex}
                      <span>{isComplete ? "已完成" : "待录制"}</span>
                    </button>
                  );
                })}
                {completedRecording && !recording.isRecording ? (
                  <button
                    className="microphone-benchmark-retake-button"
                    disabled={isScanning || recording.isStarting}
                    onClick={() => void startRecording(activeRecordingIndex)}
                    type="button"
                  >
                    重新录制录音 {activeRecordingIndex}
                  </button>
                ) : null}
              </div>
              {completedRecording ? (
                <>
                  <div
                    aria-label={`录音 ${activeRecordingIndex} 环境摘要`}
                    className="microphone-benchmark-environment"
                  >
                    <span>
                      <strong>设备</strong>
                      {completedRecording.environment.device}
                    </span>
                    <span>
                      <strong>浏览器</strong>
                      {completedRecording.environment.browser}
                    </span>
                    <span>
                      <strong>采样率</strong>
                      {completedRecording.environment.sampleRate.toLocaleString()} Hz
                    </span>
                    <span>
                      <strong>轨道采样率</strong>
                      {completedRecording.environment.trackSampleRate?.toLocaleString() ??
                        "不可用"}{" "}
                      Hz
                    </span>
                    <span>
                      <strong>原始 RMS</strong>
                      {completedRecording.signal.rawRms.toFixed(5)}
                    </span>
                    <span>
                      <strong>输入放大</strong>
                      {completedRecording.environment.inputGain}×
                    </span>
                    <span>
                      <strong>放大后 RMS</strong>
                      {completedRecording.signal.amplifiedRms.toFixed(5)}
                    </span>
                    <span>
                      <strong>削波</strong>原始{" "}
                      {completedRecording.signal.rawClippedRatio > 0 ? "有" : "无"} · 放大后{" "}
                      {completedRecording.signal.amplifiedClippedRatio > 0 ? "有" : "无"}
                    </span>
                    <span>
                      <strong>敏感度上下文</strong>
                      {practiceMicrophoneSensitivityLevelLabel(
                        completedRecording.environment.sensitivityLevel
                      )}
                      {completedRecording.environment.debugMode ? " · 详细参数覆盖开启" : ""}
                    </span>
                  </div>
                  <div className="microphone-benchmark-waveform-heading">
                    <strong>起音点校正</strong>
                    <span>
                      {completedRecording.markersMs.length} 个自动标记 ·
                      可拖动修正；标记数量不必等于音数， 延迟按匹配到的正确音统计
                    </span>
                  </div>
                  <MicrophoneBenchmarkWaveform
                    addMarkerMode={addMarkerMode}
                    disabled={isScanning}
                    durationMs={completedRecording.take.durationMs}
                    markerTimesMs={completedRecording.markersMs}
                    onAddMarker={addMarker}
                    onMarkerChange={updateMarker}
                    onSelectMarker={setSelectedMarkerIndex}
                    samples={completedRecording.take.samples}
                    selectedMarkerIndex={selectedMarkerIndex}
                  />
                  <div className="microphone-benchmark-marker-controls">
                    <span>
                      选中起音点 {completedRecording.markersMs.length ? selectedMarkerIndex + 1 : 0}
                      {completedRecording.markersMs[selectedMarkerIndex] !== undefined
                        ? ` · ${Math.round(completedRecording.markersMs[selectedMarkerIndex]!)} ms`
                        : ""}
                    </span>
                    <button
                      aria-pressed={addMarkerMode}
                      disabled={isScanning}
                      onClick={() => setAddMarkerMode((current) => !current)}
                      type="button"
                    >
                      {addMarkerMode ? "点按波形添加起音点" : "添加起音点"}
                    </button>
                    <button
                      disabled={isScanning || completedRecording.markersMs.length === 0}
                      onClick={deleteSelectedMarker}
                      type="button"
                    >
                      删除所选点
                    </button>
                  </div>
                </>
              ) : (
                <p className="microphone-benchmark-note">
                  完成一段录音后，可在这里查看采样环境和校正起音点。
                </p>
              )}
            </div>
          </details>
        </section>

        <section
          aria-labelledby="microphone-benchmark-matrix-title"
          className={`microphone-benchmark-section microphone-benchmark-wizard-card microphone-benchmark-scan-card${allRecordingsComplete ? "" : " is-locked"}`}
        >
          <div className="microphone-benchmark-card-heading">
            <div>
              <span className="microphone-benchmark-step-label">第二步</span>
              <h3 id="microphone-benchmark-matrix-title">运行离线扫描</h3>
            </div>
            {!allRecordingsComplete ? (
              <span className="microphone-benchmark-lock-tag">请先完成两段录音</span>
            ) : null}
          </div>
          <fieldset className="microphone-benchmark-algorithms">
            <legend>参与扫描的算法</legend>
            {MICROPHONE_BENCHMARK_ALGORITHMS.map((algorithm) => (
              <label key={algorithm}>
                <input
                  checked={algorithms.includes(algorithm)}
                  disabled={!allRecordingsComplete || isScanning || recording.isRecording}
                  onChange={() => {
                    clearResults();
                    toggleSelection(algorithms, setAlgorithms, algorithm);
                  }}
                  type="checkbox"
                />
                {benchmarkAlgorithmLabel(algorithm)}
              </label>
            ))}
          </fieldset>
          <details
            className={`microphone-benchmark-advanced${allRecordingsComplete ? "" : " is-locked"}`}
          >
            <summary>
              <span>⚙️ 展开高级参数配置</span>
              <small>{allRecordingsComplete ? "默认全选" : "完成两段录音后可修改"}</small>
            </summary>
            <p className="microphone-benchmark-note">
              扫描帧间隔、置信度、输入 RMS 门槛、稳定帧数和最短稳定时间；YIN threshold
              等算法专属参数沿用当前敏感度。
            </p>
            <div className="microphone-benchmark-options-grid">
              <fieldset>
                <legend>帧间隔</legend>
                {MICROPHONE_BENCHMARK_FRAME_INTERVALS.map((interval) => (
                  <label key={interval}>
                    <input
                      checked={selectedIntervals.includes(interval)}
                      disabled={!allRecordingsComplete || isScanning}
                      onChange={() => {
                        clearResults();
                        toggleSelection(selectedIntervals, setSelectedIntervals, interval);
                      }}
                      type="checkbox"
                    />
                    {interval} ms
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>置信度</legend>
                {MICROPHONE_BENCHMARK_CONFIDENCE_THRESHOLDS.map((threshold) => (
                  <label key={threshold}>
                    <input
                      checked={selectedConfidence.includes(threshold)}
                      disabled={!allRecordingsComplete || isScanning}
                      onChange={() => {
                        clearResults();
                        toggleSelection(selectedConfidence, setSelectedConfidence, threshold);
                      }}
                      type="checkbox"
                    />
                    {threshold.toFixed(1)}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>输入 RMS 门槛</legend>
                {MICROPHONE_BENCHMARK_RMS_THRESHOLDS.map((threshold) => (
                  <label key={threshold.id}>
                    <input
                      checked={selectedRmsIds.includes(threshold.id)}
                      disabled={!allRecordingsComplete || isScanning}
                      onChange={() => {
                        clearResults();
                        toggleSelection(selectedRmsIds, setSelectedRmsIds, threshold.id);
                      }}
                      type="checkbox"
                    />
                    {threshold.label} · {threshold.value.toFixed(4)}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>稳定帧数</legend>
                {MICROPHONE_BENCHMARK_STABLE_FRAME_COUNTS.map((count) => (
                  <label key={count}>
                    <input
                      checked={selectedStableFrames.includes(count)}
                      disabled={!allRecordingsComplete || isScanning}
                      onChange={() => {
                        clearResults();
                        toggleSelection(selectedStableFrames, setSelectedStableFrames, count);
                      }}
                      type="checkbox"
                    />
                    {count} 帧
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>最短稳定时间</legend>
                {MICROPHONE_BENCHMARK_STABLE_DURATIONS.map((duration) => (
                  <label key={duration}>
                    <input
                      checked={selectedStableMs.includes(duration)}
                      disabled={!allRecordingsComplete || isScanning}
                      onChange={() => {
                        clearResults();
                        toggleSelection(selectedStableMs, setSelectedStableMs, duration);
                      }}
                      type="checkbox"
                    />
                    {duration} ms
                  </label>
                ))}
              </fieldset>
            </div>
          </details>
          <div className="microphone-benchmark-scan-controls">
            <button
              className="primary microphone-benchmark-scan-button"
              disabled={
                !allRecordingsComplete ||
                algorithms.length === 0 ||
                configurationsPerAlgorithm === 0 ||
                isScanning ||
                recording.isRecording
              }
              onClick={() => void startScan()}
              type="button"
            >
              {isPreparingAlgorithm
                ? "正在准备识别模型…"
                : isScanning
                  ? "正在扫描…"
                  : "🚀 开始离线扫描"}
            </button>
            {isScanning ? (
              <button
                className="microphone-benchmark-cancel-scan-button"
                onClick={cancelScan}
                type="button"
              >
                取消扫描
              </button>
            ) : null}
          </div>
          {isScanning ? (
            <div
              aria-label="扫描进度"
              aria-valuemax={1}
              aria-valuemin={0}
              aria-valuenow={progress}
              className="microphone-benchmark-progress"
              role="progressbar"
            >
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
              <small>
                {completedCount} / {totalEvaluations}
              </small>
            </div>
          ) : (
            <p className="microphone-benchmark-scan-caption">
              {algorithms.length} 个算法 × {configurationsPerAlgorithm} 组 × 2 段 ={" "}
              {totalEvaluations} 次评估
            </p>
          )}
          {scanError ? (
            <p className="microphone-benchmark-error" role="alert">
              {scanError}
            </p>
          ) : null}
        </section>

        {results.length > 0 ? (
          <section
            aria-labelledby="microphone-benchmark-results-title"
            className="microphone-benchmark-section microphone-benchmark-results"
          >
            <div className="microphone-benchmark-results-heading">
              <div>
                <h3 id="microphone-benchmark-results-title">3. 扫描结果 · {results.length} 组</h3>
                <p>
                  Worker 总评估耗时{" "}
                  {formatElapsed(
                    results.reduce((sum, result) => sum + result.workerProcessingMs, 0)
                  )}
                  （参数提取成本按组合均摊）。
                </p>
              </div>
              <div className="microphone-benchmark-export-actions">
                <button
                  className="microphone-benchmark-export-button"
                  disabled={!isScanComplete}
                  onClick={() => void exportBenchmarkJsonBundle()}
                  type="button"
                >
                  <Download aria-hidden="true" size={16} /> 导出完整 JSON（CSV + 音频）
                </button>
              </div>
            </div>
            <MicrophoneBenchmarkResultTable results={results} />
            <p className="microphone-benchmark-note">
              平均延迟只统计能与正确识别音一一对应的起音标记；表格和导出包
              会同时记录标记数、延迟样本数与覆盖率。
            </p>
            <p className="microphone-benchmark-disclaimer">
              本结果基于离线 Worker 的序列评估，仅供理论参数参考，不代表实时链路的绝对手感。
            </p>
          </section>
        ) : null}
      </div>
    </dialog>
  );
}
