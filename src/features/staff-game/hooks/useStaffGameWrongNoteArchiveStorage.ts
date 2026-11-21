import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import {
  archiveStaffGameWrongNoteRun,
  db,
  enqueuePendingStaffGameWrongNoteArchiveRun,
  removePendingStaffGameWrongNoteArchiveRun,
  retryPendingStaffGameWrongNoteArchives,
} from "../../../data/db";
import { mergeStaffGameWrongNoteArchives as mergeArchives } from "../../../domain/staffGameWrongNoteArchives";
import type {
  StaffGameWrongNoteArchive,
  StaffGameWrongNoteArchiveRun,
} from "../../../domain/types";
import {
  makeTrendOnlyWrongNoteRun,
  nextWrongNoteRunUpdatedAt,
} from "../logic/staffGameWrongNoteArchive";

type WrongNoteArchiveStatus = "idle" | "manual" | "saving" | "saved" | "error";
type ArchiveMode = "full" | "trend";

type Options = {
  pendingRunsRef: MutableRefObject<StaffGameWrongNoteArchiveRun[]>;
  summaryArchiveRunIdRef: MutableRefObject<string | null>;
  setWrongNoteArchiveRetryQueued: Dispatch<SetStateAction<boolean>>;
  setWrongNoteArchiveStatus: Dispatch<SetStateAction<WrongNoteArchiveStatus>>;
  setWrongNoteArchives: Dispatch<SetStateAction<StaffGameWrongNoteArchive[]>>;
};

export function useStaffGameWrongNoteArchiveStorage({
  pendingRunsRef,
  summaryArchiveRunIdRef,
  setWrongNoteArchiveRetryQueued,
  setWrongNoteArchiveStatus,
  setWrongNoteArchives,
}: Options) {
  useEffect(() => {
    let active = true;
    void db.staffGameWrongNoteArchives
      .orderBy("date")
      .toArray()
      .then((archives) => {
        if (active) setWrongNoteArchives(archives);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [setWrongNoteArchives]);

  useEffect(() => {
    let active = true;
    void retryPendingStaffGameWrongNoteArchives().then((archives) => {
      if (active && archives.length > 0) {
        setWrongNoteArchives((current) => mergeArchives(current, archives));
      }
    });
    return () => {
      active = false;
    };
  }, [setWrongNoteArchives]);

  const archiveWrongNoteRun = useCallback(
    async (
      runId: string | null = null,
      mode: ArchiveMode = "full",
      keepTrendRunPendingForManualArchive = false
    ): Promise<void> => {
      const run = [...pendingRunsRef.current]
        .reverse()
        .find((item) => runId === null || item.runId === runId);
      if (!run) return;
      const shouldUpdateArchiveStatus =
        summaryArchiveRunIdRef.current === run.runId &&
        (mode === "full" || (mode === "trend" && !keepTrendRunPendingForManualArchive));
      const runToSave =
        mode === "trend"
          ? makeTrendOnlyWrongNoteRun(run)
          : { ...run, updatedAt: nextWrongNoteRunUpdatedAt(run), trendOnly: false };
      if (shouldUpdateArchiveStatus) {
        setWrongNoteArchiveStatus("saving");
        setWrongNoteArchiveRetryQueued(false);
      }
      try {
        const savedArchive = await archiveStaffGameWrongNoteRun(runToSave);
        if (mode === "full" || !keepTrendRunPendingForManualArchive) {
          pendingRunsRef.current = pendingRunsRef.current.filter(
            (item) => item.runId !== run.runId
          );
        }
        setWrongNoteArchives((current) => mergeArchives(current, [savedArchive]));
        await removePendingStaffGameWrongNoteArchiveRun(runToSave);
        if (shouldUpdateArchiveStatus) {
          setWrongNoteArchiveStatus("saved");
          setWrongNoteArchiveRetryQueued(false);
        }
      } catch {
        const retryQueued = await enqueuePendingStaffGameWrongNoteArchiveRun(runToSave);
        if (shouldUpdateArchiveStatus) {
          setWrongNoteArchiveRetryQueued(retryQueued);
          setWrongNoteArchiveStatus("error");
        } else if (mode === "trend") {
          toast.error(
            retryQueued
              ? "本局趋势数据保存失败，已暂存并会在下次进入游戏页时自动重试。"
              : "本局趋势数据和本地暂存都失败了；如需保留错漏记录，请在结算页点“加入错题集”重试。"
          );
        }
      }
    },
    [
      pendingRunsRef,
      setWrongNoteArchiveRetryQueued,
      setWrongNoteArchiveStatus,
      setWrongNoteArchives,
      summaryArchiveRunIdRef,
    ]
  );

  return { archiveWrongNoteRun };
}
