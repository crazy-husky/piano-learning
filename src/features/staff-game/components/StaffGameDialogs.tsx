import { BookOpen, Flame, Keyboard, Mic, Music2, RefreshCw, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type AnimationEventHandler, type CSSProperties } from "react";
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
  isUnsavedSettingsPromptOpen: boolean;
  onSettingsDialogAnimationEnd: AnimationEventHandler<HTMLElement>;
  onCloseWrongNoteNotice: () => void;
  onCancelUnsavedSettingsPrompt: () => void;
  onDiscardUnsavedSettings: () => void;
  isWrongNoteReview: boolean;
  isArcadeMode: boolean;
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
  onToggleAutoArchiveWrongNotes: () => void;
  applyGameSettings: () => void;
}

const { levelJumpDecorationArt, settingsPawArt } = STAFF_GAME_ART;

const STAFF_GAME_HELP_TABS = [
  { id: "rules", label: "闯关规则" },
  { id: "operation", label: "操作说明" },
  { id: "modes", label: "模式差异" },
] as const;

type StaffGameHelpTab = (typeof STAFF_GAME_HELP_TABS)[number]["id"];

function StaffGameHelpGuide({
  isWrongNoteReview,
  isArcadeMode,
}: {
  isWrongNoteReview: boolean;
  isArcadeMode: boolean;
}) {
  const [activeTab, setActiveTab] = useState<StaffGameHelpTab>("rules");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const currentMode = isWrongNoteReview ? "review" : isArcadeMode ? "arcade" : "learning";

  return (
    <>
      <div
        aria-label="玩法说明分类"
        aria-orientation="horizontal"
        className="staff-game-help-tabs is-segmented-control"
        role="tablist"
      >
        {STAFF_GAME_HELP_TABS.map((tab, index) => (
          <button
            aria-controls="staff-game-help-panel"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "is-active" : undefined}
            id={`staff-game-help-tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => {
              let nextIndex = index;
              if (event.key === "ArrowRight") nextIndex = (index + 1) % STAFF_GAME_HELP_TABS.length;
              else if (event.key === "ArrowLeft") {
                nextIndex = (index - 1 + STAFF_GAME_HELP_TABS.length) % STAFF_GAME_HELP_TABS.length;
              } else if (event.key === "Home") nextIndex = 0;
              else if (event.key === "End") nextIndex = STAFF_GAME_HELP_TABS.length - 1;
              else return;

              event.preventDefault();
              const nextTab = STAFF_GAME_HELP_TABS[nextIndex];
              setActiveTab(nextTab.id);
              tabRefs.current[nextIndex]?.focus();
            }}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            role="tab"
            tabIndex={activeTab === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section
        aria-labelledby={`staff-game-help-tab-${activeTab}`}
        className="staff-game-help-copy"
        id="staff-game-help-panel"
        role="tabpanel"
        tabIndex={0}
      >
        {activeTab === "operation" ? (
          <ul className="staff-game-help-list">
            <li>
              <strong>如何作答</strong>
              <span>观察气泡中的五线谱音符，使用麦克风、MIDI 键盘或虚拟琴键作答。</span>
            </li>
            <li>
              <strong>电脑键盘映射</strong>
              <span>
                <kbd>A S D F G H J</kbd> 对应 <b>C4–B4</b> 白键；<kbd>W E T Y U</kbd> 对应 5
                个黑键。
              </span>
            </li>
          </ul>
        ) : null}

        {activeTab === "rules" ? (
          <ul className="staff-game-help-list">
            <li>
              <strong>关卡进度</strong>
              <span>
                共 <b>60 关</b>：第 1–35 关逐步加入白键，第 36–60
                关加入黑键。可通过「跳级」自选关卡。
              </span>
            </li>
            <li>
              <strong>星级评价</strong>
              <span>
                按首次答对率计算：≥<b>60%</b> 获 1 星，≥<b>75%</b> 获 2 星，≥<b>90%</b> 获 3 星。
              </span>
            </li>
            <li>
              <strong>成绩记录</strong>
              <span>完整完成一局才记录成绩；中途退出或重新开始不记录。</span>
            </li>
            <li>
              <strong>得分机制</strong>
              <span>难度影响基础分和音符下落速度；连击可增加额外分数。</span>
            </li>
          </ul>
        ) : null}

        {activeTab === "modes" ? (
          <div className="staff-game-help-mode-grid">
            <article
              className={`staff-game-help-mode-card is-learning${currentMode === "learning" ? " is-current" : ""}`}
            >
              <h3>
                <BookOpen aria-hidden="true" size={18} /> 学习测试
              </h3>
              <ul>
                <li>无整局倒计时。</li>
                <li>当前音池每个音出现 2 次，答完全部题目后生成报告。</li>
                <li>报告展示正确率、错漏明细和反应耗时。</li>
              </ul>
            </article>
            <article
              className={`staff-game-help-mode-card is-review${currentMode === "review" ? " is-current" : ""}`}
            >
              <h3>
                <RefreshCw aria-hidden="true" size={18} /> 错题复习
              </h3>
              <ul>
                <li>按历史错题生成本轮题目。</li>
                <li>
                  限时 <b>1–3 分钟</b>，打完整袋或时间耗尽即结束。
                </li>
                <li>完整完成才记录，中途退出不记录。</li>
              </ul>
            </article>
            <article
              className={`staff-game-help-mode-card is-arcade${currentMode === "arcade" ? " is-current" : ""}`}
            >
              <h3>
                <Flame aria-hidden="true" size={18} /> 娱乐模式
              </h3>
              <ul>
                <li>整局倒计时结束后结算。</li>
                <li>题袋打完会循环补题。</li>
                <li>适合追求高分和连击。</li>
              </ul>
            </article>
          </div>
        ) : null}
      </section>
    </>
  );
}

export function StaffGameDialogs({
  dialog,
  gameArtStyle,
  isStarting,
  isSettingsDialogShaking,
  isWrongNoteNoticeOpen,
  isUnsavedSettingsPromptOpen,
  onSettingsDialogAnimationEnd,
  onCloseWrongNoteNotice,
  onCancelUnsavedSettingsPrompt,
  onDiscardUnsavedSettings,
  isWrongNoteReview,
  isArcadeMode,
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
  onToggleAutoArchiveWrongNotes,
  applyGameSettings,
}: StaffGameDialogsProps) {
  const wrongNoteNoticeButtonRef = useRef<HTMLButtonElement>(null);
  const wrongNoteNoticeDialogRef = useRef<HTMLElement>(null);
  const staffGameDialogRef = useRef<HTMLElement>(null);
  const wrongNoteNoticeWasOpenRef = useRef(false);
  const unsavedSettingsDialogRef = useRef<HTMLElement>(null);
  const unsavedSettingsSaveButtonRef = useRef<HTMLButtonElement>(null);
  const settingsCloseButtonRef = useRef<HTMLButtonElement>(null);
  const unsavedSettingsPromptWasOpenRef = useRef(false);

  useEffect(() => {
    if (isWrongNoteNoticeOpen) {
      wrongNoteNoticeWasOpenRef.current = true;
      wrongNoteNoticeButtonRef.current?.focus();
    } else if (wrongNoteNoticeWasOpenRef.current) {
      wrongNoteNoticeWasOpenRef.current = false;
      document.getElementById("staff-game-weak-note-statistics-toggle")?.focus();
    }
  }, [isWrongNoteNoticeOpen]);

  useEffect(() => {
    if (isUnsavedSettingsPromptOpen) {
      unsavedSettingsPromptWasOpenRef.current = true;
      unsavedSettingsSaveButtonRef.current?.focus();
    } else if (unsavedSettingsPromptWasOpenRef.current) {
      unsavedSettingsPromptWasOpenRef.current = false;
      settingsCloseButtonRef.current?.focus();
    }
  }, [isUnsavedSettingsPromptOpen]);

  useEffect(() => {
    if (!isWrongNoteNoticeOpen && !isUnsavedSettingsPromptOpen) return undefined;
    const backgroundDialog = staffGameDialogRef.current;
    if (!backgroundDialog) return undefined;

    const wasInert = backgroundDialog.inert;
    backgroundDialog.inert = true;
    return () => {
      backgroundDialog.inert = wasInert;
    };
  }, [isUnsavedSettingsPromptOpen, isWrongNoteNoticeOpen]);

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

  useEffect(() => {
    if (!isUnsavedSettingsPromptOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancelUnsavedSettingsPrompt();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = unsavedSettingsDialogRef.current;
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
  }, [isUnsavedSettingsPromptOpen, onCancelUnsavedSettingsPrompt]);

  const isNestedSettingsPromptOpen =
    dialog === "settings" && (isWrongNoteNoticeOpen || isUnsavedSettingsPromptOpen);

  return (
    <>
      {dialog && typeof document !== "undefined"
        ? createPortal(
            <div
              className="staff-game-dialog-backdrop"
              role="presentation"
              onClick={(event) => {
                if (
                  !isStarting &&
                  !isWrongNoteNoticeOpen &&
                  !isUnsavedSettingsPromptOpen &&
                  event.target === event.currentTarget
                )
                  closeGameDialog();
              }}
              style={gameArtStyle}
            >
              <section
                aria-hidden={isNestedSettingsPromptOpen}
                aria-labelledby="staff-game-dialog-title"
                aria-modal={!isNestedSettingsPromptOpen}
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
                    <h2 className="staff-game-help-heading" id="staff-game-dialog-title">
                      玩法说明
                    </h2>
                    {isSongMode ? (
                      <div className="staff-game-help-copy staff-game-help-song-copy">
                        <h3>歌曲模式说明</h3>
                        <ul className="staff-game-help-list">
                          <li>
                            <strong>旋律顺序</strong>
                            <span>
                              选择歌曲后，气泡按旋律顺序出现；答错可重试，气泡飘走后会记为漏音并继续。
                            </span>
                          </li>
                          <li>
                            <strong>完成评星</strong>
                            <span>
                              全曲完成后按首次答对率评星：达到 <b>60%</b>、<b>75%</b>、<b>90%</b>
                              分别获得 1、2、3 星。
                            </span>
                          </li>
                          <li>
                            <strong>得分与输入</strong>
                            <span>
                              可用麦克风、MIDI 或虚拟琴键；难度影响基础分、下落速度和连击时限。
                            </span>
                          </li>
                        </ul>
                      </div>
                    ) : (
                      <StaffGameHelpGuide
                        isArcadeMode={isArcadeMode}
                        isWrongNoteReview={isWrongNoteReview}
                      />
                    )}
                    <div className="staff-game-dialog-actions staff-game-help-actions">
                      <button
                        className="staff-game-primary"
                        onClick={closeGameDialog}
                        type="button"
                      >
                        知道了
                      </button>
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
                          <div className="staff-game-level-picker-grid is-black-key-grid">
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
                      ref={settingsCloseButtonRef}
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
                      <div
                        className={`staff-game-settings-layout${isArcadeMode && settingsDraft.inputMode === "virtual" ? " is-arcade-virtual-layout" : ""}`}
                      >
                        <StaffGameSettingsControls
                          draftAudioSettings={draftAudioSettings}
                          onDisplayModeChange={onDisplayModeChange}
                          onToggleBackgroundMusic={onToggleBackgroundMusic}
                          onToggleGameEffects={onToggleGameEffects}
                          onTogglePianoSound={onTogglePianoSound}
                          onToggleSoundEffects={onToggleSoundEffects}
                          settingsDraft={settingsDraft}
                        />
                        <div
                          className={`staff-game-difficulty-statistics-row${isArcadeMode ? " is-arcade-mode" : ""}`}
                        >
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
                          {!isArcadeMode ? (
                            <section className="staff-game-settings-section staff-game-wrong-note-setting">
                              <div>
                                <h3>展示薄弱音</h3>
                                <p>在结算页显示错漏音数和逐音详情</p>
                              </div>
                              <ToggleSwitch
                                aria-label="展示薄弱音"
                                checked={settingsDraft.wrongNoteStatisticsEnabled}
                                className="staff-game-settings-toggle"
                                id="staff-game-weak-note-statistics-toggle"
                                onCheckedChange={() => onToggleWrongNoteStatistics()}
                              />
                            </section>
                          ) : null}
                        </div>
                      </div>
                      <section className="staff-game-settings-section staff-game-wrong-note-setting">
                        <div>
                          <h3>错题自动归档</h3>
                          <p>控制闯关中的错音和漏音是否自动归档；错题复习始终自动归档</p>
                        </div>
                        <ToggleSwitch
                          aria-label="错题自动归档"
                          checked={settingsDraft.autoArchiveWrongNotesEnabled}
                          className="staff-game-settings-toggle"
                          id="staff-game-auto-archive-wrong-notes-toggle"
                          onCheckedChange={() => onToggleAutoArchiveWrongNotes()}
                        />
                      </section>
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
                      {!isSongMode && !isArcadeMode ? (
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
                              <small>
                                以本关重点音为主，穿插旧音复习；近期薄弱音会适度多出现。
                              </small>
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
              {dialog === "settings" && isUnsavedSettingsPromptOpen ? (
                <div className="staff-game-unsaved-settings-backdrop">
                  <section
                    aria-describedby="staff-game-unsaved-settings-description"
                    aria-labelledby="staff-game-unsaved-settings-title"
                    aria-modal="true"
                    className="staff-game-unsaved-settings-dialog"
                    ref={unsavedSettingsDialogRef}
                    role="alertdialog"
                    tabIndex={-1}
                  >
                    <div className="staff-game-unsaved-settings-header">
                      <h2 id="staff-game-unsaved-settings-title">有未保存的更改</h2>
                      <button
                        aria-label="关闭提示并返回设置"
                        className="staff-game-unsaved-settings-close"
                        onClick={onCancelUnsavedSettingsPrompt}
                        type="button"
                      >
                        <X size={20} />
                      </button>
                    </div>
                    <p id="staff-game-unsaved-settings-description">要保存这些设置吗？</p>
                    <div className="staff-game-unsaved-settings-actions">
                      <button
                        className="staff-game-secondary"
                        onClick={onDiscardUnsavedSettings}
                        type="button"
                      >
                        不保存
                      </button>
                      <button
                        className="staff-game-primary"
                        onClick={applyGameSettings}
                        ref={unsavedSettingsSaveButtonRef}
                        type="button"
                      >
                        保存
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}
              {dialog === "settings" && isWrongNoteNoticeOpen ? (
                <div className="staff-game-wrong-note-notice-backdrop">
                  <section
                    aria-labelledby="staff-game-weak-note-notice-title"
                    aria-modal="true"
                    className="staff-game-wrong-note-notice"
                    ref={wrongNoteNoticeDialogRef}
                    role="alertdialog"
                    tabIndex={-1}
                  >
                    <h2 id="staff-game-weak-note-notice-title">薄弱音统计说明</h2>
                    <p>
                      按每个目标音的首次输入统计：错音或漏音都会计入薄弱音；超时或本局结束时未输入，均记为漏音。麦克风识别受算法、设备和环境影响，统计仅供练习参考。
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
