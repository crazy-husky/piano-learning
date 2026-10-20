import { useEffect, useMemo, useState } from "react";
import type { StaffGameWrongNoteArchive } from "../../../domain/types";
import {
  buildStaffGameWrongNoteTrendGroups,
  buildStaffGameWrongNoteTrendPoints,
  countStaffGameWrongNoteTrendRunsMissingSettings,
  type StaffGameWrongNoteTrendGroup,
  type StaffGameWrongNoteTrendSource,
} from "../../../domain/staffGameWrongNoteTrends";
import type { StaffGameWrongNoteRange } from "../../../domain/staffGameWrongNoteArchives";
import {
  StaffGameWrongNoteTrendChart,
  type StaffGameWrongNoteTrendMetric,
} from "./StaffGameWrongNoteTrendChart";

const RANGE_LABELS: Record<string, string> = {
  3: "近 3 天",
  7: "近 7 天",
  15: "近 15 天",
  30: "近 30 天",
  all: "全部",
};

const DIFFICULTY_LABELS: Record<string, string> = {
  muggle: "麻瓜",
  leisure: "悠闲",
  easy: "简单",
  normal: "普通",
  hard: "困难",
  nightmare: "噩梦",
};

const INPUT_MODE_LABELS: Record<string, string> = {
  virtual: "虚拟琴键",
  physical: "实体钢琴",
  midi: "MIDI",
};

const NOTE_POOL_SCOPE_LABELS: Record<string, string> = {
  "current-group": "仅当前组",
  "all-history": "全部已解锁音符",
  "all-history-current-clef": "当前谱号全部",
};

const NOTE_SCHEDULING_LABELS: Record<string, string> = {
  random: "随机练习",
  system: "系统编排",
};

function trendGroupLabel(group: StaffGameWrongNoteTrendGroup): string {
  const parts =
    group.source === "review"
      ? [
          `范围${RANGE_LABELS[String(group.reviewRange)] ?? "未知"}`,
          DIFFICULTY_LABELS[group.difficulty] ?? group.difficulty,
          INPUT_MODE_LABELS[group.inputMode] ?? group.inputMode,
        ]
      : [
          `第${group.level ?? "—"}关`,
          DIFFICULTY_LABELS[group.difficulty] ?? group.difficulty,
          INPUT_MODE_LABELS[group.inputMode] ?? group.inputMode,
          NOTE_POOL_SCOPE_LABELS[group.notePoolScope ?? ""] ?? "",
          NOTE_SCHEDULING_LABELS[group.noteSchedulingStrategy ?? ""] ?? "",
        ];
  return parts.filter(Boolean).join(" · ");
}

export function StaffGameWrongNoteTrendPanel({
  archives,
  onChangeRange,
  range,
  scopeDescription,
  showRangeControl = true,
}: {
  archives: readonly StaffGameWrongNoteArchive[];
  range: StaffGameWrongNoteRange;
  onChangeRange: (range: StaffGameWrongNoteRange) => void;
  scopeDescription?: string;
  showRangeControl?: boolean;
}): JSX.Element {
  const [requestedSource, setRequestedSource] = useState<StaffGameWrongNoteTrendSource>("review");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [metric, setMetric] = useState<StaffGameWrongNoteTrendMetric>("accuracy");
  const groups = useMemo(
    () => buildStaffGameWrongNoteTrendGroups(archives, range),
    [archives, range]
  );
  const runsMissingSettings = useMemo(
    () => countStaffGameWrongNoteTrendRunsMissingSettings(archives, range),
    [archives, range]
  );
  const sourceAvailable = (source: StaffGameWrongNoteTrendSource) =>
    groups.some((group) => group.source === source);
  const source: StaffGameWrongNoteTrendSource = sourceAvailable(requestedSource)
    ? requestedSource
    : sourceAvailable("review")
      ? "review"
      : "challenge";
  const sourceGroups = groups.filter((group) => group.source === source);
  const selectedGroup =
    sourceGroups.find((group) => group.id === selectedGroupId) ?? sourceGroups[0] ?? null;

  useEffect(() => {
    if (selectedGroup && selectedGroup.id !== selectedGroupId) {
      setSelectedGroupId(selectedGroup.id);
    }
  }, [selectedGroup, selectedGroupId]);

  const trend = useMemo(
    () => (selectedGroup ? buildStaffGameWrongNoteTrendPoints(selectedGroup) : null),
    [selectedGroup]
  );
  const points = trend?.points ?? [];
  const hasResponseSamples = points.some((point) => point.averageResponseMs !== null);
  const includesLegacyResponseSamples = Boolean(
    selectedGroup?.runs.some(
      ({ run }) =>
        run.responseTimeBasis !== "first-correct" &&
        Object.values(run.notes).some(
          (note) => (note.responseSampleCount ?? 0) > 0 && (note.totalResponseMs ?? 0) > 0
        )
    )
  );
  const activeMetric: StaffGameWrongNoteTrendMetric =
    metric === "response" && hasResponseSamples ? "response" : "accuracy";
  const metrics: Array<{ id: StaffGameWrongNoteTrendMetric; label: string }> = [
    { id: "accuracy", label: "准确率" },
    { id: "response", label: "平均用时" },
  ];
  const isLowSample = points.length >= 3 && points.length <= 6;
  const displayMode = trend?.displayMode ?? "day";
  const pointCountLabel = displayMode === "run" ? "局" : "天";

  return (
    <div className="staff-game-wrong-note-trend-panel">
      <div className="staff-game-wrong-note-trend-filters">
        {showRangeControl ? (
          <label>
            <span>记录时间</span>
            <select
              aria-label="趋势记录时间范围"
              onChange={(event) =>
                onChangeRange(
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
        ) : null}
        <label className="staff-game-wrong-note-trend-group-select">
          <span>练习条件（同条件才能对比）</span>
          <select
            aria-label="趋势练习条件"
            disabled={sourceGroups.length === 0}
            onChange={(event) => setSelectedGroupId(event.target.value)}
            value={selectedGroup?.id ?? ""}
          >
            {sourceGroups.length === 0 ? <option value="">暂无可比记录</option> : null}
            {sourceGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {trendGroupLabel(group)} · 共 {group.runs.length} 局
              </option>
            ))}
          </select>
        </label>
      </div>

      <div aria-label="趋势练习类型" className="staff-game-wrong-note-trend-sources" role="group">
        <button
          aria-pressed={source === "review"}
          disabled={!sourceAvailable("review")}
          onClick={() => setRequestedSource("review")}
          type="button"
        >
          错题复习
        </button>
        <button
          aria-pressed={source === "challenge"}
          disabled={!sourceAvailable("challenge")}
          onClick={() => setRequestedSource("challenge")}
          type="button"
        >
          闯关
        </button>
      </div>

      {scopeDescription ? (
        <p className="staff-game-wrong-note-trend-scope-note">{scopeDescription}</p>
      ) : null}

      {!selectedGroup ? (
        <div className="staff-game-wrong-note-trend-empty" role="status">
          <strong>
            {runsMissingSettings > 0
              ? "历史归档缺少出题设置，暂不能可靠比较"
              : groups.length === 0
                ? "当前范围暂无可比较的对局"
                : "当前类型暂无记录"}
          </strong>
          <span>
            {runsMissingSettings > 0
              ? "旧归档仍保留，但不纳入趋势；新归档会记录音池范围和出题策略。"
              : "完成几局相同条件的闯关或错题复习后，这里会显示变化趋势。"}
          </span>
        </div>
      ) : (
        <>
          {points.length === 0 ? (
            <div className="staff-game-wrong-note-trend-empty" role="status">
              <strong>当前范围暂无可比较的对局</strong>
              <span>完成几局相同条件的闯关或错题复习后，这里会显示变化趋势。</span>
            </div>
          ) : (
            <>
              <div className="staff-game-wrong-note-trend-summary">
                <strong>
                  共 {points.length} {pointCountLabel} · 平均
                  {activeMetric === "accuracy" ? "准确率 " : "用时 "}
                  {activeMetric === "accuracy"
                    ? trend?.groupAccuracyPercent == null
                      ? "—"
                      : `${Math.round(trend.groupAccuracyPercent)}%`
                    : trend?.groupAverageResponseMs == null
                      ? "—"
                      : `${(trend.groupAverageResponseMs / 1000).toFixed(1)}s`}
                </strong>
              </div>
              {runsMissingSettings > 0 ? (
                <p className="staff-game-wrong-note-trend-legacy-note" role="status">
                  另有 {runsMissingSettings} 局旧归档缺少出题设置，已从趋势中略过；归档数据仍保留。
                </p>
              ) : null}
              <div
                aria-label="趋势指标"
                className="staff-game-wrong-note-trend-metrics"
                role="group"
              >
                {metrics.map((item) => (
                  <button
                    aria-pressed={activeMetric === item.id}
                    className={activeMetric === item.id ? "is-active" : ""}
                    disabled={item.id === "response" && !hasResponseSamples}
                    key={item.id}
                    onClick={() => setMetric(item.id)}
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {points.length < 3 ? (
                <p className="staff-game-wrong-note-trend-sample-note" role="status">
                  样本很少，仅供参考
                </p>
              ) : null}
              {isLowSample ? (
                <p className="staff-game-wrong-note-trend-sample-note" role="status">
                  数据点较少
                </p>
              ) : null}
              <StaffGameWrongNoteTrendChart
                displayMode={displayMode}
                includesLegacyResponseSamples={includesLegacyResponseSamples}
                metric={activeMetric}
                points={points}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
