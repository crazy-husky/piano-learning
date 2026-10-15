import { Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { StaffGameWrongNoteArchive } from "../../../domain/types";
import {
  filterStaffGameWrongNoteArchivesByRange,
  getStaffGameWrongNoteRunErrorCount,
  type StaffGameWrongNoteRange,
} from "../../../domain/staffGameWrongNoteArchives";
import { StaffGameWrongNoteTrendPanel } from "./StaffGameWrongNoteTrendPanel";

interface StaffGameWrongNoteArchiveManagerDialogProps {
  archives: readonly StaffGameWrongNoteArchive[];
  range: StaffGameWrongNoteRange;
  onChangeRange: (range: StaffGameWrongNoteRange) => void;
  onClose: () => void;
  onDeleteRuns: (runIds: string[]) => void;
}

function formatArchiveDate(date: string): string {
  const [, month = "", day = ""] = date.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

export function StaffGameWrongNoteArchiveManagerDialog({
  archives,
  range,
  onChangeRange,
  onClose,
  onDeleteRuns,
}: StaffGameWrongNoteArchiveManagerDialogProps): JSX.Element | null {
  const [activeTab, setActiveTab] = useState<"trend" | "manage">("trend");
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(() => new Set());
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const availableRuns = useMemo(
    () =>
      filterStaffGameWrongNoteArchivesByRange(archives, "all").flatMap((archive) =>
        archive.runs.map((run) => ({ archiveDate: archive.date, run }))
      ),
    [archives]
  );
  const visibleRuns = useMemo(
    () =>
      filterStaffGameWrongNoteArchivesByRange(archives, range)
        .flatMap((archive) => archive.runs.map((run) => ({ archiveDate: archive.date, run })))
        .sort(
          (left, right) =>
            right.archiveDate.localeCompare(left.archiveDate) ||
            right.run.endedAt.localeCompare(left.run.endedAt)
        ),
    [archives, range]
  );
  const visibleRunIds = useMemo(
    () => new Set(visibleRuns.map(({ run }) => run.runId)),
    [visibleRuns]
  );
  const selectedVisibleRunIds = useMemo(
    () => [...selectedRunIds].filter((runId) => visibleRunIds.has(runId)),
    [selectedRunIds, visibleRunIds]
  );
  const allVisibleSelected =
    visibleRuns.length > 0 && selectedVisibleRunIds.length === visibleRuns.length;
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate =
        selectedVisibleRunIds.length > 0 && !allVisibleSelected;
    }
  }, [allVisibleSelected, selectedVisibleRunIds.length]);

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextTab = activeTab === "trend" ? "manage" : "trend";
    setActiveTab(nextTab);
    window.requestAnimationFrame(() => {
      document.getElementById(`staff-game-archive-tab-${nextTab}`)?.focus();
    });
  };

  useEffect(() => {
    setSelectedRunIds(new Set());
  }, [range]);

  useEffect(() => {
    setSelectedRunIds((current) => {
      const retained = [...current].filter((runId) => visibleRunIds.has(runId));
      return retained.length === current.size ? current : new Set(retained);
    });
  }, [visibleRunIds]);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    const wasInert = root?.inert ?? false;
    if (root) root.inert = true;
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (root) root.inert = wasInert;
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  const toggleRun = (runId: string): void => {
    setSelectedRunIds((current) => {
      const next = new Set(current);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const handleRunRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, runId: string): void => {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    event.preventDefault();
    toggleRun(runId);
  };

  const toggleAllVisible = (): void => {
    setSelectedRunIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleRunIds.forEach((runId) => next.delete(runId));
      } else {
        visibleRunIds.forEach((runId) => next.add(runId));
      }
      return next;
    });
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="staff-game-archive-manager-backdrop">
      <section
        aria-labelledby="staff-game-archive-manager-title"
        aria-modal="true"
        className="staff-game-archive-manager-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="staff-game-archive-manager-header">
          <h2 id="staff-game-archive-manager-title">错题趋势与管理</h2>
          <button
            aria-label="关闭错题归档管理"
            className="staff-game-archive-manager-close"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        <div
          aria-label="错题趋势与管理"
          className="staff-game-archive-manager-tabs"
          onKeyDown={handleTabKeyDown}
          role="tablist"
          tabIndex={-1}
        >
          <button
            aria-controls="staff-game-archive-panel-trend"
            aria-selected={activeTab === "trend"}
            className={activeTab === "trend" ? "is-active" : ""}
            id="staff-game-archive-tab-trend"
            onClick={() => setActiveTab("trend")}
            role="tab"
            tabIndex={activeTab === "trend" ? 0 : -1}
            type="button"
          >
            趋势
          </button>
          <button
            aria-controls="staff-game-archive-panel-manage"
            aria-selected={activeTab === "manage"}
            className={activeTab === "manage" ? "is-active" : ""}
            id="staff-game-archive-tab-manage"
            onClick={() => setActiveTab("manage")}
            role="tab"
            tabIndex={activeTab === "manage" ? 0 : -1}
            type="button"
          >
            管理
          </button>
        </div>

        {activeTab === "trend" ? (
          <div
            aria-labelledby="staff-game-archive-tab-trend"
            className="staff-game-archive-manager-trend-panel"
            id="staff-game-archive-panel-trend"
            role="tabpanel"
            tabIndex={0}
          >
            <StaffGameWrongNoteTrendPanel
              archives={archives}
              onChangeRange={onChangeRange}
              range={range}
            />
          </div>
        ) : (
          <div
            aria-labelledby="staff-game-archive-tab-manage"
            className="staff-game-archive-manager-content"
            id="staff-game-archive-panel-manage"
            role="tabpanel"
            tabIndex={0}
          >
            <div className="staff-game-archive-manager-toolbar">
              <label>
                <span>记录时间</span>
                <select
                  aria-label="管理错题归档时间范围"
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
            </div>

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
                      disabled={visibleRuns.length === 0}
                      onChange={toggleAllVisible}
                      ref={selectAllCheckboxRef}
                      type="checkbox"
                    />
                    <span aria-hidden="true">全选</span>
                  </div>
                  <div className="staff-game-archive-manager-table-record" role="columnheader">
                    归档记录
                  </div>
                  <div className="staff-game-archive-manager-table-count" role="columnheader">
                    错漏
                  </div>
                </div>
              </div>
              <div className="staff-game-archive-manager-list" role="rowgroup">
                {visibleRuns.length > 0 ? (
                  visibleRuns.map(({ archiveDate, run }) => {
                    const errorCount = getStaffGameWrongNoteRunErrorCount(run);
                    const source = run.source === "review" ? "错题复习" : `第${run.level ?? "—"}关`;
                    const isSelected = selectedRunIds.has(run.runId);
                    return (
                      <div
                        aria-selected={isSelected}
                        className="staff-game-archive-manager-table-row staff-game-archive-manager-row"
                        key={run.runId}
                        onClick={() => toggleRun(run.runId)}
                        onKeyDown={(event) => handleRunRowKeyDown(event, run.runId)}
                        role="row"
                        tabIndex={0}
                      >
                        <span className="staff-game-archive-manager-table-selection" role="cell">
                          <input
                            aria-label={`${formatArchiveDate(archiveDate)} · ${source} · 错漏 ${errorCount} 次`}
                            checked={isSelected}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => toggleRun(run.runId)}
                            type="checkbox"
                          />
                        </span>
                        <span className="staff-game-archive-manager-table-record" role="cell">
                          <strong>{formatArchiveDate(archiveDate)}</strong>
                          <span>{source}</span>
                        </span>
                        <span className="staff-game-archive-manager-table-count" role="cell">
                          {errorCount} 次
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="staff-game-archive-manager-empty" role="status">
                    {availableRuns.length === 0 ? "暂无归档记录" : "当前时间范围内无记录"}
                  </div>
                )}
              </div>
            </div>

            <footer className="staff-game-archive-manager-actions">
              <span aria-live="polite">已选 {selectedVisibleRunIds.length} 项</span>
              <button
                className="staff-game-archive-manager-delete"
                disabled={selectedVisibleRunIds.length === 0}
                onClick={() => onDeleteRuns(selectedVisibleRunIds)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={16} />
                删除选中
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>,
    document.body
  );
}
