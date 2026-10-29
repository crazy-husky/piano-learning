import { useEffect, useMemo, useState } from "react";
import { db } from "../../../data/db";
import type { AnswerEvent } from "../../../domain/types";
import { GAME_DIFFICULTIES, type GameDifficulty } from "../../staff-game/logic/staffGameRules";
import {
  readStaffGameSongProgress,
  STAFF_GAME_SONGS,
  type StaffGameSongProgress,
} from "../../staff-game/data/staffGameSongs";
import { SongPracticeStatsPanel } from "../../stats/components/SongPracticeStatsPanel";
import type { PlaygroundStatsTab } from "../../../routing/appRoutes";

interface ChallengeProgressSnapshot {
  learningBestStars: number[];
  arcadeBestStars: number[];
  arcadeBestScores: number[];
  unlockedLevel: number;
}

const EMPTY_CHALLENGE_PROGRESS: ChallengeProgressSnapshot = {
  learningBestStars: [],
  arcadeBestStars: [],
  arcadeBestScores: [],
  unlockedLevel: 1,
};

function readChallengeProgress(): ChallengeProgressSnapshot {
  try {
    const value = JSON.parse(localStorage.getItem("anki-note.staffGameProgress.v6") ?? "null") as {
      version?: unknown;
      modes?: {
        learning?: { bestStars?: unknown };
        arcade?: { bestStars?: unknown; bestScores?: unknown };
      };
      unlockedLevel?: unknown;
    } | null;
    if (!value || value.version !== 6) return EMPTY_CHALLENGE_PROGRESS;
    const readArray = (raw: unknown, max: number): number[] =>
      Array.isArray(raw)
        ? raw.map((item) =>
            Number.isFinite(Number(item)) ? Math.max(0, Math.min(max, Math.floor(Number(item)))) : 0
          )
        : [];
    return {
      learningBestStars: readArray(value.modes?.learning?.bestStars, 3),
      arcadeBestStars: readArray(value.modes?.arcade?.bestStars, 3),
      arcadeBestScores: readArray(value.modes?.arcade?.bestScores, Number.MAX_SAFE_INTEGER),
      unlockedLevel: Number.isFinite(Number(value.unlockedLevel))
        ? Math.max(1, Math.floor(Number(value.unlockedLevel)))
        : 1,
    };
  } catch {
    return EMPTY_CHALLENGE_PROGRESS;
  }
}

function ChallengeStats({ dataSetId }: { dataSetId: string }): JSX.Element {
  const [events, setEvents] = useState<AnswerEvent[] | null>(null);
  const [progress, setProgress] = useState(readChallengeProgress);

  useEffect(() => {
    let active = true;
    void db.answerEvents
      .toArray()
      .then((rows) => {
        if (active) setEvents(rows);
      })
      .catch(() => {
        if (active) setEvents([]);
      });
    const refreshProgress = (): void => setProgress(readChallengeProgress());
    window.addEventListener("storage", refreshProgress);
    return () => {
      active = false;
      window.removeEventListener("storage", refreshProgress);
    };
  }, []);

  const challengeEvents = useMemo(
    () =>
      (events ?? []).filter(
        (event) =>
          event.dataSetId === dataSetId &&
          event.mode === "staff-game" &&
          event.staffGameSource !== "review"
      ),
    [dataSetId, events]
  );
  const answered = challengeEvents.filter((event) => event.isCorrectFinal !== null);
  const firstTry = challengeEvents.filter((event) => event.isCorrectFirstTry !== null);
  const firstTryCorrectCount = firstTry.filter((event) => event.isCorrectFirstTry).length;
  const clearedLevels = progress.learningBestStars.filter((stars) => stars > 0).length;
  const stars = progress.learningBestStars.reduce((sum, value) => sum + value, 0);
  const arcadeScore = Math.max(0, ...progress.arcadeBestScores);

  return (
    <section aria-labelledby="playground-challenge-stats-title" className="module-stats-view">
      <header className="module-stats-heading">
        <div>
          <span>游乐场 · 闯关</span>
          <h2 id="playground-challenge-stats-title">闯关统计</h2>
          <p>查看已获得的星级、街机最高分和最近答题准确度。</p>
        </div>
      </header>
      <dl className="module-stats-metrics">
        <div>
          <dt>已通关关卡</dt>
          <dd>{clearedLevels}</dd>
        </div>
        <div>
          <dt>累计星级</dt>
          <dd>{stars}</dd>
        </div>
        <div>
          <dt>街机最高分</dt>
          <dd>{arcadeScore}</dd>
        </div>
        <div>
          <dt>首答准确率</dt>
          <dd>
            {firstTry.length
              ? `${Math.round((firstTryCorrectCount / firstTry.length) * 100)}%`
              : "—"}
          </dd>
        </div>
      </dl>
      {events === null ? (
        <p aria-label="正在加载闯关统计" className="module-stats-empty" role="status">
          正在读取闯关答题记录…
        </p>
      ) : challengeEvents.length === 0 ? (
        <p className="module-stats-empty" role="status">
          完成闯关后，这里会显示首答准确率等答题数据。
        </p>
      ) : (
        <p className="module-stats-caption">
          当前已解锁至第 {progress.unlockedLevel} 关 · 共记录 {answered.length} 次有效作答。
        </p>
      )}
    </section>
  );
}

function StaffGameSongStats(): JSX.Element {
  const [progress, setProgress] = useState<StaffGameSongProgress>(() =>
    readStaffGameSongProgress()
  );

  useEffect(() => {
    const refresh = (): void => setProgress(readStaffGameSongProgress());
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  const difficulties = GAME_DIFFICULTIES as readonly { id: GameDifficulty; label: string }[];
  return (
    <section aria-labelledby="playground-song-stats-title" className="panel playground-song-stats">
      <header className="module-stats-heading">
        <div>
          <span>游乐场 · 歌曲</span>
          <h2 id="playground-song-stats-title">歌曲闯关统计</h2>
          <p>每首歌按难度分别记录最佳星级、分数和准确率。</p>
        </div>
      </header>
      <div className="playground-song-stats-grid">
        {STAFF_GAME_SONGS.map((song) => (
          <article className="playground-song-stat-card" key={song.id}>
            <h3>{song.title}</h3>
            {difficulties.map(({ id, label }) => {
              const record = progress[song.id]?.[id];
              return (
                <dl key={id}>
                  <dt>{label}</dt>
                  <dd>
                    {record?.bestStars ?? 0} 星 · {record?.bestScore ?? 0} 分 ·{" "}
                    {record?.bestAccuracy ?? 0}%
                  </dd>
                </dl>
              );
            })}
          </article>
        ))}
      </div>
    </section>
  );
}

export function PlaygroundStatsView({
  activeTab,
  dataSetId,
  onTabChange,
}: {
  activeTab: PlaygroundStatsTab;
  dataSetId: string;
  onTabChange: (tab: PlaygroundStatsTab) => void;
}): JSX.Element {
  return (
    <section
      aria-labelledby="playground-stats-title"
      className="module-stats-view playground-stats-view"
    >
      <header className="module-stats-heading">
        <div>
          <span>游乐场</span>
          <h1 id="playground-stats-title">统计</h1>
          <p>分别查看闯关成绩和歌曲完成情况。</p>
        </div>
      </header>
      <div aria-label="游乐场统计类型" className="playground-stats-tabs" role="tablist">
        {(
          [
            ["challenge", "闯关统计"],
            ["songs", "歌曲统计"],
          ] as const
        ).map(([tab, label]) => (
          <button
            aria-selected={activeTab === tab}
            className={activeTab === tab ? "is-active" : ""}
            key={tab}
            onClick={() => onTabChange(tab)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {activeTab === "challenge" ? (
        <ChallengeStats dataSetId={dataSetId} />
      ) : (
        <div className="playground-songs-stats-content">
          <StaffGameSongStats />
          <SongPracticeStatsPanel />
        </div>
      )}
    </section>
  );
}
