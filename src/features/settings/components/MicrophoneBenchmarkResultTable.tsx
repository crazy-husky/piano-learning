import { useMemo, useState } from "react";
import type { MicrophoneBenchmarkResult } from "../../vocal-pitch/logic/microphoneParameterBenchmark";
import { practiceMicrophoneAlgorithmLabel } from "../../vocal-pitch/logic/practiceMicrophonePreferences";

type SortKey =
  | "accuracy"
  | "actualFrameIntervalMs"
  | "confidenceThreshold"
  | "extra"
  | "falsePositiveRate"
  | "inputRmsThreshold"
  | "meanLatencyMs"
  | "missedRate"
  | "requiredStableFrames"
  | "requiredStableMs"
  | "workerProcessingMs"
  | "wrongRate";

interface MicrophoneBenchmarkResultTableProps {
  results: readonly MicrophoneBenchmarkResult[];
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function sortValue(result: MicrophoneBenchmarkResult, key: SortKey): number {
  if (key === "meanLatencyMs") return result.score.meanLatencyMs ?? Number.POSITIVE_INFINITY;
  if (key === "extra") return result.score.extra;
  if (key === "falsePositiveRate") return result.score.falsePositiveRate;
  if (key === "missedRate") return result.score.missedRate;
  if (key === "wrongRate") return result.score.wrongRate;
  if (key === "actualFrameIntervalMs") return result.actualFrameIntervalMs;
  if (key === "confidenceThreshold") return result.confidenceThreshold;
  if (key === "inputRmsThreshold") return result.inputRmsThreshold;
  if (key === "requiredStableFrames") return result.requiredStableFrames;
  if (key === "requiredStableMs") return result.requiredStableMs;
  if (key === "workerProcessingMs") return result.workerProcessingMs;
  return result.score.accuracy;
}

export function MicrophoneBenchmarkResultTable({
  results,
}: MicrophoneBenchmarkResultTableProps): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>("accuracy");
  const [descending, setDescending] = useState(true);
  const algorithmLabel = (result: MicrophoneBenchmarkResult): string =>
    practiceMicrophoneAlgorithmLabel(result.algorithm);
  const sortedResults = useMemo(
    () =>
      [...results].sort((left, right) => {
        const difference = sortValue(left, sortKey) - sortValue(right, sortKey);
        return descending ? -difference : difference;
      }),
    [descending, results, sortKey]
  );

  function toggleSort(key: SortKey): void {
    if (sortKey === key) setDescending((current) => !current);
    else {
      setSortKey(key);
      setDescending(key !== "meanLatencyMs");
    }
  }

  function header(label: string, key: SortKey): JSX.Element {
    const active = sortKey === key;
    return (
      <th aria-sort={active ? (descending ? "descending" : "ascending") : "none"} key={key}>
        <button onClick={() => toggleSort(key)} type="button">
          {label}
          {active ? (descending ? " ↓" : " ↑") : ""}
        </button>
      </th>
    );
  }

  return (
    <div className="microphone-benchmark-table-scroll" role="region" aria-label="参数扫描结果">
      <table className="microphone-benchmark-table">
        <thead>
          <tr>
            <th>录音</th>
            <th>算法</th>
            {header("帧间隔", "actualFrameIntervalMs")}
            {header("置信度", "confidenceThreshold")}
            {header("RMS 门槛", "inputRmsThreshold")}
            {header("稳定帧", "requiredStableFrames")}
            {header("最短稳定时间", "requiredStableMs")}
            {header("准确率", "accuracy")}
            {header("错音率", "wrongRate")}
            {header("误报率", "falsePositiveRate")}
            {header("漏音率", "missedRate")}
            <th>延迟覆盖</th>
            {header("平均延迟", "meanLatencyMs")}
            {header("Worker 处理 ms", "workerProcessingMs")}
          </tr>
        </thead>
        <tbody>
          {sortedResults.map((result, index) => (
            <tr
              key={`${result.recordingIndex}-${result.algorithm}-${result.frameIntervalMs}-${result.confidenceThreshold}-${result.inputRmsThresholdId}-${result.requiredStableFrames}-${result.requiredStableMs}-${index}`}
            >
              <td>录音 {result.recordingIndex}</td>
              <td>{algorithmLabel(result)}</td>
              <td>
                {result.frameIntervalMs} ms
                {Math.abs(result.actualFrameIntervalMs - result.frameIntervalMs) > 0.5
                  ? `（实测 ${result.actualFrameIntervalMs.toFixed(1)}）`
                  : ""}
              </td>
              <td>{result.confidenceThreshold.toFixed(1)}</td>
              <td>
                {result.inputRmsThresholdLabel} · {result.inputRmsThreshold.toFixed(4)}
              </td>
              <td>{result.requiredStableFrames}</td>
              <td>{result.requiredStableMs} ms</td>
              <td>
                {formatPercent(result.score.accuracy)} · {result.score.correct}
              </td>
              <td>
                {formatPercent(result.score.wrongRate)} · {result.score.wrong}
              </td>
              <td>
                {formatPercent(result.score.falsePositiveRate)} · {result.score.extra}
              </td>
              <td>
                {formatPercent(result.score.missedRate)} · {result.score.missed}
              </td>
              <td>
                {result.score.latencySampleCount} / {result.score.correct} ·{" "}
                {formatPercent(result.score.latencyCoverage)}
              </td>
              <td>
                {result.score.meanLatencyMs === null
                  ? "—"
                  : `${result.score.meanLatencyMs.toFixed(1)} ms`}
              </td>
              <td>{result.workerProcessingMs.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
