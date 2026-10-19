import { DatabaseBackup, FolderOpen, RotateCcw, Upload } from "lucide-react";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
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
  practiceMicrophoneSensitivityLevelLabel,
  type PracticeMicrophonePreferences,
} from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import { releaseSwiftF0PracticeRuntime } from "../../vocal-pitch/logic/swiftF0PracticeClient";
import { BackupConflictResolver } from "../../../shared/components/BackupConflictResolver";
import { PausedPlaybackBpmInput } from "../../../shared/components/PausedPlaybackBpmInput";
import { PlayableKeyboardPreview } from "../../../shared/components/PlayableKeyboardPreview";
import { handleWheelStep } from "../logic/settingsWheel";
import { formatDateTime } from "../../../shared/formatDateTime";
import type { AppUpdateStatus } from "../../../app/useAppUpdateNotice";
import {
  DEFAULT_STAFF_PAGE_UI_PREFERENCES,
  parseStaffPageUiPreferences,
  STAFF_PAGE_UI_PREFERENCES_KEY,
} from "../../../shared/preferences/staffPageUiPreferences";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";
import {
  clearGlobalDebugEvents,
  GLOBAL_DEBUG_ENABLED_KEY,
  GLOBAL_DEBUG_MODE_CHANGE_EVENT,
  isGlobalDebugEnabled,
  setGlobalDebugEnabled,
} from "../../../shared/diagnostics/globalDebug";
import { LOCAL_STORAGE_PREFERENCES_RESET_EVENT } from "../../../storage/localPreferenceEvents";
import { MicrophoneParameterBenchmarkDialog } from "./MicrophoneParameterBenchmarkDialog";

type StoredBackupState = BackupState & { restoreRequiredBeforeBackup?: boolean };
type SettingsActionFeedback = { description?: string; kind?: "danger"; title: string };
const PIANO_VOLUME_STEP = 0.05;
const ANSWER_KEYBOARD_SCALE_STEP = 0.05;
const SLIDER_SAVE_DEBOUNCE_MS = 450;

function useWheelSteps<T extends HTMLElement>(
  elementRef: RefObject<T>,
  onStep: (direction: -1 | 1) => void
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
  appUpdateStatus: AppUpdateStatus;
  appUpdateMessage: string;
  hasUpdateAvailable: boolean;
  hasPreparedUpdate: boolean;
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
  onCheckForUpdates: () => void;
  onApplyUpdate: () => void;
}

export function SettingsView({
  appUpdateStatus,
  appUpdateMessage,
  hasUpdateAvailable,
  hasPreparedUpdate,
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
  onCheckForUpdates,
  onApplyUpdate,
}: SettingsViewProps): JSX.Element {
  const confirmDialog = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [isRestoringConfiguration, setIsRestoringConfiguration] = useState(false);
  const [globalDebugEnabled, setGlobalDebugEnabledState] = useState(isGlobalDebugEnabled);
  const isAppUpdateBusy =
    appUpdateStatus === "checking" ||
    appUpdateStatus === "preparing" ||
    appUpdateStatus === "reloading";

  useEffect(() => {
    const syncGlobalDebugEnabled = (event?: Event): void => {
      const enabled = (event as CustomEvent<{ enabled?: unknown }> | undefined)?.detail?.enabled;
      setGlobalDebugEnabledState(typeof enabled === "boolean" ? enabled : isGlobalDebugEnabled());
    };
    const resetGlobalDebugEnabled = (): void => {
      setGlobalDebugEnabledState(false);
      clearGlobalDebugEvents();
    };
    const syncFromOtherTab = (event: StorageEvent): void => {
      if (event.key !== GLOBAL_DEBUG_ENABLED_KEY && event.key !== null) return;
      setGlobalDebugEnabledState(isGlobalDebugEnabled());
    };

    window.addEventListener(GLOBAL_DEBUG_MODE_CHANGE_EVENT, syncGlobalDebugEnabled);
    window.addEventListener(LOCAL_STORAGE_PREFERENCES_RESET_EVENT, resetGlobalDebugEnabled);
    window.addEventListener("storage", syncFromOtherTab);
    return () => {
      window.removeEventListener(GLOBAL_DEBUG_MODE_CHANGE_EVENT, syncGlobalDebugEnabled);
      window.removeEventListener(LOCAL_STORAGE_PREFERENCES_RESET_EVENT, resetGlobalDebugEnabled);
      window.removeEventListener("storage", syncFromOtherTab);
    };
  }, []);
  const [isMicrophoneBenchmarkOpen, setIsMicrophoneBenchmarkOpen] = useState(false);
  const [pianoVolumeDraft, setPianoVolumeDraft] = useState(() =>
    normalizePianoVolume(settings.pianoVolume)
  );
  const [answerKeyboardScaleDraft, setAnswerKeyboardScaleDraft] = useState(() =>
    normalizeAnswerKeyboardScale(settings.answerKeyboardScale)
  );
  const [staffPageUiPreferences, setStaffPageUiPreferences] = useLocalStorageState(
    STAFF_PAGE_UI_PREFERENCES_KEY,
    DEFAULT_STAFF_PAGE_UI_PREFERENCES,
    { parse: parseStaffPageUiPreferences }
  );
  const pianoVolumeRef = useRef(pianoVolumeDraft);
  const answerKeyboardScaleRef = useRef(answerKeyboardScaleDraft);
  const pendingSliderSettingsRef = useRef<Partial<AppSettings> | null>(null);
  const sliderSaveTimerRef = useRef<number | null>(null);
  const onSettingsSavedRef = useRef(onSettingsSaved);
  const settingsRef = useRef(settings);
  onSettingsSavedRef.current = onSettingsSaved;
  settingsRef.current = settings;
  const pianoVolumeControlRef = useRef<HTMLLabelElement>(null);
  const answerKeyboardScaleControlRef = useRef<HTMLLabelElement>(null);
  const storedBackupState = backupState as StoredBackupState;
  const backupBlockedUntilSync = Boolean(
    backupState.dataConflictBeforeBackup ??
    backupState.syncRequiredBeforeBackup ??
    storedBackupState.restoreRequiredBeforeBackup
  );
  const hasBackupSnapshot = Boolean(backupBlockedUntilSync || backupState.lastSeenBackupVersion);
  const pianoVolumePercent = Math.round(pianoVolumeDraft * 100);
  const answerKeyboardScalePercent = Math.round(answerKeyboardScaleDraft * 100);

  useEffect(
    () => () => {
      if (sliderSaveTimerRef.current !== null) {
        window.clearTimeout(sliderSaveTimerRef.current);
      }
      const pendingSettings = pendingSliderSettingsRef.current;
      pendingSliderSettingsRef.current = null;
      if (pendingSettings) {
        void onSettingsSavedRef.current({ ...settingsRef.current, ...pendingSettings });
      }
    },
    []
  );

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

  async function saveSettings(next: AppSettings): Promise<void> {
    await onSettingsSaved(next);
  }

  function scheduleSliderSettingsSave(update: Partial<AppSettings>): void {
    pendingSliderSettingsRef.current = {
      ...pendingSliderSettingsRef.current,
      ...update,
    };
    if (sliderSaveTimerRef.current !== null) {
      window.clearTimeout(sliderSaveTimerRef.current);
    }
    sliderSaveTimerRef.current = window.setTimeout(() => {
      const pendingSettings = pendingSliderSettingsRef.current;
      pendingSliderSettingsRef.current = null;
      sliderSaveTimerRef.current = null;
      if (pendingSettings) {
        void onSettingsSavedRef.current({ ...settingsRef.current, ...pendingSettings });
      }
    }, SLIDER_SAVE_DEBOUNCE_MS);
  }

  async function flushPendingSliderSettingsSave(): Promise<void> {
    if (sliderSaveTimerRef.current !== null) {
      window.clearTimeout(sliderSaveTimerRef.current);
      sliderSaveTimerRef.current = null;
    }
    const pendingSettings = pendingSliderSettingsRef.current;
    pendingSliderSettingsRef.current = null;
    if (pendingSettings) {
      await onSettingsSavedRef.current({ ...settingsRef.current, ...pendingSettings });
    }
  }

  async function restoreDefaultConfiguration(): Promise<void> {
    const confirmed = await confirmDialog({
      title: "恢复所有配置默认值？",
      description:
        "这会重置页面、练习、识谱、麦克风和设备选择等设置，并解除此浏览器的备份目录绑定。备份目录中的文件、练习与复习记录、识谱回忆记录、音频素材和数据集身份会保留。",
      confirmLabel: "恢复默认配置",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setIsRestoringConfiguration(true);
    try {
      await flushPendingSliderSettingsSave();
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
    scheduleSliderSettingsSave({ pianoVolume: normalizedVolume });
  }

  function saveAnswerKeyboardScale(nextScale: number): void {
    const normalizedScale = normalizeAnswerKeyboardScale(nextScale);
    if (normalizedScale === answerKeyboardScaleRef.current) {
      return;
    }
    answerKeyboardScaleRef.current = normalizedScale;
    setAnswerKeyboardScaleDraft(normalizedScale);
    scheduleSliderSettingsSave({ answerKeyboardScale: normalizedScale });
  }

  useWheelSteps(pianoVolumeControlRef, (direction) => {
    savePianoVolume(pianoVolumeRef.current + direction * PIANO_VOLUME_STEP);
  });
  useWheelSteps(answerKeyboardScaleControlRef, (direction) => {
    saveAnswerKeyboardScale(
      answerKeyboardScaleRef.current + direction * ANSWER_KEYBOARD_SCALE_STEP
    );
  });

  function describeDirectorySelection(
    result: BackupDirectorySelectionResult
  ): SettingsActionFeedback {
    if (result === "diverged") {
      return {
        kind: "danger",
        title: backupText.titles.dataConflict,
        description: formatBackupConflictDetail(),
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

  async function runBusy(
    action: () => Promise<SettingsActionFeedback | void>,
    doneMessage: string
  ): Promise<void> {
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
      toast.error("操作失败", {
        description: error instanceof Error ? error.message : String(error),
      });
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
          <p>管理练习、设备与界面偏好</p>
        </div>
        <DatabaseBackup size={24} />
      </div>

      <fieldset className="settings-restore-lock" disabled={isRestoringConfiguration}>
        <div className="settings-cards">
          <section className="panel settings-panel settings-category-card">
            <div className="panel-heading">
              <h2>外观与体验</h2>
            </div>
            <div className="setting-row">
              <div>
                <strong>夜间模式</strong>
                <span>可始终开启，也可按本地时段自动切换</span>
              </div>
              <div className="settings-mode-controls">
                <ToggleSwitch
                  aria-label="夜间模式"
                  checked={pageAppearancePreferences.mode !== "off"}
                  onCheckedChange={(enabled) =>
                    onPageAppearancePreferencesChange({
                      ...pageAppearancePreferences,
                      mode: enabled ? "on" : "off",
                    })
                  }
                />
                <select
                  aria-label="夜间模式时间方式"
                  disabled={pageAppearancePreferences.mode === "off"}
                  value={pageAppearancePreferences.mode === "auto" ? "auto" : "manual"}
                  onChange={(event) =>
                    onPageAppearancePreferencesChange({
                      ...pageAppearancePreferences,
                      mode: event.target.value === "auto" ? "auto" : "on",
                    })
                  }
                >
                  <option value="manual">始终开启</option>
                  <option value="auto">按时段自动</option>
                </select>
              </div>
            </div>
            {pageAppearancePreferences.mode === "auto" ? (
              <div className="setting-row page-appearance-hours-row">
                <div>
                  <strong>自动时段</strong>
                  <span>按设备本地时间切换；开始和结束相同表示全天</span>
                </div>
                <div aria-label="夜间模式自动时段" className="page-appearance-hours">
                  <label>
                    <span>开始</span>
                    <select
                      aria-label="夜间模式开始小时"
                      value={pageAppearancePreferences.startHour}
                      onChange={(event) =>
                        onPageAppearancePreferencesChange({
                          ...pageAppearancePreferences,
                          startHour: Number(event.target.value),
                        })
                      }
                    >
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={hour}>
                          {String(hour).padStart(2, "0")} 时
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>结束</span>
                    <select
                      aria-label="夜间模式结束小时"
                      value={pageAppearancePreferences.endHour}
                      onChange={(event) =>
                        onPageAppearancePreferencesChange({
                          ...pageAppearancePreferences,
                          endHour: Number(event.target.value),
                        })
                      }
                    >
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={hour}>
                          {String(hour).padStart(2, "0")} 时
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ) : null}
            <div className="setting-row settings-switch-row">
              <div>
                <strong>谱页平滑滚动</strong>
                <span>换行时平滑上移</span>
              </div>
              <ToggleSwitch
                aria-label="谱页平滑滚动"
                checked={staffPageUiPreferences.smoothStaffPageScroll}
                onCheckedChange={(smoothStaffPageScroll) =>
                  setStaffPageUiPreferences((current) => ({
                    ...current,
                    smoothStaffPageScroll,
                  }))
                }
              />
            </div>
          </section>

          <section className="panel settings-panel settings-category-card">
            <div className="panel-heading">
              <h2>练习与答题</h2>
            </div>
            <div className="setting-row">
              <div>
                <strong>正确后延迟</strong>
                <span>答对后自动进入下一题</span>
              </div>
              <select
                aria-label="正确后延迟"
                value={settings.correctDelayMs}
                onChange={(event) =>
                  void saveSettings({ ...settings, correctDelayMs: Number(event.target.value) })
                }
              >
                {[0, 100, 200, 300, 400, 500, 800].map((delay) => (
                  <option key={delay} value={delay}>
                    {delay}ms
                  </option>
                ))}
              </select>
            </div>
            <div className="setting-row">
              <div>
                <strong>离开阈值</strong>
                <span>无输入达到时长后标记中断</span>
              </div>
              <select
                aria-label="离开阈值"
                value={settings.inactivityThresholdSeconds}
                onChange={(event) =>
                  void saveSettings({
                    ...settings,
                    inactivityThresholdSeconds: Number(event.target.value),
                  })
                }
              >
                {settings.inactivityThresholdSeconds !== 10 &&
                settings.inactivityThresholdSeconds !== 30 &&
                settings.inactivityThresholdSeconds !== 60 ? (
                  <option value={settings.inactivityThresholdSeconds}>
                    {settings.inactivityThresholdSeconds} 秒（当前）
                  </option>
                ) : null}
                <option value={10}>10 秒</option>
                <option value={30}>30 秒</option>
                <option value={60}>60 秒</option>
              </select>
            </div>
            <div className="setting-row">
              <div>
                <strong>切换页面后暂停</strong>
                <span>切换应用或浏览器标签页后自动暂停</span>
              </div>
              <select
                aria-label="切换页面后暂停"
                value={practicePagePreferences.focusLossPauseSeconds}
                onChange={(event) =>
                  onPracticePagePreferencesChange({
                    ...practicePagePreferences,
                    focusLossPauseSeconds: Number(
                      event.target.value
                    ) as PracticePagePreferences["focusLossPauseSeconds"],
                  })
                }
              >
                <option value={0}>立刻</option>
                <option value={10}>10 秒</option>
                <option value={20}>20 秒</option>
                <option value={30}>30 秒</option>
              </select>
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
          </section>

          <section className="panel settings-panel settings-category-card">
            <div className="panel-heading">
              <h2>音频与输入设备</h2>
            </div>
            <div className="setting-row">
              <div>
                <strong>麦克风灵敏度</strong>
                <span className="settings-helper">
                  仅调整输入音量门槛。高敏感适合轻声弹奏，抗噪适合嘈杂环境。
                </span>
              </div>
              <select
                aria-label="麦克风灵敏度"
                value={practiceMicrophonePreferences.sensitivityLevel}
                onChange={(event) => {
                  const sensitivityLevel = Number(
                    event.target.value
                  ) as PracticeMicrophonePreferences["sensitivityLevel"];
                  onPracticeMicrophonePreferencesChange((current) => ({
                    ...current,
                    debugMode: false,
                    sensitivityLevel,
                    sensitivityScaleVersion: 2,
                  }));
                }}
              >
                {PRACTICE_MICROPHONE_SENSITIVITY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {practiceMicrophoneSensitivityLevelLabel(level)}
                  </option>
                ))}
              </select>
            </div>
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
                            ? midi.inputs.length > 0
                              ? "请选择 MIDI 输入设备"
                              : "未检测到可用的 MIDI 输入"
                            : (midi.errorMessage ?? "连接后可选择设备并测试按键")}
                </span>
              </div>
              {midi.status === "ready" && midi.inputs.length > 0 ? (
                <select
                  aria-label="MIDI 输入设备"
                  value={midi.selectedInput ? midi.selectedInputId : ""}
                  onChange={(event) => midi.selectInput(event.target.value)}
                >
                  {!midi.selectedInput ? (
                    <option disabled value="">
                      请选择 MIDI 输入
                    </option>
                  ) : null}
                  {midi.inputs.map((input) => (
                    <option key={input.id} value={input.id}>
                      {input.manufacturer ? `${input.manufacturer} · ` : ""}
                      {input.name}
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
                  type="button"
                >
                  {midi.status === "denied" || midi.status === "error" ? "重新连接" : "连接 MIDI"}
                </button>
              )}
            </div>
            {midi.isConnected ? (
              <p className="keyboard-settings-description" aria-live="polite">
                测试输入：
                {midi.lastNote
                  ? `${midi.lastNote.keyName}${midi.lastNote.octave}`
                  : "请按下一个琴键"}
              </p>
            ) : null}
            <div className="setting-row">
              <div>
                <strong>音量</strong>
                <span>控制目标音与键盘预览音量</span>
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
          </section>

          <section className="panel settings-panel settings-category-card keyboard-settings-panel">
            <div className="panel-heading">
              <h2>界面显示</h2>
            </div>
            <div className="setting-row keyboard-size-row">
              <div>
                <strong>琴键大小</strong>
                <span className="settings-helper">调整虚拟键盘的显示比例及预览音区（C4-C5）。</span>
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
            <PlayableKeyboardPreview scale={answerKeyboardScaleDraft} />
          </section>

          <section className="panel settings-panel settings-category-card settings-backup-card">
            <div className="panel-heading">
              <h2>数据与备份</h2>
            </div>
            <div className="backup-settings-row">
              <div className="backup-settings-summary">
                <strong>备份目录</strong>
                <span title={backupState.directoryName}>
                  {backupState.directoryName
                    ? truncateStart(backupState.directoryName)
                    : backupText.status.unselected}
                </span>
                <small>
                  状态：
                  {backupState.lastError ??
                    (backupBlockedUntilSync
                      ? "需要处理冲突"
                      : backupState.directoryHandle
                        ? hasBackupSnapshot
                          ? "已启用"
                          : "暂无备份"
                        : "未选择")}
                  {" · 更新："}
                  {backupState.backupDataModifiedAt
                    ? new Date(backupState.backupDataModifiedAt).toLocaleString()
                    : "暂无"}
                </small>
              </div>
              <div className="backup-settings-actions">
                <button
                  disabled={!supportsFileBackups() || busy}
                  onClick={() =>
                    void runBusy(async () => {
                      const result = await chooseBackupDirectory();
                      await getBackupState();
                      return describeDirectorySelection(result);
                    }, backupText.messages.directorySelected)
                  }
                  type="button"
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
                      if (
                        await confirmDialog({
                          title: "确定导入备份？",
                          description: backupText.messages.browserDataWillBeReplaced,
                          confirmLabel: backupText.labels.importBackup,
                          destructive: true,
                        })
                      ) {
                        void runBusy(
                          () => restoreBackupFromDirectory(backupState.directoryHandle!),
                          backupText.titles.importSuccess
                        );
                      }
                    }}
                    type="button"
                  >
                    <Upload size={18} />
                    {backupText.labels.importBackup}
                  </button>
                ) : null}
              </div>
            </div>
            {backupBlockedUntilSync ? (
              <>
                <div className="status-line danger">{formatBackupConflictDetail()}</div>
                <BackupConflictResolver
                  backupState={backupState}
                  disabled={busy}
                  onResolve={resolveConflict}
                />
              </>
            ) : null}
            {!supportsFileBackups() ? (
              <div className="status-line">{backupText.status.unsupportedFileSystemAccess}</div>
            ) : null}
          </section>
        </div>

        <details className="settings-developer-options">
          <summary>开发者选项</summary>
          <div className="settings-developer-content">
            {import.meta.env.DEV ? (
              <div className="setting-row">
                <div>
                  <strong>麦克风参数基准测试</strong>
                  <span className="settings-helper">录制基准音序并离线比较识别参数。</span>
                </div>
                <button
                  className="microphone-benchmark-trigger"
                  onClick={() => setIsMicrophoneBenchmarkOpen(true)}
                  type="button"
                >
                  打开基准测试
                </button>
              </div>
            ) : null}
            <div className="setting-row settings-switch-row">
              <div>
                <strong>全局调试开关</strong>
                <span className="settings-helper">
                  显示调试入口，可查看并手动导出当前页面错误与设备信息；不会录音或自动上传。
                </span>
              </div>
              <ToggleSwitch
                aria-label="全局调试开关"
                checked={globalDebugEnabled}
                onCheckedChange={(enabled) => {
                  setGlobalDebugEnabledState(enabled);
                  setGlobalDebugEnabled(enabled);
                }}
              />
            </div>
          </div>
        </details>

        <section className="panel settings-panel settings-about-panel">
          <div className="panel-heading">
            <h2>关于</h2>
          </div>
          <div className="setting-row">
            <div>
              <strong>当前版本</strong>
              <span className="settings-helper">
                {__APP_VERSION__} · 构建于 {formatDateTime(__APP_BUILD_TIME__)}
              </span>
            </div>
            <button disabled={isAppUpdateBusy} onClick={onCheckForUpdates} type="button">
              {appUpdateStatus === "checking"
                ? "正在检查…"
                : appUpdateStatus === "preparing"
                  ? "正在准备…"
                  : appUpdateStatus === "reloading"
                    ? "正在刷新…"
                    : appUpdateStatus === "up-to-date" || hasUpdateAvailable
                      ? "重新检查"
                      : "检查更新"}
            </button>
          </div>
          {appUpdateMessage ? (
            <p
              aria-live="polite"
              className={`status-line${appUpdateStatus === "error" ? " danger" : ""}`}
            >
              {appUpdateMessage}
            </p>
          ) : null}
          {hasUpdateAvailable ? (
            <div className="action-row">
              <button
                className="primary"
                disabled={isAppUpdateBusy}
                onClick={onApplyUpdate}
                type="button"
              >
                {appUpdateStatus === "reloading"
                  ? "正在刷新页面…"
                  : hasPreparedUpdate
                    ? "立即使用新版"
                    : "刷新试试"}
              </button>
            </div>
          ) : null}
          <div className="settings-reset-row">
            <div>
              <strong>恢复默认配置</strong>
              <span className="settings-helper">学习记录和备份文件会保留。</span>
            </div>
            <button
              className="settings-reset-action"
              disabled={busy}
              onClick={() => void restoreDefaultConfiguration()}
              type="button"
            >
              <RotateCcw size={15} />
              {isRestoringConfiguration ? "正在恢复…" : "恢复默认配置"}
            </button>
          </div>
        </section>
      </fieldset>

      {import.meta.env.DEV ? (
        <MicrophoneParameterBenchmarkDialog
          isOpen={isMicrophoneBenchmarkOpen}
          onClose={() => setIsMicrophoneBenchmarkOpen(false)}
          preferences={practiceMicrophonePreferences}
        />
      ) : null}
    </section>
  );
}
