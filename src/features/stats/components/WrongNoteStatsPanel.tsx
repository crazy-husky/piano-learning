import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Trash2 } from "lucide-react";
import type { StaffGameWrongNoteArchive } from "../../../domain/types";
import {
  filterStaffGameWrongNoteArchivesByRange,
  getStaffGameWrongNoteRunErrorCount,
} from "../../../domain/staffGameWrongNoteArchives";
import { deleteStaffGameWrongNoteArchiveRuns, db } from "../../../data/db";
import { useConfirmDialog } from "../../../shared/components/ui/ConfirmDialog";
import type { StatsRange } from "./statsRange";
import { getStatsRangeCutoff } from "./statsRange";
import { StaffGameWrongNoteNoteDiagnosticPanel } from "../../staff-game/components/StaffGameWrongNoteNoteDiagnosticPanel";
import { StaffGameWrongNoteTrendPanel } from "../../staff-game/components/StaffGameWrongNoteTrendPanel";
import type { WrongNoteStatsTab } from "./statsUiPreferences";

const DIFFICULTY_LABELS: Record<string, string> = {
  muggle: "麻瓜",
  leisure: "悠闲",
  easy: "简单",
  normal: "普通",
  hard: "困难",
  nightmare: "噩梦",
};

function formatArchiveDateTime(date: string, endedAt: string): string {
  const endedTimestamp = Date.parse(endedAt);
  const endedDate = Number.isFinite(endedTimestamp)
    ? new Date(endedTimestamp)
    : new Date(`${date}T00:00:00`);
  return `${endedDate.getMonth() + 1}月${endedDate.getDate()}日${endedDate.getHours()}时`;
}

function filterArchivesByStatsRange(
  archives: readonly StaffGameWrongNoteArchive[],
  range: StatsRange
): StaffGameWrongNoteArchive[] {
  const cutoff = getStatsRangeCutoff(range);
  if (!cutoff) return [...archives];
  return archives.filter((archive) => new Date(`${archive.date}T00:00:00`) >= cutoff);
}

export function WrongNoteStatsPanel({
  activeTab,
  archives,
  loadError,
  loading,
  onActiveTabChange,
  onArchivesChange,
  onRetryLoad,
  range,
}: {
  activeTab: WrongNoteStatsTab;
  archives: readonly StaffGameWrongNoteArchive[];
  loadError: string | null;
  loading: boolean;
  onActiveTabChange: (tab: WrongNoteStatsTab) => void;
  onArchivesChange: (archives: StaffGameWrongNoteArchive[]) => void;
  onRetryLoad: () => void;
  range: StatsRange;
}): JSX.Element {
  const confirm = useConfirmDialog();
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(() => new Set());
  const [deleteError, setDeleteError] = useState("");
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const rangedArchives = useMemo(
    () => filterArchivesByStatsRange(archives, range),
    [archives, range]
  );
  const availableRuns = useMemo(
    () =>
      filterStaffGameWrongNoteArchivesByRange(rangedArchives, "all").flatMap((archive) =>
        archive.runs.map((run) => ({ archiveDate: archive.date, run }))
      ),
    [rangedArchives]
  );
  const visibleRunIds = useMemo(
    () => new Set(availableRuns.map(({ run }) => run.runId)),
    [availableRuns]
  );
  const selectedVisibleRunIds = useMemo(
    () => [...selectedRunIds].filter((runId) => visibleRunIds.has(runId)),
    [selectedRunIds, visibleRunIds]
  );
  const allVisibleSelected =
    availableRuns.length > 0 && selectedVisibleRunIds.length === availableRuns.length;

  useEffect(() => {
    setSelectedRunIds((current) => {
      const retained = [...current].filter((runId) => visibleRunIds.has(runId));
      return retained.length === current.size ? current : new Set(retained);
    });
  }, [visibleRunIds]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedVisibleRunIds.length > 0 && !allVisibleSelected;
    }
  }, [allVisibleSelected, selectedVisibleRunIds.length]);

  const toggleRun = (runId: string): void => {
    setSelectedRunIds((current) => {
      const next = new Set(current);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const toggleAllVisible = (): void => {
    setSelectedRunIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) availableRuns.forEach(({ run }) => next.delete(run.runId));
      else availableRuns.forEach(({ run }) => next.add(run.runId));
      return next;
    });
  };

  const deleteSelected = async (): Promise<void> => {
    const runIds = selectedVisibleRunIds;
    if (runIds.length === 0) return;
    const confirmed = await confirm({
      title: `删除选中的 ${runIds.length} 局记录？`,
      description: "此操作不可撤销。",
      cancelLabel: "取消",
      confirmLabel: "确认删除",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const remainingArchives = await deleteStaffGameWrongNoteArchiveRuns(runIds);
      onArchivesChange(remainingArchives);
      setSelectedRunIds(new Set());
      setDeleteError("");
    } catch {
      setDeleteError("删除失败，请稍后重试。");
    }
  };

  return (
    <section aria-label="错题趋势与管理" className="panel stats-wrong-note-panel">
      <div
        aria-label="错题趋势与管理分区"
        className="stats-wrong-note-tabs"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const tabs: WrongNoteStatsTab[] = ["trend", "note", "manage"];
          const currentIndex = tabs.indexOf(activeTab);
          const direction = event.key === "ArrowRight" ? 1 : -1;
          const nextTab = tabs[(currentIndex + direction + tabs.length) % tabs.length]!;
          onActiveTabChange(nextTab);
          window.requestAnimationFrame(() =>
            document.getElementById(`stats-wrong-note-tab-${nextTab}`)?.focus()
          );
        }}
        role="tablist"
        tabIndex={-1}
      >
        {(
          [
            ["trend", "趋势"],
            ["note", "单音"],
            ["manage", "管理"],
          ] as const
        ).map(([tab, label]) => (
          <button
            aria-controls={`stats-wrong-note-panel-${tab}`}
            aria-selected={activeTab === tab}
            className={activeTab === tab ? "is-active" : ""}
            id={`stats-wrong-note-tab-${tab}`}
            key={tab}
            onClick={() => onActiveTabChange(tab)}
            role="tab"
            tabIndex={activeTab === tab ? 0 : -1}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="stats-inline-empty" role="status">
          正在读取错题归档…
        </div>
      ) : null}
      {!loading && loadError ? (
        <div className="stats-inline-error" role="alert">
          <span>{loadError}</span>
          <button onClick={onRetryLoad} type="button">
            重试
          </button>
        </div>
      ) : null}
      {!loading && !loadError ? (
        <>
          <div
            aria-labelledby="stats-wrong-note-tab-trend"
            className="stats-wrong-note-subpanel"
            hidden={activeTab !== "trend"}
            id="stats-wrong-note-panel-trend"
            role="tabpanel"
          >
            <StaffGameWrongNoteTrendPanel
              archives={rangedArchives}
              onChangeRange={() => undefined}
              range="all"
              showRangeControl={false}
            />
          </div>

          <div
            aria-labelledby="stats-wrong-note-tab-note"
            className="stats-wrong-note-subpanel"
            hidden={activeTab !== "note"}
            id="stats-wrong-note-panel-note"
            role="tabpanel"
          >
            <StaffGameWrongNoteNoteDiagnosticPanel
              archives={rangedArchives}
              onChangeRange={() => undefined}
              range="all"
              showRangeControl={false}
            />
          </div>

          <div
            aria-labelledby="stats-wrong-note-tab-manage"
            className="stats-wrong-note-subpanel stats-wrong-note-manage"
            hidden={activeTab !== "manage"}
            id="stats-wrong-note-panel-manage"
            role="tabpanel"
          >
            <div
              aria-label="错题归档局列表"
              className="staff-game-archive-manager-table"
              role="table"
            >
              <div className="staff-game-archive-manager-table-head" role="rowgroup">
                <div className="staff-game-archive-manager-table-row" role="row">
                  <div className="staff-game-archive-manager-table-selection" role="columnheader">
                    <input
                      aria-label="全选当前时间范围内的归档"
                      checked={allVisibleSelected}
                      disabled={availableRuns.length === 0}
                      onChange={toggleAllVisible}
                      ref={selectAllRef}
                      type="checkbox"
                    />
                  </div>
                  <div className="staff-game-archive-manager-table-date" role="columnheader">
                    时间
                  </div>
                  <div className="staff-game-archive-manager-table-source" role="columnheader">
                    来源
                  </div>
                  <div className="staff-game-archive-manager-table-difficulty" role="columnheader">
                    难度
                  </div>
                  <div className="staff-game-archive-manager-table-count" role="columnheader">
                    错漏次数
                  </div>
                </div>
              </div>
              <div className="staff-game-archive-manager-list" role="rowgroup">
                {availableRuns.length > 0 ? (
                  [...availableRuns]
                    .sort(
                      (left, right) =>
                        right.archiveDate.localeCompare(left.archiveDate) ||
                        right.run.endedAt.localeCompare(left.run.endedAt)
                    )
                    .map(({ archiveDate, run }) => {
                      const errorCount = getStaffGameWrongNoteRunErrorCount(run);
                      const source =
                        run.source === "review" ? "错题复习" : `第${run.level ?? "—"}关`;
                      const runTime = formatArchiveDateTime(archiveDate, run.endedAt);
                      const isSelected = selectedRunIds.has(run.runId);
                      return (
                        <div
                          aria-selected={isSelected}
                          className="staff-game-archive-manager-table-row staff-game-archive-manager-row"
                          onClick={() => toggleRun(run.runId)}
                          onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
                            if (
                              event.target === event.currentTarget &&
                              (event.key === "Enter" || event.key === " ")
                            ) {
                              event.preventDefault();
                              toggleRun(run.runId);
                            }
                          }}
                          key={run.runId}
                          role="row"
                          tabIndex={0}
                        >
                          <span className="staff-game-archive-manager-table-selection" role="cell">
                            <input
                              aria-label={`${runTime} · ${source} · 错漏 ${errorCount} 次`}
                              checked={isSelected}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleRun(run.runId)}
                              type="checkbox"
                            />
                          </span>
                          <strong className="staff-game-archive-manager-table-date" role="cell">
                            {runTime}
                          </strong>
                          <span className="staff-game-archive-manager-table-source" role="cell">
                            {source}
                          </span>
                          <span className="staff-game-archive-manager-table-difficulty" role="cell">
                            {DIFFICULTY_LABELS[run.difficulty] ?? "—"}
                          </span>
                          <span className="staff-game-archive-manager-table-count" role="cell">
                            {errorCount} 次
                          </span>
                        </div>
                      );
                    })
                ) : (
                  <div className="staff-game-archive-manager-empty" role="status">
                    {filterStaffGameWrongNoteArchivesByRange(archives, "all").length === 0
                      ? "暂无错漏归档记录"
                      : "此时间范围内暂无错漏记录"}
                  </div>
                )}
              </div>
            </div>
            <footer className="staff-game-archive-manager-actions">
              <span aria-live="polite">已选 {selectedVisibleRunIds.length} 项</span>
              {deleteError ? (
                <span className="stats-wrong-note-delete-error" role="alert">
                  {deleteError}
                </span>
              ) : null}
              <button
                className="staff-game-archive-manager-delete"
                disabled={selectedVisibleRunIds.length === 0}
                onClick={() => void deleteSelected()}
                type="button"
              >
                <Trash2 aria-hidden="true" size={16} />
                删除选中
              </button>
            </footer>
          </div>
        </>
      ) : null}
    </section>
  );
}

export function useStaffGameWrongNoteArchives(): {
  archives: StaffGameWrongNoteArchive[];
  error: string | null;
  loading: boolean;
  retry: () => void;
  setArchives: (archives: StaffGameWrongNoteArchive[]) => void;
} {
  const [archives, setArchives] = useState<StaffGameWrongNoteArchive[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void db.staffGameWrongNoteArchives
      .orderBy("date")
      .toArray()
      .then((nextArchives) => {
        if (active) setArchives(nextArchives);
      })
      .catch(() => {
        if (active) setError("错题归档读取失败，请检查本地数据后重试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retryToken]);
  return {
    archives,
    error,
    loading,
    retry: () => setRetryToken((token) => token + 1),
    setArchives,
  };
}
