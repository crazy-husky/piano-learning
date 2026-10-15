import { useEffect, useMemo, useRef, useState } from "react";
import type { StaffGameWrongNoteTrendPoint } from "../../../domain/staffGameWrongNoteTrends";

export type StaffGameWrongNoteTrendMetric = "accuracy" | "errorRate" | "response";

const CHART_WIDTH = 800;
const CHART_HEIGHT = 230;
const PLOT_LEFT = 58;
const PLOT_TOP = 14;
const Y_TICK_COUNT = 4;

function formatMetricValue(value: number, metric: StaffGameWrongNoteTrendMetric): string {
  if (metric === "accuracy") return `${Math.round(value)}%`;
  if (metric === "response") return `${value.toFixed(1)} 秒`;
  return `${value.toFixed(1)}%`;
}

function formatPointValue(
  point: StaffGameWrongNoteTrendPoint,
  metric: StaffGameWrongNoteTrendMetric
): string {
  if (metric === "errorRate") {
    return point.errorRatePercent === null
      ? "暂无样本"
      : formatMetricValue(point.errorRatePercent, metric);
  }
  if (metric === "accuracy") {
    return point.firstTryAccuracyPercent === null
      ? "暂无样本"
      : formatMetricValue(point.firstTryAccuracyPercent, metric);
  }
  return point.averageResponseMs === null
    ? "暂无样本"
    : formatMetricValue(point.averageResponseMs / 1000, metric);
}

function formatRunLabel(point: StaffGameWrongNoteTrendPoint): string {
  const timestamp = Date.parse(point.endedAt);
  const date = Number.isFinite(timestamp)
    ? new Date(timestamp)
    : new Date(`${point.archiveDate}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function pointValue(
  point: StaffGameWrongNoteTrendPoint,
  metric: StaffGameWrongNoteTrendMetric
): number | null {
  if (metric === "accuracy") return point.firstTryAccuracyPercent;
  if (metric === "response") {
    return point.averageResponseMs === null ? null : point.averageResponseMs / 1000;
  }
  return point.errorRatePercent;
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
  metric,
  points,
}: {
  metric: StaffGameWrongNoteTrendMetric;
  points: readonly StaffGameWrongNoteTrendPoint[];
}): JSX.Element {
  const chartElementRef = useRef<SVGSVGElement | null>(null);
  const [chartSize, setChartSize] = useState({ height: CHART_HEIGHT, width: CHART_WIDTH });

  useEffect(() => {
    const element = chartElementRef.current;
    if (!element) return undefined;

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
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    updateSize();
    return () => observer.disconnect();
  }, []);

  const chartData = useMemo(() => {
    const values = points.map((point) => pointValue(point, metric));
    const numericValues = values.filter((value): value is number => value !== null);
    const [minValue, maxValue] = getValueDomain(
      numericValues.length > 0 ? numericValues : [0],
      metric
    );
    const plotRight = chartSize.width - 14;
    const plotBottom = chartSize.height - 46;
    const plotWidth = plotRight - PLOT_LEFT;
    const plotHeight = plotBottom - PLOT_TOP;
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
      return { label: formatRunLabel(point), labelAnchor, labelX, labelY, point, value, x, y };
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

    const yTicks = Array.from({ length: Y_TICK_COUNT + 1 }, (_, index) => {
      const value = minValue + ((maxValue - minValue) * index) / Y_TICK_COUNT;
      const y = plotBottom - (plotHeight * index) / Y_TICK_COUNT;
      return { label: formatMetricValue(value, metric), value, y };
    });
    return { coordinates, plotRight, segments, yTicks };
  }, [chartSize, metric, points]);

  const metricLabel =
    metric === "accuracy" ? "首次答对率" : metric === "response" ? "平均反应时长" : "错漏率";
  const accessibleValues = chartData.coordinates
    .map(
      ({ label, point, value }) =>
        `${label}：${value === null ? "暂无样本" : formatMetricValue(value, metric)}，错漏 ${point.errorCount} 次 / 出题 ${point.targetCount} 次`
    )
    .join("；");

  return (
    <div className="staff-game-wrong-note-trend-chart-shell">
      <svg
        aria-label={`${metricLabel}趋势折线图。${accessibleValues}`}
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
        {chartData.coordinates.map(({ label, labelAnchor, labelX, labelY, point, x, y }) => (
          <g key={point.runId}>
            {y === null ? null : (
              <circle
                aria-label={`${label} · ${formatPointValue(point, metric)} · 错漏 ${point.errorCount} 次 / 出题 ${point.targetCount} 次`}
                className="staff-game-wrong-note-trend-point"
                cx={x}
                cy={y}
                r={5}
                role="img"
              >
                <title>{`${label} · ${formatPointValue(point, metric)} · 错漏 ${point.errorCount} 次 / 出题 ${point.targetCount} 次`}</title>
              </circle>
            )}
            <text
              className="staff-game-wrong-note-trend-data-label"
              textAnchor={labelAnchor}
              x={labelX}
              y={labelY}
            >
              {formatPointValue(point, metric)}
            </text>
          </g>
        ))}
        {chartData.coordinates.map(({ label, point, x }) => (
          <text
            className="staff-game-wrong-note-trend-x-label"
            key={`${point.runId}-label`}
            textAnchor="middle"
            x={x}
            y={chartSize.height - 8}
          >
            {label}
          </text>
        ))}
      </svg>
      <p className="staff-game-wrong-note-trend-chart-caption">
        横轴为练习时间，纵轴为{metricLabel}
        ；图表只统计共同音符。每个点都显示具体数值；点的辅助说明包含该局错漏数与出题数。
      </p>
    </div>
  );
}
