import { Keyboard, Mic, Music2, Play, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { StaffGameSong, StaffGameSongProgress, StaffGameSongRecord } from "../data/staffGameSongs";
import bubbleShell from "../assets/effects/bubble-shell-empty-center.webp";
import notationC4Preview from "../assets/notation/treble-staff-c4-note.webp";
import starParticleArt from "../assets/ui/star-particle.webp";

interface SharedArtwork {
  bubbleImage: string;
  starImage: string;
}

type StaffGameReadyPanelProps = SharedArtwork & (
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
      onStartSong: () => void;
      onBackToSongList: () => void;
    }
  | {
      variant: "level";
      focusNote: string;
      bestStars: number;
      maxCombo: number;
      inputMode: "virtual" | "physical" | "midi";
      inputStatusText: string;
      inputStatusState: "error" | "ready" | "pending";
      isStarting: boolean;
      onStartLevel: () => void;
    }
);

export function StaffGameReadyPanel(props: StaffGameReadyPanelProps) {
  if (props.variant === "song-list") {
    return (
      <section aria-label="选择游戏歌曲" className="staff-game-card staff-game-song-card">
        <span aria-hidden="true" className="staff-game-song-card-ornament"><Sparkles size={22} strokeWidth={2.4} /></span>
        <div className="staff-game-song-list-heading">
          <div><h1>选择歌曲</h1><p>自然音单旋律 · 可以自由选歌</p></div>
          <span>{props.songs.length} 首</span>
        </div>
        <div className="staff-game-song-list">
          {props.songs.map((song) => {
            const record = props.songProgress[song.id];
            return (
              <button className="staff-game-song-choice" key={song.id} onClick={() => props.onSelectSong(song.id)} type="button">
                <span className="staff-game-song-choice-note" aria-hidden="true">♪</span>
                <span className="staff-game-song-choice-copy">
                  <strong>{song.title}</strong>
                  <small>{song.englishTitle}</small>
                  <span>{song.difficulty} · {song.noteMidis.length} 个音 · 最佳 {record?.bestScore ?? 0} 分</span>
                </span>
                <strong aria-label={`${record?.bestStars ?? 0} 颗星`} className="staff-game-history-stars">
                  {[1, 2, 3].map((star) => (
                    <img alt="" className={(record?.bestStars ?? 0) >= star ? "earned" : ""} key={star} src={props.starImage} />
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
      <section aria-label={`${song.title} 歌曲详情`} className="staff-game-card staff-game-song-card staff-game-song-detail-card">
        <span aria-hidden="true" className="staff-game-song-card-ornament"><Sparkles size={22} strokeWidth={2.4} /></span>
        <div className="staff-game-song-detail-hero">
          <div className="staff-game-preview-bubble">
            <img alt="" aria-hidden="true" className="staff-game-bubble-shell" draggable="false" src={props.bubbleImage} />
            {props.previewNotation}
          </div>
          <div>
            <h1>{song.title}</h1>
            <p>{song.englishTitle}</p>
          </div>
        </div>
        <p className="staff-game-song-description">{song.description}</p>
        <div className="staff-game-song-facts">
          <span>{song.difficulty}</span><span>自然音</span><span>{song.noteMidis.length} 个音</span>
        </div>
        <div className="staff-game-song-record">
          <span>历史最佳</span>
          <strong className="staff-game-history-stars">
            {[1, 2, 3].map((star) => (
              <img alt="" className={record.bestStars >= star ? "earned" : ""} key={star} src={props.starImage} />
            ))}
          </strong>
          <small>{record.bestScore} 分 · 首次准确率 {record.bestAccuracy}% · 最高连击 {record.maxCombo}</small>
        </div>
        <p className="staff-game-song-howto">泡泡按旋律顺序出现，答错可重试；漏音后继续下一音。完成歌曲后按首次作答准确率评星。</p>
        <button className="staff-game-primary" disabled={props.isStarting} onClick={props.onStartSong} type="button">
          <Play fill="currentColor" size={20} />{props.isStarting ? "正在准备…" : "开始演奏"}
        </button>
        <button className="staff-game-song-inline-back" onClick={props.onBackToSongList} type="button">‹ 返回歌曲列表</button>
      </section>
    );
  }

  const inputModeIcon = props.inputMode === "virtual"
    ? <Keyboard size={17} />
    : props.inputMode === "midi"
      ? <Music2 size={17} />
      : <Mic size={17} />;
  return (
    <div className="staff-game-card staff-game-ready-card">
      <h1>五线谱闯关</h1>
      <div className="staff-game-preview-bubble">
        <img alt="" aria-hidden="true" className="staff-game-bubble-shell" draggable="false" src={props.bubbleImage} />
        <img alt="中央 C 音符位于高音谱表上的示意图" className="staff-game-preview-notation" draggable="false" src={notationC4Preview} />
      </div>
      <div className="staff-game-level-detail">
        <div className="staff-game-stat"><span>本关重点音符</span><strong>{props.focusNote}</strong></div>
        <div className="staff-game-stat">
          <span>历史星级</span>
          <strong aria-label={`${props.bestStars} 星`} className="staff-game-history-stars">
            {[1, 2, 3].map((star) => (
              <img alt="" className={props.bestStars >= star ? "earned" : ""} key={star} src={props.starImage} />
            ))}
          </strong>
        </div>
        <div className="staff-game-stat"><span>最高连击</span><strong>{props.maxCombo} 次</strong></div>
      </div>
      <div className={`staff-game-mic-status${props.inputStatusState === "error" ? " has-error" : props.inputStatusState === "ready" ? " is-ready" : " is-pending"}`}>
        <span aria-hidden="true" className="staff-game-mic-indicator">{inputModeIcon}</span>
        <span>{props.inputStatusText}</span>
      </div>
      <button className="staff-game-primary" disabled={props.isStarting} onClick={props.onStartLevel} type="button">
        <Play fill="currentColor" size={20} />{props.isStarting ? "正在准备…" : "开始闯关"}
      </button>
    </div>
  );
}
