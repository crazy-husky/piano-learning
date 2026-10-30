import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  AppSettings,
  PracticeSessionRecord,
  ReviewRecord,
  StaffRecallRunRecord,
} from "../../../domain/types";
import type { LearningLevelId } from "../../../routing/appRoutes";
import {
  DistanceStats,
  DuetStats,
  ModuleEventStats,
  NameToKeyStats,
  StaffToNameStats,
} from "./ModuleEventStats";
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

function NameRecognitionStats({ dataSetId }: { dataSetId: string }): JSX.Element {
  type NameStatsTab = "staff-to-name" | "name-to-key";
  const [activeTab, setActiveTab] = useState<NameStatsTab>("staff-to-name");
  const statsTabRefs = useRef<Record<NameStatsTab, HTMLButtonElement | null>>({
    "staff-to-name": null,
    "name-to-key": null,
  });
  const handleStatsTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentTab: NameStatsTab
  ): void => {
    const tabs: NameStatsTab[] = ["staff-to-name", "name-to-key"];
    const currentIndex = tabs.indexOf(currentTab);
    const nextIndex =
      event.key === "ArrowRight"
        ? (currentIndex + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex]!;
    setActiveTab(nextTab);
    statsTabRefs.current[nextTab]?.focus();
  };
  return (
    <div className="module-name-key-stats">
      <div aria-label="音名练习统计类型" className="module-name-key-stats-tabs" role="tablist">
        <button
          aria-controls="staff-to-name-stats-panel"
          aria-selected={activeTab === "staff-to-name"}
          className={activeTab === "staff-to-name" ? "is-active" : ""}
          id="staff-to-name-stats-tab"
          onKeyDown={(event) => handleStatsTabKeyDown(event, "staff-to-name")}
          onClick={() => setActiveTab("staff-to-name")}
          ref={(element) => {
            statsTabRefs.current["staff-to-name"] = element;
          }}
          tabIndex={activeTab === "staff-to-name" ? 0 : -1}
          role="tab"
          type="button"
        >
          看谱认音
        </button>
        <button
          aria-controls="name-to-key-stats-panel"
          aria-selected={activeTab === "name-to-key"}
          className={activeTab === "name-to-key" ? "is-active" : ""}
          id="name-to-key-stats-tab"
          onKeyDown={(event) => handleStatsTabKeyDown(event, "name-to-key")}
          onClick={() => setActiveTab("name-to-key")}
          ref={(element) => {
            statsTabRefs.current["name-to-key"] = element;
          }}
          tabIndex={activeTab === "name-to-key" ? 0 : -1}
          role="tab"
          type="button"
        >
          音名找键
        </button>
      </div>
      <div
        aria-labelledby={`${activeTab}-stats-tab`}
        className="module-name-key-stats-panel"
        id={`${activeTab}-stats-panel`}
        role="tabpanel"
      >
        {activeTab === "staff-to-name" ? (
          <StaffToNameStats dataSetId={dataSetId} />
        ) : (
          <NameToKeyStats dataSetId={dataSetId} />
        )}
      </div>
    </div>
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
  if (levelId === 3) return <NameRecognitionStats dataSetId={settings.dataSetId} />;
  if (levelId === 4) return <DistanceStats dataSetId={settings.dataSetId} />;
  if (levelId === 5) return <ModuleEventStats dataSetId={settings.dataSetId} kind="pre-reading" />;
  return <DuetStats dataSetId={settings.dataSetId} />;
}
