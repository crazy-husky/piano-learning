import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { AnswerEvent } from "../../../domain/types";
import { ALL_NOTES } from "../../../domain/notes";
import { getTargetMidiNoteNumber } from "../../../domain/answerInput";
import { staffPosition } from "../../../domain/staffDistancePractice";
import type { LearningLevelId } from "../../../routing/appRoutes";
import {
  formatLearningNoteId,
  getAnswerDisplay,
  getIncorrectAnswerDisplays,
  type WeakPracticeItem,
} from "./learningStatsData";

function noteLabel(event: AnswerEvent): string {
  const exactNote = event.targetNoteId
    ? ALL_NOTES.find((note) => note.id === event.targetNoteId)
    : undefined;
  if (exactNote) return formatLearningNoteId(exactNote.id);
  const midi = event.targetMidi;
  if (midi !== undefined) {
    const note = ALL_NOTES.find((candidate) => getTargetMidiNoteNumber(candidate) === midi);
    return note ? formatLearningNoteId(note.id) : `MIDI ${midi}`;
  }
  return event.targetNoteId ?? event.targetDisplayName ?? event.targetNoteName ?? "目标音";
}

type StaffPromptNote = { midi: number; noteId?: string; staff?: "treble" | "bass" };
type LearningPracticeQuestion = {
  item: WeakPracticeItem;
  event: AnswerEvent | undefined;
  answer: string;
  notes: StaffPromptNote[];
};

function midiParts(midi: number): { letter: string; octave: number; accidental: string } {
  const pitchClass = ((midi % 12) + 12) % 12;
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const display = names[pitchClass] ?? "C";
  return {
    letter: display[0] ?? "C",
    accidental: display.length > 1 ? "♯" : "",
    octave: Math.floor(midi / 12) - 1,
  };
}

const KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

function keyLabelForMidi(midi: number, includeOctave: boolean): string {
  const keyName = KEY_NAMES[((midi % 12) + 12) % 12] ?? "C";
  return includeOctave ? `${keyName}${Math.floor(midi / 12) - 1}` : keyName;
}

function StaffPrompt({ notes }: { notes: StaffPromptNote[] }): JSX.Element {
  const visibleNotes = notes.slice(0, 8);
  return (
    <div aria-label="五线谱音符题目" className="learning-stats-staff-prompt">
      {visibleNotes.map(({ midi, noteId, staff }, index) => {
        const exactNote = noteId ? ALL_NOTES.find((note) => note.id === noteId) : undefined;
        const midiDisplay = midiParts(midi);
        const letter = exactNote?.noteName ?? midiDisplay.letter;
        const octave = exactNote?.octave ?? midiDisplay.octave;
        const accidental = exactNote ? "" : midiDisplay.accidental;
        const treble = exactNote
          ? exactNote.staff === "treble"
          : staff
            ? staff === "treble"
            : midi >= 60;
        const baseline = treble ? 30 : 18;
        const letterIndex = ["C", "D", "E", "F", "G", "A", "B"].indexOf(letter);
        const noteY = 65 + (baseline - (octave * 7 + letterIndex)) * 5;
        const clef = treble ? "𝄞" : "𝄢";
        const ledgerYs: number[] = [];
        for (let ledgerY = 15; ledgerY >= noteY; ledgerY -= 10) ledgerYs.push(ledgerY);
        for (let ledgerY = 75; ledgerY <= noteY; ledgerY += 10) ledgerYs.push(ledgerY);
        const viewBoxTop = Math.min(0, noteY - 18, ...ledgerYs);
        const viewBoxBottom = Math.max(82, noteY + 18, ...ledgerYs);
        return (
          <svg
            aria-hidden="true"
            key={index}
            viewBox={`0 ${viewBoxTop} 130 ${viewBoxBottom - viewBoxTop}`}
          >
            {[10, 20, 30, 40, 50].map((lineY) => (
              <line key={lineY} x1="10" x2="120" y1={lineY + 15} y2={lineY + 15} />
            ))}
            <text className="learning-stats-clef" x="18" y="53">
              {clef}
            </text>
            {ledgerYs.map((ledgerY) => (
              <line
                key={ledgerY}
                className="is-ledger"
                x1="79"
                x2="105"
                y1={ledgerY}
                y2={ledgerY}
              />
            ))}
            {accidental ? (
              <text className="learning-stats-accidental" x="69" y={noteY + 5}>
                {accidental}
              </text>
            ) : null}
            <ellipse cx="94" cy={noteY} rx="8" ry="5.5" transform={`rotate(-18 94 ${noteY})`} />
          </svg>
        );
      })}
    </div>
  );
}

function answerForEvent(event: AnswerEvent, levelId: LearningLevelId): string {
  if (levelId === 4) {
    if (event.staffDistance?.direction === "same") return "同音";
    const direction = event.staffDistance?.direction === "down" ? "向下" : "向上";
    return `${direction} ${event.staffDistance?.distance ?? "?"} 度`;
  }
  if (levelId === 6) {
    const noteIds = event.duetTargetNoteIds ?? [];
    const highIds = noteIds.filter(
      (id) => ALL_NOTES.find((note) => note.id === id)?.staff === "treble"
    );
    const lowIds = noteIds.filter(
      (id) => ALL_NOTES.find((note) => note.id === id)?.staff === "bass"
    );
    const midis = event.duetTargetMidis ?? {
      treble: event.targetMidiHigh === undefined ? [] : [event.targetMidiHigh],
      bass: event.targetMidiLow === undefined ? [] : [event.targetMidiLow],
    };
    if (highIds.length || lowIds.length || midis.treble.length || midis.bass.length) {
      const displayNoteId = (noteId: string): string => {
        const note = ALL_NOTES.find((candidate) => candidate.id === noteId);
        return note ? formatLearningNoteId(note.id) : noteId;
      };
      const getStaffNoteLabel = (midi: number, staff: "treble" | "bass"): string => {
        const note = ALL_NOTES.find(
          (candidate) => candidate.staff === staff && getTargetMidiNoteNumber(candidate) === midi
        );
        return note ? `${note.noteName}${note.octave}` : String(midi);
      };
      const high = highIds.length
        ? highIds.map(displayNoteId).join("、")
        : midis.treble.map((midi) => getStaffNoteLabel(midi, "treble")).join("、");
      const low = lowIds.length
        ? lowIds.map(displayNoteId).join("、")
        : midis.bass.map((midi) => getStaffNoteLabel(midi, "bass")).join("、");
      return `高音部 ${high || "—"}；低音部 ${low || "—"}`;
    }
  }
  if (
    levelId === 3 &&
    event.mode === "name-to-key" &&
    !event.nameToKeyConfig?.includeOctaveNumbers
  ) {
    return event.targetMidi === undefined
      ? (event.targetDisplayName ?? event.targetNoteName ?? noteLabel(event))
      : keyLabelForMidi(event.targetMidi, false);
  }
  if (levelId === 3 && event.mode === "name-to-key" && event.targetMidi !== undefined) {
    return keyLabelForMidi(event.targetMidi, true);
  }
  return noteLabel(event);
}

function questionTitle(event: AnswerEvent, levelId: LearningLevelId): string {
  if (levelId === 3 && event.mode === "name-to-key")
    return `找到音名 ${event.targetDisplayName ?? noteLabel(event)} 对应的琴键`;
  if (levelId === 4) return "判断相邻音的方向和距离";
  if (levelId === 5)
    return `根据提前 ${event.preReadingBufferSize ?? "?"} 个音的谱面，回忆下一个目标音`;
  if (levelId === 6) return "识别这组双手目标音";
  return "看谱识别目标音";
}

function optionsForEvent(
  event: AnswerEvent,
  levelId: LearningLevelId,
  controls: AnswerEvent[]
): string[] {
  const correct = answerForEvent(event, levelId);
  const compatibleControls =
    levelId === 3
      ? controls.filter(
          (candidate) =>
            candidate.mode === event.mode &&
            (event.mode !== "name-to-key" ||
              Boolean(candidate.nameToKeyConfig?.includeOctaveNumbers) ===
                Boolean(event.nameToKeyConfig?.includeOctaveNumbers))
        )
      : controls;
  const alternatives = compatibleControls
    .map((candidate) => answerForEvent(candidate, levelId))
    .filter((option) => option !== correct);
  if (levelId === 4) {
    for (const direction of ["向上", "向下"]) {
      for (let distance = 1; distance <= 8; distance += 1) {
        const candidate = `${direction} ${distance} 度`;
        if (candidate !== correct) alternatives.push(candidate);
      }
    }
  }
  if (levelId === 6) {
    alternatives.push("高音部 C5；低音部 C3", "高音部 G4；低音部 G2", "高音部 E5；低音部 C3");
  }
  if (
    levelId === 3 &&
    event.mode === "name-to-key" &&
    !event.nameToKeyConfig?.includeOctaveNumbers
  ) {
    alternatives.push(...KEY_NAMES);
  } else if (levelId === 3 && event.mode === "name-to-key") {
    if (event.targetMidi !== undefined) {
      const nearbyMidis = Array.from({ length: 67 }, (_, index) => index + 29)
        .filter((midi) => midi !== event.targetMidi)
        .sort(
          (left, right) => Math.abs(left - event.targetMidi!) - Math.abs(right - event.targetMidi!)
        );
      alternatives.push(...nearbyMidis.map((midi) => keyLabelForMidi(midi, true)));
    }
  } else if (levelId !== 4 && levelId !== 6) {
    alternatives.push(...ALL_NOTES.map((note) => formatLearningNoteId(note.id)));
  }
  const unique = [...new Set([correct, ...alternatives])];
  const distractors = unique.filter((option) => option !== correct).slice(0, 3);
  const options = [correct, ...distractors];
  const shift = event.eventIndex % Math.max(1, options.length);
  return [...options.slice(shift), ...options.slice(0, shift)];
}

function promptNotesForEvent(
  event: AnswerEvent,
  levelId: LearningLevelId,
  contextEvents: AnswerEvent[]
): StaffPromptNote[] {
  if (levelId === 3 && event.mode === "name-to-key") return [];
  if (levelId === 4 && event.targetMidi !== undefined && event.staffDistance) {
    const target =
      ALL_NOTES.find((note) => note.id === event.targetNoteId) ??
      ALL_NOTES.find((note) => getTargetMidiNoteNumber(note) === event.targetMidi);
    if (target) {
      const delta =
        event.staffDistance.direction === "up"
          ? event.staffDistance.distance
          : event.staffDistance.direction === "down"
            ? -event.staffDistance.distance
            : 0;
      const sourcePosition = staffPosition(target) - delta;
      const source = ALL_NOTES.find(
        (note) => note.staff === target.staff && staffPosition(note) === sourcePosition
      );
      if (source) {
        return [
          { midi: getTargetMidiNoteNumber(source), noteId: source.id },
          { midi: event.targetMidi, noteId: target.id },
        ];
      }
    }
  }
  if (levelId === 5) {
    const bufferSize = event.preReadingBufferSize ?? 1;
    return contextEvents
      .filter(
        (candidate) =>
          candidate.sessionId === event.sessionId &&
          candidate.mode === "pre-reading" &&
          candidate.preReadingBufferSize === event.preReadingBufferSize &&
          candidate.eventIndex < event.eventIndex
      )
      .sort((left, right) => left.eventIndex - right.eventIndex)
      .slice(-bufferSize)
      .flatMap((candidate) =>
        candidate.targetMidi === undefined
          ? []
          : [
              {
                midi: candidate.targetMidi,
                ...(candidate.targetNoteId ? { noteId: candidate.targetNoteId } : {}),
              },
            ]
      );
  }
  if (levelId === 6) {
    const noteIds = event.duetTargetNoteIds ?? [];
    if (noteIds.length) {
      return noteIds.flatMap((noteId) => {
        const note = ALL_NOTES.find((candidate) => candidate.id === noteId);
        return note ? [{ midi: getTargetMidiNoteNumber(note), noteId }] : [];
      });
    }
    const duet = event.duetTargetMidis;
    if (duet) {
      return [
        ...duet.treble.map((midi) => {
          const note = ALL_NOTES.find(
            (candidate) =>
              candidate.staff === "treble" && getTargetMidiNoteNumber(candidate) === midi
          );
          return { midi, staff: "treble" as const, ...(note ? { noteId: note.id } : {}) };
        }),
        ...duet.bass.map((midi) => {
          const note = ALL_NOTES.find(
            (candidate) => candidate.staff === "bass" && getTargetMidiNoteNumber(candidate) === midi
          );
          return { midi, staff: "bass" as const, ...(note ? { noteId: note.id } : {}) };
        }),
      ];
    }
    const noteAtStaff = (midi: number, staff: "treble" | "bass"): StaffPromptNote => {
      const note = ALL_NOTES.find(
        (candidate) => candidate.staff === staff && getTargetMidiNoteNumber(candidate) === midi
      );
      return { midi, staff, ...(note ? { noteId: note.id } : {}) };
    };
    return [
      ...(event.targetMidiHigh === undefined ? [] : [noteAtStaff(event.targetMidiHigh, "treble")]),
      ...(event.targetMidiLow === undefined ? [] : [noteAtStaff(event.targetMidiLow, "bass")]),
      ...(event.targetMidi === undefined
        ? []
        : [{ midi: event.targetMidi, noteId: event.targetNoteId }]),
    ];
  }
  if (event.targetMidi !== undefined) {
    return [
      { midi: event.targetMidi, ...(event.targetNoteId ? { noteId: event.targetNoteId } : {}) },
    ];
  }
  if (event.targetNoteId) {
    const note = ALL_NOTES.find((candidate) => candidate.id === event.targetNoteId);
    if (note) return [{ midi: getTargetMidiNoteNumber(note), noteId: note.id }];
  }
  return [];
}

export function LearningPracticeDialog({
  controls,
  controlNoteIds = [],
  controlItems = [],
  contextEvents = [],
  items,
  levelId,
  mode,
  onClose,
}: {
  controls: AnswerEvent[];
  controlNoteIds?: string[];
  controlItems?: WeakPracticeItem[];
  contextEvents?: AnswerEvent[];
  items: WeakPracticeItem[];
  levelId: LearningLevelId;
  mode: "review" | "test";
  onClose: () => void;
}): JSX.Element | null {
  const questionItems = useMemo<LearningPracticeQuestion[]>(() => {
    const selectedItems =
      mode === "test"
        ? items.flatMap((item, itemIndex) =>
            [item, controlItems[itemIndex]].filter((value): value is WeakPracticeItem =>
              Boolean(value)
            )
          )
        : items;
    return selectedItems.flatMap<LearningPracticeQuestion>((item) => {
      if (item.event) {
        return [
          {
            item,
            event: item.event,
            answer: answerForEvent(item.event, levelId),
            notes: promptNotesForEvent(item.event, levelId, contextEvents),
          },
        ];
      }
      return item.noteIds.map((noteId) => ({
        item,
        event: undefined,
        answer: formatLearningNoteId(noteId),
        notes: ALL_NOTES.filter((note) => note.id === noteId).map((note) => ({
          midi: getTargetMidiNoteNumber(note),
          noteId: note.id,
        })),
      }));
    });
  }, [contextEvents, controlItems, items, levelId, mode]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const finished = index >= questionItems.length;
  const question = questionItems[index];
  const event = question?.event;
  const correctAnswer = question?.answer ?? "";
  const options = question
    ? event
      ? optionsForEvent(event, levelId, controls)
      : [
          ...new Set([
            correctAnswer,
            ...controlNoteIds.map(formatLearningNoteId),
            ...question.item.noteIds
              .map(formatLearningNoteId)
              .filter((noteId) => noteId !== correctAnswer),
          ]),
        ].slice(0, 4)
    : [];
  const targetNotes = question?.notes ?? [];
  if (finished) {
    return (
      <div className="learning-stats-dialog-backdrop" role="presentation">
        <button
          aria-label="关闭错题练习"
          className="learning-stats-dialog-backdrop-dismiss"
          onClick={onClose}
          type="button"
        />
        <section
          aria-labelledby="learning-stats-dialog-title"
          aria-modal="true"
          className="learning-stats-dialog"
          role="dialog"
        >
          <header>
            <h2 id="learning-stats-dialog-title">
              {mode === "test" ? "自测完成" : "错题复习完成"}
            </h2>
            <button aria-label="关闭" onClick={onClose} type="button">
              <X size={18} />
            </button>
          </header>
          {mode === "test" ? (
            <p className="learning-stats-test-score">
              {correctCount} / {questionItems.length} 题答对
            </p>
          ) : null}
          {mode === "test" ? (
            <p>本次以薄弱项为主，并混入已答对的目标；结果不计入正式统计和本关毕业进度。</p>
          ) : null}
          <button className="primary" onClick={onClose} type="button">
            返回统计
          </button>
        </section>
      </div>
    );
  }
  if (!question) return null;
  const next = (): void => {
    if (mode === "test" && selected === correctAnswer) setCorrectCount((count) => count + 1);
    setSelected(null);
    setIndex((current) => current + 1);
  };
  return (
    <div className="learning-stats-dialog-backdrop" role="presentation">
      <button
        aria-label="关闭错题练习"
        className="learning-stats-dialog-backdrop-dismiss"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="learning-stats-dialog-title"
        aria-modal="true"
        className="learning-stats-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span>
              {mode === "review" ? "错题复习" : "错题自测"} · {index + 1}/{questionItems.length}
            </span>
            <h2 id="learning-stats-dialog-title">
              {event ? questionTitle(event, levelId) : `认出 ${question.item.title} 对应的琴键`}
            </h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        {targetNotes.length ? (
          <StaffPrompt notes={targetNotes} />
        ) : (
          <p className="learning-stats-dialog-prompt">
            {levelId === 5 && event
              ? "本轮没有可回看的前置预读音"
              : (event?.targetDisplayName ?? event?.targetNoteId ?? question.item.title)}
          </p>
        )}
        {levelId === 5 && targetNotes.length ? (
          <p className="learning-stats-dialog-context">
            上方是当前题前面的预读音，选出接下来的目标音。
          </p>
        ) : null}
        {mode === "review" ? (
          <div className="learning-stats-answer-reveal">
            <p>
              正确答案：<strong>{correctAnswer}</strong>
            </p>
            {event ? (
              <p>上次作答：{getAnswerDisplay(event)}</p>
            ) : (
              <p>估算识别用时：{Math.round(question.item.averageMs ?? 0)} 毫秒</p>
            )}
            <button className="primary" onClick={next} type="button">
              下一题
            </button>
          </div>
        ) : (
          <>
            <div aria-label="选择答案" className="learning-stats-answer-options">
              {options.map((option) => (
                <button
                  aria-pressed={selected === option}
                  className={selected === option ? "is-selected" : ""}
                  key={option}
                  onClick={() => setSelected(option)}
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>
            {selected ? (
              <p
                aria-live="polite"
                className={selected === correctAnswer ? "is-correct" : "is-incorrect"}
              >
                {selected === correctAnswer ? "答对了" : `再看一下：答案是 ${correctAnswer}`}
              </p>
            ) : null}
            <button className="primary" disabled={!selected} onClick={next} type="button">
              {index + 1 === questionItems.length ? "完成自测" : "下一题"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

export function LearningWeakDetailsDialog({
  contextEvents,
  item,
  levelId,
  onClose,
}: {
  contextEvents: AnswerEvent[];
  item: WeakPracticeItem;
  levelId: LearningLevelId;
  onClose: () => void;
}): JSX.Element {
  const history = useMemo(
    () =>
      [...(item.events ?? (item.event ? [item.event] : []))].sort((left, right) =>
        right.occurredAt.localeCompare(left.occurredAt)
      ),
    [item]
  );
  const latestEvent = history[0];
  const promptNotes = latestEvent
    ? promptNotesForEvent(latestEvent, levelId, contextEvents)
    : item.noteIds.flatMap((noteId) => {
        const note = ALL_NOTES.find((candidate) => candidate.id === noteId);
        return note ? [{ midi: getTargetMidiNoteNumber(note), noteId: note.id }] : [];
      });
  const correctAnswer = latestEvent ? answerForEvent(latestEvent, levelId) : item.title;
  const isNameToKey = latestEvent?.mode === "name-to-key";
  const latestPromptDescription = latestEvent
    ? questionTitle(latestEvent, levelId)
    : "本关识谱回忆中的待巩固音";

  return (
    <div className="learning-stats-dialog-backdrop" role="presentation">
      <button
        aria-label="关闭错题详情"
        className="learning-stats-dialog-backdrop-dismiss"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="learning-stats-weak-details-title"
        aria-modal="true"
        className="learning-stats-dialog learning-stats-weak-details"
        role="dialog"
      >
        <header>
          <div>
            <span>
              {item.subtitle} · {item.count}
              {levelId === 1 ? " 次回忆" : " 次错题"}
            </span>
            <h2 id="learning-stats-weak-details-title">{item.title}</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        <section className="learning-stats-weak-detail-section">
          <h3>最近一次题目</h3>
          <p className="learning-stats-dialog-context">{latestPromptDescription}</p>
          {promptNotes.length ? (
            <StaffPrompt notes={promptNotes} />
          ) : (
            <p className="learning-stats-dialog-prompt">
              {isNameToKey && latestEvent
                ? `找到音名 ${latestEvent.targetDisplayName ?? noteLabel(latestEvent)} 对应的琴键`
                : (latestEvent?.targetDisplayName ?? latestEvent?.targetNoteId ?? item.title)}
            </p>
          )}
          {levelId === 5 && promptNotes.length ? (
            <p className="learning-stats-dialog-context">
              上方是当时呈现的预读谱面；当前目标音为 {correctAnswer}。
            </p>
          ) : null}
          <dl className="learning-stats-weak-answer">
            <div>
              <dt>标准答案</dt>
              <dd>{correctAnswer}</dd>
            </div>
            {latestEvent ? (
              <div>
                <dt>最近错误作答</dt>
                <dd>{getIncorrectAnswerDisplays(latestEvent).join("、")}</dd>
              </div>
            ) : null}
            {!latestEvent ? (
              <div>
                <dt>平均识别用时</dt>
                <dd>{Math.round(item.averageMs ?? 0)} 毫秒</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="learning-stats-weak-detail-section">
          <h3>最近作答记录</h3>
          {history.length ? (
            <ol className="learning-stats-weak-history">
              {history.slice(0, 10).map((event) => (
                <li key={event.id}>
                  <time dateTime={event.occurredAt}>
                    {new Date(event.occurredAt).toLocaleString()}
                  </time>
                  <span>作答：{getIncorrectAnswerDisplays(event).join("、")}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="learning-stats-dialog-context">
              回忆记录只保存音区累计用时，没有逐题对错数据。
            </p>
          )}
          {history.length > 10 ? (
            <p className="learning-stats-dialog-context">
              这里只显示最近 10 次；该项共记录 {history.length} 次。
            </p>
          ) : null}
        </section>

        <button className="secondary" onClick={onClose} type="button">
          返回薄弱记录
        </button>
      </section>
    </div>
  );
}
