import { ArrowUp, Check, ChevronLeft, ChevronRight, Volume2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { playTargetNote } from "../../../audio/piano";
import { ALL_NOTES, PITCH_OCTAVE_GROUPS } from "../../../domain/notes";
import type {
  NoteName,
  PianoKeyName,
  StaffGameWrongNoteArchive,
  TargetNote,
} from "../../../domain/types";
import type { StaffGameWrongNoteRange } from "../../../domain/staffGameWrongNoteArchives";
import { StaffPrompt } from "../../practice/components/StaffPrompt";
import {
  createStaffGameWrongNoteSelfTestProgress,
  getStaffGameWrongNoteStudyItems,
  isStaffGameWrongNoteSelfTestComplete,
  navigateStaffGameWrongNoteSelfTest,
  rateStaffGameWrongNoteSelfTestItem,
  revealStaffGameWrongNoteSelfTestAnswer,
} from "../logic/staffGameWrongNoteStudy";

interface StaffGameWrongNoteStudyDialogProps {
  archives: readonly StaffGameWrongNoteArchive[];
  range: StaffGameWrongNoteRange;
  onChangeRange: (range: StaffGameWrongNoteRange) => void;
  onClose: () => void;
}

type StudyTab = "browse" | "self-test";

const EMPTY_TARGET_NOTE_IDS = new Set<never>();
const WHITE_KEYS: readonly NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];
const BLACK_KEYS: ReadonlyArray<{ name: PianoKeyName; position: number }> = [
  { name: "C#", position: 1 },
  { name: "D#", position: 2 },
  { name: "F#", position: 4 },
  { name: "G#", position: 5 },
  { name: "A#", position: 6 },
];

function targetNoteForKeyboardKey(
  key: PianoKeyName,
  octave: TargetNote["octave"]
): TargetNote | null {
  const isSharp = key.endsWith("#");
  const noteName = key[0] as NoteName;
  const pitchId = `${noteName}${octave}`;
  const naturalTarget = ALL_NOTES.find(
    (candidate) => candidate.pitchId === pitchId && candidate.id === candidate.pitchId
  );
  if (!naturalTarget) return null;
  return isSharp ? { ...naturalTarget, accidental: "sharp" } : naturalTarget;
}

function playKeyboardNote(note: TargetNote): void {
  void playTargetNote(note).catch(() => toast.error("钢琴音暂时无法播放，请稍后重试"));
}

function StaffGameWrongNoteKeyboardMap({
  label,
  target,
}: {
  label: string;
  target: TargetNote;
}): JSX.Element {
  const group = PITCH_OCTAVE_GROUPS.find((candidate) =>
    candidate.pitchIds.includes(target.pitchId)
  );
  const selectedKey = `${target.noteName}${target.accidental === "sharp" ? "#" : ""}`;

  return (
    <div
      aria-label={`${label}位于钢琴${group?.label ?? `${target.octave}组`}`}
      className="staff-game-wrong-note-keyboard-map"
      role="group"
    >
      <div className="staff-game-wrong-note-key-location">
        <div
          aria-label={`C${target.octave} 到 B${target.octave}`}
          className="staff-game-wrong-note-keybed"
          role="group"
        >
          <div className="staff-game-wrong-note-white-keys">
            {WHITE_KEYS.map((key) => (
              <button
                aria-label={`弹奏 ${key}${target.octave}`}
                className={`staff-game-wrong-note-key staff-game-wrong-note-key-white${selectedKey === key ? " is-selected" : ""}`}
                key={key}
                onClick={() => {
                  const note = targetNoteForKeyboardKey(key, target.octave);
                  if (note) playKeyboardNote(note);
                }}
                type="button"
              >
                {key}
              </button>
            ))}
          </div>
          {BLACK_KEYS.map(({ name, position }) => (
            <button
              aria-label={`弹奏 ${name}${target.octave}`}
              className={`staff-game-wrong-note-key staff-game-wrong-note-key-black${selectedKey === name ? " is-selected" : ""}`}
              key={name}
              onClick={() => {
                const note = targetNoteForKeyboardKey(name, target.octave);
                if (note) playKeyboardNote(note);
              }}
              style={{ left: `${(position / 7) * 100}%` }}
              type="button"
            />
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="staff-game-wrong-note-register-map">
        <div className="staff-game-wrong-note-register-arrows">
          {PITCH_OCTAVE_GROUPS.map((octaveGroup) => {
            const isSelected = octaveGroup.pitchIds.includes(target.pitchId);
            return (
              <span className="staff-game-wrong-note-register-arrow-cell" key={octaveGroup.label}>
                {isSelected ? (
                  <ArrowUp className="staff-game-wrong-note-register-arrow" size={14} />
                ) : null}
              </span>
            );
          })}
        </div>
        <div className="staff-game-wrong-note-register-keyboard">
          {PITCH_OCTAVE_GROUPS.map((octaveGroup) => {
            const isSelected = octaveGroup.pitchIds.includes(target.pitchId);
            return (
              <span
                className={`staff-game-wrong-note-register-octave${isSelected ? " is-selected" : ""}`}
                key={octaveGroup.label}
              >
                <span className="staff-game-wrong-note-register-white-keys">
                  {WHITE_KEYS.map((key) => (
                    <i
                      className={isSelected && selectedKey === key ? "is-current-note" : undefined}
                      key={`${octaveGroup.label}-${key}`}
                    />
                  ))}
                </span>
                {BLACK_KEYS.map(({ name, position }) => (
                  <i
                    className={`staff-game-wrong-note-register-black-key${isSelected && selectedKey === name ? " is-current-note" : ""}`}
                    key={`${octaveGroup.label}-${name}`}
                    style={{ left: `${(position / 7) * 100}%` }}
                  />
                ))}
              </span>
            );
          })}
        </div>
        <div className="staff-game-wrong-note-register-labels">
          {PITCH_OCTAVE_GROUPS.map((octaveGroup) => {
            const isSelected = octaveGroup.pitchIds.includes(target.pitchId);
            return (
              <span
                className={isSelected ? "is-selected" : ""}
                key={octaveGroup.label}
                title={octaveGroup.label}
              >
                {octaveGroup.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function StaffGameWrongNoteStudyDialog({
  archives,
  range,
  onChangeRange,
  onClose,
}: StaffGameWrongNoteStudyDialogProps): JSX.Element | null {
  const [activeTab, setActiveTab] = useState<StudyTab>("browse");
  const selectedRange = range;
  const [progress, setProgress] = useState(createStaffGameWrongNoteSelfTestProgress);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const browseItemRefs = useRef(new Map<number, HTMLLIElement>());
  const [activeBrowseMidi, setActiveBrowseMidi] = useState<number | null>(null);
  const items = useMemo(
    () => getStaffGameWrongNoteStudyItems(archives, selectedRange),
    [archives, selectedRange]
  );
  const currentItem = items[progress.index];
  const isComplete = isStaffGameWrongNoteSelfTestComplete(progress, items.length);
  const forgottenLabels = items
    .filter((item) => progress.forgottenMidis.includes(item.midi))
    .map((item) => item.label);

  const closeDialog = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    setProgress(createStaffGameWrongNoteSelfTestProgress());
    setActiveBrowseMidi(null);
  }, [range]);

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
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
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
  }, [closeDialog]);

  const playNote = (item: (typeof items)[number]): void => {
    playKeyboardNote(item.target);
  };

  const revealAnswer = (): void => {
    setProgress((current) => revealStaffGameWrongNoteSelfTestAnswer(current, items.length));
  };

  const changeRange = (nextRange: StaffGameWrongNoteRange): void => {
    onChangeRange(nextRange);
    setProgress(createStaffGameWrongNoteSelfTestProgress());
    setActiveBrowseMidi(null);
  };

  const rateCurrent = (remembered: boolean): void => {
    setProgress((current) => rateStaffGameWrongNoteSelfTestItem(current, items, remembered));
  };

  const scrollToBrowseItem = (midi: number): void => {
    setActiveBrowseMidi(midi);
    browseItemRefs.current.get(midi)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const emptyState = (
    <div className="staff-game-wrong-note-study-empty" role="status">
      <strong>暂无错题，先去闯关积累一些</strong>
    </div>
  );
  const rangeSelector = (
    <label className="staff-game-wrong-note-study-range">
      <span>复习范围</span>
      <select
        aria-label="错题复习弹窗时间范围"
        onChange={(event) =>
          changeRange(
            event.target.value === "all" ? "all" : (Number(event.target.value) as 3 | 7 | 15 | 30)
          )
        }
        value={selectedRange}
      >
        <option value={3}>近 3 天</option>
        <option value={7}>近 7 天</option>
        <option value={15}>近 15 天</option>
        <option value={30}>近 30 天</option>
        <option value="all">全部</option>
      </select>
    </label>
  );

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="staff-game-wrong-note-study-backdrop">
      <section
        aria-labelledby="staff-game-wrong-note-study-title"
        aria-modal="true"
        className="staff-game-wrong-note-study-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="staff-game-wrong-note-study-header">
          <h2 id="staff-game-wrong-note-study-title">错题复习</h2>
          <button
            aria-label="关闭错题复习"
            className="staff-game-wrong-note-study-close"
            onClick={closeDialog}
            ref={closeButtonRef}
            type="button"
          >
            <X aria-hidden="true" size={22} />
          </button>
          <div aria-label="复习方式" className="staff-game-wrong-note-study-tabs" role="tablist">
            <button
              aria-controls="staff-game-wrong-note-study-panel"
              aria-selected={activeTab === "browse"}
              className={activeTab === "browse" ? "is-active" : ""}
              id="staff-game-wrong-note-study-tab-browse"
              onClick={() => setActiveTab("browse")}
              role="tab"
              type="button"
            >
              浏览
            </button>
            <button
              aria-controls="staff-game-wrong-note-study-panel"
              aria-selected={activeTab === "self-test"}
              className={activeTab === "self-test" ? "is-active" : ""}
              id="staff-game-wrong-note-study-tab-self-test"
              onClick={() => setActiveTab("self-test")}
              role="tab"
              type="button"
            >
              自测
            </button>
          </div>
        </header>

        <div
          className={`staff-game-wrong-note-study-toolbar${activeTab === "browse" && items.length > 0 ? " has-overview" : ""}`}
        >
          {activeTab === "browse" && items.length > 0 ? (
            <nav aria-label="按错漏次数排序的错音总览" className="staff-game-wrong-note-overview">
              <div className="staff-game-wrong-note-overview-items">
                {items.map((item) => {
                  const isActive = activeBrowseMidi === item.midi;
                  return (
                    <button
                      aria-current={isActive ? "true" : undefined}
                      aria-label={`${item.label}，错漏 ${item.errorCount} 次，跳转到该音`}
                      className={`staff-game-wrong-note-overview-item${isActive ? " is-active" : ""}`}
                      key={item.midi}
                      onClick={() => scrollToBrowseItem(item.midi)}
                      type="button"
                    >
                      <span>{item.label}</span>
                      <small>{item.errorCount}</small>
                    </button>
                  );
                })}
              </div>
            </nav>
          ) : null}
          {rangeSelector}
        </div>

        <div
          aria-labelledby={`staff-game-wrong-note-study-tab-${activeTab === "browse" ? "browse" : "self-test"}`}
          className="staff-game-wrong-note-study-content"
          id="staff-game-wrong-note-study-panel"
          role="tabpanel"
          tabIndex={0}
        >
          {items.length === 0 ? (
            emptyState
          ) : activeTab === "browse" ? (
            <ol aria-label="按错漏次数排序的错题音" className="staff-game-wrong-note-study-list">
              {items.map((item) => (
                <li
                  className={`staff-game-wrong-note-study-item${activeBrowseMidi === item.midi ? " is-active" : ""}`}
                  key={item.midi}
                  ref={(element) => {
                    if (element) browseItemRefs.current.set(item.midi, element);
                    else browseItemRefs.current.delete(item.midi);
                  }}
                >
                  <div className="staff-game-wrong-note-study-item-header">
                    <strong>{item.label}</strong>
                    <span>错漏 {item.errorCount} 次</span>
                    <button
                      aria-label={`播放 ${item.label}`}
                      className="staff-game-wrong-note-study-play"
                      onClick={() => playNote(item)}
                      type="button"
                    >
                      <Volume2 aria-hidden="true" size={17} />
                      播放
                    </button>
                  </div>
                  <div className="staff-game-wrong-note-study-item-body">
                    <StaffPrompt
                      accessibleLabel={`${item.label} 的五线谱位置`}
                      compact
                      effectiveTargetNoteIds={EMPTY_TARGET_NOTE_IDS}
                      highlight
                      note={item.target}
                      noteDuration="quarter"
                      showAccidental
                      staffNotationMode={
                        item.target.staff === "treble" ? "treble-only" : "bass-only"
                      }
                      useLedgerGap={false}
                    />
                    <StaffGameWrongNoteKeyboardMap label={item.label} target={item.target} />
                  </div>
                </li>
              ))}
            </ol>
          ) : isComplete ? (
            <div className="staff-game-wrong-note-study-complete" role="status">
              <h3>自测完成</h3>
              <p>
                本轮记住：{progress.rememberedMidis.length} / {items.length}
              </p>
              <p>没记住的音：{forgottenLabels.length > 0 ? forgottenLabels.join("、") : "无"}</p>
              <div className="staff-game-wrong-note-study-actions">
                <button
                  className="staff-game-wrong-note-study-action is-primary"
                  onClick={() => setProgress(createStaffGameWrongNoteSelfTestProgress())}
                  type="button"
                >
                  再来一轮
                </button>
                <button
                  className="staff-game-wrong-note-study-action"
                  onClick={closeDialog}
                  type="button"
                >
                  退出
                </button>
              </div>
            </div>
          ) : currentItem ? (
            <div className="staff-game-wrong-note-self-test-card">
              <div className="staff-game-wrong-note-self-test-navigation">
                <button
                  aria-label="上一个音"
                  className="staff-game-wrong-note-self-test-nav-button"
                  disabled={progress.index === 0}
                  onClick={() =>
                    setProgress((current) =>
                      navigateStaffGameWrongNoteSelfTest(current, items.length, "previous")
                    )
                  }
                  type="button"
                >
                  <ChevronLeft aria-hidden="true" size={19} />
                </button>
                <p className="staff-game-wrong-note-self-test-count">
                  第 {progress.index + 1} / {items.length} 个
                </p>
                <button
                  aria-label="下一个音"
                  className="staff-game-wrong-note-self-test-nav-button"
                  disabled={progress.index >= items.length - 1}
                  onClick={() =>
                    setProgress((current) =>
                      navigateStaffGameWrongNoteSelfTest(current, items.length, "next")
                    )
                  }
                  type="button"
                >
                  <ChevronRight aria-hidden="true" size={19} />
                </button>
              </div>
              <div className="staff-game-wrong-note-self-test-body">
                <div className="staff-game-wrong-note-self-test-score">
                  <StaffPrompt
                    accessibleLabel="请辨认谱面上的音符"
                    compact
                    effectiveTargetNoteIds={EMPTY_TARGET_NOTE_IDS}
                    highlight
                    note={currentItem.target}
                    noteDuration="quarter"
                    showAccidental
                    staffNotationMode={
                      currentItem.target.staff === "treble" ? "treble-only" : "bass-only"
                    }
                    useLedgerGap={false}
                  />
                </div>
                <div className="staff-game-wrong-note-self-test-details">
                  {!progress.isAnswerRevealed ? (
                    <button
                      className="staff-game-wrong-note-study-action is-primary"
                      onClick={revealAnswer}
                      type="button"
                    >
                      查看答案
                    </button>
                  ) : (
                    <StaffGameWrongNoteKeyboardMap
                      label={currentItem.label}
                      target={currentItem.target}
                    />
                  )}
                  {progress.isAnswerRevealed ? (
                    <div className="staff-game-wrong-note-self-test-answer-row">
                      <div className="staff-game-wrong-note-self-test-answer">
                        <strong>{currentItem.label}</strong>
                        <button
                          aria-label={`播放 ${currentItem.label}`}
                          className="staff-game-wrong-note-study-play"
                          onClick={() => playNote(currentItem)}
                          type="button"
                        >
                          <Volume2 aria-hidden="true" size={17} />
                          播放
                        </button>
                      </div>
                      <button
                        className="staff-game-wrong-note-self-test-hide"
                        onClick={() =>
                          setProgress((current) => ({ ...current, isAnswerRevealed: false }))
                        }
                        type="button"
                      >
                        隐藏答案
                      </button>
                    </div>
                  ) : null}
                  <div className="staff-game-wrong-note-self-test-rating">
                    <button
                      className="staff-game-wrong-note-study-action is-known"
                      disabled={!progress.isAnswerRevealed}
                      onClick={() => rateCurrent(true)}
                      type="button"
                    >
                      <Check aria-hidden="true" size={18} />
                      记住了
                    </button>
                    <button
                      className="staff-game-wrong-note-study-action is-unknown"
                      disabled={!progress.isAnswerRevealed}
                      onClick={() => rateCurrent(false)}
                      type="button"
                    >
                      <X aria-hidden="true" size={18} />
                      没记住
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>,
    document.body
  );
}
