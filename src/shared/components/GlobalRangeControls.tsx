import { useRef, type ReactNode } from "react";

import {
  AVAILABLE_PITCH_IDS,
  DEFAULT_ENABLED_GROUPS,
  getPitchIdsForGroups,
  getStaffCorePitchIds,
  getStaffRangeExtensionOptions,
  getStaffSelectedPitchIds,
  getValidStaffCrossGroupPitchIds,
  PITCH_OCTAVE_GROUPS,
} from "../../domain/notes";
import type {
  AppSettings,
  PitchId,
  StaffNotationMode,
  StaffRangeSelection,
} from "../../domain/types";

interface GlobalRangeControlsProps {
  disabled?: boolean;
  allowInterStaffLedgerChoice?: boolean;
  rangeControlPart?: "all" | "base" | "extensions";
  compactSummary?: boolean;
  summaryAction?: ReactNode;
  staffNotationModeOverride?: StaffNotationMode;
  settings: AppSettings;
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
}

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

function orderedPitchIds(pitchIds: Iterable<PitchId>): PitchId[] {
  const selected = new Set(pitchIds);
  return AVAILABLE_PITCH_IDS.filter((pitchId) => selected.has(pitchId));
}

export function GlobalRangeControls({
  disabled = false,
  allowInterStaffLedgerChoice = true,
  rangeControlPart = "all",
  compactSummary = false,
  summaryAction,
  staffNotationModeOverride,
  settings,
  onSettingsSaved,
}: GlobalRangeControlsProps): JSX.Element {
  const pointerToggleRef = useRef(false);
  const staffMode = staffNotationModeOverride ?? settings.staffNotationMode;
  const activeRange = settings.staffRangeProfiles?.[staffMode] ?? settings;
  const basePitchIds = getStaffCorePitchIds(
    activeRange.enabledPitchIds ?? getPitchIdsForGroups(activeRange.enabledGroupIds),
    staffMode
  );
  const crossPitchIds = getValidStaffCrossGroupPitchIds(
    basePitchIds,
    activeRange.crossGroupPitchIds
  );
  const selectedPitchIds = getStaffSelectedPitchIds(
    activeRange.enabledGroupIds,
    activeRange.enabledPitchIds,
    activeRange.crossGroupPitchIds,
    staffMode
  );
  const selectedPitchSet = new Set(selectedPitchIds);
  const extensionOptions = getStaffRangeExtensionOptions(basePitchIds);
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
    const normalizedCross = getValidStaffCrossGroupPitchIds(
      normalizedBase,
      orderedPitchIds(nextCross)
    );
    const nextRange: StaffRangeSelection = {
      enabledGroupIds: [],
      enabledPitchIds: normalizedBase,
      crossGroupPitchIds: normalizedCross,
    };
    save({
      ...settings,
      ...(staffMode === settings.staffNotationMode ? nextRange : {}),
      staffRangeProfiles: {
        ...settings.staffRangeProfiles,
        [staffMode]: nextRange,
      },
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

  function isExtensionSelected(
    direction: "lower" | "higher",
    pitchIds: readonly PitchId[]
  ): boolean {
    const directionOptions = extensionOptions.filter((option) => option.direction === direction);
    const directionPitchIds = new Set(directionOptions.flatMap((option) => option.pitchIds));
    const selectedDirectionPitchIds = crossPitchIds.filter((pitchId) =>
      directionPitchIds.has(pitchId)
    );
    return (
      selectedDirectionPitchIds.length === pitchIds.length &&
      pitchIds.every((pitchId) => selectedDirectionPitchIds.includes(pitchId))
    );
  }

  function toggleCrossGroupRange(option: {
    direction: "lower" | "higher";
    pitchIds: PitchId[];
  }): void {
    const directionPitchIds = new Set(
      extensionOptions
        .filter((candidate) => candidate.direction === option.direction)
        .flatMap((candidate) => candidate.pitchIds)
    );
    const keptOtherDirection = crossPitchIds.filter((pitchId) => !directionPitchIds.has(pitchId));
    const selected = isExtensionSelected(option.direction, option.pitchIds);
    savePitchSelection(
      basePitchIds,
      selected ? keptOtherDirection : [...keptOtherDirection, ...option.pitchIds]
    );
  }

  function removeCrossGroupRange(): void {
    savePitchSelection(basePitchIds, []);
  }

  function selectStaffNotationMode(staffNotationMode: StaffNotationMode): void {
    const existingRange = settings.staffRangeProfiles?.[staffNotationMode];
    const nextBase = existingRange
      ? getStaffCorePitchIds(
          existingRange.enabledPitchIds ?? getPitchIdsForGroups(existingRange.enabledGroupIds),
          staffNotationMode
        )
      : (() => {
          const compatible = getStaffCorePitchIds(basePitchIds, staffNotationMode);
          return compatible.length > 0
            ? compatible
            : getStaffCorePitchIds(getPitchIdsForGroups(DEFAULT_ENABLED_GROUPS), staffNotationMode);
        })();
    const nextCross = existingRange
      ? getValidStaffCrossGroupPitchIds(nextBase, existingRange.crossGroupPitchIds)
      : [];
    const nextRange: StaffRangeSelection = {
      enabledGroupIds: [],
      enabledPitchIds: nextBase,
      crossGroupPitchIds: nextCross,
    };
    save({
      ...settings,
      ...nextRange,
      staffNotationMode,
      staffRangeProfiles: {
        ...settings.staffRangeProfiles,
        [staffMode]: {
          enabledGroupIds: [],
          enabledPitchIds: basePitchIds,
          crossGroupPitchIds: crossPitchIds,
        },
        [staffNotationMode]: nextRange,
      },
    });
  }

  function toggleInterStaffLedger(checked: boolean): void {
    save({ ...settings, includeInterStaffLedgerSpellings: checked });
  }

  const crossRangeSection = (
    <div className="global-range-cross-section">
      <span className="global-range-cross-title">音域加练</span>
      <div className="global-range-cross-options">
        {extensionOptions.length === 0 ? (
          <small>
            {basePitchIds.length === 0
              ? "先选择一个音组，再设置加练。"
              : "当前音域已到可用范围边界。"}
          </small>
        ) : (
          extensionOptions.map((option) => {
            const selected = isExtensionSelected(option.direction, option.pitchIds);
            const directionLabel = option.direction === "lower" ? "向低" : "向高";
            return (
              <button
                aria-label={
                  selected
                    ? `取消${directionLabel}加练 ${option.pitchIds.length} 音`
                    : `${directionLabel}加练 ${option.pitchIds.length} 音`
                }
                aria-pressed={selected}
                className={selected ? "active" : ""}
                disabled={disabled}
                key={`${option.direction}-${option.pitchIds.length}`}
                type="button"
                onClick={() => toggleCrossGroupRange(option)}
              >
                {directionLabel}加练 {option.pitchIds.length} 音 ·{" "}
                {formatPitchRanges(option.pitchIds)}
              </button>
            );
          })
        )}
        {basePitchIds.length > 0 && (staffMode === "grand" || extensionOptions.length > 0) ? (
          <small
            className={
              staffMode === "grand"
                ? "global-range-cross-note"
                : "global-range-cross-note global-range-cross-note-crossover"
            }
          >
            {staffMode === "grand"
              ? "大谱表可同时向低、向高加练（每侧选 3 或 5 音）。加练音按 C4/B3 分界归谱，不做单谱模式的跨手交叉练习。"
              : staffMode === "treble-only"
                ? "高音谱向低、向高可同时加练；低于 C4 的部分按跨手识谱处理，仍记在高音谱。"
                : "低音谱向低、向高可同时加练；高于 B3 的部分按跨手识谱处理，仍记在低音谱。"}
          </small>
        ) : null}
      </div>
      {crossPitchIds.length > 0 ? (
        <div className="global-range-cross-selected" aria-label="已添加的加练音">
          <span>已加练：{formatPitchRanges(crossPitchIds)}</span>
          <button
            aria-label="取消音域加练"
            disabled={disabled}
            type="button"
            onClick={removeCrossGroupRange}
          >
            取消加练
          </button>
        </div>
      ) : null}
    </div>
  );

  if (rangeControlPart === "extensions") {
    return (
      <div
        aria-label="音域加练"
        className="global-range-controls global-range-controls-extensions"
        role="group"
      >
        {crossRangeSection}
      </div>
    );
  }

  const pitchContent = (
    <>
      <div className="global-range-groups">
        {PITCH_OCTAVE_GROUPS.map((group) => {
          const selectablePitchIds = getStaffCorePitchIds(group.pitchIds, staffMode);
          const selectedCount = selectablePitchIds.filter((pitchId) =>
            selectedPitchSet.has(pitchId)
          ).length;
          const checked =
            selectablePitchIds.length > 0 && selectedCount === selectablePitchIds.length;
          const partial = selectedCount > 0 && !checked;
          const displayedRange =
            selectablePitchIds.length > 0
              ? formatPitchRanges(selectablePitchIds)
              : group.rangeLabel;
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
                disabled={disabled || selectablePitchIds.length === 0}
                ref={(input) => {
                  if (input) input.indeterminate = partial;
                }}
                type="checkbox"
                onChange={(event) => {
                  toggleOctaveGroup(selectablePitchIds);
                  blurAfterPointerToggle(event.currentTarget);
                }}
              />
              <span className="global-range-group-text">
                <strong>{group.label}</strong>
                <small>{displayedRange}</small>
              </span>
              {partial ? <small className="global-range-partial-label">部分</small> : null}
            </label>
          );
        })}
      </div>
      <div className="global-range-pitch-summary">
        <span aria-live="polite">
          {compactSummary && selectedPitchIds.length > 0
            ? `当前音域：${formatPitchRanges(selectedPitchIds)}`
            : selectedPitchIds.length > 0
              ? `当前音域：${formatPitchRanges(selectedPitchIds)} · ${selectedPitchIds.length} 个音高${selectedOctaveGroupLabels.length > 0 ? ` · ${selectedOctaveGroupLabels.join("、")}` : ""}`
              : "当前未选择音域，请至少选择一个音组。"}
        </span>
        {summaryAction}
        {selectedPitchIds.length > 0 ? (
          <button disabled={disabled} type="button" onClick={() => savePitchSelection([], [])}>
            清空音域
          </button>
        ) : null}
      </div>
    </>
  );

  const staffContent = (
    <>
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
            disabled={disabled || staffNotationModeOverride !== undefined}
            key={staffNotationMode}
            type="button"
            onClick={() => selectStaffNotationMode(staffNotationMode)}
          >
            {label}
          </button>
        ))}
      </div>
      {settings.staffNotationMode === "grand" && allowInterStaffLedgerChoice ? (
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
    </>
  );

  return (
    <div
      aria-label="全局范围"
      className={`global-range-controls${disabled ? " global-range-controls-locked" : ""}${rangeControlPart === "base" ? " global-range-controls-base" : ""}`}
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
          {!compactSummary ? (
            <small className="global-range-pitch-help">
              {staffMode === "treble-only"
                ? "高音谱主体从中央 C（C4）起；低于 C4 的加练音按跨手识谱处理"
                : staffMode === "bass-only"
                  ? "低音谱主体到中央 C 下方 B3；高于 B3 的加练音按跨手识谱处理"
                  : "可多选；小字一组包含中央 C"}
            </small>
          ) : null}
        </div>
        {rangeControlPart === "base" ? (
          <div className="practice-free-range-module-content">{pitchContent}</div>
        ) : (
          pitchContent
        )}
        {rangeControlPart === "all" ? crossRangeSection : null}
      </section>
      {rangeControlPart === "all" ? (
        <span className="global-range-divider" aria-hidden="true" />
      ) : null}
      <div
        className={
          settings.staffNotationMode === "grand"
            ? "global-range-staff-section global-range-staff-section-grand"
            : "global-range-staff-section"
        }
      >
        {rangeControlPart === "base" ? (
          <strong className="practice-free-range-module-title">谱表</strong>
        ) : null}
        {rangeControlPart === "base" ? (
          <div className="practice-free-range-module-content">{staffContent}</div>
        ) : (
          staffContent
        )}
      </div>
    </div>
  );
}
