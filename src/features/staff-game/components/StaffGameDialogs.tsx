import { Keyboard, Mic, Music2, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { AnimationEventHandler, CSSProperties } from "react";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { StaffGamePhysicalInputNotice } from "./StaffGamePhysicalInputNotice";
import { StaffGameSettingsControls, type GameDisplayMode, type StaffGameAudioSettingsDraft, type StaffGameSettingsDraft } from "./StaffGameSettingsControls";
import { GAME_DIFFICULTIES, GAME_NOTE_PROGRESSION, type GameDifficulty } from "../logic/staffGameRules";
import { STAFF_GAME_ART } from "../logic/staffGameResources";

export type StaffGameDialogKind = "help" | "settings" | "levels" | null;
type StaffGameInputMode = StaffGameSettingsDraft["inputMode"];
type StaffGameDialogSettings = StaffGameSettingsDraft & { difficulty: GameDifficulty };
type StaffGameDialogAudioSettings = StaffGameAudioSettingsDraft;

interface StaffGameDialogsProps {
  dialog: StaffGameDialogKind;
  gameArtStyle: CSSProperties;
  isSettingsDialogShaking: boolean;
  onSettingsDialogAnimationEnd: AnimationEventHandler<HTMLElement>;
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
  applyGameSettings: () => void;
}

const {
  helpTitleArt,
  levelJumpDecorationArt,
  settingsPawArt,
} = STAFF_GAME_ART;

export function StaffGameDialogs({
  dialog,
  gameArtStyle,
  isSettingsDialogShaking,
  onSettingsDialogAnimationEnd,
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
  applyGameSettings,
}: StaffGameDialogsProps) {
  return (
    <>
        {dialog && typeof document !== "undefined" ? createPortal(
          <div className="staff-game-dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeGameDialog(); }} style={gameArtStyle}>
            <section
              aria-labelledby="staff-game-dialog-title"
              aria-modal="true"
              className={`staff-game-dialog staff-game-${dialog}-dialog${dialog === "settings" && isSettingsDialogShaking ? " is-wobbling" : ""}`}
              onAnimationEnd={onSettingsDialogAnimationEnd}
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              {dialog === "help" ? (
                <>
                  <button aria-label="关闭弹窗" className="staff-game-dialog-close" onClick={closeGameDialog} type="button"><X size={23} /></button>
                  <h2 aria-label="提示" className="staff-game-help-title" id="staff-game-dialog-title">
                    <img alt="" aria-hidden="true" draggable="false" src={helpTitleArt} />
                  </h2>
                  <div className="staff-game-help-copy">
                    <h3>{isSongMode ? "歌曲模式说明" : "闯关模式说明"}</h3>
                    {isSongMode ? (
                      <>
                        <p>选择歌曲后，气泡会按旋律顺序出现。答错可重试当前音符；气泡飘走后会记为漏音并继续下一音。全曲完成后，按首次作答准确率评星：达到 60%、80%、95% 分别获得 1、2、3 星。</p>
                        <p>可用麦克风、MIDI 键盘或虚拟琴键输入。虚拟琴键可点击；电脑端也可用 A、S、D、F、G、H、J 弹奏 C4 到 B4。</p>
                        <p>答对可得分并增加连击；难度会影响基础分、气泡下落速度和连击时限，连击另有加分。歌曲成绩会记录最佳分、准确率、星级和最高连击。</p>
                      </>
                    ) : (
                      <>
                        <p>共有 60 关：第 1–35 关逐步加入白键，第 36–60 关加入黑键。可通过「跳级」直接选择任意关卡。</p>
                        <p>观察气泡里的五线谱音符，用麦克风（实体乐器）、MIDI 键盘或虚拟琴键作答。虚拟琴键可点击，也可在电脑端用键盘输入。</p>
                        <p>答对可得分并增加连击；难度会影响基础分、气泡下落速度和连击时限，连击另有加分。星级按答对数量计算，目标随关卡时长调整，不受难度加分影响；结算页可重试或直接开始下一关，也可通过跳级选择任意关卡。</p>
                        <p>虚拟琴键输入时，电脑端可用 A、S、D、F、G、H、J 弹奏 C4 到 B4；W、E、T、Y、U 对应五个黑键。</p>
                      </>
                    )}
                  </div>
                </>
              ) : dialog === "levels" ? (
                <>
                  <img alt="" aria-hidden="true" className="staff-game-level-decoration" draggable="false" src={levelJumpDecorationArt} />
                  <button aria-label="关闭弹窗" className="staff-game-dialog-close" onClick={closeGameDialog} type="button"><X size={23} /></button>
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
                                key={selectedLevel}
                                onClick={() => jumpToLevel(selectedLevel)}
                                type="button"
                              ><strong>{selectedLevel}</strong><span>{note.name}{note.octave}</span>{isCurrent ? <small>当前</small> : null}</button>
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
                                key={selectedLevel}
                                onClick={() => jumpToLevel(selectedLevel)}
                                type="button"
                              ><strong>{selectedLevel}</strong><span>{note.name}{note.octave}</span>{isCurrent ? <small>当前</small> : null}</button>
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
                  ><img alt="" aria-hidden="true" draggable="false" src={settingsPawArt} /></button>
                  <button aria-label="关闭弹窗" className="staff-game-dialog-close" onClick={closeGameDialog} type="button"><X size={23} /></button>
                  <div className="staff-game-settings-content">
                    <h2 id="staff-game-dialog-title">游戏设置</h2>
                    <section className="staff-game-settings-section">
                      <h3>输入方式</h3>
                      <div className="staff-game-input-options">
                        <button aria-pressed={settingsDraft.inputMode === "virtual"} className={`staff-game-input-option${settingsDraft.inputMode === "virtual" ? " is-selected" : ""}`} disabled={!virtualKeyboardAvailable} onClick={() => selectInputMode("virtual")} type="button">
                          <Keyboard aria-hidden="true" size={29} /><strong>虚拟琴键</strong><small>{virtualKeyboardAvailable ? "点击屏幕琴键作答，电脑也可用" : "虚拟琴键暂不可用"}</small>
                        </button>
                        <button aria-pressed={settingsDraft.inputMode === "physical"} className={`staff-game-input-option${settingsDraft.inputMode === "physical" ? " is-selected" : ""}`} onClick={() => selectInputMode("physical")} type="button">
                          <Mic aria-hidden="true" size={29} /><strong>实体钢琴</strong><small>麦克风识别，关闭背景音乐，游戏音效单独控制</small>
                        </button>
                        {midiOptionAvailable ? (
                          <button aria-pressed={settingsDraft.inputMode === "midi"} className={`staff-game-input-option${settingsDraft.inputMode === "midi" ? " is-selected" : ""}`} onClick={() => selectInputMode("midi")} type="button">
                            <Music2 aria-hidden="true" size={29} /><strong>MIDI 键盘</strong><small>{midi.isConnected ? `已连接：${midi.selectedInput?.name ?? "设备"}` : midi.status === "denied" ? "浏览器 MIDI 权限未开启" : "电脑端连接 MIDI 键盘"}</small>
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
                    <section className="staff-game-settings-section staff-game-difficulty-setting">
                      <h3>难度</h3>
                      <div aria-label="游戏难度" className="staff-game-difficulty-options" role="group">
                        {GAME_DIFFICULTIES.map((option) => (
                          <button
                            aria-pressed={settingsDraft.difficulty === option.id}
                            className={`staff-game-difficulty-option${settingsDraft.difficulty === option.id ? " is-selected" : ""}`}
                            key={option.id}
                            onClick={() => onDifficultyChange(option.id)}
                            type="button"
                          >{option.label}</button>
                        ))}
                      </div>
                      <p className="staff-game-difficulty-summary" aria-live="polite">
                        <span>下落 { (draftDifficulty.bubbleDurationMs / 1000).toFixed(1) } 秒 · 连击等待 { (draftDifficulty.comboWindowMs / 1000).toFixed(1) } 秒</span>
                        <span>答对 {draftDifficulty.correctPoints} 分 · 连击每次 +{draftDifficulty.comboBonusPoints} 分</span>
                      </p>
                    </section>
                    {settingsDraft.inputMode === "physical" ? (
                      <StaffGamePhysicalInputNotice />
                    ) : null}
                    <div className="staff-game-dialog-actions">
                      <button className="staff-game-secondary" onClick={closeGameDialog} type="button">取消</button>
                      <button className="staff-game-primary" onClick={applyGameSettings} type="button">确定</button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>,
          document.body,
        ) : null}
    </>
  );
}
