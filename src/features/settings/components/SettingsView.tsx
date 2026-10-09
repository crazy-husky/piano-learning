import { DatabaseBackup, FolderOpen, RotateCcw, Upload } from "lucide-react";
import { type Dispatch, type RefObject, type SetStateAction, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  chooseBackupDirectory,
  resolveBackupConflict,
  restoreBackupFromDirectory,
  supportsFileBackups,
  type BackupConflictResolution,
  type BackupDirectorySelectionResult,
} from "../../../data/backup";
import { getBackupState } from "../../../data/db";
import { backupText, formatBackupConflictDetail } from "../../../domain/backupText";
import { normalizeAnswerKeyboardScale, normalizePianoVolume } from "../../../domain/settings";
import type { AppSettings, BackupState } from "../../../domain/types";
import type { MidiInputController } from "../../../midi/useMidiInput";
import type { PageAppearancePreferences } from "../../../shared/appearance/pageAppearance";
import { useConfirmDialog } from "../../../shared/components/ui/ConfirmDialog";
import { ToggleSwitch } from "../../../shared/components/ui/ToggleSwitch";
import type { PracticePagePreferences } from "../../../shared/preferences/practicePagePreferences";
import {
  PRACTICE_MICROPHONE_SENSITIVITY_LEVELS,
  practiceMicrophoneAlgorithmLabel,
  practiceMicrophoneDebugParametersForSensitivityLevel,
  practiceMicrophoneSensitivityLevelLabel,
  type PracticeMicrophonePreferences,
  withPracticeMicrophoneAlgorithm,
} from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import {
  ensureSwiftF0PracticeRuntimeReady,
  isSwiftF0PracticeRuntimeReady,
  releaseSwiftF0PracticeRuntime,
} from "../../vocal-pitch/logic/swiftF0PracticeClient";
import { BackupConflictResolver } from "../../../shared/components/BackupConflictResolver";
import { PausedPlaybackBpmInput } from "../../../shared/components/PausedPlaybackBpmInput";
import { PlayableKeyboardPreview } from "../../../shared/components/PlayableKeyboardPreview";
import { handleWheelStep } from "../logic/settingsWheel";
import {
  DEFAULT_STAFF_PAGE_UI_PREFERENCES,
  parseStaffPageUiPreferences,
  STAFF_PAGE_UI_PREFERENCES_KEY,
} from "../../../shared/preferences/staffPageUiPreferences";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";

type StoredBackupState = BackupState & { restoreRequiredBeforeBackup?: boolean };
type SettingsActionFeedback = { description?: string; kind?: "danger"; title: string };
const PIANO_VOLUME_STEP = 0.05;
const ANSWER_KEYBOARD_SCALE_STEP = 0.05;

function useWheelSteps<T extends HTMLElement>(
  elementRef: RefObject<T>,
  onStep: (direction: -1 | 1) => void,
): void {
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    function handleWheel(event: WheelEvent): void {
      handleWheelStep(event, onStepRef.current);
    }

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [elementRef]);
}

function truncateStart(value: string, maxLength = 24): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `...${value.slice(-(maxLength - 3))}`;
}

function isUserAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

interface SettingsViewProps {
  pageAppearancePreferences: PageAppearancePreferences;
  practiceMicrophonePreferences: PracticeMicrophonePreferences;
  practicePagePreferences: PracticePagePreferences;
  settings: AppSettings;
  backupState: BackupState;
  onPageAppearancePreferencesChange: (preferences: PageAppearancePreferences) => void;
  onPracticeMicrophonePreferencesChange: Dispatch<SetStateAction<PracticeMicrophonePreferences>>;
  onPracticePagePreferencesChange: (preferences: PracticePagePreferences) => void;
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
  onDataChanged: () => Promise<void>;
  onRestoreDefaultConfiguration: () => Promise<void>;
  midi: MidiInputController;
}

export function SettingsView({
  pageAppearancePreferences,
  practiceMicrophonePreferences,
  practicePagePreferences,
  settings,
  backupState,
  onPageAppearancePreferencesChange,
  onPracticeMicrophonePreferencesChange,
  onPracticePagePreferencesChange,
  onSettingsSaved,
  onDataChanged,
  onRestoreDefaultConfiguration,
  midi,
}: SettingsViewProps): JSX.Element {
  const confirmDialog = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [isRestoringConfiguration, setIsRestoringConfiguration] = useState(false);
  const [selectedMicrophoneAlgorithm, setSelectedMicrophoneAlgorithm] = useState(
    practiceMicrophonePreferences.algorithm,
  );
  const [isLoadingMicrophoneAlgorithm, setIsLoadingMicrophoneAlgorithm] = useState(false);
  const [microphoneAlgorithmError, setMicrophoneAlgorithmError] = useState<string | null>(null);
  const [pianoVolumeDraft, setPianoVolumeDraft] = useState(() => normalizePianoVolume(settings.pianoVolume));
  const [answerKeyboardScaleDraft, setAnswerKeyboardScaleDraft] = useState(() =>
    normalizeAnswerKeyboardScale(settings.answerKeyboardScale),
  );
  const [staffPageUiPreferences, setStaffPageUiPreferences] = useLocalStorageState(
    STAFF_PAGE_UI_PREFERENCES_KEY,
    DEFAULT_STAFF_PAGE_UI_PREFERENCES,
    { parse: parseStaffPageUiPreferences },
  );
  const pianoVolumeRef = useRef(pianoVolumeDraft);
  const answerKeyboardScaleRef = useRef(answerKeyboardScaleDraft);
  const pianoVolumeControlRef = useRef<HTMLLabelElement>(null);
  const answerKeyboardScaleControlRef = useRef<HTMLLabelElement>(null);
  const storedBackupState = backupState as StoredBackupState;
  const backupBlockedUntilSync = Boolean(
    backupState.dataConflictBeforeBackup ?? backupState.syncRequiredBeforeBackup ?? storedBackupState.restoreRequiredBeforeBackup,
  );
  const hasBackupSnapshot = Boolean(backupBlockedUntilSync || backupState.lastSeenBackupVersion);
  const pianoVolumePercent = Math.round(pianoVolumeDraft * 100);
  const answerKeyboardScalePercent = Math.round(answerKeyboardScaleDraft * 100);

  useEffect(() => {
    const nextPianoVolume = normalizePianoVolume(settings.pianoVolume);
    pianoVolumeRef.current = nextPianoVolume;
    setPianoVolumeDraft(nextPianoVolume);
  }, [settings.pianoVolume]);

  useEffect(() => {
    const nextScale = normalizeAnswerKeyboardScale(settings.answerKeyboardScale);
    answerKeyboardScaleRef.current = nextScale;
    setAnswerKeyboardScaleDraft(nextScale);
  }, [settings.answerKeyboardScale]);

  useEffect(() => {
    setSelectedMicrophoneAlgorithm(practiceMicrophonePreferences.algorithm);
  }, [practiceMicrophonePreferences.algorithm]);

  async function saveSettings(next: AppSettings): Promise<void> {
    await onSettingsSaved(next);
  }

  async function selectMicrophoneAlgorithm(algorithm: PracticeMicrophonePreferences["algorithm"]): Promise<void> {
    if (algorithm === practiceMicrophonePreferences.algorithm || isLoadingMicrophoneAlgorithm) {
      return;
    }
    setSelectedMicrophoneAlgorithm(algorithm);
    setMicrophoneAlgorithmError(null);

    if (algorithm === "swiftf0" && !isSwiftF0PracticeRuntimeReady()) {
      setIsLoadingMicrophoneAlgorithm(true);
      try {
        await ensureSwiftF0PracticeRuntimeReady();
      } catch (error) {
        setSelectedMicrophoneAlgorithm(practiceMicrophonePreferences.algorithm);
        setMicrophoneAlgorithmError(
          `算法资源加载失败：${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      } finally {
        setIsLoadingMicrophoneAlgorithm(false);
      }
    } else if (algorithm !== "swiftf0") {
      releaseSwiftF0PracticeRuntime();
    }

    onPracticeMicrophonePreferencesChange((current) => withPracticeMicrophoneAlgorithm(current, algorithm));
  }

  async function restoreDefaultConfiguration(): Promise<void> {
    const confirmed = await confirmDialog({
      title: "恢复所有配置默认值？",
      description: "这会重置页面、练习、识谱、麦克风和设备选择等设置，并解除此浏览器的备份目录绑定。备份目录中的文件、练习与复习记录、识谱回忆记录、音频素材和数据集身份会保留。",
      confirmLabel: "恢复默认配置",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setIsRestoringConfiguration(true);
    try {
      releaseSwiftF0PracticeRuntime();
      await onRestoreDefaultConfiguration();
    } finally {
      setIsRestoringConfiguration(false);
      setBusy(false);
    }
  }

  function savePianoVolume(nextVolume: number): void {
    const normalizedVolume = normalizePianoVolume(nextVolume);
    if (normalizedVolume === pianoVolumeRef.current) {
      return;
    }
    pianoVolumeRef.current = normalizedVolume;
    setPianoVolumeDraft(normalizedVolume);
    void saveSettings({ ...settings, pianoVolume: normalizedVolume });
  }

  function saveAnswerKeyboardScale(nextScale: number): void {
    const normalizedScale = normalizeAnswerKeyboardScale(nextScale);
    if (normalizedScale === answerKeyboardScaleRef.current) {
      return;
    }
    answerKeyboardScaleRef.current = normalizedScale;
    setAnswerKeyboardScaleDraft(normalizedScale);
    void saveSettings({ ...settings, answerKeyboardScale: normalizedScale });
  }

  useWheelSteps(pianoVolumeControlRef, (direction) => {
    savePianoVolume(pianoVolumeRef.current + direction * PIANO_VOLUME_STEP);
  });
  useWheelSteps(answerKeyboardScaleControlRef, (direction) => {
    saveAnswerKeyboardScale(answerKeyboardScaleRef.current + direction * ANSWER_KEYBOARD_SCALE_STEP);
  });

  function describeDirectorySelection(result: BackupDirectorySelectionResult, selectedBackupState: BackupState): SettingsActionFeedback {
    if (result === "diverged") {
      return {
        kind: "danger",
        title: backupText.titles.dataConflict,
        description: formatBackupConflictDetail(selectedBackupState),
      };
    }
    if (result === "synced-up") {
      return {
        title: backupText.titles.importSuccess,
        description: backupText.messages.importSuccessDetail,
      };
    }
    return { title: backupText.messages.directorySelected };
  }

  async function runBusy(action: () => Promise<SettingsActionFeedback | void>, doneMessage: string): Promise<void> {
    setBusy(true);
    try {
      const result = await action();
      await onDataChanged();
      const feedback = typeof result === "object" && result !== null ? result : undefined;
      if (feedback?.kind === "danger") {
        toast.error(feedback.title, { description: feedback.description });
      } else {
        toast.success(feedback?.title ?? doneMessage, { description: feedback?.description });
      }
    } catch (error) {
      if (isUserAbort(error)) {
        return;
      }
      toast.error("操作失败", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  function resolveConflict(resolution: BackupConflictResolution): Promise<void> {
    return runBusy(async () => {
      try {
        await resolveBackupConflict(resolution);
      } catch (error) {
        await onDataChanged();
        throw error;
      }
    }, backupText.messages.conflictResolvedDetail);
  }

  return (
    <section aria-busy={isRestoringConfiguration} className="settings-shell">
      <div className="stats-header">
        <div>
          <h1>设置</h1>
          <p>全局偏好和备份</p>
        </div>
        <DatabaseBackup size={24} />
      </div>

      <fieldset className="settings-restore-lock" disabled={isRestoringConfiguration}>
      <div className="panel settings-panel page-appearance-panel">
        <div className="panel-heading">
          <h2>页面设置</h2>
        </div>
        <div className="setting-row page-appearance-mode-row">
          <div>
            <strong>夜间模式</strong>
            <span>应用于所有页面</span>
          </div>
          <select
            aria-label="夜间模式"
            className="page-appearance-mode"
            value={pageAppearancePreferences.mode}
            onChange={(event) => onPageAppearancePreferencesChange({
              ...pageAppearancePreferences,
              mode: event.target.value as PageAppearancePreferences["mode"],
            })}
          >
            <option value="off">关闭</option>
            <option value="on">开启</option>
            <option value="auto">自动</option>
          </select>
        </div>
        {pageAppearancePreferences.mode === "auto" ? (
          <div className="setting-row page-appearance-hours-row">
            <div>
              <strong>自动时段</strong>
              <span>按设备本地时间启用夜间模式；开始和结束小时相同时全天启用</span>
            </div>
            <div aria-label="夜间模式自动时段" className="page-appearance-hours">
              <label>
                <span>开始</span>
                <select
                  aria-label="夜间模式开始小时"
                  value={pageAppearancePreferences.startHour}
                  onChange={(event) => onPageAppearancePreferencesChange({
                    ...pageAppearancePreferences,
                    startHour: Number(event.target.value),
                  })}
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>{String(hour).padStart(2, "0")} 时</option>
                  ))}
                </select>
              </label>
              <label>
                <span>结束</span>
                <select
                  aria-label="夜间模式结束小时"
                  value={pageAppearancePreferences.endHour}
                  onChange={(event) => onPageAppearancePreferencesChange({
                    ...pageAppearancePreferences,
                    endHour: Number(event.target.value),
                  })}
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>{String(hour).padStart(2, "0")} 时</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : null}
      </div>

      <div className="panel settings-panel">
        <div className="setting-row">
          <div>
            <strong>练习页面离开多久暂停</strong>
            <span>切换应用或浏览器标签页后自动暂停</span>
          </div>
          <select
            aria-label="练习页面离开多久暂停"
            value={practicePagePreferences.focusLossPauseSeconds}
            onChange={(event) => onPracticePagePreferencesChange({
              ...practicePagePreferences,
              focusLossPauseSeconds: Number(event.target.value) as PracticePagePreferences["focusLossPauseSeconds"],
            })}
          >
            <option value={0}>立刻</option>
            <option value={10}>10 秒</option>
            <option value={20}>20 秒</option>
            <option value={30}>30 秒</option>
          </select>
        </div>
      </div>

      <div className="panel settings-panel">
        <div className="panel-heading">
          <h2>麦克风答题</h2>
        </div>
        <div className="setting-row">
          <div>
            <strong>识别算法</strong>
            <span>仅影响练习中的麦克风答题</span>
            {isLoadingMicrophoneAlgorithm ? (
              <span aria-live="polite" role="status">加载算法所需资源中...</span>
            ) : null}
            {microphoneAlgorithmError ? (
              <span aria-live="assertive" role="alert">{microphoneAlgorithmError}</span>
            ) : null}
          </div>
          <select
            aria-label="麦克风识别算法"
            disabled={isLoadingMicrophoneAlgorithm}
            value={selectedMicrophoneAlgorithm}
            onChange={(event) => void selectMicrophoneAlgorithm(
              event.target.value as PracticeMicrophonePreferences["algorithm"],
            )}
          >
            <option value="mpm-c">{practiceMicrophoneAlgorithmLabel("mpm-c")}</option>
            <option value="swiftf0">{practiceMicrophoneAlgorithmLabel("swiftf0")}</option>
            <option value="yin">{practiceMicrophoneAlgorithmLabel("yin")}</option>
          </select>
        </div>
        <div className="setting-row settings-switch-row">
          <div>
            <strong>调试开关</strong>
            <span>开启后由详细参数接管识别，算法敏感度档位暂时隐藏；关闭后恢复之前选择的档位。详细参数可在练习页的“调试设置”中调整。</span>
          </div>
          <div className="settings-switch-control">
            <span>{practiceMicrophonePreferences.debugMode ? "开启" : "关闭"}</span>
            <ToggleSwitch
              aria-label="调试开关"
              checked={practiceMicrophonePreferences.debugMode}
              disabled={isLoadingMicrophoneAlgorithm}
              onCheckedChange={(debugMode) => onPracticeMicrophonePreferencesChange((current) => ({
                ...current,
                debugMode,
              }))}
            />
          </div>
        </div>
        {!practiceMicrophonePreferences.debugMode ? (
          <>
            <div className="setting-row">
              <div>
                <strong>算法敏感度</strong>
              </div>
              <select
                aria-label="算法敏感度"
                value={practiceMicrophonePreferences.sensitivityLevel}
                onChange={(event) => {
                  const sensitivityLevel = Number(event.target.value) as PracticeMicrophonePreferences["sensitivityLevel"];
                  onPracticeMicrophonePreferencesChange((current) => ({
                    ...current,
                    sensitivityLevel,
                    ...(!current.debugMode
                      ? {
                          debugParameters: practiceMicrophoneDebugParametersForSensitivityLevel(
                            current.algorithm,
                            sensitivityLevel,
                          ),
                        }
                      : {}),
                  }));
                }}
              >
                {PRACTICE_MICROPHONE_SENSITIVITY_LEVELS.map((level) => (
                  <option key={level} value={level}>{practiceMicrophoneSensitivityLevelLabel(level)}</option>
                ))}
              </select>
            </div>
            <div className="setting-row">
              <div className="practice-microphone-sensitivity-warning-wrap">
                <p className="practice-microphone-sensitivity-warning">
                  敏感度越高，越容易识别轻声和短促弹奏；但也更容易把环境噪声误认为音符，增加误报。
                </p>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="panel settings-panel">
        <div className="setting-row">
          <div>
            <strong>离开阈值</strong>
            <span>聚焦但无输入后标记中断</span>
          </div>
          <select
            value={settings.inactivityThresholdSeconds}
            onChange={(event) =>
              void saveSettings({ ...settings, inactivityThresholdSeconds: Number(event.target.value) })
            }
          >
            <option value={15}>15 秒</option>
            <option value={30}>30 秒</option>
            <option value={45}>45 秒</option>
            <option value={60}>60 秒</option>
          </select>
        </div>

        <div className="setting-row">
          <div>
            <strong>正确后延迟</strong>
            <span>答对后自动进入下一题</span>
          </div>
          <select
            value={settings.correctDelayMs}
            onChange={(event) => void saveSettings({ ...settings, correctDelayMs: Number(event.target.value) })}
          >
            <option value={0}>0ms</option>
            <option value={300}>300ms</option>
            <option value={400}>400ms</option>
            <option value={500}>500ms</option>
            <option value={800}>800ms</option>
          </select>
        </div>

        <div className="setting-row">
          <div>
            <strong>音量</strong>
            <span>目标音、学习页和琴键预览播放音量</span>
          </div>
          <label className="volume-control" ref={pianoVolumeControlRef}>
            <input
              aria-label="音量"
              max={100}
              min={0}
              step={5}
              type="range"
              value={pianoVolumePercent}
              onChange={(event) => savePianoVolume(Number(event.target.value) / 100)}
            />
            <span>{pianoVolumePercent}%</span>
          </label>
        </div>

        <div className="setting-row">
          <div>
            <strong>播放剩余 BPM</strong>
            <span>暂停时按谱面时值播放的速度</span>
          </div>
          <PausedPlaybackBpmInput
            className="setting-number-input"
            value={staffPageUiPreferences.pausedPlaybackBpm}
            onChange={(pausedPlaybackBpm) =>
              setStaffPageUiPreferences((current) => ({
                ...current,
                pausedPlaybackBpm,
              }))
            }
          />
        </div>

        <div className="setting-row">
          <div>
            <strong>谱页平滑滚动</strong>
            <span>换行时平滑上移，过渡时间不计入练习与识别用时</span>
          </div>
          <label className="toggle">
            <input
              aria-label="谱页平滑滚动"
              checked={staffPageUiPreferences.smoothStaffPageScroll}
              type="checkbox"
              onChange={(event) =>
                setStaffPageUiPreferences((current) => ({
                  ...current,
                  smoothStaffPageScroll: event.target.checked,
                }))
              }
            />
            <span aria-hidden="true" />
          </label>
        </div>
      </div>

      <div className="panel settings-panel keyboard-settings-panel">
        <div className="setting-row">
          <div>
            <strong>MIDI 键盘</strong>
            <span>
              {midi.status === "insecure-context"
                ? "当前页面不是安全连接，请改用 HTTPS 或本机 localhost"
                : midi.status === "unsupported"
                  ? "当前浏览器不支持 Web MIDI"
                  : midi.status === "requesting"
                    ? "正在请求 MIDI 权限…"
                    : midi.isConnected
                      ? `已连接：${midi.selectedInput?.name}`
                      : midi.status === "ready"
                        ? midi.inputs.length > 0 ? "请选择 MIDI 输入设备" : "未检测到可用的 MIDI 输入"
                        : midi.errorMessage ?? "连接后可选择设备并测试按键"}
            </span>
          </div>
          {midi.status === "ready" && midi.inputs.length > 0 ? (
            <select
              aria-label="MIDI 输入设备"
              value={midi.selectedInput ? midi.selectedInputId : ""}
              onChange={(event) => midi.selectInput(event.target.value)}
            >
              {!midi.selectedInput ? <option disabled value="">请选择 MIDI 输入</option> : null}
              {midi.inputs.map((input) => (
                <option key={input.id} value={input.id}>
                  {input.manufacturer ? `${input.manufacturer} · ` : ""}{input.name}
                </option>
              ))}
            </select>
          ) : (
            <button
              disabled={
                midi.status === "requesting" ||
                midi.status === "insecure-context" ||
                midi.status === "unsupported"
              }
              onClick={() => void midi.connect()}
            >
              {midi.status === "denied" || midi.status === "error" ? "重新连接" : "连接 MIDI"}
            </button>
          )}
        </div>
        {midi.isConnected ? (
          <p className="keyboard-settings-description" aria-live="polite">
            测试输入：{midi.lastNote
              ? `${midi.lastNote.keyName}${midi.lastNote.octave}`
              : "请按下一个琴键"}
          </p>
        ) : null}
        <div className="setting-row keyboard-size-row">
          <div>
            <strong>琴键大小</strong>
            <span>练习页以此尺寸为基准</span>
          </div>
          <label className="volume-control" ref={answerKeyboardScaleControlRef}>
            <input
              aria-label="琴键大小"
              max={150}
              min={70}
              step={5}
              type="range"
              value={answerKeyboardScalePercent}
              onChange={(event) => saveAnswerKeyboardScale(Number(event.target.value) / 100)}
            />
            <span>{answerKeyboardScalePercent}%</span>
          </label>
        </div>
        <p className="keyboard-settings-description">
          预览音区 C4–C5，可按住多键试听和弦；练习页仅白键可作答，空间不足时会先缩空白，再缩小琴键。
        </p>
        <PlayableKeyboardPreview scale={answerKeyboardScaleDraft} />
      </div>

      <div className="panel settings-panel">
        <div className="backup-status">
          <div>
            <strong>备份目录</strong>
            <span title={backupState.directoryName}>
              {backupState.directoryName ? truncateStart(backupState.directoryName) : backupText.status.unselected}
            </span>
          </div>
          <div>
            <strong>数据更新</strong>
            <span>{backupState.backupDataModifiedAt ? new Date(backupState.backupDataModifiedAt).toLocaleString() : "-"}</span>
          </div>
          <div>
            <strong>状态</strong>
            <span>{backupState.lastError ?? backupText.status.normal}</span>
          </div>
        </div>
        <div className="action-row">
          <button
            disabled={!supportsFileBackups() || busy}
            onClick={() =>
              void runBusy(async () => {
                const result = await chooseBackupDirectory();
                return describeDirectorySelection(result, await getBackupState());
              }, backupText.messages.directorySelected)
            }
          >
            <FolderOpen size={18} />
            {backupText.labels.chooseDirectory}
          </button>
          {!backupBlockedUntilSync ? (
            <button
              disabled={!backupState.directoryHandle || !hasBackupSnapshot || busy}
              onClick={async () => {
                if (!backupState.directoryHandle) {
                  return;
                }
                if (await confirmDialog({
                  title: "确定导入备份？",
                  description: backupText.messages.browserDataWillBeReplaced,
                  confirmLabel: backupText.labels.importBackup,
                  destructive: true,
                })) {
                  void runBusy(() => restoreBackupFromDirectory(backupState.directoryHandle!), backupText.titles.importSuccess);
                }
              }}
            >
              <Upload size={18} />
              {backupText.labels.importBackup}
            </button>
          ) : null}
        </div>
        {backupBlockedUntilSync ? (
          <>
            <div className="status-line danger">{formatBackupConflictDetail(backupState)}</div>
            <BackupConflictResolver backupState={backupState} disabled={busy} onResolve={resolveConflict} />
          </>
        ) : backupState.directoryHandle && !hasBackupSnapshot ? (
          <div className="status-line">{backupText.messages.emptyBackupDirectory}</div>
        ) : backupState.directoryHandle ? (
          <div className="status-line">{backupText.messages.backupEnabled}</div>
        ) : null}
        {!supportsFileBackups() ? <div className="status-line">{backupText.status.unsupportedFileSystemAccess}</div> : null}
      </div>

      <div className="panel settings-panel settings-reset-panel">
        <div>
          <strong>恢复默认配置</strong>
          <span>重置所有应用配置和备份目录绑定；学习数据及备份目录中的文件会保留。</span>
        </div>
        <button
          className="danger-action"
          disabled={busy || isLoadingMicrophoneAlgorithm}
          onClick={() => void restoreDefaultConfiguration()}
          type="button"
        >
          <RotateCcw size={16} />
          {isRestoringConfiguration ? "正在恢复..." : "恢复默认配置"}
        </button>
      </div>
      </fieldset>
    </section>
  );
}
