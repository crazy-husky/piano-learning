import { useMemo, useState } from "react";
import { PITCH_OCTAVE_GROUPS } from "../../../domain/notes";
import type { StaffGameWrongNoteArchive } from "../../../domain/types";
import {
  calculateStaffGameWrongNoteNoteDiagnostics,
  filterStaffGameWrongNoteArchivesByGameMode,
  type StaffGameWrongNoteRange,
  type StaffGameWrongNoteGameModeFilter,
} from "../../../domain/staffGameWrongNoteArchives";
import { gameNoteFromMidi, staffGameSolfegeLabel } from "../logic/staffGameRules";

function octaveGroupLabel(octave: number): string {
  return (
    PITCH_OCTAVE_GROUPS.find((group) =>
      group.pitchIds.some((pitchId) => pitchId.endsWith(String(octave)))
    )?.label ?? `${octave}组`
  );
}

export function StaffGameWrongNoteNoteDiagnosticPanel({
  archives,
  fixedGameMode,
  onChangeRange,
  range,
  showModeControl = true,
  showRangeControl = true,
}: {
  archives: readonly StaffGameWrongNoteArchive[];
  fixedGameMode?: StaffGameWrongNoteGameModeFilter;
  range: StaffGameWrongNoteRange;
  onChangeRange: (range: StaffGameWrongNoteRange) => void;
  showModeControl?: boolean;
  showRangeControl?: boolean;
}): JSX.Element {
  const [selectedGameMode, setSelectedGameMode] =
    useState<StaffGameWrongNoteGameModeFilter>("learning");
  const gameMode = fixedGameMode ?? selectedGameMode;
  const filteredArchives = useMemo(
    () => filterStaffGameWrongNoteArchivesByGameMode(archives, gameMode),
    [archives, gameMode]
  );
  const diagnostics = useMemo(
    () => calculateStaffGameWrongNoteNoteDiagnostics(filteredArchives, range),
    [filteredArchives, range]
  );

  return (
    <div className="staff-game-archive-note-panel">
      <div className="staff-game-archive-note-toolbar">
        {showModeControl ? (
          <label>
            <span>练习模式</span>
            <select
              aria-label="单音诊断练习模式"
              onChange={(event) =>
                setSelectedGameMode(event.target.value as StaffGameWrongNoteGameModeFilter)
              }
              value={gameMode}
            >
              <option value="learning">学习测试</option>
              <option value="arcade">娱乐模式</option>
              <option value="all">全部练习（含错题复习）</option>
            </select>
          </label>
        ) : null}
        {showRangeControl ? (
          <label>
            <span>记录时间</span>
            <select
              aria-label="单音诊断时间范围"
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
      </div>

      <div className="staff-game-archive-note-list" aria-label="单音诊断列表" role="list">
        {diagnostics.length === 0 ? (
          <div className="staff-game-archive-note-empty" role="status">
            暂无单音数据，多练几局再来
          </div>
        ) : (
          diagnostics.map((note) => {
            const pitch = gameNoteFromMidi(note.midi);
            const label = `${pitch.name}${pitch.octave}`;
            const groupLabel = octaveGroupLabel(pitch.octave);
            const solfegeLabel = staffGameSolfegeLabel(pitch.name);
            return (
              <article className="staff-game-archive-note-card" key={note.midi} role="listitem">
                <div className="staff-game-archive-note-heading">
                  <strong>
                    {label}
                    <span className="staff-game-archive-note-octave-label">
                      （{groupLabel} {solfegeLabel}）
                    </span>
                  </strong>
                  <span>
                    错误率{" "}
                    {note.errorRatePercent === null ? "—" : `${Math.round(note.errorRatePercent)}%`}
                  </span>
                  {note.runCount < 3 ? (
                    <small title="该音在少于 3 局归档中出现">样本不足</small>
                  ) : null}
                </div>
                <p>
                  用时{" "}
                  {note.averageResponseMs === null
                    ? "—"
                    : `${(note.averageResponseMs / 1000).toFixed(1)}s`}
                  {" · "}出场 {note.runCount} 局 · 共出现 {note.appearanceCount} 次
                </p>
                {note.confusions.length > 0 ? (
                  <p className="staff-game-archive-note-confusions">
                    <span>常见错认：</span>
                    {note.confusions.map((confusion, index) => (
                      <span key={confusion.note}>
                        {index > 0 ? "，" : ""}
                        {confusion.note} × {confusion.count}
                      </span>
                    ))}
                  </p>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
