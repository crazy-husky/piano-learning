import { useEffect, useState } from "react";
import {
  getSongPracticeProgressEntries,
  type SongPracticeProgress,
} from "../../practice/song-practice/songPracticeProgress";
import type { SongPracticeKeyVersion } from "../../practice/song-practice/songPracticeMaterials";

const SONG_PROGRESS_ENTRIES: readonly {
  songId: string;
  keyVersion: SongPracticeKeyVersion;
  title: string;
  version: string;
}[] = [
  { songId: "cong-cong-na-nian", keyVersion: "c", title: "匆匆那年", version: "C 调版" },
  { songId: "cong-cong-na-nian", keyVersion: "original", title: "匆匆那年", version: "原调版" },
  { songId: "always-with-me", keyVersion: "c", title: "Always with Me", version: "C 调简单版" },
  { songId: "always-with-me", keyVersion: "original", title: "Always with Me", version: "原调版" },
];

const MODE_LABELS = [
  ["right", "右手"],
  ["left", "左手"],
  ["both", "混弹"],
] as const;

function emptyProgress(): SongPracticeProgress {
  const emptyMode = () => ({ attempts: 0, correctTargets: 0, incorrectAttempts: 0 });
  return {
    activeMs: 0,
    completedSessions: 0,
    modes: { left: emptyMode(), right: emptyMode(), both: emptyMode() },
    sessionsStarted: 0,
  };
}

function formatActiveTime(milliseconds: number): string {
  const totalMinutes = Math.floor(milliseconds / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

export function SongPracticeStatsPanel(): JSX.Element {
  const [progressByKey, setProgressByKey] = useState<Record<string, SongPracticeProgress>>({});

  useEffect(() => {
    setProgressByKey(
      Object.fromEntries(
        getSongPracticeProgressEntries().map(({ key, progress }) => [key, progress])
      )
    );
  }, []);

  return (
    <section
      aria-labelledby="song-practice-stats-title"
      className="panel song-practice-stats-panel"
    >
      <div className="song-practice-stats-heading">
        <div>
          <h2 id="song-practice-stats-title">歌曲练习</h2>
          <p>与自由练习分开累计，不受上方日期筛选影响。</p>
        </div>
      </div>
      <div className="song-practice-stats-grid">
        {SONG_PROGRESS_ENTRIES.map(({ songId, keyVersion, title, version }) => {
          const key = `${songId}:${keyVersion}`;
          const progress = progressByKey[key] ?? emptyProgress();
          return (
            <article className="song-practice-stats-card" key={key}>
              <h3>
                {title}
                <span>{version}</span>
              </h3>
              <dl>
                <div>
                  <dt>完成</dt>
                  <dd>{progress.completedSessions} 次</dd>
                </div>
                <div>
                  <dt>开始</dt>
                  <dd>{progress.sessionsStarted} 次</dd>
                </div>
                <div>
                  <dt>完成用时</dt>
                  <dd>{formatActiveTime(progress.activeMs)}</dd>
                </div>
              </dl>
              <div className="song-practice-stats-modes">
                {MODE_LABELS.map(([mode, label]) => {
                  const stats = progress.modes[mode];
                  const accuracy =
                    stats.attempts > 0
                      ? Math.round((stats.correctTargets / stats.attempts) * 100)
                      : null;
                  return (
                    <span key={mode}>
                      {label}：{stats.attempts} 次{accuracy === null ? "" : ` · ${accuracy}%`}
                    </span>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
