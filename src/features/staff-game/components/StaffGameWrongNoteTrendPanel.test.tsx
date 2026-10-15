import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  StaffGameWrongNoteArchive,
  StaffGameWrongNoteArchiveRun,
} from "../../../domain/types";
import { StaffGameWrongNoteTrendPanel } from "./StaffGameWrongNoteTrendPanel";

function run(
  runId: string,
  endedAt: string,
  totalTargets = 10,
  firstTryCorrect = 7
): StaffGameWrongNoteArchiveRun {
  return {
    runId,
    source: "challenge",
    level: 2,
    difficulty: "hard",
    inputMode: "virtual",
    startedAt: endedAt,
    endedAt,
    updatedAt: endedAt,
    reviewRange: null,
    notePoolScope: "current-group",
    noteSchedulingStrategy: "random",
    trendOnly: false,
    responseTimeBasis: "first-correct",
    totalTargets,
    firstTryCorrect,
    lowSample: false,
    notes: {
      "60": {
        midi: 60,
        note: "C4",
        appear: totalTargets,
        correct: firstTryCorrect,
        wrong: totalTargets - firstTryCorrect,
        missed: 0,
        confusions: {},
        totalResponseMs: firstTryCorrect * 1200,
        responseSampleCount: firstTryCorrect,
      },
    },
  };
}

function archives(...runs: StaffGameWrongNoteArchiveRun[]): StaffGameWrongNoteArchive[] {
  const byDate = new Map<string, StaffGameWrongNoteArchiveRun[]>();
  for (const item of runs) {
    const date = item.endedAt.slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), item]);
  }
  return [...byDate].map(([date, dateRuns]) => ({ id: date, date, runs: dateRuns }));
}

function renderPanel(data: readonly StaffGameWrongNoteArchive[]): string {
  return renderToStaticMarkup(
    <StaffGameWrongNoteTrendPanel archives={data} onChangeRange={() => undefined} range="all" />
  );
}

describe("staff game wrong note trend panel", () => {
  it("plots runs and labels the x-axis with time when there is only one date", () => {
    const markup = renderPanel(
      archives(run("run-1", "2026-10-15T17:22:00"), run("run-2", "2026-10-15T18:04:00", 10, 8))
    );

    expect(markup).toContain("共 2 局 · 平均准确率 75%");
    expect(markup).toContain("样本很少，仅供参考");
    expect(markup).toContain(">17:22</text>");
    expect(markup).toContain(">18:04</text>");
    expect(markup).toContain("横轴按局序（时间）显示");
    expect(markup).toContain("默认按天查看，只有一天数据时按时间查看。");
    expect(markup).toContain("横轴为局序，纵轴为准确率。");
    expect(markup).toContain("练习条件（同条件才能对比）");
  });

  it("pools same-day runs into daily points once there are multiple dates", () => {
    const markup = renderPanel(
      archives(
        run("day-1-a", "2026-10-15T10:00:00.000Z", 10, 5),
        run("day-1-b", "2026-10-15T12:00:00.000Z", 10, 10),
        run("day-2", "2026-10-16T10:00:00.000Z", 10, 8),
        run("day-3", "2026-10-17T10:00:00.000Z", 10, 7)
      )
    );

    expect(markup).toContain("共 3 天 · 平均准确率 75%");
    expect(markup).toContain("数据点较少");
    expect(markup).not.toContain("样本很少，仅供参考");
    expect(markup).toContain("10/15");
    expect(markup).toContain("10/16");
    expect(markup).toContain("10/17");
    expect(markup).toContain("横轴按日期显示");
  });

  it("removes the low-sample note at seven plotted dates", () => {
    const data = archives(
      ...Array.from({ length: 7 }, (_, index) =>
        run(`run-${index}`, `2026-10-${String(index + 10).padStart(2, "0")}T10:00:00.000Z`)
      )
    );

    const markup = renderPanel(data);

    expect(markup).toContain("共 7 天 · 平均准确率 70%");
    expect(markup).not.toContain("数据点较少");
    expect(markup).not.toContain("样本很少，仅供参考");
  });

  it("shows an empty state when no archive runs are available", () => {
    expect(renderPanel([])).toContain("当前范围暂无可比较的对局");
  });
});
