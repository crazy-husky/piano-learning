import { BarlineType, Formatter, Renderer, Stave, StaveConnector, StaveNote, Voice } from "vexflow";
import { useEffect, useRef } from "react";
import { getPageThemeColor, useNightMode } from "../../../shared/appearance/pageAppearance";
import {
  getChordMajorKey,
  getVexChordNoteKey,
  type ChordArpeggioPatternId,
  type ChordNoteDuration,
  type ChordPrompt,
} from "../logic/chordTraining";

type ChordScoreEventFeedback = "correct" | "early" | "late" | "wrong" | "missed";

const ARPEGGIO_PATTERN_LABELS: Record<ChordArpeggioPatternId, string> = {
  "ascending-return": "上行往返型",
  "broken-block-ending": "分解加柱式收尾",
  "pop-loop": "流行循环型",
};

const NOTE_DURATION_LABELS: Record<ChordNoteDuration, string> = {
  "8": "八分音符",
  q: "四分音符",
  h: "二分音符",
  w: "全音符",
};

function getStaffPromptLabel(prompt: ChordPrompt, highlightRoot: boolean): string {
  const patternLabel = prompt.arpeggioPatternId
    ? `，${ARPEGGIO_PATTERN_LABELS[prompt.arpeggioPatternId]}`
    : "";
  const eventLabels = prompt.noteEvents.map(({ notes, duration }) => {
    const noteNames = notes
      .map(
        ({ letter, accidental, octave }) =>
          `${letter}${accidental === 1 ? "升" : accidental === -1 ? "降" : ""}${octave}`
      )
      .join("、");
    const onsetLabel = notes.length > 1 ? `同时弹奏 ${noteNames}` : noteNames;
    return `${onsetLabel}，${NOTE_DURATION_LABELS[duration]}`;
  });
  return `五线谱和弦题目${patternLabel}。${highlightRoot ? "蓝色音符表示根音。" : ""}起音顺序：${eventLabels.join("；")}`;
}

export function ChordStaffPrompt({
  prompt,
  highlightRoot = true,
  activeEventIndex = 0,
  eventFeedback = [],
}: {
  prompt: ChordPrompt;
  highlightRoot?: boolean;
  activeEventIndex?: number;
  eventFeedback?: readonly (ChordScoreEventFeedback | undefined)[];
}): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const isNightMode = useNightMode();

  useEffect(() => {
    const frame = frameRef.current;
    const target = targetRef.current;
    if (!frame || !target) return undefined;

    const render = (): void => {
      target.innerHTML = "";
      const width = Math.max(440, frame.clientWidth || 720);
      const height = 210;
      const renderer = new Renderer(target, Renderer.Backends.SVG);
      renderer.resize(width, height);
      const context = renderer.getContext();
      context.setFillStyle(getPageThemeColor("--notation-ink", "#211c18"));
      context.setStrokeStyle(getPageThemeColor("--notation-staff", "#766b5f"));

      const keySignature = getChordMajorKey(prompt.chord.keyId).vexKey;
      const treble = new Stave(18, 24, width - 36).addClef("treble").addKeySignature(keySignature);
      const bass = new Stave(18, 112, width - 36).addClef("bass").addKeySignature(keySignature);
      treble.setEndBarType(BarlineType.NONE);
      bass.setEndBarType(BarlineType.NONE);
      treble.setContext(context).draw();
      bass.setContext(context).draw();
      new StaveConnector(treble, bass).setType("brace").setContext(context).draw();
      new StaveConnector(treble, bass).setType("singleLeft").setContext(context).draw();
      new StaveConnector(treble, bass).setType("singleRight").setContext(context).draw();

      const clef = (prompt.notes[0]?.midi ?? 60) < 60 ? "bass" : "treble";
      const targetStave = clef === "bass" ? bass : treble;
      const ink = getPageThemeColor("--notation-ink", "#211c18");
      const rootInk = getPageThemeColor("--notation-root", "#1769aa");
      const activeInk = getPageThemeColor("--notation-active", "#256f67");
      const scoreNotes = prompt.noteEvents.map(({ notes, duration }, eventIndex) => {
        const scoreNote = new StaveNote({
          clef,
          duration,
          keys: notes.map(getVexChordNoteKey),
        }).setStave(targetStave);
        const eventState = eventFeedback[eventIndex];
        const eventInk =
          eventState === "wrong" || eventState === "missed"
            ? getPageThemeColor("--notation-error", "#c84c3d")
            : eventState === "early" || eventState === "late"
              ? getPageThemeColor("--warning", "#d88c24")
              : eventState === "correct"
                ? getPageThemeColor("--notation-correct", "#2f8f5f")
                : undefined;
        scoreNote.setStyle({ fillStyle: eventInk ?? ink, strokeStyle: eventInk ?? ink });
        notes.forEach((note, index) => {
          const isRoot =
            highlightRoot &&
            `${note.letter}${note.accidental === 1 ? "♯" : note.accidental === -1 ? "♭" : ""}` ===
              prompt.chord.rootName;
          const keyInk =
            eventInk ?? (isRoot ? rootInk : eventIndex === activeEventIndex ? activeInk : ink);
          scoreNote.setKeyStyle(index, { fillStyle: keyInk, strokeStyle: keyInk });
        });
        scoreNote.setLedgerLineStyle({ fillStyle: ink, strokeStyle: ink });
        return scoreNote;
      });
      const voice = new Voice({ numBeats: 4, beatValue: 4 })
        .setMode(Voice.Mode.SOFT)
        .addTickables(scoreNotes);
      new Formatter().joinVoices([voice]).format([voice], Math.max(1, width - 180), { context });
      voice.draw(context, targetStave);
      const svg = target.querySelector("svg");
      if (svg) {
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        svg.style.width = "100%";
        svg.style.height = "auto";
      }
    };

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [activeEventIndex, eventFeedback, highlightRoot, isNightMode, prompt]);

  return (
    <div
      aria-label={getStaffPromptLabel(prompt, highlightRoot)}
      className="chord-staff-frame"
      ref={frameRef}
      role="img"
    >
      <div className="chord-staff-renderer" ref={targetRef} />
    </div>
  );
}
