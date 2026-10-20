import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateStaffGameWrongNoteTrendMovingAverage,
  type StaffGameWrongNoteTrendDisplayMode,
  type StaffGameWrongNoteTrendPoint,
} from "../../../domain/staffGameWrongNoteTrends";

export type StaffGameWrongNoteTrendMetric = "accuracy" | "response";

const CHART_WIDTH = 800;
const CHART_HEIGHT = 230;
const PLOT_LEFT = 38;
const PLOT_RIGHT = 38;
const PLOT_TOP = 14;
const Y_TICK_COUNT = 4;

function formatMetricValue(value: number, metric: StaffGameWrongNoteTrendMetric): string {
  return metric === "accuracy" ? `${Math.round(value)}%` : `${value.toFixed(1)} 秒`;
}

function formatPointValue(
  point: StaffGameWrongNoteTrendPoint,
  metric: StaffGameWrongNoteTrendMetric
): string {
  if (metric === "accuracy") {
    return point.firstTryAccuracyPercent === null
      ? "暂无样本"
      : formatMetricValue(point.firstTryAccuracyPercent, metric);
  }
  return point.averageResponseMs === null
    ? "暂无样本"
    : formatMetricValue(point.averageResponseMs / 1000, metric);
}

function formatPointDate(point: StaffGameWrongNoteTrendPoint): string {
  const [year, month, day] = point.date.split("-").map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatPointLabel(
  point: StaffGameWrongNoteTrendPoint,
  index: number,
  displayMode: StaffGameWrongNoteTrendDisplayMode
): string {
  if (displayMode === "day") return formatPointDate(point);
  const timestamp = Date.parse(point.endedAt ?? "");
  if (!Number.isFinite(timestamp)) return `第${index + 1}局`;
  const time = new Date(timestamp);
  return `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
}

function pointValue(
  point: StaffGameWrongNoteTrendPoint,
  metric: StaffGameWrongNoteTrendMetric
): number | null {
  return metric === "accuracy"
    ? point.firstTryAccuracyPercent
    : point.averageResponseMs === null
      ? null
      : point.averageResponseMs / 1000;
}

function getValueDomain(values: number[], metric: StaffGameWrongNoteTrendMetric): [number, number] {
  if (metric === "accuracy") return [0, 100];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = Math.max((maxValue - minValue) * 0.16, metric === "response" ? 0.1 : 1);
  const min = Math.max(0, Math.floor(minValue - padding));
  const max = Math.max(min + 1, Math.ceil(maxValue + padding));
  return [min, max];
}

export function StaffGameWrongNoteTrendChart({
  displayMode,
  metric,
  points,
  includesLegacyResponseSamples,
}: {
  displayMode: StaffGameWrongNoteTrendDisplayMode;
  metric: StaffGameWrongNoteTrendMetric;
  points: readonly StaffGameWrongNoteTrendPoint[];
  includesLegacyResponseSamples?: boolean;
}): JSX.Element {
  const chartElementRef = useRef<SVGSVGElement | null>(null);
  const [chartSize, setChartSize] = useState({ height: CHART_HEIGHT, width: CHART_WIDTH });

  useEffect(() => {
    const element = chartElementRef.current;
    if (!element) return undefined;

    let resizeFrame = 0;
    const updateSize = () => {
      const { height, width } = element.getBoundingClientRect();
      const nextSize = {
        height: Math.max(190, Math.round(height)),
        width: Math.max(320, Math.round(width)),
      };
      setChartSize((current) =>
        current.width === nextSize.width && current.height === nextSize.height ? current : nextSize
      );
    };
    const scheduleUpdateSize = (): void => {
      if (resizeFrame !== 0) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        updateSize();
      });
    };
    const observer = new ResizeObserver(scheduleUpdateSize);
    observer.observe(element);
    updateSize();
    return () => {
      window.cancelAnimationFrame(resizeFrame);
      observer.disconnect();
    };
  }, []);

  const chartData = useMemo(() => {
    const values = points.map((point) => pointValue(point, metric));
    const numericValues = values.filter((value): value is number => value !== null);
    const [minValue, maxValue] = getValueDomain(
      numericValues.length > 0 ? numericValues : [0],
      metric
    );
    const plotRight = chartSize.width - PLOT_RIGHT;
    const plotBottom = chartSize.height - 46;
    const plotWidth = plotRight - PLOT_LEFT;
    const plotHeight = plotBottom - PLOT_TOP;
    const labelStep = Math.max(1, Math.ceil(points.length / 7));
    const coordinates = points.map((point, index) => {
      const value = values[index];
      const x =
        points.length <= 1
          ? PLOT_LEFT + plotWidth / 2
          : PLOT_LEFT + (index / (points.length - 1)) * plotWidth;
      const y =
        value === null
          ? null
          : plotBottom - ((value - minValue) / (maxValue - minValue)) * plotHeight;
      const labelY =
        y === null
          ? plotBottom - 4
          : index % 2 === 0
            ? y < PLOT_TOP + 26
              ? y + 22
              : y - 12
            : y > plotBottom - 24
              ? y - 12
              : y + 22;
      const labelAnchor: "start" | "end" | "middle" =
        points.length < 3
          ? "middle"
          : index === 0
            ? "start"
            : index === points.length - 1
              ? "end"
              : "middle";
      const labelX = labelAnchor === "start" ? x + 5 : labelAnchor === "end" ? x - 5 : x;
      const showLabel = index % labelStep === 0 || index === points.length - 1;
      return {
        label: formatPointLabel(point, index, displayMode),
        labelAnchor,
        labelX,
        labelY,
        point,
        showLabel,
        value,
        x,
        y,
      };
    });
    const segments: string[] = [];
    let activePath: string[] = [];
    for (const coordinate of coordinates) {
      if (coordinate.y === null) {
        if (activePath.length > 0) segments.push(activePath.join(" "));
        activePath = [];
      } else {
        activePath.push(`${activePath.length === 0 ? "M" : "L"} ${coordinate.x} ${coordinate.y}`);
      }
    }
    if (activePath.length > 0) segments.push(activePath.join(" "));

    const movingAverage = calculateStaffGameWrongNoteTrendMovingAverage(values).map(
      ({ index, value }) => ({
        index,
        x: coordinates[index]?.x ?? PLOT_LEFT,
        y: plotBottom - ((value - minValue) / (maxValue - minValue)) * plotHeight,
      })
    );
    const movingAverageSegments: string[] = [];
    activePath = [];
    for (const [index, coordinate] of movingAverage.entries()) {
      const previous = movingAverage[index - 1];
      if (previous && coordinate.index !== previous.index + 1) {
        if (activePath.length > 1) movingAverageSegments.push(activePath.join(" "));
        activePath = [];
      }
      activePath.push(`${activePath.length === 0 ? "M" : "L"} ${coordinate.x} ${coordinate.y}`);
    }
    if (activePath.length > 1) movingAverageSegments.push(activePath.join(" "));

    const yTicks = Array.from({ length: Y_TICK_COUNT + 1 }, (_, index) => {
      const value = minValue + ((maxValue - minValue) * index) / Y_TICK_COUNT;
      const y = plotBottom - (plotHeight * index) / Y_TICK_COUNT;
      return { label: formatMetricValue(value, metric), value, y };
    });
    return { coordinates, movingAverageSegments, plotRight, segments, yTicks };
  }, [chartSize, displayMode, metric, points]);

  const metricLabel = metric === "accuracy" ? "准确率" : "平均用时";
  const pointUnitLabel = displayMode === "run" ? "局" : "天";
  const horizontalAxisLabel = displayMode === "run" ? "局序（时间）" : "日期";
  const accessibleValues = chartData.coordinates
    .map(
      ({ label, point, value }) =>
        `${label}：${value === null ? "暂无样本" : formatMetricValue(value, metric)}，${point.runCount} 局，错漏 ${point.errorCount} 次 / 出题 ${point.targetCount} 次`
    )
    .join("；");

  return (
    <div className="staff-game-wrong-note-trend-chart-shell">
      {chartData.movingAverageSegments.length > 0 ? (
        <div aria-label="图表图例" className="staff-game-wrong-note-trend-legend">
          <span>{displayMode === "run" ? "每局数据" : "每日数据"}</span>
          <span className="is-moving-average">3 {pointUnitLabel}均线</span>
        </div>
      ) : null}
      <svg
        aria-label={`${metricLabel}趋势折线图，横轴按${horizontalAxisLabel}显示。${accessibleValues}`}
        className="staff-game-wrong-note-trend-chart"
        preserveAspectRatio="none"
        ref={chartElementRef}
        role="img"
        viewBox={`0 0 ${chartSize.width} ${chartSize.height}`}
      >
        {chartData.yTicks.map((tick) => (
          <g key={`${tick.value}-${tick.y}`}>
            <line
              className="staff-game-wrong-note-trend-grid-line"
              x1={PLOT_LEFT}
              x2={chartData.plotRight}
              y1={tick.y}
              y2={tick.y}
            />
            <text
              className="staff-game-wrong-note-trend-axis-label"
              textAnchor="end"
              x={PLOT_LEFT - 8}
              y={tick.y + 4}
            >
              {tick.label}
            </text>
          </g>
        ))}
        {chartData.segments.map((path, index) => (
          <path className="staff-game-wrong-note-trend-line" d={path} key={`segment-${index}`} />
        ))}
        {chartData.movingAverageSegments.map((path, index) => (
          <path
            className="staff-game-wrong-note-trend-moving-average"
            d={path}
            key={`average-${index}`}
          />
        ))}
        {chartData.coordinates.map(
          ({ label, labelAnchor, labelX, labelY, point, showLabel, x, y }, index) => (
            <g key={`${displayMode}-${index}-${point.date}`}>
              {y === null ? null : (
                <circle
                  aria-label={`${label} · ${formatPointValue(point, metric)} · ${point.runCount} 局 · 错漏 ${point.errorCount} 次 / 出题 ${point.targetCount} 次`}
                  className="staff-game-wrong-note-trend-point"
                  cx={x}
                  cy={y}
                  r={5}
                  role="img"
                >
                  <title>{`${label} · ${formatPointValue(point, metric)} · ${point.runCount} 局 · 错漏 ${point.errorCount} 次 / 出题 ${point.targetCount} 次`}</title>
                </circle>
              )}
              {showLabel ? (
                <text
                  className="staff-game-wrong-note-trend-data-label"
                  textAnchor={labelAnchor}
                  x={labelX}
                  y={labelY}
                >
                  {formatPointValue(point, metric)}
                </text>
              ) : null}
            </g>
          )
        )}
        {chartData.coordinates.map(({ label, point, showLabel, x }, index) =>
          showLabel ? (
            <text
              className="staff-game-wrong-note-trend-x-label"
              key={`${displayMode}-${index}-${point.date}-label`}
              textAnchor="middle"
              x={x}
              y={chartSize.height - 8}
            >
              {label}
            </text>
          ) : null
        )}
      </svg>
      <p className="staff-game-wrong-note-trend-chart-caption">
        横轴为{displayMode === "run" ? "局序" : "日期"}，纵轴为{metricLabel}
        {displayMode === "day" ? "；同一天多局按练习题数合并。" : "。"}
        {metric === "accuracy" ? (
          <>
            {"准确率按作答题数计算，只将"}
            <span className="staff-game-wrong-note-trend-first-try">第一次</span>
            {"答对计为正确，"}
          </>
        ) : (
          <>
            {includesLegacyResponseSamples ? (
              <>
                {"平均用时按有效样本数合并；新记录只统计"}
                <span className="staff-game-wrong-note-trend-first-try">第一次</span>
                {"作答正确的目标，旧归档沿用已保存的用时样本，统计口径可能不同。"}
              </>
            ) : (
              <>
                {"平均用时按有效样本数合并，只统计"}
                <span className="staff-game-wrong-note-trend-first-try">第一次</span>
                {"作答正确的目标；答错后补答正确不计入，"}
              </>
            )}
          </>
        )}
        默认按天查看，只有一天数据时按时间查看。
      </p>
    </div>
  );
}
