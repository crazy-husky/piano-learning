import { Keyboard, Mic, Music2, Play, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type {
  StaffGameSong,
  StaffGameSongProgress,
  StaffGameSongRecord,
} from "../data/staffGameSongs";
import type { StaffGameWrongNoteRange } from "../../../domain/staffGameWrongNoteArchives";
import notationC4Preview from "../assets/notation/treble-staff-c4-note.webp";

interface SharedArtwork {
  bubbleImage: string;
  starImage: string;
}

type StaffGameReadyPanelProps = SharedArtwork &
  (
    | {
        variant: "song-list";
        songs: readonly StaffGameSong[];
        songProgress: StaffGameSongProgress;
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
        reviewNotes: Array<{ label: string; weight: number }>;
        wrongNoteArchiveDateCount: number;
        inputMode: "virtual" | "physical" | "midi";
        inputStatusText: string;
        inputStatusState: "error" | "ready" | "pending";
        isStarting: boolean;
        onSelectReadyMode: (mode: "level" | "review") => void;
        onChangeReviewRange: (range: StaffGameWrongNoteRange) => void;
        onClearWrongNoteArchives: () => Promise<void>;
        onStartReview: () => void;
        onStartLevel: () => void;
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
            const record = props.songProgress[song.id];
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
                    {song.difficulty} · {song.noteMidis.length} 个音 · 最佳{" "}
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
            {Math.round(record.bestScore)} 分 · 首次准确率 {Math.round(record.bestAccuracy)}% ·
            最高连击 {record.maxCombo}
          </small>
        </div>
        <p className="staff-game-song-howto">
          泡泡按旋律顺序出现，答错可重试；漏音后继续下一音。完成歌曲后按首次作答准确率评星。
        </p>
        <button
          className="staff-game-primary"
          disabled={props.isStarting}
          onClick={props.onStartSong}
          type="button"
        >
          <Play fill="currentColor" size={20} />
          {props.isStarting
            ? props.isPreparingMicrophone
              ? "正在准备，请稍等…"
              : "正在准备…"
            : "开始演奏"}
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
  return (
    <div
      className={`staff-game-card staff-game-ready-card${props.readyMode === "review" ? " is-wrong-note-review" : ""}`}
    >
      <div className="staff-game-ready-mode-switch" aria-label="选择游戏模式" role="group">
        <button
          aria-pressed={props.readyMode === "level"}
          className={props.readyMode === "level" ? "is-active" : ""}
          onClick={() => props.onSelectReadyMode("level")}
          type="button"
        >
          闯关
        </button>
        <button
          aria-pressed={props.readyMode === "review"}
          className={props.readyMode === "review" ? "is-active" : ""}
          onClick={() => props.onSelectReadyMode("review")}
          type="button"
        >
          错题复习
        </button>
      </div>
      <h1>{props.readyMode === "review" ? "错题复习" : "五线谱闯关"}</h1>
      <div className="staff-game-preview-bubble">
        <img
          alt=""
          aria-hidden="true"
          className="staff-game-bubble-shell"
          draggable="false"
          src={props.bubbleImage}
        />
        <img
          alt="中央 C 音符位于高音谱表上的示意图"
          className="staff-game-preview-notation"
          draggable="false"
          src={notationC4Preview}
        />
      </div>
      {props.readyMode === "review" ? (
        <div className="staff-game-review-picker">
          <div className="staff-game-review-range-row">
            <label className="staff-game-review-range">
              <span>复习范围</span>
              <select
                aria-label="错题复习时间范围"
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
            {props.wrongNoteArchiveDateCount > 0 ? (
              <button
                aria-label="管理错题归档"
                className="staff-game-archive-manage"
                onClick={() => void props.onClearWrongNoteArchives()}
                type="button"
              >
                管理
              </button>
            ) : null}
          </div>
          <div className="staff-game-review-preview" aria-live="polite">
            <strong>优先复习的音</strong>
            {props.reviewNotes.length > 0 ? (
              <ol>
                {props.reviewNotes.map((note) => (
                  <li key={note.label}>
                    <span>{note.label}</span>
                    <small>权重 {note.weight.toFixed(1)}</small>
                  </li>
                ))}
              </ol>
            ) : (
              <p>
                {props.wrongNoteArchiveDateCount === 0
                  ? "暂无错题归档记录"
                  : "所选范围内还没有错题记录"}
              </p>
            )}
          </div>
          <p>错题音会优先出现，并穿插其他已解锁音。</p>
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
            <span>最高连击</span>
            <strong>{props.maxCombo} 次</strong>
          </div>
        </div>
      )}
      <div
        className={`staff-game-mic-status${props.inputStatusState === "error" ? " has-error" : props.inputStatusState === "ready" ? " is-ready" : " is-pending"}`}
      >
        <span aria-hidden="true" className="staff-game-mic-indicator">
          {inputModeIcon}
        </span>
        <span aria-live="polite" role="status">
          {props.inputStatusText}
        </span>
      </div>
      <button
        className={`staff-game-primary${props.isStarting ? " is-loading" : ""}`}
        disabled={
          props.isStarting || (props.readyMode === "review" && props.reviewNotes.length === 0)
        }
        onClick={props.readyMode === "review" ? props.onStartReview : props.onStartLevel}
        type="button"
      >
        <Play fill="currentColor" size={20} />
        {props.isStarting ? "正在准备…" : props.readyMode === "review" ? "开始复习" : "开始闯关"}
      </button>
    </div>
  );
}
