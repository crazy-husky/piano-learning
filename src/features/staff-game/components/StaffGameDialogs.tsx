import { Keyboard, Mic, Music2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, type AnimationEventHandler, type CSSProperties } from "react";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { ToggleSwitch } from "../../../shared/components/ui/ToggleSwitch";
import { StaffGamePhysicalInputNotice } from "./StaffGamePhysicalInputNotice";
import {
  StaffGameSettingsControls,
  type GameDisplayMode,
  type StaffGameAudioSettingsDraft,
  type StaffGameSettingsDraft,
} from "./StaffGameSettingsControls";
import {
  GAME_DIFFICULTIES,
  GAME_NOTE_PROGRESSION,
  type GameDifficulty,
  type StaffGameNotePoolScope,
  type StaffGameNoteSchedulingStrategy,
} from "../logic/staffGameRules";
import { STAFF_GAME_ART } from "../logic/staffGameResources";

export type StaffGameDialogKind = "help" | "settings" | "levels" | null;
type StaffGameInputMode = StaffGameSettingsDraft["inputMode"];
type StaffGameDialogSettings = StaffGameSettingsDraft & { difficulty: GameDifficulty };
type StaffGameDialogAudioSettings = StaffGameAudioSettingsDraft;

interface StaffGameDialogsProps {
  dialog: StaffGameDialogKind;
  gameArtStyle: CSSProperties;
  isStarting: boolean;
  isSettingsDialogShaking: boolean;
  isWrongNoteNoticeOpen: boolean;
  onSettingsDialogAnimationEnd: AnimationEventHandler<HTMLElement>;
  onCloseWrongNoteNotice: () => void;
  isSongMode: boolean;
  closeGameDialog: () => void;
  bestStars: number[];
  level: number;
  jumpToLevel: (level: number) => void;
  triggerSettingsDialogShake: () => void;
  settingsDraft: StaffGameDialogSettings;
  draftAudioSettings: StaffGameDialogAudioSettings;
  draftDifficulty: (typeof GAME_DIFFICULTIES)[number];
  virtualKeyboardAvailable: boolean;
  midiOptionAvailable: boolean;
  midi: Pick<MidiInputController, "isConnected" | "selectedInput" | "status">;
  selectInputMode: (mode: StaffGameInputMode) => void;
  onToggleSoundEffects: () => void;
  onToggleBackgroundMusic: () => void;
  onTogglePianoSound: () => void;
  onDisplayModeChange: (mode: GameDisplayMode) => void;
  onToggleGameEffects: () => void;
  onDifficultyChange: (difficulty: GameDifficulty) => void;
  onNotePoolScopeChange: (scope: StaffGameNotePoolScope) => void;
  onNoteSchedulingStrategyChange: (strategy: StaffGameNoteSchedulingStrategy) => void;
  onToggleWrongNoteStatistics: () => void;
  applyGameSettings: () => void;
}

const { helpTitleArt, levelJumpDecorationArt, settingsPawArt } = STAFF_GAME_ART;

export function StaffGameDialogs({
  dialog,
  gameArtStyle,
  isStarting,
  isSettingsDialogShaking,
  isWrongNoteNoticeOpen,
  onSettingsDialogAnimationEnd,
  onCloseWrongNoteNotice,
  isSongMode,
  closeGameDialog,
  bestStars,
  level,
  jumpToLevel,
  triggerSettingsDialogShake,
  settingsDraft,
  draftAudioSettings,
  draftDifficulty,
  virtualKeyboardAvailable,
  midiOptionAvailable,
  midi,
  selectInputMode,
  onToggleSoundEffects,
  onToggleBackgroundMusic,
  onTogglePianoSound,
  onDisplayModeChange,
  onToggleGameEffects,
  onDifficultyChange,
  onNotePoolScopeChange,
  onNoteSchedulingStrategyChange,
  onToggleWrongNoteStatistics,
  applyGameSettings,
}: StaffGameDialogsProps) {
  const wrongNoteNoticeButtonRef = useRef<HTMLButtonElement>(null);
  const wrongNoteNoticeDialogRef = useRef<HTMLElement>(null);
  const staffGameDialogRef = useRef<HTMLElement>(null);
  const wrongNoteNoticeWasOpenRef = useRef(false);

  useEffect(() => {
    if (isWrongNoteNoticeOpen) {
      wrongNoteNoticeWasOpenRef.current = true;
      wrongNoteNoticeButtonRef.current?.focus();
    } else if (wrongNoteNoticeWasOpenRef.current) {
      wrongNoteNoticeWasOpenRef.current = false;
      document.getElementById("staff-game-wrong-note-statistics-toggle")?.focus();
    }
  }, [isWrongNoteNoticeOpen]);

  useEffect(() => {
    if (!isWrongNoteNoticeOpen) return undefined;
    const backgroundDialog = staffGameDialogRef.current;
    if (!backgroundDialog) return undefined;

    const wasInert = backgroundDialog.inert;
    backgroundDialog.inert = true;
    return () => {
      backgroundDialog.inert = wasInert;
    };
  }, [isWrongNoteNoticeOpen]);

  useEffect(() => {
    if (!isWrongNoteNoticeOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseWrongNoteNotice();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = wrongNoteNoticeDialogRef.current;
      if (!dialog) return;
      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      event.stopPropagation();
      if (!firstElement || !lastElement) {
        event.preventDefault();
        dialog.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isWrongNoteNoticeOpen, onCloseWrongNoteNotice]);

  return (
    <>
      {dialog && typeof document !== "undefined"
        ? createPortal(
            <div
              className="staff-game-dialog-backdrop"
              role="presentation"
              onClick={(event) => {
                if (!isStarting && !isWrongNoteNoticeOpen && event.target === event.currentTarget)
                  closeGameDialog();
              }}
              style={gameArtStyle}
            >
              <section
                aria-hidden={dialog === "settings" && isWrongNoteNoticeOpen}
                aria-labelledby="staff-game-dialog-title"
                aria-modal={!(dialog === "settings" && isWrongNoteNoticeOpen)}
                className={`staff-game-dialog staff-game-${dialog}-dialog${dialog === "settings" && isSettingsDialogShaking ? " is-wobbling" : ""}`}
                onAnimationEnd={onSettingsDialogAnimationEnd}
                ref={staffGameDialogRef}
                role="dialog"
              >
                {dialog === "help" ? (
                  <>
                    <button
                      aria-label="关闭弹窗"
                      className="staff-game-dialog-close"
                      onClick={closeGameDialog}
                      type="button"
                    >
                      <X size={23} />
                    </button>
                    <h2
                      aria-label="提示"
                      className="staff-game-help-title"
                      id="staff-game-dialog-title"
                    >
                      <img alt="" aria-hidden="true" draggable="false" src={helpTitleArt} />
                    </h2>
                    <div className="staff-game-help-copy">
                      <h3>{isSongMode ? "歌曲模式说明" : "闯关模式说明"}</h3>
                      {isSongMode ? (
                        <>
                          <p>
                            选择歌曲后，气泡会按旋律顺序出现。答错可重试当前音符；气泡飘走后会记为漏音并继续下一音。全曲完成后，按首次作答准确率评星：达到
                            60%、80%、95% 分别获得 1、2、3 星。
                          </p>
                          <p>
                            可用麦克风、MIDI 键盘或虚拟琴键输入。虚拟琴键可点击；电脑端也可用
                            A、S、D、F、G、H、J 弹奏 C4 到 B4。
                          </p>
                          <p>
                            答对可得分并增加连击；难度会影响基础分、气泡下落速度和连击时限，连击另有加分。歌曲成绩会记录最佳分、准确率、星级和最高连击。
                          </p>
                        </>
                      ) : (
                        <>
                          <p>
                            共有 60 关：第 1–35 关逐步加入白键，第 36–60
                            关加入黑键。可通过「跳级」直接选择任意关卡。
                          </p>
                          <p>
                            观察气泡里的五线谱音符，用麦克风（实体乐器）、MIDI
                            键盘或虚拟琴键作答。虚拟琴键可点击，也可在电脑端用键盘输入。
                          </p>
                          <p>
                            答对可得分并增加连击；难度会影响基础分、气泡下落速度和连击时限，连击另有加分。星级按答对数量计算，目标随关卡时长调整，不受难度加分影响；结算页可重试或直接开始下一关，也可通过跳级选择任意关卡。
                          </p>
                          <p>
                            虚拟琴键输入时，电脑端可用 A、S、D、F、G、H、J 弹奏 C4 到
                            B4；W、E、T、Y、U 对应五个黑键。
                          </p>
                        </>
                      )}
                    </div>
                  </>
                ) : dialog === "levels" ? (
                  <>
                    <img
                      alt=""
                      aria-hidden="true"
                      className="staff-game-level-decoration"
                      draggable="false"
                      src={levelJumpDecorationArt}
                    />
                    <button
                      aria-label="关闭弹窗"
                      className="staff-game-dialog-close"
                      disabled={isStarting}
                      onClick={closeGameDialog}
                      type="button"
                    >
                      <X size={23} />
                    </button>
                    <div className="staff-game-level-dialog-content">
                      <h2 id="staff-game-dialog-title">选择关卡</h2>
                      <div className="staff-game-level-picker-content">
                        <p>点选关卡后会立即开始</p>
                        <section aria-label="白键关卡" className="staff-game-level-picker-group">
                          <h3>白键 · 1–35</h3>
                          <div className="staff-game-level-picker-grid">
                            {GAME_NOTE_PROGRESSION.slice(0, 35).map((note, index) => {
                              const selectedLevel = index + 1;
                              const isCurrent = level === selectedLevel;
                              return (
                                <button
                                  aria-label={`第 ${selectedLevel} 关，${note.name}${note.octave}${isCurrent ? "，当前关卡" : ""}`}
                                  aria-pressed={isCurrent}
                                  className={`staff-game-level-choice${isCurrent ? " is-current" : ""}${bestStars[index] > 0 ? " has-stars" : ""}`}
                                  disabled={isStarting}
                                  key={selectedLevel}
                                  onClick={() => jumpToLevel(selectedLevel)}
                                  type="button"
                                >
                                  <strong>{selectedLevel}</strong>
                                  <span>
                                    {note.name}
                                    {note.octave}
                                  </span>
                                  {isCurrent ? <small>当前</small> : null}
                                </button>
                              );
                            })}
                          </div>
                        </section>
                        <section aria-label="黑键关卡" className="staff-game-level-picker-group">
                          <h3>黑键 · 36–60</h3>
                          <div className="staff-game-level-picker-grid">
                            {GAME_NOTE_PROGRESSION.slice(35).map((note, index) => {
                              const selectedLevel = index + 36;
                              const progressIndex = selectedLevel - 1;
                              const isCurrent = level === selectedLevel;
                              return (
                                <button
                                  aria-label={`第 ${selectedLevel} 关，${note.name}${note.octave}${isCurrent ? "，当前关卡" : ""}`}
                                  aria-pressed={isCurrent}
                                  className={`staff-game-level-choice is-black-key${isCurrent ? " is-current" : ""}${bestStars[progressIndex] > 0 ? " has-stars" : ""}`}
                                  disabled={isStarting}
                                  key={selectedLevel}
                                  onClick={() => jumpToLevel(selectedLevel)}
                                  type="button"
                                >
                                  <strong>{selectedLevel}</strong>
                                  <span>
                                    {note.name}
                                    {note.octave}
                                  </span>
                                  {isCurrent ? <small>当前</small> : null}
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      aria-label="熊掌，悬停或点击可让弹窗颤动"
                      className="staff-game-settings-decoration"
                      onClick={triggerSettingsDialogShake}
                      onPointerEnter={triggerSettingsDialogShake}
                      type="button"
                    >
                      <img alt="" aria-hidden="true" draggable="false" src={settingsPawArt} />
                    </button>
                    <button
                      aria-label="关闭弹窗"
                      className="staff-game-dialog-close"
                      onClick={closeGameDialog}
                      type="button"
                    >
                      <X size={23} />
                    </button>
                    <div className="staff-game-settings-content">
                      <h2 id="staff-game-dialog-title">游戏设置</h2>
                      <section className="staff-game-settings-section">
                        <h3>输入方式</h3>
                        <div className="staff-game-input-options">
                          <button
                            aria-pressed={settingsDraft.inputMode === "virtual"}
                            className={`staff-game-input-option${settingsDraft.inputMode === "virtual" ? " is-selected" : ""}`}
                            disabled={!virtualKeyboardAvailable}
                            onClick={() => selectInputMode("virtual")}
                            type="button"
                          >
                            <Keyboard aria-hidden="true" size={29} />
                            <strong>虚拟琴键</strong>
                            <small>
                              {virtualKeyboardAvailable
                                ? "点击屏幕琴键作答，电脑也可用"
                                : "虚拟琴键暂不可用"}
                            </small>
                          </button>
                          <button
                            aria-pressed={settingsDraft.inputMode === "physical"}
                            className={`staff-game-input-option${settingsDraft.inputMode === "physical" ? " is-selected" : ""}`}
                            onClick={() => selectInputMode("physical")}
                            type="button"
                          >
                            <Mic aria-hidden="true" size={29} />
                            <strong>实体钢琴</strong>
                            <small>麦克风识别，关闭背景音乐，游戏音效单独控制</small>
                          </button>
                          {midiOptionAvailable ? (
                            <button
                              aria-pressed={settingsDraft.inputMode === "midi"}
                              className={`staff-game-input-option${settingsDraft.inputMode === "midi" ? " is-selected" : ""}`}
                              onClick={() => selectInputMode("midi")}
                              type="button"
                            >
                              <Music2 aria-hidden="true" size={29} />
                              <strong>MIDI 键盘</strong>
                              <small>
                                {midi.isConnected
                                  ? `已连接：${midi.selectedInput?.name ?? "设备"}`
                                  : midi.status === "denied"
                                    ? "浏览器 MIDI 权限未开启"
                                    : "电脑端连接 MIDI 键盘"}
                              </small>
                            </button>
                          ) : null}
                        </div>
                      </section>
                      <StaffGameSettingsControls
                        draftAudioSettings={draftAudioSettings}
                        onDisplayModeChange={onDisplayModeChange}
                        onToggleBackgroundMusic={onToggleBackgroundMusic}
                        onToggleGameEffects={onToggleGameEffects}
                        onTogglePianoSound={onTogglePianoSound}
                        onToggleSoundEffects={onToggleSoundEffects}
                        settingsDraft={settingsDraft}
                      />
                      <div className="staff-game-difficulty-statistics-row">
                        <section className="staff-game-settings-section staff-game-difficulty-setting">
                          <label htmlFor="staff-game-difficulty">难度</label>
                          <select
                            aria-describedby="staff-game-difficulty-summary"
                            className="staff-game-difficulty-select"
                            id="staff-game-difficulty"
                            onChange={(event) =>
                              onDifficultyChange(event.currentTarget.value as GameDifficulty)
                            }
                            value={settingsDraft.difficulty}
                          >
                            {GAME_DIFFICULTIES.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <p
                            className="staff-game-difficulty-summary"
                            id="staff-game-difficulty-summary"
                            aria-live="polite"
                          >
                            <span>
                              下落 {(draftDifficulty.bubbleDurationMs / 1000).toFixed(1)} 秒 ·
                              连击等待 {(draftDifficulty.comboWindowMs / 1000).toFixed(1)} 秒
                            </span>
                          </p>
                        </section>
                        <section className="staff-game-settings-section staff-game-wrong-note-setting">
                          <div>
                            <h3>统计错音</h3>
                            <p>记录本局错误输入并显示详情</p>
                          </div>
                          <ToggleSwitch
                            aria-label="统计错音"
                            checked={settingsDraft.wrongNoteStatisticsEnabled}
                            className="staff-game-settings-toggle"
                            id="staff-game-wrong-note-statistics-toggle"
                            onCheckedChange={() => onToggleWrongNoteStatistics()}
                          />
                        </section>
                      </div>
                      {!isSongMode ? (
                        <section className="staff-game-settings-section staff-game-settings-row staff-game-note-pool-setting">
                          <div>
                            <h3>音符池范围</h3>
                            <p>当前谱号全部按当前关卡重点音，练习已解锁的全部高音或低音音符。</p>
                          </div>
                          <select
                            aria-label="音符池范围"
                            className="staff-game-difficulty-select"
                            onChange={(event) =>
                              onNotePoolScopeChange(
                                event.currentTarget.value as StaffGameNotePoolScope
                              )
                            }
                            value={settingsDraft.notePoolScope}
                          >
                            <option value="all-history">全部已解锁音符</option>
                            <option value="all-history-current-clef">当前谱号全部</option>
                            <option value="current-group">仅当前组</option>
                          </select>
                        </section>
                      ) : null}
                      {!isSongMode ? (
                        <section
                          aria-describedby="staff-game-note-scheduling-description"
                          aria-labelledby="staff-game-note-scheduling-title"
                          className="staff-game-settings-section staff-game-note-scheduling-setting"
                        >
                          <h3 id="staff-game-note-scheduling-title">出题策略</h3>
                          <p id="staff-game-note-scheduling-description">
                            决定当前音符池内，下落音符的安排方式。
                          </p>
                          <div
                            aria-label="出题策略"
                            className="staff-game-input-options staff-game-note-scheduling-options"
                            role="group"
                          >
                            <button
                              aria-pressed={settingsDraft.noteSchedulingStrategy === "random"}
                              className={`staff-game-input-option${settingsDraft.noteSchedulingStrategy === "random" ? " is-selected" : ""}`}
                              onClick={() => onNoteSchedulingStrategyChange("random")}
                              type="button"
                            >
                              <strong>随机练习</strong>
                              <small>池内音符等机会随机抽取；尽量避免三连同音和 ABAB 循环。</small>
                            </button>
                            <button
                              aria-pressed={settingsDraft.noteSchedulingStrategy === "system"}
                              className={`staff-game-input-option${settingsDraft.noteSchedulingStrategy === "system" ? " is-selected" : ""}`}
                              onClick={() => onNoteSchedulingStrategyChange("system")}
                              type="button"
                            >
                              <strong>系统编排（推荐）</strong>
                              <small>重点音适度加权，穿插已解锁音符复习。</small>
                            </button>
                          </div>
                        </section>
                      ) : null}
                      {isSongMode && settingsDraft.inputMode === "virtual" ? (
                        <p className="staff-game-song-mode-notice" role="note">
                          歌曲模式默认关闭背景音乐和游戏音效，让你专注聆听与演奏歌曲。
                        </p>
                      ) : null}
                      {settingsDraft.inputMode === "physical" ? (
                        <StaffGamePhysicalInputNotice />
                      ) : null}
                      <div className="staff-game-dialog-actions">
                        <button
                          className="staff-game-secondary"
                          onClick={closeGameDialog}
                          type="button"
                        >
                          取消
                        </button>
                        <button
                          className="staff-game-primary"
                          onClick={applyGameSettings}
                          type="button"
                        >
                          确定
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </section>
              {dialog === "settings" && isWrongNoteNoticeOpen ? (
                <div className="staff-game-wrong-note-notice-backdrop">
                  <section
                    aria-labelledby="staff-game-wrong-note-notice-title"
                    aria-modal="true"
                    className="staff-game-wrong-note-notice"
                    ref={wrongNoteNoticeDialogRef}
                    role="alertdialog"
                    tabIndex={-1}
                  >
                    <h2 id="staff-game-wrong-note-notice-title">错音统计说明</h2>
                    <p>
                      音符识别会受到识别算法、设备和环境等因素影响，统计数据仅供参考，不代表演奏准确性的绝对判断。
                    </p>
                    <button
                      className="staff-game-primary"
                      onClick={onCloseWrongNoteNotice}
                      ref={wrongNoteNoticeButtonRef}
                      type="button"
                    >
                      知道了
                    </button>
                  </section>
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
