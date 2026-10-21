import {
  AlertTriangle,
  DatabaseBackup,
  FolderOpen,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  chooseBackupDirectory,
  resolveBackupConflict,
  restoreBackupFromDirectory,
  supportsFileBackups,
  type BackupConflictResolution,
  type BackupDirectorySelectionResult,
} from "../../../data/backup";
import {
  clearLearningRecordsPreservingConfiguration,
  deleteAllApplicationData,
  getBackupState,
} from "../../../data/db";
import { backupText, formatBackupConflictDetail } from "../../../domain/backupText";
import type { AppSettings, BackupState } from "../../../domain/types";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { MidiInputControl } from "../../../midi/MidiInputControl";
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
import { formatDateTime } from "../../../shared/formatDateTime";
import type { AppUpdateStatus } from "../../../app/useAppUpdateNotice";
import {
  DEFAULT_STAFF_PAGE_UI_PREFERENCES,
  parseStaffPageUiPreferences,
  STAFF_PAGE_UI_PREFERENCES_KEY,
} from "../../../shared/preferences/staffPageUiPreferences";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";
import {
  LoadingActivityIndicator,
  LoadingActivityText,
} from "../../../shared/components/LoadingActivity";
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
type SettingsDataClearFeedback = { kind: "success" | "error"; message: string };

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
  const [isDataClearDialogOpen, setIsDataClearDialogOpen] = useState(false);
  const [dataClearFeedback, setDataClearFeedback] = useState<SettingsDataClearFeedback | null>(
    null
  );
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

  async function clearApplicationData(clearConfiguration: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (clearConfiguration) await deleteAllApplicationData();
      else await clearLearningRecordsPreservingConfiguration();
      setDataClearFeedback({
        kind: "success",
        message: clearConfiguration
          ? "所有应用数据已清除，正在重新加载…"
          : "学习记录已清除，配置已保留，正在重新加载…",
      });
      window.setTimeout(() => window.location.reload(), 1800);
    } catch (error) {
      setDataClearFeedback({
        kind: "error",
        message: `清理失败：${error instanceof Error ? error.message : String(error)}`,
      });
      setBusy(false);
    }
  }
  const [staffPageUiPreferences, setStaffPageUiPreferences] = useLocalStorageState(
    STAFF_PAGE_UI_PREFERENCES_KEY,
    DEFAULT_STAFF_PAGE_UI_PREFERENCES,
    { parse: parseStaffPageUiPreferences }
  );
  const storedBackupState = backupState as StoredBackupState;
  const backupBlockedUntilSync = Boolean(
    backupState.dataConflictBeforeBackup ??
    backupState.syncRequiredBeforeBackup ??
    storedBackupState.restoreRequiredBeforeBackup
  );
  const hasBackupSnapshot = Boolean(backupBlockedUntilSync || backupState.lastSeenBackupVersion);
  async function saveSettings(next: AppSettings): Promise<void> {
    await onSettingsSaved(next);
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
      releaseSwiftF0PracticeRuntime();
      await onRestoreDefaultConfiguration();
    } finally {
      setIsRestoringConfiguration(false);
      setBusy(false);
    }
  }

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
                <span>选择关闭、始终开启，或按设备本地时段自动切换</span>
              </div>
              <div className="settings-mode-controls">
                <select
                  aria-label="夜间模式"
                  className="page-appearance-mode"
                  value={pageAppearancePreferences.mode}
                  onChange={(event) => {
                    const mode = event.target.value;
                    if (mode !== "off" && mode !== "on" && mode !== "auto") return;
                    onPageAppearancePreferencesChange({
                      ...pageAppearancePreferences,
                      mode,
                    });
                  }}
                >
                  <option value="off">关闭</option>
                  <option value="on">始终开启</option>
                  <option value="auto">按时段自动</option>
                </select>
              </div>
            </div>
            {pageAppearancePreferences.mode === "auto" ? (
              <div className="setting-row page-appearance-hours-row">
                <div>
                  <strong>自动时段</strong>
                  <span>按设备本地时间自动切换到夜间模式；开始和结束相同表示全天夜间</span>
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
          </section>

          <section
            className="panel settings-panel settings-category-card"
            id="settings-audio-input-devices"
          >
            <div className="panel-heading">
              <h2>音频与输入设备</h2>
            </div>
            <div className="setting-row">
              <div>
                <strong>算法敏感度</strong>
                <span className="settings-helper">
                  调整音高识别门槛。档位越高越容易识别弱音；输入增强会按设备单独调整。
                </span>
              </div>
              <select
                aria-label="算法敏感度"
                value={practiceMicrophonePreferences.sensitivityLevel}
                onChange={(event) => {
                  const sensitivityLevel = Number(
                    event.target.value
                  ) as PracticeMicrophonePreferences["sensitivityLevel"];
                  onPracticeMicrophonePreferencesChange((current) => ({
                    ...current,
                    debugMode: false,
                    sensitivityLevel,
                    sensitivityScaleVersion: 3,
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
            <div className={`setting-row${midi.isConnected ? " has-midi-test-input" : ""}`}>
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
              <MidiInputControl midi={midi} />
            </div>
            {midi.isConnected ? (
              <p className="keyboard-settings-description" aria-live="polite">
                测试输入：
                {midi.lastNote
                  ? `${midi.lastNote.keyName}${midi.lastNote.octave}`
                  : "请按下一个琴键"}
              </p>
            ) : null}
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
            <div className="settings-data-clear-row">
              <div>
                <strong>清除本机数据</strong>
                <span className="settings-helper">
                  清除练习历史，或连同配置与音频素材一起删除。
                </span>
              </div>
              <button
                className="settings-data-clear-trigger"
                disabled={busy}
                onClick={() => {
                  setDataClearFeedback(null);
                  setIsDataClearDialogOpen(true);
                }}
                type="button"
              >
                <Trash2 size={17} />
                清空所有数据
              </button>
            </div>
          </section>
        </div>

        <details className="settings-developer-options">
          <summary>开发者选项</summary>
          <div className="settings-developer-content">
            <div className="setting-row">
              <div>
                <strong>麦克风参数基准测试</strong>
                <span className="settings-helper">
                  录制音序并在本机比较识别参数，不会自动上传录音。
                </span>
              </div>
              <button
                className="microphone-benchmark-trigger"
                onClick={() => setIsMicrophoneBenchmarkOpen(true)}
                type="button"
              >
                打开基准测试
              </button>
            </div>
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
          <div className="setting-row settings-about-version-row">
            <div>
              <strong>当前版本</strong>
              <span className="settings-helper">
                {__APP_VERSION__} · 构建于 {formatDateTime(__APP_BUILD_TIME__)}
              </span>
            </div>
            <button disabled={isAppUpdateBusy} onClick={onCheckForUpdates} type="button">
              {appUpdateStatus === "checking" ? (
                <LoadingActivityText kind="spinner">正在检查…</LoadingActivityText>
              ) : appUpdateStatus === "preparing" ? (
                <LoadingActivityText kind="dots">正在准备</LoadingActivityText>
              ) : appUpdateStatus === "reloading" ? (
                <LoadingActivityText kind="spinner">正在刷新…</LoadingActivityText>
              ) : appUpdateStatus === "up-to-date" || hasUpdateAvailable ? (
                "重新检查"
              ) : (
                "检查更新"
              )}
            </button>
          </div>
          {appUpdateMessage ? (
            <p
              aria-live="polite"
              className={`status-line${appUpdateStatus === "error" ? " danger" : ""}`}
            >
              {appUpdateStatus === "preparing" ? (
                <>
                  {appUpdateMessage} <LoadingActivityIndicator kind="dots" />
                </>
              ) : (
                appUpdateMessage
              )}
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
                {appUpdateStatus === "reloading" ? (
                  <LoadingActivityText kind="spinner">正在刷新页面…</LoadingActivityText>
                ) : hasPreparedUpdate ? (
                  "立即使用新版"
                ) : (
                  "刷新试试"
                )}
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

      <MicrophoneParameterBenchmarkDialog
        isOpen={isMicrophoneBenchmarkOpen}
        onClose={() => setIsMicrophoneBenchmarkOpen(false)}
        preferences={practiceMicrophonePreferences}
      />
      <AlertDialog.Root
        onOpenChange={(open) => {
          setIsDataClearDialogOpen(open);
          if (!open) setDataClearFeedback(null);
        }}
        open={isDataClearDialogOpen}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="ui-confirm-overlay" />
          <AlertDialog.Content className="ui-confirm-content settings-data-clear-dialog">
            <AlertDialog.Cancel asChild>
              <button
                aria-label="关闭清空数据对话框"
                className="settings-data-clear-close"
                disabled={busy}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Title className="ui-confirm-title">
              <AlertTriangle aria-hidden="true" className="settings-data-clear-icon" size={20} />
              清空本机数据？
            </AlertDialog.Title>
            <AlertDialog.Description className="ui-confirm-description">
              此操作不可逆。选择清理范围；浏览器备份目录中的文件不会被删除。
            </AlertDialog.Description>
            {dataClearFeedback && (
              <p
                className={`settings-data-clear-feedback is-${dataClearFeedback.kind}`}
                role={dataClearFeedback.kind === "error" ? "alert" : "status"}
              >
                {dataClearFeedback.message}
              </p>
            )}
            <div className="ui-confirm-actions settings-data-clear-actions">
              <button
                className="button-secondary"
                disabled={busy}
                onClick={() => void clearApplicationData(false)}
                type="button"
              >
                保留配置数据
              </button>
              <button
                className="ui-confirm-action is-destructive"
                disabled={busy}
                onClick={() => void clearApplicationData(true)}
                type="button"
              >
                全部删除
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
