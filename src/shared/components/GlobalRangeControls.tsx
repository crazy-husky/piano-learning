import { useRef } from "react";

import {
  AVAILABLE_PITCH_IDS,
  getPitchIdsForGroups,
  getSelectedPitchIds,
  PITCH_OCTAVE_GROUPS,
} from "../../domain/notes";
import type { AppSettings, PitchId, StaffNotationMode } from "../../domain/types";

interface GlobalRangeControlsProps {
  disabled?: boolean;
  settings: AppSettings;
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
}

type PitchDirection = "lower" | "higher";

function groupPitchIds(pitchIds: readonly PitchId[]): PitchId[][] {
  const selected = new Set(pitchIds);
  const ranges: PitchId[][] = [];
  let currentRange: PitchId[] = [];

  AVAILABLE_PITCH_IDS.forEach((pitchId) => {
    if (selected.has(pitchId)) {
      currentRange.push(pitchId);
      return;
    }
    if (currentRange.length > 0) {
      ranges.push(currentRange);
      currentRange = [];
    }
  });

  if (currentRange.length > 0) ranges.push(currentRange);
  return ranges;
}

function formatPitchRanges(pitchIds: readonly PitchId[]): string {
  return groupPitchIds(pitchIds)
    .map((range) => (range.length === 1 ? range[0] : `${range[0]}–${range[range.length - 1]}`))
    .join("、");
}

function getAdjacentPitchRange(
  selectedPitchIds: readonly PitchId[],
  direction: PitchDirection
): PitchId[] {
  if (selectedPitchIds.length === 0) return [];
  const selectedIndices = selectedPitchIds
    .map((pitchId) => AVAILABLE_PITCH_IDS.indexOf(pitchId))
    .filter((index) => index >= 0);
  if (selectedIndices.length === 0) return [];

  const edge = direction === "lower" ? Math.min(...selectedIndices) : Math.max(...selectedIndices);
  return direction === "lower"
    ? AVAILABLE_PITCH_IDS.slice(Math.max(0, edge - 3), edge)
    : AVAILABLE_PITCH_IDS.slice(edge + 1, edge + 4);
}

function orderedPitchIds(pitchIds: Iterable<PitchId>): PitchId[] {
  const selected = new Set(pitchIds);
  return AVAILABLE_PITCH_IDS.filter((pitchId) => selected.has(pitchId));
}

export function GlobalRangeControls({
  disabled = false,
  settings,
  onSettingsSaved,
}: GlobalRangeControlsProps): JSX.Element {
  const pointerToggleRef = useRef(false);
  const selectedPitchIds = getSelectedPitchIds(
    settings.enabledGroupIds,
    settings.enabledPitchIds,
    settings.crossGroupPitchIds
  );
  const selectedPitchSet = new Set(selectedPitchIds);
  const basePitchIds = settings.enabledPitchIds ?? getPitchIdsForGroups(settings.enabledGroupIds);
  const crossPitchIds = settings.crossGroupPitchIds ?? [];
  const lowerExtension = getAdjacentPitchRange(selectedPitchIds, "lower");
  const higherExtension = getAdjacentPitchRange(selectedPitchIds, "higher");
  const selectedOctaveGroupLabels = PITCH_OCTAVE_GROUPS.filter((group) =>
    group.pitchIds.some((pitchId) => selectedPitchSet.has(pitchId))
  ).map((group) => group.label);

  function markPointerToggle(): void {
    pointerToggleRef.current = true;
    window.setTimeout(() => {
      pointerToggleRef.current = false;
    }, 1000);
  }

  function blurAfterPointerToggle(input: HTMLInputElement): void {
    if (!pointerToggleRef.current) return;
    pointerToggleRef.current = false;
    window.setTimeout(() => {
      if (document.activeElement === input) input.blur();
    }, 0);
  }

  function save(nextSettings: AppSettings): void {
    void onSettingsSaved(nextSettings);
  }

  function savePitchSelection(nextBase: Iterable<PitchId>, nextCross: Iterable<PitchId>): void {
    const normalizedBase = orderedPitchIds(nextBase);
    const normalizedCross = orderedPitchIds(nextCross).filter(
      (pitchId) => !normalizedBase.includes(pitchId)
    );
    save({
      ...settings,
      enabledGroupIds: [],
      enabledPitchIds: normalizedBase,
      crossGroupPitchIds: normalizedCross,
    });
  }

  function toggleOctaveGroup(pitchIds: readonly PitchId[]): void {
    const nextBase = new Set(basePitchIds);
    const nextCross = new Set(crossPitchIds);
    const fullySelected = pitchIds.every((pitchId) => selectedPitchSet.has(pitchId));

    if (fullySelected) {
      pitchIds.forEach((pitchId) => {
        nextBase.delete(pitchId);
        nextCross.delete(pitchId);
      });
    } else {
      pitchIds.forEach((pitchId) => {
        nextBase.add(pitchId);
        nextCross.delete(pitchId);
      });
    }

    savePitchSelection(nextBase, nextCross);
  }

  function addCrossGroupRange(pitchIds: readonly PitchId[]): void {
    const nextCross = new Set(crossPitchIds);
    pitchIds.forEach((pitchId) => {
      if (!basePitchIds.includes(pitchId)) nextCross.add(pitchId);
    });
    savePitchSelection(basePitchIds, nextCross);
  }

  function removeCrossGroupRange(pitchIds: readonly PitchId[]): void {
    const removed = new Set(pitchIds);
    savePitchSelection(
      basePitchIds,
      crossPitchIds.filter((pitchId) => !removed.has(pitchId))
    );
  }

  function selectStaffNotationMode(staffNotationMode: StaffNotationMode): void {
    save({ ...settings, staffNotationMode });
  }

  function toggleInterStaffLedger(checked: boolean): void {
    save({ ...settings, includeInterStaffLedgerSpellings: checked });
  }

  return (
    <div
      aria-label="全局范围"
      className={
        disabled ? "global-range-controls global-range-controls-locked" : "global-range-controls"
      }
      role="group"
    >
      <section
        className={
          selectedPitchIds.length === 0
            ? "global-range-pitch-section global-range-pitch-section-empty"
            : "global-range-pitch-section"
        }
        aria-label="按音组选择练习范围"
      >
        <div className="global-range-pitch-heading">
          <strong>练习音组</strong>
          <small>可多选；小字一组包含中央 C</small>
        </div>
        <div className="global-range-groups">
          {PITCH_OCTAVE_GROUPS.map((group) => {
            const selectedCount = group.pitchIds.filter((pitchId) =>
              selectedPitchSet.has(pitchId)
            ).length;
            const checked = selectedCount === group.pitchIds.length;
            const partial = selectedCount > 0 && !checked;
            return (
              <label
                className={
                  checked
                    ? "choice choice-active global-range-group-choice"
                    : partial
                      ? "choice global-range-group-choice global-range-group-partial"
                      : "choice global-range-group-choice"
                }
                key={group.label}
                onPointerDown={markPointerToggle}
              >
                <input
                  checked={checked}
                  disabled={disabled}
                  ref={(input) => {
                    if (input) input.indeterminate = partial;
                  }}
                  type="checkbox"
                  onChange={(event) => {
                    toggleOctaveGroup(group.pitchIds);
                    blurAfterPointerToggle(event.currentTarget);
                  }}
                />
                <span className="global-range-group-text">
                  <strong>{group.label}</strong>
                  <small>{group.rangeLabel}</small>
                </span>
                {partial ? <small className="global-range-partial-label">部分</small> : null}
              </label>
            );
          })}
        </div>
        <div className="global-range-pitch-summary" aria-live="polite">
          <span>
            {selectedPitchIds.length > 0
              ? `当前音域：${formatPitchRanges(selectedPitchIds)} · ${selectedPitchIds.length} 个音高${selectedOctaveGroupLabels.length > 0 ? ` · ${selectedOctaveGroupLabels.join("、")}` : ""}`
              : "当前未选择音域，请至少选择一个音组。"}
          </span>
          {selectedPitchIds.length > 0 ? (
            <button disabled={disabled} type="button" onClick={() => savePitchSelection([], [])}>
              清空音域
            </button>
          ) : null}
        </div>
        <div className="global-range-cross-section">
          <span className="global-range-cross-title">跨组加练</span>
          <div className="global-range-cross-options">
            {lowerExtension.length > 0 ? (
              <button
                disabled={disabled}
                type="button"
                onClick={() => addCrossGroupRange(lowerExtension)}
              >
                向低加练 {formatPitchRanges(lowerExtension)}
              </button>
            ) : null}
            {higherExtension.length > 0 ? (
              <button
                disabled={disabled}
                type="button"
                onClick={() => addCrossGroupRange(higherExtension)}
              >
                向高加练 {formatPitchRanges(higherExtension)}
              </button>
            ) : null}
            {lowerExtension.length === 0 && higherExtension.length === 0 ? (
              <small>先选择一个音组</small>
            ) : null}
          </div>
          {crossPitchIds.length > 0 ? (
            <div className="global-range-cross-selected" aria-label="已添加的跨组音">
              <span>已加练：{formatPitchRanges(crossPitchIds)}</span>
              {groupPitchIds(crossPitchIds).map((range) => (
                <button
                  aria-label={`移除跨组加练 ${formatPitchRanges(range)}`}
                  disabled={disabled}
                  key={range.join("-")}
                  type="button"
                  onClick={() => removeCrossGroupRange(range)}
                >
                  移除
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>
      <span className="global-range-divider" aria-hidden="true" />
      <div
        className={
          settings.staffNotationMode === "grand"
            ? "global-range-staff-section global-range-staff-section-grand"
            : "global-range-staff-section"
        }
      >
        <div className="segmented global-range-staffs" aria-label="谱表选择">
          {(
            [
              ["treble-only", "高音谱表"],
              ["bass-only", "低音谱表"],
              ["grand", "大谱表"],
            ] as const
          ).map(([staffNotationMode, label]) => (
            <button
              aria-pressed={settings.staffNotationMode === staffNotationMode}
              className={settings.staffNotationMode === staffNotationMode ? "active" : ""}
              disabled={disabled}
              key={staffNotationMode}
              type="button"
              onClick={() => selectStaffNotationMode(staffNotationMode)}
            >
              {label}
            </button>
          ))}
        </div>
        {settings.staffNotationMode === "grand" ? (
          <label className="global-range-ledger-choice" onPointerDown={markPointerToggle}>
            <input
              checked={settings.includeInterStaffLedgerSpellings}
              disabled={disabled}
              type="checkbox"
              onChange={(event) => {
                toggleInterStaffLedger(event.target.checked);
                blurAfterPointerToggle(event.currentTarget);
              }}
            />
            <span>谱表间加线</span>
            <small>E3–A4 同时练习两种谱号</small>
          </label>
        ) : null}
      </div>
    </div>
  );
}
