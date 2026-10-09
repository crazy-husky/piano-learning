import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { X } from "lucide-react";
import { formatMidiNote } from "../../../domain/vocalPitch";
import type {
  PracticeMicrophoneAnalysis,
  PracticeMicrophoneAnalysisEvent,
  PracticeMicrophoneCandidateSegment,
} from "../../vocal-pitch/logic/practiceMicrophoneAnalysis";
import { PRACTICE_NOTE_CONTINUITY_CONFIDENCE } from "../../vocal-pitch/logic/practiceNoteRecognizer";
import {
  practiceMicrophoneAlgorithmLabel,
  practiceMicrophoneSensitivityLevelLabel,
} from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import { ResponsiveDataTable, type ResponsiveDataTableColumn } from "../../../shared/components/ui/ResponsiveDataTable";

interface StableResultDisplayRow {
  event: PracticeMicrophoneAnalysisEvent | null;
  expectedMidiNoteNumber: number;
  isMissing: boolean;
  rowNumber: number | string;
}

const MICROPHONE_CANDIDATE_TABLE_MIN_WIDTH = "1300px";
const MICROPHONE_CANDIDATE_COLUMN_WIDTHS = {
  note: "44px",
  time: "116px",
  status: "76px",
  confidence: "130px",
  inputRms: "120px",
  analysisRms: "160px",
  eligibleFrames: "100px",
  gateReasons: "150px",
  frames: "80px",
} as const;

function buildStableResultDisplayRows(analysis: PracticeMicrophoneAnalysis): StableResultDisplayRow[] {
  if (!analysis.expectedSequence) {
    return analysis.events.map((event, index) => ({
      event,
      expectedMidiNoteNumber: event.midiNoteNumber,
      isMissing: false,
      rowNumber: index + 1,
    }));
  }

  const missedSequenceIndexes = new Set(analysis.missedNotes.map((note) => note.sequenceIndex));
  const expectedEvents = analysis.events.filter((event) => event.expectedMidiNoteNumber !== null);
  const extraEvents = analysis.events.filter((event) => event.expectedMidiNoteNumber === null);
  let expectedEventIndex = 0;
  const expectedRows = analysis.expectedSequence.map((expectedMidiNoteNumber, index) => {
    const isMissing = missedSequenceIndexes.has(index);
    const event = isMissing ? null : expectedEvents[expectedEventIndex++] ?? null;
    return {
      event,
      expectedMidiNoteNumber,
      isMissing: isMissing || event === null,
      rowNumber: index + 1,
    };
  });

  return [
    ...expectedRows,
    ...extraEvents.map((event, index) => ({
      event,
      expectedMidiNoteNumber: event.midiNoteNumber,
      isMissing: false,
      rowNumber: `+${index + 1}`,
    })),
  ];
}

interface CandidateSegmentDisplayInfo {
  durationMs: number;
  failureReasons: string[];
  isDurationBelowThreshold: boolean;
  isFrameCountBelowThreshold: boolean;
  isMissedNote: boolean;
}

function getCandidateSegmentDisplayInfo(
  segment: PracticeMicrophoneCandidateSegment,
  analysis: PracticeMicrophoneAnalysis,
): CandidateSegmentDisplayInfo {
  const durationMs = segment.longestEligibleDurationMs;
  const { confidenceThreshold, inputRmsThreshold, requiredStableFrames, requiredStableMs } = analysis.parameters;
  const isDurationBelowThreshold = durationMs < requiredStableMs;
  const isFrameCountBelowThreshold = segment.maxConsecutiveEligibleFrameCount < requiredStableFrames;
  const ambiguousFrameCount = segment.frames.filter((frame) => frame.ambiguous).length;
  return {
    durationMs,
    failureReasons: [
      ...(segment.lowConfidenceFrameCount > 0
        ? [`置信度低于 ${confidenceThreshold.toFixed(3)}：${segment.lowConfidenceFrameCount} 帧`]
        : []),
      ...(segment.lowRmsFrameCount > 0
        ? [`处理后 RMS 低于 ${inputRmsThreshold.toFixed(6)}：${segment.lowRmsFrameCount} 帧`]
        : []),
      ...(isFrameCountBelowThreshold
        ? [`连续有效帧 ${segment.maxConsecutiveEligibleFrameCount}/${requiredStableFrames} 帧，未达到设置门槛`]
        : []),
      ...(isDurationBelowThreshold
        ? [`连续有效时长 ${durationMs}/${requiredStableMs} ms，未达到设置门槛`]
        : []),
      ...(ambiguousFrameCount > 0
        ? [`存在歧义帧 ${ambiguousFrameCount} 帧，未计入有效帧`]
        : []),
    ],
    isDurationBelowThreshold,
    isFrameCountBelowThreshold,
    isMissedNote: analysis.missedNotes.some((missedNote) =>
      missedNote.midiNoteNumber === segment.midiNoteNumber,
    ),
  };
}

function sortCandidateSegmentsMissedFirst(
  segments: readonly PracticeMicrophoneCandidateSegment[],
  analysis: PracticeMicrophoneAnalysis,
): PracticeMicrophoneCandidateSegment[] {
  return segments
    .map((segment, originalIndex) => ({
      isMissedNote: getCandidateSegmentDisplayInfo(segment, analysis).isMissedNote,
      originalIndex,
      segment,
    }))
    .sort((left, right) => Number(right.isMissedNote) - Number(left.isMissedNote) || left.originalIndex - right.originalIndex)
    .map(({ segment }) => segment);
}

interface PracticeMicrophoneAnalysisDialogProps {
  analysis: PracticeMicrophoneAnalysis | null;
  debugMode: boolean;
  expandedCandidateSegmentKey: string | null;
  isOpen: boolean;
  notice: string | null;
  onClose: () => void;
  onExpandedCandidateSegmentKeyChange: Dispatch<SetStateAction<string | null>>;
}

export function PracticeMicrophoneAnalysisDialog({
  analysis: microphoneCaptureAnalysis,
  debugMode,
  expandedCandidateSegmentKey,
  isOpen: isMicrophoneAnalysisDialogOpen,
  notice: microphoneCaptureNotice,
  onClose,
  onExpandedCandidateSegmentKeyChange: setExpandedCandidateSegmentKey,
}: PracticeMicrophoneAnalysisDialogProps): JSX.Element | null {
  const microphoneAnalysisDialogRef = useRef<HTMLDialogElement | null>(null);
  const microphoneAnalysisDialogCloseRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    if (!isMicrophoneAnalysisDialogOpen) {
      return;
    }
    const dialog = microphoneAnalysisDialogRef.current;
    if (!dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    microphoneAnalysisDialogCloseRef.current?.focus();
    const outerScroller = dialog.querySelector<HTMLElement>(".practice-microphone-analysis-dialog-body");
    const tableRegions = Array.from(dialog.querySelectorAll<HTMLElement>(".practice-microphone-analysis-table-scroll"));
    const onTableWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || (!event.deltaX && !event.deltaY) || !outerScroller) return;
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? outerScroller.clientHeight : 1;
      const deltaX = event.deltaX * multiplier;
      const deltaY = event.deltaY * multiplier;
      const previousLeft = event.currentTarget instanceof HTMLElement ? event.currentTarget.scrollLeft : 0;
      const previousTop = outerScroller.scrollTop;
      if (event.currentTarget instanceof HTMLElement && deltaX) {
        const region = event.currentTarget;
        region.scrollLeft = Math.max(0, Math.min(region.scrollWidth - region.clientWidth, region.scrollLeft + deltaX));
      }
      if (deltaY) {
        outerScroller.scrollTop = Math.max(
          0,
          Math.min(outerScroller.scrollHeight - outerScroller.clientHeight, outerScroller.scrollTop + deltaY),
        );
      }
      const currentLeft = event.currentTarget instanceof HTMLElement ? event.currentTarget.scrollLeft : previousLeft;
      if (currentLeft !== previousLeft || outerScroller.scrollTop !== previousTop) event.preventDefault();
    };
    const onTableKeyDown = (event: KeyboardEvent): void => {
      if (!outerScroller) return;
      const step = Math.max(40, Math.round(outerScroller.clientHeight * 0.8));
      const delta = event.key === "ArrowDown" ? 40
        : event.key === "ArrowUp" ? -40
          : event.key === "PageDown" ? step
            : event.key === "PageUp" ? -step
              : event.key === "Home" ? -outerScroller.scrollTop
                : event.key === "End" ? outerScroller.scrollHeight
                  : 0;
      if (!delta) return;
      const previousTop = outerScroller.scrollTop;
      outerScroller.scrollTop = event.key === "End"
        ? outerScroller.scrollHeight
        : Math.max(0, Math.min(outerScroller.scrollHeight - outerScroller.clientHeight, previousTop + delta));
      if (outerScroller.scrollTop !== previousTop) event.preventDefault();
    };
    for (const region of tableRegions) {
      region.addEventListener("wheel", onTableWheel, { passive: false });
      region.addEventListener("keydown", onTableKeyDown);
    }
    return () => {
      for (const region of tableRegions) {
        region.removeEventListener("wheel", onTableWheel);
        region.removeEventListener("keydown", onTableKeyDown);
      }
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [isMicrophoneAnalysisDialogOpen]);

  if (!isMicrophoneAnalysisDialogOpen || !debugMode || !microphoneCaptureAnalysis) return null;

  return (

        <dialog
          aria-labelledby="practice-microphone-analysis-title"
          className="practice-microphone-analysis-dialog"
          onCancel={(event) => {
            event.preventDefault();
            onClose();
          }}
          onClick={(event) => {
            if (event.currentTarget === event.target) {
              onClose();
            }
          }}
          ref={microphoneAnalysisDialogRef}
        >
          <div className="practice-microphone-analysis-dialog-header">
            <div>
              <h2 id="practice-microphone-analysis-title">采样分析结果</h2>
              <span>逐音列出稳定识别结果，并统计错音、漏音和多报。</span>
              {microphoneCaptureNotice ? (
                <div aria-live="polite" className="practice-microphone-feedback-banner" role="status">
                  {microphoneCaptureNotice}
                </div>
              ) : null}
            </div>
            <button
              aria-label="关闭采样分析"
              className="practice-microphone-analysis-dialog-close"
              onClick={() => onClose()}
              ref={microphoneAnalysisDialogCloseRef}
              title="关闭"
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>
          <div className="practice-microphone-analysis-dialog-body">
            <div className="practice-microphone-analysis-result">
              <section className="practice-microphone-analysis-conclusion">
                <h3>结论</h3>
                <p className={microphoneCaptureAnalysis.counts.extra || microphoneCaptureAnalysis.counts.wrong ||
                  microphoneCaptureAnalysis.counts.missed ? "is-attention" : "is-clear"}>
                  {microphoneCaptureAnalysis.counts.expected === null
                    ? `检测到 ${microphoneCaptureAnalysis.counts.detected} 个稳定音符，未与预期音序比较。`
                    : `预期 ${microphoneCaptureAnalysis.counts.expected} 音，识别 ${microphoneCaptureAnalysis.counts.detected} 音；` +
                      `正确 ${microphoneCaptureAnalysis.counts.correct}，错音 ${microphoneCaptureAnalysis.counts.wrong}，` +
                      `漏音 ${microphoneCaptureAnalysis.counts.missed}，多报 ${microphoneCaptureAnalysis.counts.extra}。` +
                      (microphoneCaptureAnalysis.counts.extra
                        ? `多报 ${microphoneCaptureAnalysis.counts.extra} 音可能造成额外误答。`
                        : "")}
                </p>
                {microphoneCaptureAnalysis.missedNotes.length > 0 ? (
                  <p className="practice-microphone-missed-notes">
                    漏音位置：{microphoneCaptureAnalysis.missedNotes.map((item) =>
                      `第 ${item.sequenceIndex + 1} 个白键 ${formatMidiNote(item.midiNoteNumber)}`
                    ).join("、")}。
                  </p>
                ) : null}
                <div className="practice-microphone-analysis-counts">
                  <span>
                    配置 {microphoneCaptureAnalysis.parameters.frameIntervalSelection === "auto"
                      ? "自动"
                      : `${microphoneCaptureAnalysis.parameters.frameIntervalSelection} ms`}
                    {" · 实测帧间隔 "}{microphoneCaptureAnalysis.medianFrameIntervalMs === null
                      ? "--"
                      : `${microphoneCaptureAnalysis.medianFrameIntervalMs.toFixed(0)} ms`}
                  </span>
                  <span>
                    稳定条件 {microphoneCaptureAnalysis.parameters.requiredStableFrames} 帧 /
                    {microphoneCaptureAnalysis.parameters.requiredStableMs} ms
                  </span>
                  <span>
                    {practiceMicrophoneAlgorithmLabel(microphoneCaptureAnalysis.parameters.algorithm)} ·
                    {microphoneCaptureAnalysis.parameters.debugMode
                      ? "调试参数"
                      : practiceMicrophoneSensitivityLevelLabel(microphoneCaptureAnalysis.parameters.sensitivityLevel)} ·
                    {microphoneCaptureAnalysis.parameters.analysisGain}× · RMS ≥
                    {microphoneCaptureAnalysis.parameters.inputRmsThreshold.toFixed(6)} · 置信度 ≥
                    {microphoneCaptureAnalysis.parameters.confidenceThreshold.toFixed(3)}
                    {microphoneCaptureAnalysis.parameters.algorithm === "mpm-c"
                      ? ` · 相邻音衔接 ≥${PRACTICE_NOTE_CONTINUITY_CONFIDENCE.toFixed(3)}（±2 半音、500 ms）`
                      : ""}
                    {microphoneCaptureAnalysis.parameters.algorithm === "mpm-c"
                      ? ` · 清晰度 ≥${microphoneCaptureAnalysis.parameters.primaryClarityThreshold.toFixed(3)}`
                      : ""}
                    {microphoneCaptureAnalysis.parameters.algorithm === "yin"
                      ? ` · YIN 阈值 ${microphoneCaptureAnalysis.parameters.yinThreshold.toFixed(3)}`
                      : ""}
                  </span>
                </div>
              </section>

              <section className="practice-microphone-analysis-section">
                <div className="practice-microphone-analysis-section-heading">
                  <h3>稳定识别结果</h3>
                  <span aria-label={`稳定识别 ${microphoneCaptureAnalysis.counts.detected} / ${microphoneCaptureAnalysis.expectedSequence?.length ?? 7}`}>
                    {microphoneCaptureAnalysis.counts.detected}/{microphoneCaptureAnalysis.expectedSequence?.length ?? 7}
                  </span>
                </div>
                {microphoneCaptureAnalysis.expectedSequence !== null || microphoneCaptureAnalysis.events.length > 0 ? (
                  <ResponsiveDataTable
                    ariaLabel="稳定识别结果表格"
                    className="practice-microphone-analysis-table"
                    columns={[
                      {
                        header: "#",
                        id: "row-number",
                        renderCell: (row) => row.rowNumber,
                        width: "44px",
                      },
                      {
                        header: "音符",
                        id: "note",
                        renderCell: (row) => row.event?.note ?? formatMidiNote(row.expectedMidiNoteNumber),
                        rowHeader: true,
                        width: "90px",
                      },
                      {
                        header: "判定",
                        id: "classification",
                        renderCell: (row) => {
                          const event = row.event;
                          if (!event) return "缺失";
                          if (event.classification === "correct") return "正确";
                          if (event.classification === "wrong") {
                            return `错音 · 预期 ${formatMidiNote(event.expectedMidiNoteNumber ?? 0)}`;
                          }
                          return event.classification === "extra" ? "多报" : "未对照";
                        },
                        width: "140px",
                      },
                      {
                        header: "时间 / 间隔",
                        id: "time",
                        renderCell: (row) => row.event
                          ? <>{(row.event.offsetMs / 1000).toFixed(2)} 秒
                            {row.event.intervalFromPreviousMs === null
                              ? " · 首音"
                              : ` · 间隔 ${(row.event.intervalFromPreviousMs / 1000).toFixed(2)} 秒`}</>
                          : "-",
                        width: "200px",
                      },
                      {
                        header: "置信度",
                        id: "confidence",
                        renderCell: (row) => row.event?.confidence.toFixed(3) ?? "-",
                        width: "90px",
                      },
                      {
                        header: "原始 RMS",
                        id: "input-rms",
                        renderCell: (row) => row.event?.rms.toFixed(6) ?? "-",
                        width: "110px",
                      },
                      {
                        header: "处理后 RMS",
                        id: "analysis-rms",
                        renderCell: (row) => row.event?.analysisRms.toFixed(6) ?? "-",
                        width: "110px",
                      },
                      {
                        header: "原始峰值",
                        id: "input-peak",
                        renderCell: (row) => row.event?.peak.toFixed(6) ?? "-",
                        width: "110px",
                      },
                      {
                        header: "处理后峰值",
                        id: "analysis-peak",
                        renderCell: (row) => row.event?.analysisPeak.toFixed(6) ?? "-",
                        width: "110px",
                      },
                      {
                        header: "频率",
                        id: "frequency",
                        renderCell: (row) => row.event ? `${row.event.frequencyHz.toFixed(1)} Hz` : "-",
                        width: "100px",
                      },
                    ] satisfies readonly ResponsiveDataTableColumn<StableResultDisplayRow>[]}
                    getRowKey={(row, index) => row.event
                      ? `${row.event.offsetMs}-${index}`
                      : `missing-${row.expectedMidiNoteNumber}-${index}`}
                    minWidth="1120px"
                    rows={buildStableResultDisplayRows(microphoneCaptureAnalysis)}
                    rowClassName={(row) => row.isMissing
                      ? "is-missed-note"
                      : row.event ? `is-${row.event.classification}` : undefined}
                    tableLayout="fixed"
                    viewportClassName="practice-microphone-analysis-table-scroll"
                  />
                ) : (
                  <p className="practice-microphone-analysis-empty">没有形成稳定识别事件。</p>
                )}
              </section>

              <section className="practice-microphone-analysis-section">
                <h3>
                  未触发答题的候选片段 · {microphoneCaptureAnalysis.candidateSegments.filter((segment) =>
                    segment.stableEventCount === 0
                  ).length}
                </h3>
                {microphoneCaptureAnalysis.candidateSegments.some((segment) => segment.stableEventCount === 0) ? (
                  <ResponsiveDataTable
                    ariaLabel="未触发答题的候选片段表格"
                    className="practice-microphone-analysis-table practice-microphone-candidate-table"
                    columns={[
                      {
                        header: "音符",
                        id: "note",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.note,
                        renderCell: (segment) => segment.note,
                        rowHeader: true,
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.note,
                      },
                      {
                        getCellClassName: (segment) => {
                          const displayInfo = getCandidateSegmentDisplayInfo(segment, microphoneCaptureAnalysis);
                          return displayInfo.isMissedNote && displayInfo.isDurationBelowThreshold
                            ? "is-below-threshold"
                            : undefined;
                        },
                        header: "时间范围 / 连续时长门槛",
                        id: "time",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.time,
                        renderCell: (segment) => {
                          const { durationMs } = getCandidateSegmentDisplayInfo(segment, microphoneCaptureAnalysis);
                          return (
                            <>
                              {(segment.startOffsetMs / 1000).toFixed(2)}–{(segment.endOffsetMs / 1000).toFixed(2)} 秒
                              <span className="practice-microphone-threshold-comparison">
                                连续有效 {durationMs}/{microphoneCaptureAnalysis.parameters.requiredStableMs} ms
                              </span>
                            </>
                          );
                        },
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.time,
                      },
                      {
                        header: "状态",
                        id: "status",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.status,
                        renderCell: (segment) => segment.stableThresholdMet ? "达到门槛，未触发" : "未达到门槛",
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.status,
                      },
                      {
                        getCellClassName: (segment) => {
                          const displayInfo = getCandidateSegmentDisplayInfo(segment, microphoneCaptureAnalysis);
                          return displayInfo.isMissedNote && segment.lowConfidenceFrameCount > 0
                            ? "is-below-threshold"
                            : undefined;
                        },
                        header: "置信度 均值 / 峰值",
                        id: "confidence",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.confidence,
                        renderCell: (segment) => {
                          const threshold = microphoneCaptureAnalysis.parameters.confidenceThreshold;
                          return (
                            <>
                              <span className="practice-microphone-threshold-comparison">
                                均值 {segment.confidenceAverage === null ? "--" : segment.confidenceAverage.toFixed(3)} / {threshold.toFixed(3)}
                              </span>
                              <span className="practice-microphone-threshold-comparison">
                                峰值 {segment.confidenceMaximum === null ? "--" : segment.confidenceMaximum.toFixed(3)} / {threshold.toFixed(3)}
                              </span>
                            </>
                          );
                        },
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.confidence,
                      },
                      {
                        header: "原始 RMS（参考）均值 / 峰值",
                        id: "input-rms",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.inputRms,
                        renderCell: (segment) => (
                          <>
                            <span className="practice-microphone-threshold-comparison">均值 {segment.inputRmsAverage.toFixed(6)}</span>
                            <span className="practice-microphone-threshold-comparison">峰值 {segment.inputRmsMaximum.toFixed(6)}</span>
                          </>
                        ),
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.inputRms,
                      },
                      {
                        getCellClassName: (segment) => {
                          const displayInfo = getCandidateSegmentDisplayInfo(segment, microphoneCaptureAnalysis);
                          return displayInfo.isMissedNote && segment.lowRmsFrameCount > 0
                            ? "is-below-threshold"
                            : undefined;
                        },
                        header: "处理后 RMS 均值 / 峰值",
                        id: "analysis-rms",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.analysisRms,
                        renderCell: (segment) => {
                          const threshold = microphoneCaptureAnalysis.parameters.inputRmsThreshold;
                          return (
                            <>
                              <span className="practice-microphone-threshold-comparison">
                                均值 {segment.analysisRmsAverage.toFixed(6)} / {threshold.toFixed(6)}
                              </span>
                              <span className="practice-microphone-threshold-comparison">
                                峰值 {segment.analysisRmsMaximum.toFixed(6)} / {threshold.toFixed(6)}
                              </span>
                            </>
                          );
                        },
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.analysisRms,
                      },
                      {
                        getCellClassName: (segment) => {
                          const displayInfo = getCandidateSegmentDisplayInfo(segment, microphoneCaptureAnalysis);
                          return displayInfo.isMissedNote && displayInfo.isFrameCountBelowThreshold
                            ? "is-below-threshold"
                            : undefined;
                        },
                        header: "连续有效帧 / 门槛",
                        id: "eligible-frames",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.eligibleFrames,
                        renderCell: (segment) => `${segment.maxConsecutiveEligibleFrameCount}/${microphoneCaptureAnalysis.parameters.requiredStableFrames}`,
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.eligibleFrames,
                      },
                      {
                        header: "门槛说明",
                        id: "gate-reasons",
                        maxWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.gateReasons,
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.gateReasons,
                        renderCell: (segment) => {
                          const { failureReasons } = getCandidateSegmentDisplayInfo(segment, microphoneCaptureAnalysis);
                          return failureReasons.length > 0 ? (
                            <ul className="practice-microphone-gate-reasons">
                              {failureReasons.map((reason) => <li key={reason}>{reason}</li>)}
                            </ul>
                          ) : "稳定门槛已满足";
                        },
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.gateReasons,
                      },
                      {
                        header: "逐帧数据",
                        id: "frames",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.frames,
                        renderCell: (segment, index) => {
                          const segmentKey = `${segment.startOffsetMs}-${index}`;
                          const isExpanded = expandedCandidateSegmentKey === segmentKey;
                          return (
                            <button
                              aria-controls={`microphone-candidate-frames-${segment.startOffsetMs}-${index}`}
                              aria-expanded={isExpanded}
                              className="practice-microphone-frame-toggle"
                              onClick={() => setExpandedCandidateSegmentKey((current) =>
                                current === segmentKey ? null : segmentKey)}
                              type="button"
                            >
                              {isExpanded ? "收起" : `查看 ${segment.frames.length} 帧`}
                            </button>
                          );
                        },
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.frames,
                      },
                    ] satisfies readonly ResponsiveDataTableColumn<PracticeMicrophoneCandidateSegment>[]}
                    getRowKey={(segment, index) => `${segment.startOffsetMs}-${index}`}
                    minWidth={MICROPHONE_CANDIDATE_TABLE_MIN_WIDTH}
                    rows={sortCandidateSegmentsMissedFirst(
                      microphoneCaptureAnalysis.candidateSegments.filter((segment) => segment.stableEventCount === 0),
                      microphoneCaptureAnalysis,
                    )}
                    renderRowDetails={(segment, index) => {
                      const segmentKey = `${segment.startOffsetMs}-${index}`;
                      if (expandedCandidateSegmentKey !== segmentKey) return null;
                      const detailsId = `microphone-candidate-frames-${segment.startOffsetMs}-${index}`;
                      return (
                        <ResponsiveDataTable
                          ariaLabel="候选音符逐帧数据"
                          className="practice-microphone-analysis-table practice-microphone-frame-table"
                          columns={[
                            {
                              header: "时间",
                              id: "time",
                              renderCell: (frame) => `${(frame.offsetMs / 1000).toFixed(3)} 秒`,
                              width: "100px",
                            },
                            {
                              header: "频率",
                              id: "frequency",
                              renderCell: (frame) => frame.frequencyHz === null ? "--" : `${frame.frequencyHz.toFixed(1)} Hz`,
                              width: "90px",
                            },
                            {
                              header: "置信度",
                              id: "confidence",
                              renderCell: (frame) => frame.confidence === null ? "--" : frame.confidence.toFixed(3),
                              width: "90px",
                            },
                            {
                              header: "原始 RMS",
                              id: "input-rms",
                              renderCell: (frame) => frame.rms.toFixed(6),
                              width: "100px",
                            },
                            {
                              header: "处理后 RMS",
                              id: "analysis-rms",
                              renderCell: (frame) => frame.analysisRms.toFixed(6),
                              width: "110px",
                            },
                            {
                              header: "原始峰值",
                              id: "input-peak",
                              renderCell: (frame) => frame.peak.toFixed(6),
                              width: "100px",
                            },
                            {
                              header: "处理后峰值",
                              id: "analysis-peak",
                              renderCell: (frame) => frame.analysisPeak.toFixed(6),
                              width: "110px",
                            },
                            {
                              header: "原始削波",
                              id: "input-clipping",
                              renderCell: (frame) => `${(frame.clippedSampleRatio * 100).toFixed(2)}%`,
                              width: "100px",
                            },
                            {
                              header: "处理后削波",
                              id: "analysis-clipping",
                              renderCell: (frame) => `${(frame.analysisClippedSampleRatio * 100).toFixed(2)}%`,
                              width: "110px",
                            },
                            {
                              header: "判定",
                              id: "eligibility",
                              renderCell: (frame) => frame.eligible ? "达标" : frame.ambiguous ? "歧义" : "未达标",
                              width: "100px",
                            },
                          ] satisfies readonly ResponsiveDataTableColumn<typeof segment.frames[number]>[]}
                          getRowKey={(frame, frameIndex) => `${frame.offsetMs}-${frameIndex}`}
                          id={detailsId}
                          minWidth="1060px"
                          rows={segment.frames}
                          rowClassName={(frame) => frame.eligible ? "is-eligible" : "is-ineligible"}
                          tableLayout="fixed"
                          viewportClassName="practice-microphone-analysis-frame-scroll"
                        />
                      );
                    }}
                    rowClassName={(segment) => {
                      const { isMissedNote } = getCandidateSegmentDisplayInfo(segment, microphoneCaptureAnalysis);
                      return [
                        isMissedNote ? "is-missed-note" : "",
                        segment.stableThresholdMet ? "is-threshold-met" : "",
                      ].filter(Boolean).join(" ") || undefined;
                    }}
                    detailsRowClassName="practice-microphone-frame-details-row"
                    tableLayout="fixed"
                    viewportClassName="practice-microphone-analysis-table-scroll"
                  />
                ) : (
                  <p className="practice-microphone-analysis-empty">没有未触发答题的音高候选片段。</p>
                )}
              </section>
            </div>
          </div>
        </dialog>
  );
}
