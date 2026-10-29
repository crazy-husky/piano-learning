import { useMemo } from "react";
import type {
  AppSettings,
  PracticeSessionRecord,
  ReviewRecord,
  StaffRecallRunRecord,
} from "../../../domain/types";
import type { LearningLevelId } from "../../../routing/appRoutes";
import { DistanceStats, DuetStats, NameToKeyStats } from "./ModuleEventStats";
import { SingleNoteStats } from "./SingleNoteStats";

function SightReadingStats({ runs }: { runs: StaffRecallRunRecord[] }): JSX.Element {
  const totalTargets = useMemo(
    () => runs.reduce((sum, run) => sum + run.targetNoteIds.length, 0),
    [runs]
  );
  const totalMinutes = useMemo(
    () =>
      Math.round(
        runs.reduce(
          (sum, run) => sum + Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt)),
          0
        ) / 60_000
      ),
    [runs]
  );

  return (
    <section aria-labelledby="sight-reading-stats-title" className="module-stats-view">
      <header className="module-stats-heading">
        <div>
          <span>本阶段数据</span>
          <h2 id="sight-reading-stats-title">基础识谱统计</h2>
          <p>记录识谱回忆练习的完成次数与练习投入。</p>
        </div>
      </header>
      {runs.length === 0 ? (
        <p className="module-stats-empty" role="status">
          完成基础识谱练习后，这里会显示学习次数、识别音符数和累计时长。
        </p>
      ) : (
        <dl className="module-stats-metrics">
          <div>
            <dt>学习次数</dt>
            <dd>{runs.length}</dd>
          </div>
          <div>
            <dt>识别音符数</dt>
            <dd>{totalTargets}</dd>
          </div>
          <div>
            <dt>累计时长</dt>
            <dd>{totalMinutes} 分钟</dd>
          </div>
          <div>
            <dt>最近学习</dt>
            <dd>{new Date(runs.at(-1)!.endedAt).toLocaleDateString()}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

export function LearningModuleStatsView({
  levelId,
  settings,
  reviews,
  sessions,
  staffRecallRuns,
  onSettingsSaved,
}: {
  levelId: LearningLevelId;
  settings: AppSettings;
  reviews: ReviewRecord[];
  sessions: PracticeSessionRecord[];
  staffRecallRuns: StaffRecallRunRecord[];
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
}): JSX.Element {
  if (levelId === 1) return <SightReadingStats runs={staffRecallRuns} />;
  if (levelId === 2) {
    return (
      <SingleNoteStats
        onSettingsSaved={onSettingsSaved}
        reviews={reviews}
        sessions={sessions}
        settings={settings}
      />
    );
  }
  if (levelId === 3) return <NameToKeyStats dataSetId={settings.dataSetId} />;
  if (levelId === 4) return <DistanceStats dataSetId={settings.dataSetId} />;
  return <DuetStats dataSetId={settings.dataSetId} />;
}
