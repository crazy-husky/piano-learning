import { BookOpen, Keyboard, Lightbulb, Mic, Music2, Play, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type {
  StaffGameSong,
  StaffGameSongProgress,
  StaffGameSongRecord,
} from "../data/staffGameSongs";
import type { StaffGameWrongNoteRange } from "../../../domain/staffGameWrongNoteArchives";
import {
  GAME_DIFFICULTIES,
  type GameDifficulty,
  type StaffGameArcadeDuration,
  type StaffGameChallengeMode,
  type StaffGameNotePoolScope,
} from "../logic/staffGameRules";
import { formatStaffGameWrongNoteReviewDuration } from "../logic/staffGameWrongNoteReview";
import {
  LoadingActivityText,
  type LoadingActivityKind,
} from "../../../shared/components/LoadingActivity";

interface SharedArtwork {
  bubbleImage: string;
  starImage: string;
}

type StaffGameReadyInputMode = "virtual" | "physical" | "midi";

type StaffGameReadyPanelProps = SharedArtwork &
  (
    | {
        variant: "song-list";
        songs: readonly StaffGameSong[];
        songProgress: StaffGameSongProgress;
        difficulty: GameDifficulty;
        onSelectSong: (songId: string) => void;
      }
    | {
        variant: "song-detail";
        song: StaffGameSong;
        record: StaffGameSongRecord;
        previewNotation: ReactNode;
        isStarting: boolean;
        isPreparingMicrophone: boolean;
        onStartSong: () => void;
      }
    | {
        variant: "level";
        readyMode: "level" | "review";
        focusNote: string;
        bestStars: number;
        maxCombo: number;
        reviewRange: StaffGameWrongNoteRange;
        reviewConditionValue: string;
        reviewConditions: readonly { value: string; label: string }[];
        reviewNotes: Array<{ label: string; errorCount: number; accuracyPercent: number | null }>;
        reviewQuestionCount: number;
        reviewDurationMs: number;
        reviewWeakNoteCount: number;
        wrongNoteArchiveDateCount: number;
        inputMode: StaffGameReadyInputMode;
        midiInputAvailable: boolean;
        virtualKeyboardAvailable: boolean;
        inputStatusActivity: LoadingActivityKind | null;
        inputStatusText: string;
        inputStatusState: "error" | "ready" | "pending";
        challengeMode: StaffGameChallengeMode;
        arcadeDuration: StaffGameArcadeDuration;
        difficulty: GameDifficulty;
        notePoolScope: StaffGameNotePoolScope;
        learningQuestionCount: number;
        arcadeDefaultDurationMs: number;
        isPreparingMicrophone: boolean;
        isStarting: boolean;
        onSelectReadyMode: (mode: "level" | "review") => void;
        onChangeReviewRange: (range: StaffGameWrongNoteRange) => void;
        onChangeReviewCondition: (value: string) => void;
        onOpenWrongNoteArchiveManager: () => void;
        onOpenWrongNoteStudy: () => void;
        onStartReview: () => void;
        onStartLevel: () => void;
        onChangeChallengeMode: (mode: StaffGameChallengeMode) => void;
        onChangeInputMode: (mode: StaffGameReadyInputMode) => void;
        onChangeArcadeDuration: (duration: StaffGameArcadeDuration) => void;
        onChangeDifficulty: (difficulty: GameDifficulty) => void;
        onChangeNotePoolScope: (scope: StaffGameNotePoolScope) => void;
      }
  );

export function StaffGameReadyPanel(props: StaffGameReadyPanelProps) {
  if (props.variant === "song-list") {
    return (
      <section aria-label="选择游戏歌曲" className="staff-game-card staff-game-song-card">
        <span aria-hidden="true" className="staff-game-song-card-ornament">
          <Sparkles size={22} strokeWidth={2.4} />
        </span>
        <div className="staff-game-song-list-heading">
          <div>
            <h1>选择歌曲</h1>
            <p>自然音单旋律 · 可以自由选歌</p>
          </div>
          <span>{props.songs.length} 首</span>
        </div>
        <div className="staff-game-song-list">
          {props.songs.map((song) => {
            const record = props.songProgress[song.id]?.[props.difficulty];
            const difficultyLabel =
              GAME_DIFFICULTIES.find((item) => item.id === props.difficulty)?.label ?? "当前";
            return (
              <button
                className="staff-game-song-choice"
                key={song.id}
                onClick={() => props.onSelectSong(song.id)}
                type="button"
              >
                <span className="staff-game-song-choice-note" aria-hidden="true">
                  ♪
                </span>
                <span className="staff-game-song-choice-copy">
                  <strong>{song.title}</strong>
                  <small>{song.englishTitle}</small>
                  <span>
                    {song.difficulty} · {song.noteMidis.length} 个音 · {difficultyLabel}难度最佳{" "}
                    {Math.round(record?.bestScore ?? 0)} 分
                  </span>
                </span>
                <strong
                  aria-label={`${record?.bestStars ?? 0} 颗星`}
                  className="staff-game-history-stars"
                >
                  {[1, 2, 3].map((star) => (
                    <img
                      alt=""
                      className={(record?.bestStars ?? 0) >= star ? "earned" : ""}
                      key={star}
                      src={props.starImage}
                    />
                  ))}
                </strong>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  if (props.variant === "song-detail") {
    const { song, record } = props;
    return (
      <section
        aria-label={`${song.title} 歌曲详情`}
        className="staff-game-card staff-game-song-card staff-game-song-detail-card"
      >
        <span aria-hidden="true" className="staff-game-song-card-ornament">
          <Sparkles size={22} strokeWidth={2.4} />
        </span>
        <div className="staff-game-song-detail-hero">
          <div className="staff-game-preview-bubble">
            <img
              alt=""
              aria-hidden="true"
              className="staff-game-bubble-shell"
              draggable="false"
              src={props.bubbleImage}
            />
            {props.previewNotation}
          </div>
          <div>
            <h1>{song.title}</h1>
            <p>{song.englishTitle}</p>
          </div>
        </div>
        <p className="staff-game-song-description">{song.description}</p>
        <div className="staff-game-song-facts">
          <span>{song.difficulty}</span>
          <span>自然音</span>
          <span>{song.noteMidis.length} 个音</span>
        </div>
        <div className="staff-game-song-record">
          <span>历史最佳</span>
          <strong className="staff-game-history-stars">
            {[1, 2, 3].map((star) => (
              <img
                alt=""
                className={record.bestStars >= star ? "earned" : ""}
                key={star}
                src={props.starImage}
              />
            ))}
          </strong>
          <small>
            {Math.round(record.bestScore)} 分 · 准确率（第一次就按对）{" "}
            {Math.round(record.bestAccuracy)}% · 最高连击 {record.maxCombo}
          </small>
        </div>
        <p className="staff-game-song-howto">
          泡泡按旋律顺序出现，答错可重试；漏音后继续下一音。完成歌曲后按准确率（第一次就按对）评星。
        </p>
        <button
          className="staff-game-primary"
          disabled={props.isStarting}
          onClick={props.onStartSong}
          type="button"
        >
          {props.isStarting ? (
            <LoadingActivityText kind="dots">
              {props.isPreparingMicrophone ? "正在准备识别模型" : "正在准备"}
            </LoadingActivityText>
          ) : (
            <>
              <Play fill="currentColor" size={20} />
              开始演奏
            </>
          )}
        </button>
      </section>
    );
  }

  const inputModeIcon =
    props.inputMode === "virtual" ? (
      <Keyboard size={17} />
    ) : props.inputMode === "midi" ? (
      <Music2 size={17} />
    ) : (
      <Mic size={17} />
    );
  const activeReadyTab =
    props.readyMode === "review"
      ? "review"
      : props.challengeMode === "learning"
        ? "learning"
        : "arcade";
  const selectReadyTab = (tab: "learning" | "review" | "arcade") => {
    if (tab === "review") {
      props.onSelectReadyMode("review");
      return;
    }

    props.onSelectReadyMode("level");
    props.onChangeChallengeMode(tab);
  };
  const renderInputSetting = () => (
    <label className="staff-game-ready-input-setting">
      <span>输入方式</span>
      <select
        aria-label="输入方式"
        onChange={(event) =>
          props.onChangeInputMode(event.currentTarget.value as StaffGameReadyInputMode)
        }
        value={props.inputMode}
      >
        <option disabled={!props.virtualKeyboardAvailable} value="virtual">
          虚拟键盘
        </option>
        <option value="physical">麦克风</option>
        {props.midiInputAvailable || props.inputMode === "midi" ? (
          <option disabled={!props.midiInputAvailable} value="midi">
            MIDI 键盘
          </option>
        ) : null}
      </select>
    </label>
  );
  const inputStatusContent = (
    <div
      className={`staff-game-mic-status${props.inputStatusState === "error" ? " has-error" : props.inputStatusState === "ready" ? " is-ready" : " is-pending"}${props.inputMode === "midi" && props.inputStatusState === "pending" && !props.inputStatusActivity ? " is-idle-midi-hint" : ""}`}
    >
      <span aria-hidden="true" className="staff-game-mic-indicator">
        {inputModeIcon}
      </span>
      <span aria-live="polite" role="status">
        {props.inputStatusActivity ? (
          <LoadingActivityText kind={props.inputStatusActivity}>
            {props.inputStatusText}
          </LoadingActivityText>
        ) : (
          props.inputStatusText
        )}
      </span>
    </div>
  );

  return (
    <div
      className={`staff-game-card staff-game-ready-card${props.readyMode === "review" ? " is-wrong-note-review" : props.challengeMode === "arcade" ? " is-arcade-ready" : ""}`}
    >
      <div className="staff-game-ready-mode-switch" aria-label="选择练习模式" role="group">
        <button
          aria-pressed={activeReadyTab === "learning"}
          className={activeReadyTab === "learning" ? "is-active" : ""}
          onClick={() => selectReadyTab("learning")}
          type="button"
        >
          学习测试
        </button>
        <button
          aria-pressed={activeReadyTab === "review"}
          className={activeReadyTab === "review" ? "is-active" : ""}
          onClick={() => selectReadyTab("review")}
          type="button"
        >
          错题复习
        </button>
        <button
          aria-pressed={activeReadyTab === "arcade"}
          className={activeReadyTab === "arcade" ? "is-active" : ""}
          onClick={() => selectReadyTab("arcade")}
          type="button"
        >
          娱乐模式
        </button>
      </div>
      <div className="staff-game-ready-input-row">{renderInputSetting()}</div>
      {props.readyMode === "level" ? (
        <div className="staff-game-challenge-setup">
          <div className="staff-game-challenge-settings">
            <label>
              <span>难度</span>
              <select
                aria-label="闯关难度"
                onChange={(event) =>
                  props.onChangeDifficulty(event.currentTarget.value as GameDifficulty)
                }
                value={props.difficulty}
              >
                {GAME_DIFFICULTIES.map((difficulty) => (
                  <option key={difficulty.id} value={difficulty.id}>
                    {difficulty.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>音域</span>
              <select
                aria-label="闯关音域"
                onChange={(event) =>
                  props.onChangeNotePoolScope(event.currentTarget.value as StaffGameNotePoolScope)
                }
                value={props.notePoolScope}
              >
                <option value="current-group">当前组</option>
                <option value="all-history-current-clef">当前谱号全部音域</option>
                <option value="all-history">全部已解锁音</option>
              </select>
            </label>
            {props.challengeMode === "arcade" ? (
              <label>
                <span>关卡时长</span>
                <select
                  aria-label="娱乐模式关卡时长"
                  onChange={(event) =>
                    props.onChangeArcadeDuration(
                      event.currentTarget.value === "level-default"
                        ? "level-default"
                        : (Number(event.currentTarget.value) as 60_000 | 120_000 | 180_000)
                    )
                  }
                  value={props.arcadeDuration}
                >
                  <option value="level-default">
                    关卡默认（{Math.ceil(props.arcadeDefaultDurationMs / 1000)} 秒）
                  </option>
                  <option value={60_000}>60 秒</option>
                  <option value={120_000}>120 秒</option>
                  <option value={180_000}>180 秒</option>
                </select>
              </label>
            ) : null}
          </div>
          <p
            aria-live="polite"
            className={`staff-game-challenge-mode-description${props.challengeMode === "learning" ? " is-learning-mode" : ""}`}
          >
            {props.challengeMode === "learning" ? (
              <>
                <span>
                  覆盖 {props.learningQuestionCount / 2} 个音，每个音出现 2 次，共{" "}
                  {props.learningQuestionCount} 题；
                </span>
                <span>完成全部题目后生成学习报告。</span>
              </>
            ) : (
              "时间有限，连击无限！在倒计时结束前尽情弹奏，挑战你的最高分纪录。"
            )}
          </p>
        </div>
      ) : null}
      {props.readyMode === "level" ? (
        <button
          className={`staff-game-primary staff-game-ready-start${props.isStarting ? " is-loading" : ""}`}
          disabled={props.isStarting}
          onClick={props.onStartLevel}
          type="button"
        >
          {props.isStarting ? (
            <LoadingActivityText kind="dots">
              {props.isPreparingMicrophone ? "正在准备识别模型" : "正在准备"}
            </LoadingActivityText>
          ) : (
            <>
              <Play fill="currentColor" size={20} />
              开始闯关
            </>
          )}
        </button>
      ) : null}
      {props.readyMode === "level" ? inputStatusContent : null}
      {props.readyMode === "review" ? (
        <div className="staff-game-review-picker">
          <div className="staff-game-review-filters">
            <label className="staff-game-review-range">
              <span>日期范围</span>
              <select
                aria-label="错题复习日期范围"
                onChange={(event) =>
                  props.onChangeReviewRange(
                    event.target.value === "all"
                      ? "all"
                      : (Number(event.target.value) as 3 | 7 | 15 | 30)
                  )
                }
                value={props.reviewRange}
              >
                <option value={3}>近 3 天</option>
                <option value={7}>近 7 天</option>
                <option value={15}>近 15 天</option>
                <option value={30}>近 30 天</option>
                <option value="all">全部</option>
              </select>
            </label>
            <label className="staff-game-review-condition">
              <span>练习条件</span>
              <select
                aria-label="错题复习练习条件"
                onChange={(event) => props.onChangeReviewCondition(event.currentTarget.value)}
                value={props.reviewConditionValue}
              >
                <option value="all-learning">全部学习测试条件</option>
                {props.reviewConditions.map((condition) => (
                  <option key={condition.value} value={condition.value}>
                    {condition.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-label="详情与管理错题集"
              className="staff-game-archive-manage"
              onClick={props.onOpenWrongNoteArchiveManager}
              title="详情与管理错题集"
              type="button"
            >
              <Lightbulb aria-hidden="true" className="staff-game-archive-manage-icon" size={22} />
            </button>
          </div>
          <div className="staff-game-review-preview" aria-live="polite">
            {props.reviewWeakNoteCount > 0 ? (
              <>
                <div className="staff-game-review-count">
                  <p className="staff-game-review-count-summary">
                    本轮预计 <strong>{props.reviewQuestionCount}</strong> 题，覆盖{" "}
                    <strong>{props.reviewWeakNoteCount}</strong> 个错音，限时{" "}
                    <strong>
                      {formatStaffGameWrongNoteReviewDuration(props.reviewDurationMs)}
                    </strong>
                  </p>
                  {props.reviewWeakNoteCount > 20 ? (
                    <p className="staff-game-review-overload-warning" role="status">
                      错音较多，本轮仍会全部覆盖；可缩小复习范围减少题量。
                    </p>
                  ) : null}
                </div>
                <div className="staff-game-review-priority">
                  <strong>优先复习的音</strong>
                  {props.reviewNotes.length > 0 ? (
                    <ol>
                      {props.reviewNotes.slice(0, 3).map((note, index) => (
                        <li className={`is-priority-${index + 1}`} key={note.label}>
                          <strong>{note.label}</strong>
                          <small
                            aria-label={`错漏 ${note.errorCount} 次，错误率 ${note.accuracyPercent === null ? "暂无数据" : `${100 - Math.round(note.accuracyPercent)}%`}`}
                          >
                            <span>错漏 {note.errorCount} 次</span>
                            <span>
                              错误率{" "}
                              {note.accuracyPercent === null
                                ? "—"
                                : `${100 - Math.round(note.accuracyPercent)}%`}
                            </span>
                          </small>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>当前范围内暂无需要优先复习的音。</p>
                  )}
                </div>
              </>
            ) : (
              <div className="staff-game-review-empty">
                <strong>暂无可复习的错音</strong>
                {props.wrongNoteArchiveDateCount === 0 ? (
                  <p>完成闯关并产生错音后，这里会整理本轮复习内容。</p>
                ) : (
                  <p>所选范围内没有错题，试试扩大日期范围或更换练习条件。</p>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="staff-game-level-detail">
          <div className="staff-game-stat">
            <span>本关重点音符</span>
            <strong>{props.focusNote}</strong>
          </div>
          <div className="staff-game-stat">
            <span>历史星级</span>
            <strong aria-label={`${props.bestStars} 星`} className="staff-game-history-stars">
              {[1, 2, 3].map((star) => (
                <img
                  alt=""
                  className={props.bestStars >= star ? "earned" : ""}
                  key={star}
                  src={props.starImage}
                />
              ))}
            </strong>
          </div>
          <div className="staff-game-stat">
            <span>{props.challengeMode === "learning" ? "娱乐最高连击" : "最高连击"}</span>
            <strong>{props.maxCombo} 次</strong>
          </div>
        </div>
      )}
      {props.readyMode === "review" ? (
        <div className="staff-game-ready-footer">
          <div className="staff-game-ready-actions">
            <button
              className="staff-game-secondary"
              disabled={props.isStarting}
              onClick={props.onOpenWrongNoteStudy}
              type="button"
            >
              <BookOpen aria-hidden="true" size={19} />
              先看一遍
            </button>
            <button
              className={`staff-game-primary${props.isStarting ? " is-loading" : ""}`}
              disabled={props.isStarting || props.reviewNotes.length === 0}
              onClick={props.onStartReview}
              type="button"
            >
              {props.isStarting ? (
                <LoadingActivityText kind="dots">
                  {props.isPreparingMicrophone ? "正在准备识别模型" : "正在准备"}
                </LoadingActivityText>
              ) : (
                <>
                  <Play fill="currentColor" size={20} />
                  开始测试
                </>
              )}
            </button>
          </div>
          {inputStatusContent}
        </div>
      ) : null}
    </div>
  );
}
