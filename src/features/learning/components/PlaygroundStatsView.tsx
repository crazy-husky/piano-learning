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
import { useStaffGameWrongNoteArchives } from "../../stats/components/WrongNoteStatsPanel";
import { filterStaffGameWrongNoteLearningChallengeArchivesWithErrors } from "../../../domain/staffGameWrongNoteArchives";
import type { StaffGameWrongNoteRange } from "../../../domain/staffGameWrongNoteArchives";
import { StaffGameWrongNoteNoteDiagnosticPanel } from "../../staff-game/components/StaffGameWrongNoteNoteDiagnosticPanel";
import { StaffGameWrongNoteTrendPanel } from "../../staff-game/components/StaffGameWrongNoteTrendPanel";
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

function ChallengeLearningWrongNoteStats(): JSX.Element {
  const { archives, error, loading, retry } = useStaffGameWrongNoteArchives();
  const [range, setRange] = useState<StaffGameWrongNoteRange>("all");
  const learningArchives = useMemo(
    () => filterStaffGameWrongNoteLearningChallengeArchivesWithErrors(archives),
    [archives]
  );

  return (
    <section aria-label="学习模式错题统计" className="playground-learning-wrong-note-stats">
      <header className="playground-learning-wrong-note-heading">
        <div>
          <h3>错题趋势与单音诊断</h3>
          <p>仅统计学习模式中出现错漏并保存的对局。</p>
        </div>
        <label>
          <span>记录时间</span>
          <select
            aria-label="学习模式错题统计时间范围"
            onChange={(event) =>
              setRange(
                event.target.value === "all"
                  ? "all"
                  : (Number(event.target.value) as 3 | 7 | 15 | 30)
              )
            }
            value={range}
          >
            <option value={3}>近 3 天</option>
            <option value={7}>近 7 天</option>
            <option value={15}>近 15 天</option>
            <option value={30}>近 30 天</option>
            <option value="all">全部</option>
          </select>
        </label>
      </header>
      {loading ? (
        <p className="module-stats-empty" role="status">
          正在读取错题统计…
        </p>
      ) : error ? (
        <div className="module-stats-empty" role="alert">
          <p>{error}</p>
          <button onClick={retry} type="button">
            重试
          </button>
        </div>
      ) : (
        <>
          <section className="panel playground-wrong-note-stat-card">
            <header>
              <h4>错题趋势</h4>
              <p>按相同练习条件查看准确率和答题用时的变化。</p>
            </header>
            <StaffGameWrongNoteTrendPanel
              archives={learningArchives}
              onChangeRange={setRange}
              range={range}
              scopeDescription="仅包含学习模式的闯关记录。"
              showRangeControl={false}
            />
          </section>
          <section className="panel playground-wrong-note-stat-card">
            <header>
              <h4>单音诊断</h4>
              <p>查看各音的错漏比例、反应时间和常见错认。</p>
            </header>
            <StaffGameWrongNoteNoteDiagnosticPanel
              archives={learningArchives}
              fixedGameMode="learning"
              onChangeRange={setRange}
              range={range}
              showModeControl={false}
              showRangeControl={false}
            />
          </section>
        </>
      )}
    </section>
  );
}

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
  const [mode, setMode] = useState<"learning" | "arcade">("learning");

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
  const modeEvents = challengeEvents.filter((event) => event.gameMode === mode);
  const answered = modeEvents.filter((event) => event.isCorrectFinal !== null);
  const firstTry = modeEvents.filter((event) => event.isCorrectFirstTry !== null);
  const firstTryCorrectCount = firstTry.filter((event) => event.isCorrectFirstTry).length;
  const selectedBestStars =
    mode === "learning" ? progress.learningBestStars : progress.arcadeBestStars;
  const clearedLevels = selectedBestStars.filter((stars) => stars > 0).length;
  const stars = selectedBestStars.reduce((sum, value) => sum + value, 0);
  const arcadeScore = Math.max(0, ...progress.arcadeBestScores);

  return (
    <section aria-labelledby="playground-challenge-stats-title" className="module-stats-view">
      <header className="module-stats-heading">
        <div>
          <span>游乐场 · 闯关</span>
          <h2 id="playground-challenge-stats-title">闯关统计</h2>
          <p>分别查看学习模式和娱乐模式的闯关表现。</p>
        </div>
      </header>
      <div aria-label="闯关统计模式" className="playground-challenge-stats-tabs" role="tablist">
        <button
          aria-controls="playground-challenge-stats-learning-panel"
          aria-selected={mode === "learning"}
          className={mode === "learning" ? "is-active" : ""}
          id="playground-challenge-stats-learning-tab"
          onClick={() => setMode("learning")}
          role="tab"
          type="button"
        >
          学习模式
        </button>
        <button
          aria-controls="playground-challenge-stats-arcade-panel"
          aria-selected={mode === "arcade"}
          className={mode === "arcade" ? "is-active" : ""}
          id="playground-challenge-stats-arcade-tab"
          onClick={() => setMode("arcade")}
          role="tab"
          type="button"
        >
          娱乐模式
        </button>
      </div>
      <div
        aria-labelledby={`playground-challenge-stats-${mode}-tab`}
        className="playground-challenge-stats-panel"
        id={`playground-challenge-stats-${mode}-panel`}
        role="tabpanel"
      >
        {mode === "arcade" ? (
          <>
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
                <dt>娱乐模式最高分</dt>
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
            ) : modeEvents.length === 0 ? (
              <p className="module-stats-empty" role="status">
                完成娱乐模式闯关后，这里会显示对应的答题数据。
              </p>
            ) : (
              <p className="module-stats-caption">共记录 {answered.length} 次有效作答。</p>
            )}
          </>
        ) : null}
        {mode === "learning" ? <ChallengeLearningWrongNoteStats /> : null}
      </div>
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
  showTabs = true,
}: {
  activeTab: PlaygroundStatsTab;
  dataSetId: string;
  onTabChange: (tab: PlaygroundStatsTab) => void;
  showTabs?: boolean;
}): JSX.Element {
  const [songStatsMode, setSongStatsMode] = useState<"score" | "bubble">("bubble");

  return (
    <section
      aria-label={showTabs ? undefined : activeTab === "challenge" ? "闯关统计" : "歌曲统计"}
      aria-labelledby={showTabs ? "playground-stats-title" : undefined}
      className="module-stats-view playground-stats-view"
    >
      {showTabs ? (
        <>
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
        </>
      ) : null}
      {activeTab === "challenge" ? (
        <ChallengeStats dataSetId={dataSetId} />
      ) : (
        <section aria-label="歌曲统计明细" className="playground-songs-stats-content">
          <div aria-label="歌曲统计类型" className="playground-song-stats-tabs" role="tablist">
            <button
              aria-controls="playground-song-stats-score-panel"
              aria-selected={songStatsMode === "score"}
              className={songStatsMode === "score" ? "is-active" : ""}
              id="playground-song-stats-score-tab"
              onClick={() => setSongStatsMode("score")}
              role="tab"
              type="button"
            >
              五线谱歌曲
            </button>
            <button
              aria-controls="playground-song-stats-bubble-panel"
              aria-selected={songStatsMode === "bubble"}
              className={songStatsMode === "bubble" ? "is-active" : ""}
              id="playground-song-stats-bubble-tab"
              onClick={() => setSongStatsMode("bubble")}
              role="tab"
              type="button"
            >
              气泡歌曲
            </button>
          </div>
          <div
            aria-labelledby={`playground-song-stats-${songStatsMode}-tab`}
            className="playground-song-stats-panel"
            id={`playground-song-stats-${songStatsMode}-panel`}
            role="tabpanel"
          >
            {songStatsMode === "bubble" ? <StaffGameSongStats /> : <SongPracticeStatsPanel />}
          </div>
        </section>
      )}
    </section>
  );
}
