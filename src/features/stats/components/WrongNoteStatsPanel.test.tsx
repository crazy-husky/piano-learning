import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { StaffGameWrongNoteArchive } from "../../../domain/types";
import { ConfirmDialogProvider } from "../../../shared/components/ui/ConfirmDialog";
import { WrongNoteStatsPanel } from "./WrongNoteStatsPanel";

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function archive(date: string, runId: string): StaffGameWrongNoteArchive {
  return {
    id: date,
    date,
    runs: [
      {
        runId,
        source: "challenge",
        level: 1,
        difficulty: "easy",
        inputMode: "virtual",
        startedAt: `${date}T09:00:00`,
        endedAt: `${date}T09:05:00`,
        reviewRange: null,
        notePoolScope: "current-group",
        noteSchedulingStrategy: "random",
        totalTargets: 1,
        firstTryCorrect: 0,
        lowSample: true,
        responseTimeBasis: "first-correct",
        notes: {
          "60": {
            midi: 60,
            note: "C4",
            appear: 1,
            correct: 0,
            wrong: 1,
            missed: 0,
            confusions: {},
            totalResponseMs: 0,
            responseSampleCount: 0,
          },
        },
      },
    ],
  };
}

it("uses the shared stats date range in the embedded management list", () => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const todayDate = localDateKey(today);
  const yesterdayDate = localDateKey(yesterday);
  const todayLabel = `${today.getMonth() + 1}月${today.getDate()}日9时`;
  const yesterdayLabel = `${yesterday.getMonth() + 1}月${yesterday.getDate()}日9时`;
  const markup = renderToStaticMarkup(
    <ConfirmDialogProvider>
      <WrongNoteStatsPanel
        activeTab="manage"
        archives={[archive(yesterdayDate, "yesterday"), archive(todayDate, "today")]}
        loadError={null}
        loading={false}
        onActiveTabChange={() => undefined}
        onArchivesChange={() => undefined}
        onRetryLoad={() => undefined}
        range={1}
      />
    </ConfirmDialogProvider>
  );

  expect(markup).toContain("练习表现与已收录错题");
  expect(markup).toContain(todayLabel);
  expect(markup).not.toContain(yesterdayLabel);
  expect(markup).toContain("删除选中");
});

it("shows a retry action instead of treating a failed archive read as empty data", () => {
  const markup = renderToStaticMarkup(
    <ConfirmDialogProvider>
      <WrongNoteStatsPanel
        activeTab="manage"
        archives={[]}
        loadError="错题归档读取失败，请检查本地数据后重试。"
        loading={false}
        onActiveTabChange={() => undefined}
        onArchivesChange={() => undefined}
        onRetryLoad={() => undefined}
        range="all"
      />
    </ConfirmDialogProvider>
  );

  expect(markup).toContain("错题归档读取失败");
  expect(markup).toContain("重试");
  expect(markup).not.toContain("此时间范围内暂无错漏归档记录");
});
