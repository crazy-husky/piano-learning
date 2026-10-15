import { useEffect, useMemo, useState } from "react";
import type { StaffGameWrongNoteArchive } from "../../../domain/types";
import {
  buildStaffGameWrongNoteTrendGroups,
  buildStaffGameWrongNoteTrendPoints,
  countStaffGameWrongNoteTrendRunsMissingSettings,
  type StaffGameWrongNoteTrendGroup,
  type StaffGameWrongNoteTrendPoint,
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

interface TrendInsight {
  title: string;
  message: string;
  direction: "better" | "worse" | "steady";
  basis: string;
}

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

function getMetricValue(
  point: StaffGameWrongNoteTrendPoint,
  metric: StaffGameWrongNoteTrendMetric
): number | null {
  if (metric === "accuracy") return point.firstTryAccuracyPercent;
  if (metric === "errorRate") return point.errorRatePercent;
  if (metric === "response") {
    return point.averageResponseMs === null ? null : point.averageResponseMs / 1000;
  }
  return null;
}

function formatDelta(delta: number, metric: StaffGameWrongNoteTrendMetric): string {
  if (metric === "accuracy" || metric === "errorRate") {
    return `${Math.abs(delta).toFixed(1)} 个百分点`;
  }
  if (metric === "response") return `${Math.abs(delta).toFixed(1)} 秒`;
  return "";
}

function getTrendInsight(
  points: readonly StaffGameWrongNoteTrendPoint[],
  metric: StaffGameWrongNoteTrendMetric
): TrendInsight | null {
  const values = points
    .map((point) => getMetricValue(point, metric))
    .filter((value): value is number => value !== null);
  if (values.length < 2) return null;

  const previousCount = values.length >= 4 ? Math.floor(values.length / 2) : 1;
  const recentCount = values.length >= 4 ? values.length - previousCount : 1;
  const previousValues = values.length >= 4 ? values.slice(0, previousCount) : values.slice(-2, -1);
  const recentValues = values.length >= 4 ? values.slice(previousCount) : values.slice(-1);
  const average = (items: number[]) => items.reduce((sum, value) => sum + value, 0) / items.length;
  const delta = average(recentValues) - average(previousValues);
  const basis =
    values.length >= 4 ? `前 ${previousCount} 局与近 ${recentCount} 局平均` : "最近一局与上一局";
  const tolerance =
    metric === "accuracy" || metric === "errorRate" ? 0.5 : metric === "response" ? 0.05 : 0.1;
  if (Math.abs(delta) < tolerance) {
    return {
      title: "变化不大",
      message: "这组数据和之前接近，继续练习几局再观察会更清楚。",
      direction: "steady",
      basis,
    };
  }

  const lowerIsBetter = metric !== "accuracy";
  const direction = delta < 0 === lowerIsBetter ? "better" : "worse";
  const amount = formatDelta(delta, metric);
  if (metric === "errorRate") {
    return direction === "better"
      ? {
          title: "错漏率在下降",
          message: `${basis}，按共同音符出题次数校正后，平均错漏率下降了 ${amount}。图上每个点同时标出错漏数 / 出题数。`,
          direction,
          basis,
        }
      : {
          title: "错漏率有所上升",
          message: `${basis}，按共同音符出题次数校正后，平均错漏率上升了 ${amount}。可以先看一遍错漏较多的音，再练一轮确认。`,
          direction,
          basis,
        };
  }
  if (metric === "accuracy") {
    return direction === "better"
      ? {
          title: "答对率在提高",
          message: `${basis}，首次答对率提高了 ${amount}。保持当前练习节奏，继续观察。`,
          direction,
          basis,
        }
      : {
          title: "答对率有所回落",
          message: `${basis}，首次答对率降低了 ${amount}。建议继续复习共同音符，避免只看单局结果。`,
          direction,
          basis,
        };
  }
  return direction === "better"
    ? {
        title: "反应更快了",
        message: `${basis}，平均反应时间快了 ${amount}。继续练习，观察是否稳定。`,
        direction,
        basis,
      }
    : {
        title: "反应时间变长",
        message: `${basis}，平均反应时间慢了 ${amount}。先准确识音，再逐步提速。`,
        direction,
        basis,
      };
}

export function StaffGameWrongNoteTrendPanel({
  archives,
  onChangeRange,
  range,
}: {
  archives: readonly StaffGameWrongNoteArchive[];
  range: StaffGameWrongNoteRange;
  onChangeRange: (range: StaffGameWrongNoteRange) => void;
}): JSX.Element {
  const [requestedSource, setRequestedSource] = useState<StaffGameWrongNoteTrendSource>("review");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [metric, setMetric] = useState<StaffGameWrongNoteTrendMetric>("errorRate");
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
  const insight = getTrendInsight(points, metric);
  const metrics: Array<{ id: StaffGameWrongNoteTrendMetric; label: string }> = [
    { id: "errorRate", label: "错漏率" },
    { id: "accuracy", label: "首次答对率" },
    { id: "response", label: "平均反应" },
  ];

  return (
    <div className="staff-game-wrong-note-trend-panel">
      <div className="staff-game-wrong-note-trend-filters">
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
        <label className="staff-game-wrong-note-trend-group-select">
          <span>练习条件</span>
          <select
            aria-label="趋势练习条件"
            disabled={sourceGroups.length === 0}
            onChange={(event) => setSelectedGroupId(event.target.value)}
            value={selectedGroup?.id ?? ""}
          >
            {sourceGroups.length === 0 ? <option value="">暂无可比记录</option> : null}
            {sourceGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {trendGroupLabel(group)} · {group.runs.length} 局
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

      {!selectedGroup ? (
        <div className="staff-game-wrong-note-trend-empty" role="status">
          <strong>
            {runsMissingSettings > 0
              ? "历史归档缺少出题设置，暂不能可靠比较"
              : groups.length === 0
                ? "当前范围暂无错题归档"
                : "当前类型暂无记录"}
          </strong>
          <span>
            {runsMissingSettings > 0
              ? "旧归档仍保留，但不纳入趋势；新归档会记录音池范围和出题策略。"
              : "完成并归档几局相同条件的练习后，这里会显示变化趋势。"}
          </span>
        </div>
      ) : trend && trend.points.length === 0 ? (
        <div className="staff-game-wrong-note-trend-empty" role="status">
          <strong>这些对局暂时没有共同音符</strong>
          <span>换一组练习条件，或积累更多相同音符的记录后再看趋势。</span>
        </div>
      ) : (
        <>
          <div className="staff-game-wrong-note-trend-summary">
            <strong>{trend?.commonNoteMidis.length ?? 0} 个共同音符</strong>
            <span>
              最近 {points.length} 局 · {trendGroupLabel(selectedGroup)}
            </span>
          </div>
          {runsMissingSettings > 0 ? (
            <p className="staff-game-wrong-note-trend-legacy-note" role="status">
              另有 {runsMissingSettings} 局旧归档缺少出题设置，已从趋势中略过；归档数据仍保留。
            </p>
          ) : null}
          <div aria-label="趋势指标" className="staff-game-wrong-note-trend-metrics" role="group">
            {metrics.map((item) => (
              <button
                aria-pressed={metric === item.id}
                className={metric === item.id ? "is-active" : ""}
                disabled={item.id === "response" && !hasResponseSamples}
                key={item.id}
                onClick={() => setMetric(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          <StaffGameWrongNoteTrendChart metric={metric} points={points} />
          <section
            aria-live="polite"
            className={`staff-game-wrong-note-trend-insight is-${insight?.direction ?? "steady"}`}
          >
            <div className="staff-game-wrong-note-trend-insight-heading">
              <span aria-hidden="true">✦</span>
              <h3>变化建议</h3>
              {insight ? <small>{insight.basis}</small> : null}
            </div>
            <p>
              {insight?.message ?? "目前只有一局可比记录，再练一局后就能看到这组音的变化建议。"}
            </p>
          </section>
          <p className="staff-game-wrong-note-trend-footnote">
            只统计有错漏并已归档的对局；全对局不会进入错题归档，因此不会显示在历史趋势中。
          </p>
        </>
      )}
    </div>
  );
}
