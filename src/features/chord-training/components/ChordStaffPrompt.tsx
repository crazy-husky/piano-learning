import { BarlineType, Formatter, Renderer, Stave, StaveConnector, StaveNote, Voice } from "vexflow";
import { useEffect, useRef } from "react";
import { getPageThemeColor, useNightMode } from "../../../shared/appearance/pageAppearance";
import {
  alignStaveNotesToCenters,
  getEvenlySpacedCenters,
} from "../../../shared/staff/staffGeometry";
import { getChordMajorKey, getVexChordNoteKey, type ChordPrompt } from "../logic/chordTraining";

export function ChordStaffPrompt({ prompt }: { prompt: ChordPrompt }): JSX.Element {
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
      const chord = new StaveNote({
        clef,
        duration: prompt.noteDuration,
        keys: prompt.notes.map(getVexChordNoteKey),
      }).setStave(targetStave);
      const ink = getPageThemeColor("--notation-ink", "#211c18");
      chord.setStyle({ fillStyle: ink, strokeStyle: ink });
      const rootInk = getPageThemeColor("--notation-error", "#c84c3d");
      prompt.notes.forEach((note, index) => {
        if (
          `${note.letter}${note.accidental === 1 ? "♯" : note.accidental === -1 ? "♭" : ""}` ===
          prompt.chord.rootName
        ) {
          chord.setKeyStyle(index, { fillStyle: rootInk, strokeStyle: rootInk });
        }
      });
      chord.setLedgerLineStyle({ fillStyle: ink, strokeStyle: ink });
      const voice = new Voice({ numBeats: 4, beatValue: 4 })
        .setMode(Voice.Mode.SOFT)
        .addTickables([chord]);
      new Formatter().joinVoices([voice]).format([voice], Math.max(1, width - 180), { context });
      alignStaveNotesToCenters(
        [chord],
        getEvenlySpacedCenters(1, targetStave.getX(), targetStave.getX() + targetStave.getWidth())
      );
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
  }, [isNightMode, prompt]);

  return (
    <div aria-label="五线谱和弦题目" className="chord-staff-frame" ref={frameRef} role="img">
      <div className="chord-staff-renderer" ref={targetRef} />
    </div>
  );
}
