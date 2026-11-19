import { ChevronDown, Play, Settings2 } from "lucide-react";
import { useState } from "react";
import type { CurrentPracticeGroupId } from "../../../domain/types";
import { PRACTICE_GROUPS } from "../../../domain/notes";
import { MidiInputControl } from "../../../midi/MidiInputControl";
import type { MidiInputController } from "../../../midi/useMidiInput";
import {
  CHORD_INVERSION_OPTIONS,
  CHORD_DEGREE_OPTIONS,
  CHORD_MAJOR_KEYS,
  getDiatonicChords,
  type ChordDegree,
  type ChordKind,
  type ChordQuality,
  type ChordTrainingConfig,
} from "../logic/chordTraining";
import { PRACTICE_FIXED_COUNT_PRESETS } from "../../practice/logic/practiceLengthOptions";

const TASKS = [
  { id: "recognize", title: "认和弦" },
  { id: "block", title: "弹奏柱式和弦" },
  { id: "arpeggio", title: "弹奏分解和弦" },
] as const;

const QUALITY_OPTIONS = [
  ["triad", "三和弦", "大三、小三与减三和弦"],
  ["seventh", "七和弦", "大七、小七、属七与半减七和弦"],
] as const;

const CHORD_SUFFIXES: Record<ChordQuality, string> = {
  "major-triad": "",
  "minor-triad": "m",
  "diminished-triad": "dim",
  "major-seventh": "maj7",
  "minor-seventh": "m7",
  "dominant-seventh": "7",
  "half-diminished-seventh": "ø7",
};

function formatChordSymbol(rootName: string, quality: ChordQuality): string {
  return `${rootName}${CHORD_SUFFIXES[quality]}`;
}

export function ChordTrainingSetup({
  config,
  midi,
  isStarting,
  startError,
  onChange,
  onStart,
}: {
  config: ChordTrainingConfig;
  midi: MidiInputController;
  isStarting: boolean;
  startError: string | null;
  onChange: (next: ChordTrainingConfig) => void;
  onStart: () => void;
}): JSX.Element {
  const [isMoreConfigOpen, setIsMoreConfigOpen] = useState(false);
  const canUseThirdInversion =
    config.qualities.includes("seventh") && !config.qualities.includes("triad");

  const toggleQuality = (kind: ChordKind): void => {
    const qualities = config.qualities.includes(kind)
      ? config.qualities.filter((item) => item !== kind)
      : [...config.qualities, kind];
    if (qualities.length === 0) return;

    const inversions =
      qualities.includes("triad") && config.inversions.includes(3)
        ? config.inversions.filter((inversion) => inversion !== 3)
        : config.inversions;
    onChange({
      ...config,
      qualities,
      inversions: inversions.length > 0 ? inversions : [0],
    });
  };

  const toggleDegree = (degree: ChordDegree): void => {
    const chordDegrees = config.chordDegrees.includes(degree)
      ? config.chordDegrees.filter((item) => item !== degree)
      : [...config.chordDegrees, degree];
    if (chordDegrees.length === 0) return;

    const selected = new Set(chordDegrees);
    onChange({
      ...config,
      chordDegrees: CHORD_DEGREE_OPTIONS.filter(({ degree: option }) => selected.has(option)).map(
        ({ degree: option }) => option
      ),
    });
  };

  const togglePracticeGroup = (groupId: CurrentPracticeGroupId): void => {
    const selected = new Set(config.practiceGroupIds);
    if (selected.has(groupId)) selected.delete(groupId);
    else selected.add(groupId);
    onChange({
      ...config,
      practiceGroupIds: PRACTICE_GROUPS.filter(({ id }) => selected.has(id)).map(({ id }) => id),
    });
  };

  const toggleInversion = (inversion: number): void => {
    const inversions = config.inversions.includes(inversion)
      ? config.inversions.filter((item) => item !== inversion)
      : [...config.inversions, inversion];
    if (inversions.length > 0) {
      onChange({ ...config, inversions: [...inversions].sort((left, right) => left - right) });
    }
  };

  const lengthLabel =
    config.lengthMode === "open-ended"
      ? "不限"
      : config.lengthMode === "fixed-count"
        ? `${config.fixedCount} 题`
        : `${Math.round(config.fixedDurationSeconds / 60)} 分钟`;
  const summaryItems = [
    TASKS.find((task) => task.id === config.task)?.title ?? "认和弦",
    CHORD_MAJOR_KEYS.find((key) => key.id === config.keyId)?.label ?? "C 大调",
    PRACTICE_GROUPS.filter(({ id }) => config.practiceGroupIds.includes(id))
      .map(({ label }) => label)
      .join("、") || "未选音区",
    `${config.chordDegrees.length} 组和弦`,
    config.qualities.map((kind) => (kind === "triad" ? "三和弦" : "七和弦")).join("、"),
    `${config.inversions.length} 种转位`,
    ...(config.task === "recognize"
      ? [config.requireInversionAnswer ? "答题要求转位" : "答题不要求转位"]
      : []),
    lengthLabel,
  ];

  return (
    <div className="chord-training-page practice-free-page">
      <section
        aria-label="和弦练习配置"
        className="chord-training-setup practice-free-config-content"
      >
        <div className="chord-training-midi-topline">
          <MidiInputControl
            ariaLabel="和弦训练 MIDI 输入设备"
            label="连接 MIDI 键盘"
            midi={midi}
            setupGuideTarget="chord-midi-device"
          />
        </div>

        <section aria-labelledby="chord-training-task-title" className="practice-free-section">
          <div className="practice-free-section-heading">
            <h2 id="chord-training-task-title">练习方式</h2>
          </div>
          <div className="practice-free-range-module-content chord-training-task-content">
            <div aria-label="练习方式" className="chord-training-task-list" role="group">
              {TASKS.map((task) => (
                <button
                  aria-pressed={config.task === task.id}
                  className={`chord-training-task${config.task === task.id ? " is-selected" : ""}`}
                  key={task.id}
                  onClick={() => onChange({ ...config, task: task.id })}
                  type="button"
                >
                  <strong>{task.title}</strong>
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="practice-free-primary-grid chord-training-settings-grid">
          <div className="chord-training-settings-row">
            <section aria-labelledby="chord-training-key-title" className="practice-free-section">
              <div className="practice-free-section-heading">
                <h2 id="chord-training-key-title">调性</h2>
              </div>
              <div className="practice-free-range-module-content">
                <label className="practice-free-duet-difficulty chord-training-key-control">
                  <span className="sr-only">选择大调</span>
                  <select
                    onChange={(event) => onChange({ ...config, keyId: event.target.value })}
                    value={config.keyId}
                  >
                    {CHORD_MAJOR_KEYS.map((key) => (
                      <option key={key.id} value={key.id}>
                        {key.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section
              aria-labelledby="chord-training-quality-title"
              className="practice-free-section"
            >
              <div className="practice-free-section-heading">
                <h2 id="chord-training-quality-title">和弦类型</h2>
              </div>
              <div className="practice-free-range-module-content">
                <fieldset aria-label="和弦类型" className="chord-training-option-list">
                  {QUALITY_OPTIONS.map(([kind, title, description]) => (
                    <label
                      aria-label={`${title}，${description}`}
                      className={`practice-free-duet-range-option${config.qualities.includes(kind) ? " is-selected" : ""}`}
                      key={kind}
                    >
                      <input
                        checked={config.qualities.includes(kind)}
                        onChange={() => toggleQuality(kind)}
                        type="checkbox"
                      />
                      <span className="practice-free-duet-range-copy">
                        {title}
                        <small>{description}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </div>
            </section>
          </div>
          <div className="chord-training-settings-row">
            <section
              aria-labelledby="chord-training-groups-title"
              className="practice-free-section"
            >
              <div className="practice-free-section-heading">
                <h2 id="chord-training-groups-title">训练和弦</h2>
              </div>
              <div className="practice-free-range-module-content">
                <div
                  aria-label="选择训练和弦"
                  className="global-range-groups chord-training-degree-options"
                  role="group"
                >
                  {CHORD_DEGREE_OPTIONS.map((option) => {
                    const symbols = getDiatonicChords(
                      config.keyId,
                      [option.degree],
                      config.qualities
                    )
                      .map((chord) => formatChordSymbol(chord.rootName, chord.quality))
                      .join(" / ");
                    const accessibleName = `${symbols}，${option.label} ${option.description}`;

                    return (
                      <label
                        aria-label={accessibleName}
                        className={`global-range-group-choice chord-training-degree-card${config.chordDegrees.includes(option.degree) ? " is-selected" : ""}`}
                        key={option.degree}
                      >
                        <input
                          checked={config.chordDegrees.includes(option.degree)}
                          onChange={() => toggleDegree(option.degree)}
                          type="checkbox"
                        />
                        <span className="global-range-group-text">
                          <strong>{symbols}</strong>
                          <small>
                            {option.label} · {option.description}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </section>

            <section
              aria-labelledby="chord-training-inversion-title"
              className="practice-free-section"
            >
              <div className="practice-free-section-heading">
                <h2 id="chord-training-inversion-title">转位方式</h2>
              </div>
              <div className="practice-free-range-module-content">
                <fieldset
                  aria-label="转位方式"
                  className="chord-training-option-list chord-training-inversion-list"
                >
                  {CHORD_INVERSION_OPTIONS.map(({ value, label }) => {
                    const disabled = value === 3 && !canUseThirdInversion;

                    return (
                      <label
                        aria-label={label}
                        className={`practice-free-duet-range-option${config.inversions.includes(value) ? " is-selected" : ""}${disabled ? " is-required" : ""}`}
                        key={value}
                      >
                        <input
                          checked={config.inversions.includes(value)}
                          disabled={disabled}
                          onChange={() => toggleInversion(value)}
                          type="checkbox"
                        />
                        <span className="practice-free-duet-range-copy">{label}</span>
                      </label>
                    );
                  })}
                </fieldset>
              </div>
            </section>
          </div>
          <div className="chord-training-settings-row">
            <section
              aria-labelledby="chord-training-pitch-range-title"
              className="practice-free-section"
              data-setup-guide-target="chord-practice-range"
            >
              <div className="practice-free-section-heading">
                <h2 id="chord-training-pitch-range-title">练习音区</h2>
              </div>
              <div className="practice-free-range-module-content chord-training-pitch-range-content">
                <fieldset
                  aria-label="练习音区"
                  className="global-range-groups chord-training-practice-groups"
                >
                  {PRACTICE_GROUPS.map((group) => {
                    const selected = config.practiceGroupIds.includes(group.id);
                    const firstPitch = group.notes[0]?.pitchId;
                    const lastPitch = group.notes[group.notes.length - 1]?.pitchId;

                    return (
                      <label
                        aria-label={`${group.label}，${firstPitch} 到 ${lastPitch}`}
                        className={`choice global-range-group-choice${selected ? " choice-active" : ""}`}
                        key={group.id}
                      >
                        <input
                          checked={selected}
                          onChange={() => togglePracticeGroup(group.id)}
                          type="checkbox"
                        />
                        <span className="global-range-group-text">
                          <strong>{group.label}</strong>
                          <small>
                            {firstPitch}–{lastPitch}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
                <div className="global-range-pitch-summary">
                  <span aria-live="polite">
                    {config.practiceGroupIds.length > 0
                      ? `当前音区：${PRACTICE_GROUPS.filter(({ id }) =>
                          config.practiceGroupIds.includes(id)
                        )
                          .map(
                            ({ notes }) =>
                              `${notes[0]?.pitchId}–${notes[notes.length - 1]?.pitchId}`
                          )
                          .join("、")}`
                      : "当前未选择音区，请至少选择一个音区。"}
                  </span>
                  {config.practiceGroupIds.length > 0 ? (
                    <button
                      onClick={() => onChange({ ...config, practiceGroupIds: [] })}
                      type="button"
                    >
                      清空音区
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <section
              aria-labelledby="chord-training-length-title"
              className="practice-free-section"
            >
              <div className="practice-free-section-heading">
                <h2 id="chord-training-length-title">练习长度</h2>
              </div>
              <div className="practice-free-range-module-content chord-training-length-content">
                <div aria-label="练习长度模式" className="segmented practice-free-segmented">
                  {(
                    [
                      ["open-ended", "不限"],
                      ["fixed-count", "固定题数"],
                      ["fixed-duration", "固定时长"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      aria-pressed={config.lengthMode === value}
                      className={config.lengthMode === value ? "active" : ""}
                      key={value}
                      onClick={() => onChange({ ...config, lengthMode: value })}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {config.lengthMode === "fixed-count" ? (
                  <div className="practice-free-value-options">
                    {PRACTICE_FIXED_COUNT_PRESETS.map((count) => (
                      <button
                        aria-pressed={config.fixedCount === count}
                        className={config.fixedCount === count ? "active" : ""}
                        key={count}
                        onClick={() => onChange({ ...config, fixedCount: count })}
                        type="button"
                      >
                        {count} 题
                      </button>
                    ))}
                    <label className="chord-training-custom-count">
                      自定义
                      <input
                        aria-label="自定义练习题数"
                        max={500}
                        min={1}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isInteger(value) && value >= 1 && value <= 500) {
                            onChange({ ...config, fixedCount: value });
                          }
                        }}
                        type="number"
                        value={config.fixedCount}
                      />
                    </label>
                  </div>
                ) : null}
                {config.lengthMode === "fixed-duration" ? (
                  <label className="chord-training-custom-count">
                    时长（分钟）
                    <input
                      aria-label="固定练习时长，分钟"
                      max={120}
                      min={1}
                      onChange={(event) => {
                        const minutes = Number(event.target.value);
                        if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 120) {
                          onChange({ ...config, fixedDurationSeconds: minutes * 60 });
                        }
                      }}
                      type="number"
                      value={Math.round(config.fixedDurationSeconds / 60)}
                    />
                  </label>
                ) : null}
              </div>
            </section>
          </div>
        </div>

        {config.task === "recognize" ? (
          <section className="practice-free-advanced-disclosure chord-training-advanced-disclosure">
            <button
              aria-controls="chord-training-advanced-options"
              aria-expanded={isMoreConfigOpen}
              className="practice-free-advanced-toggle"
              onClick={() => setIsMoreConfigOpen((open) => !open)}
              type="button"
            >
              <Settings2 aria-hidden="true" size={16} />
              <span>更多配置</span>
              <span className="practice-free-advanced-count">1项</span>
              <ChevronDown
                aria-hidden="true"
                className={isMoreConfigOpen ? "is-open" : ""}
                size={16}
              />
            </button>
            <div
              className="practice-free-advanced-content chord-training-advanced-content"
              hidden={!isMoreConfigOpen}
              id="chord-training-advanced-options"
            >
              <label className="practice-checkbox-option chord-training-inversion-answer-option">
                <input
                  aria-label="答题时选择转位"
                  checked={config.requireInversionAnswer}
                  onChange={(event) =>
                    onChange({ ...config, requireInversionAnswer: event.currentTarget.checked })
                  }
                  type="checkbox"
                />
                <span>答题时选择转位</span>
              </label>
            </div>
          </section>
        ) : null}

        <footer aria-label="当前练习设置" className="practice-free-action-dock">
          <div aria-label="当前配置摘要" className="practice-free-config-summary">
            <span className="practice-free-summary-label">当前配置</span>
            {summaryItems.map((item) => (
              <span className="practice-free-summary-chip" key={item}>
                {item}
              </span>
            ))}
          </div>
          <div className="practice-free-action-buttons chord-training-action-buttons">
            {startError ? (
              <p className="practice-midi-start-warning" data-setup-guide-warning="" role="alert">
                {startError}
              </p>
            ) : isStarting ? (
              <p className="practice-midi-start-warning" role="status">
                正在准备和弦练习…
              </p>
            ) : null}
            <span className="practice-start-action">
              <button
                aria-keyshortcuts="Enter"
                className="primary practice-free-start-button chord-training-start-button"
                disabled={isStarting}
                onClick={onStart}
                type="button"
              >
                <Play aria-hidden="true" size={18} />
                开始<kbd>Enter</kbd>
              </button>
            </span>
          </div>
        </footer>
      </section>
    </div>
  );
}
