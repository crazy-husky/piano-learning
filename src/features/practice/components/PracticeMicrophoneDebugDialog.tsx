import { useLayoutEffect, useRef } from "react";
import { CircleHelp, Copy, RotateCcw, X } from "lucide-react";
import type { PracticeMicrophoneAnalysis } from "../../vocal-pitch/logic/practiceMicrophoneAnalysis";
import {
  PRACTICE_MICROPHONE_ANALYSIS_GAINS,
  PRACTICE_MICROPHONE_FRAME_INTERVALS,
  PRACTICE_MICROPHONE_STABLE_DURATIONS,
  PRACTICE_MICROPHONE_STABLE_FRAME_COUNTS,
  practiceMicrophoneAlgorithmLabel,
  practiceMicrophoneSensitivityLevelLabel,
  type PracticeMicrophoneAlgorithm,
  type PracticeMicrophoneConfiguration,
  type PracticeMicrophoneDebugParameters,
  type PracticeMicrophonePreferences,
} from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import type { usePracticeMicrophoneInput } from "../../vocal-pitch/logic/usePracticeMicrophoneInput";

function DebugParameterHelp({ label, description, recommendation }: {
  label: string;
  description: string;
  recommendation: string;
}): JSX.Element {
  return (
    <details className="debug-parameter-help">
      <summary aria-label={`${label}说明和推荐默认值`} title={`${label}说明和推荐默认值`}>
        <CircleHelp aria-hidden="true" size={16} />
      </summary>
      <div className="debug-parameter-help-popover" role="note">
        <strong>{label}</strong>
        <span>{description}</span>
        <span><b>推荐默认值：</b>{recommendation}</span>
      </div>
    </details>
  );
}
interface PracticeMicrophoneDebugDialogProps {
  analysis: PracticeMicrophoneAnalysis | null;
  configuration: PracticeMicrophoneConfiguration;
  debugMode: boolean;
  error: string | null;
  frameIntervalMs: number;
  isLoadingAlgorithm: boolean;
  isOpen: boolean;
  microphone: ReturnType<typeof usePracticeMicrophoneInput>;
  onClose: () => void;
  onRestoreDefaults: () => void;
  onSelectAlgorithm: (algorithm: PracticeMicrophoneAlgorithm) => Promise<void>;
  onUpdateParameters: (patch: Partial<PracticeMicrophoneDebugParameters>) => void;
  preferences: PracticeMicrophonePreferences;
}

export function PracticeMicrophoneDebugDialog({
  analysis: microphoneCaptureAnalysis,
  configuration: microphoneConfiguration,
  debugMode,
  error: microphoneAlgorithmError,
  frameIntervalMs: microphoneAnalysisIntervalMs,
  isLoadingAlgorithm: isLoadingMicrophoneAlgorithm,
  isOpen,
  microphone: practiceMicrophone,
  onClose,
  onRestoreDefaults: restoreMicrophoneDebugDefaults,
  onSelectAlgorithm: selectMicrophoneAlgorithm,
  onUpdateParameters: updateMicrophoneDebugParameters,
  preferences: practiceMicrophonePreferences,
}: PracticeMicrophoneDebugDialogProps): JSX.Element | null {
  const microphoneDebugDialogRef = useRef<HTMLDialogElement | null>(null);
  const microphoneDebugDialogCloseRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }
    const dialog = microphoneDebugDialogRef.current;
    if (!dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    microphoneDebugDialogCloseRef.current?.focus();
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [isOpen]);

  if (!isOpen || !debugMode) return null;

  return (
        <dialog
          aria-labelledby="practice-microphone-debug-title"
          className="practice-microphone-debug-dialog"
          onClickCapture={(event) => {
            const clickTarget = event.target;
            if (!(clickTarget instanceof Element)) return;
            const clickedHelp = clickTarget.closest(".debug-parameter-help");
            microphoneDebugDialogRef.current
              ?.querySelectorAll<HTMLDetailsElement>("details.debug-parameter-help[open]")
              .forEach((openHelp) => {
                if (openHelp !== clickedHelp && !openHelp.contains(clickTarget)) {
                  openHelp.open = false;
                }
              });
          }}
          onCancel={(event) => {
            event.preventDefault();
            onClose();
          }}
          onClick={(event) => {
            if (event.currentTarget === event.target) {
              onClose();
            }
          }}
          ref={microphoneDebugDialogRef}
        >
          <div className="practice-microphone-analysis-dialog-header">
            <div>
              <h2 id="practice-microphone-debug-title">麦克风调试</h2>
            </div>
            <button
              aria-label="关闭麦克风调试"
              className="practice-microphone-analysis-dialog-close"
              onClick={() => onClose()}
              ref={microphoneDebugDialogCloseRef}
              title="关闭"
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>
          <div className="practice-microphone-debug-dialog-body">
            <fieldset
              className="practice-microphone-debug-fields"
                disabled={practiceMicrophone.captureRecording}
            >
              <legend>详细参数（调试专用）</legend>
              <label>
                <span className="debug-parameter-label">识别算法
                  <DebugParameterHelp
                    label="识别算法"
                    description="选择从麦克风声音估算音高的算法。不同算法对设备、琴声和环境的表现可能不同。"
                    recommendation="先使用设置页当前选择的算法；手机和平板不推荐 Pitchy。"
                  />
                </span>
                <select
                  aria-label="麦克风调试识别算法"
                  disabled={isLoadingMicrophoneAlgorithm || practiceMicrophone.status === "listening" ||
                    practiceMicrophone.status === "requesting"}
                  value={practiceMicrophonePreferences.algorithm}
                  onChange={(event) => void selectMicrophoneAlgorithm(event.target.value as PracticeMicrophoneAlgorithm)}
                >
                  <option value="mpm-c">{practiceMicrophoneAlgorithmLabel("mpm-c")}</option>
                  <option value="swiftf0">{practiceMicrophoneAlgorithmLabel("swiftf0")}</option>
                  <option value="yin">{practiceMicrophoneAlgorithmLabel("yin")}</option>
                </select>
                {practiceMicrophone.status === "listening" || practiceMicrophone.status === "requesting"
                  ? <small>请先暂停练习并释放麦克风，再切换算法或恢复默认配置。</small>
                  : null}
              </label>
              <label>
                <span className="debug-parameter-label">输入放大
                  <DebugParameterHelp label="输入放大" description="在软件分析前放大麦克风信号；琴声和环境噪声都会一起变大。" recommendation="1×。只有调试采样较弱时再尝试提高。" />
                </span>
                <select
                  value={practiceMicrophonePreferences.debugParameters.analysisGain}
                  onChange={(event) => updateMicrophoneDebugParameters({
                    analysisGain: Number(event.target.value) as PracticeMicrophoneDebugParameters["analysisGain"],
                  })}
                >
                  {PRACTICE_MICROPHONE_ANALYSIS_GAINS.map((gain) => (
                    <option key={gain} value={gain}>{gain}×</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="debug-parameter-label">识别分析间隔
                  <DebugParameterHelp label="识别分析间隔" description="两次音高分析之间的时间。间隔越短，反应可能更快，但设备计算量更大。" recommendation="自动；MPM-C/SwiftF0 为 30 ms，YIN 为 50 ms。" />
                </span>
                <select
                  value={practiceMicrophonePreferences.debugParameters.frameIntervalMs}
                  onChange={(event) => updateMicrophoneDebugParameters({
                    frameIntervalMs: event.target.value === "auto"
                      ? "auto"
                      : Number(event.target.value) as PracticeMicrophoneDebugParameters["frameIntervalMs"],
                  })}
                >
                  <option value="auto">自动</option>
                  {PRACTICE_MICROPHONE_FRAME_INTERVALS.map((interval) => (
                    <option key={interval} value={interval}>{interval} ms</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="debug-parameter-label">连续稳定帧数
                  <DebugParameterHelp label="连续稳定帧数" description="候选音高需要连续出现多少次才作为一次答题。要求更多帧可减少短暂误识别，也会增加延迟。" recommendation="默认 4 帧；1 级敏感档使用 2 帧。" />
                </span>
                <select
                  value={practiceMicrophonePreferences.debugParameters.requiredStableFrames}
                  onChange={(event) => updateMicrophoneDebugParameters({
                    requiredStableFrames: Number(event.target.value) as PracticeMicrophoneDebugParameters["requiredStableFrames"],
                  })}
                >
                  {PRACTICE_MICROPHONE_STABLE_FRAME_COUNTS.map((count) => (
                    <option key={count} value={count}>{count} 帧</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="debug-parameter-label">最短稳定时长
                  <DebugParameterHelp label="最短稳定时长" description="候选音高至少持续多久才确认。时间越短，短音更容易识别，但误触发风险会增加。" recommendation="默认 80 ms；1 级敏感档使用 50 ms。" />
                </span>
                <select
                  value={practiceMicrophonePreferences.debugParameters.requiredStableMs}
                  onChange={(event) => updateMicrophoneDebugParameters({
                    requiredStableMs: Number(event.target.value) as PracticeMicrophoneDebugParameters["requiredStableMs"],
                  })}
                >
                  {PRACTICE_MICROPHONE_STABLE_DURATIONS.map((duration) => (
                    <option key={duration} value={duration}>{duration} ms</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="debug-parameter-label">置信度门槛
                  <DebugParameterHelp label="置信度门槛" description="音高算法对候选结果的把握程度要求；提高门槛会更谨慎，也更容易漏掉弱音。" recommendation="标准档为 0.75（SwiftF0 为 0.60）；实际值随算法和敏感度档位变化。" />
                </span>
                <input
                  max={1}
                  min={0}
                  onChange={(event) => {
                    if (event.target.value !== "") {
                      updateMicrophoneDebugParameters({ confidenceThreshold: Number(event.target.value) });
                    }
                  }}
                  step={0.001}
                  type="number"
                  value={practiceMicrophonePreferences.debugParameters.confidenceThreshold}
                />
              </label>
              <label>
                <span className="debug-parameter-label">输入 RMS 门槛
                  <DebugParameterHelp label="输入 RMS 门槛" description="声音强度下限。低于此值的帧不参与答题；调低能接收更轻的声音，也可能接收更多噪声。" recommendation="标准档为 0.0018，1 级敏感档为 0.0009。" />
                </span>
                <input
                  max={0.01}
                  min={0}
                  onChange={(event) => {
                    if (event.target.value !== "") {
                      updateMicrophoneDebugParameters({ inputRmsThreshold: Number(event.target.value) });
                    }
                  }}
                  step={0.00001}
                  type="number"
                  value={practiceMicrophonePreferences.debugParameters.inputRmsThreshold}
                />
              </label>
              {microphoneConfiguration.algorithm === "mpm-c" ? (
                <label>
                  <span className="debug-parameter-label">主候选清晰度门槛
                    <DebugParameterHelp label="主候选清晰度门槛" description="Pitchy 主候选相对其他音高候选需要有多清晰；提高门槛会减少模糊候选，也可能漏掉弱音。" recommendation="0.80。" />
                  </span>
                  <input
                    max={1}
                    min={0}
                    onChange={(event) => {
                      if (event.target.value !== "") {
                        updateMicrophoneDebugParameters({ primaryClarityThreshold: Number(event.target.value) });
                      }
                    }}
                    step={0.001}
                    type="number"
                    value={practiceMicrophonePreferences.debugParameters.primaryClarityThreshold}
                  />
                </label>
              ) : null}
              {microphoneConfiguration.algorithm === "yin" ? (
                <label>
                  <span className="debug-parameter-label">YIN 阈值
                    <DebugParameterHelp label="YIN 阈值" description="YIN 用波形周期寻找基频。阈值决定接受周期候选的宽松程度；值越高越容易接受候选，值越低越严格。" recommendation="标准档为 0.15；1 级敏感档为 0.25，5 级不敏感档为 0.10。" />
                  </span>
                  <input
                    max={1}
                    min={0.01}
                    onChange={(event) => {
                      if (event.target.value !== "") {
                        updateMicrophoneDebugParameters({ yinThreshold: Number(event.target.value) });
                      }
                    }}
                    step={0.001}
                    type="number"
                    value={practiceMicrophonePreferences.debugParameters.yinThreshold}
                  />
                </label>
              ) : null}
            </fieldset>
            {isLoadingMicrophoneAlgorithm ? <span role="status">正在加载 SwiftF0 算法资源…</span> : null}
            {microphoneAlgorithmError ? <span role="alert">{microphoneAlgorithmError}</span> : null}
            <div aria-live="polite" className="practice-microphone-diagnostics-values">
              {practiceMicrophone.diagnostics ? (
                <>
                  <span>
                    Web Audio：{practiceMicrophone.diagnostics.audioContextState}
                    {" · "}{practiceMicrophone.diagnostics.audioContextSampleRate} Hz
                    {practiceMicrophone.diagnostics.trackSampleRate === null
                      ? " · 音轨未报告"
                      : ` · 音轨 ${practiceMicrophone.diagnostics.trackSampleRate} Hz`}
                  </span>
                  <span>
                    浏览器报告：{practiceMicrophone.diagnostics.channelCount ?? "声道未报告"} 声道
                    {" · AGC "}{practiceMicrophone.diagnostics.autoGainControl === null
                      ? "未报告"
                      : practiceMicrophone.diagnostics.autoGainControl ? "开" : "关"}
                    {" · 回声消除 "}{practiceMicrophone.diagnostics.echoCancellation === null
                      ? "未报告"
                      : practiceMicrophone.diagnostics.echoCancellation ? "开" : "关"}
                    {" · 降噪 "}{practiceMicrophone.diagnostics.noiseSuppression === null
                      ? "未报告"
                      : practiceMicrophone.diagnostics.noiseSuppression ? "开" : "关"}
                  </span>
                  <span>
                    原始 RMS：{practiceMicrophone.diagnostics.inputRms.toFixed(5)}
                    {microphoneConfiguration.analysisGain > 1
                      ? ` · 算法 RMS ${practiceMicrophone.diagnostics.analysisRms.toFixed(5)} (${microphoneConfiguration.analysisGain}×)`
                      : ""}
                    {" · 门槛 "}{practiceMicrophone.diagnostics.inputRmsThreshold.toFixed(5)}
                  </span>
                  <span>
                    算法候选：{practiceMicrophone.diagnostics.candidateNote ?? "无标准音名"}
                    {practiceMicrophone.diagnostics.candidateFrequencyHz === null
                      ? ""
                      : ` (${practiceMicrophone.diagnostics.candidateFrequencyHz.toFixed(1)} Hz)`}
                    {" · 置信度 "}{practiceMicrophone.diagnostics.candidateConfidence === null
                      ? "--"
                      : practiceMicrophone.diagnostics.candidateConfidence.toFixed(3)}
                    {` / ${practiceMicrophone.diagnostics.confidenceThreshold.toFixed(2)}`}
                  </span>
                  <strong>{practiceMicrophone.diagnostics.outcome}</strong>
                </>
              ) : (
                <span>连接麦克风后显示实时诊断。</span>
              )}
            </div>
            {practiceMicrophone.captureStatus ? <p role="status">{practiceMicrophone.captureStatus}</p> : null}
            <div className="practice-microphone-debug-actions">
              <button
                disabled={practiceMicrophone.captureRecording || isLoadingMicrophoneAlgorithm ||
                  practiceMicrophone.status === "listening" || practiceMicrophone.status === "requesting"}
                onClick={restoreMicrophoneDebugDefaults}
                type="button"
              >
                <RotateCcw size={14} />
                恢复默认配置
              </button>
              <button
                className="practice-microphone-copy-summary"
                disabled={practiceMicrophone.status !== "listening"}
                onClick={() => void practiceMicrophone.copyDiagnosticSummary(microphoneCaptureAnalysis ?? undefined)}
                type="button"
              >
                <Copy size={14} />
                复制诊断摘要
              </button>
            </div>
          </div>
        </dialog>
  );
}
