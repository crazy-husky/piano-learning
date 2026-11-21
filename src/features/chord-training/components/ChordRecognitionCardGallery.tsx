import { useEffect, useRef, useState } from "react";
import {
  PracticeSessionFrame,
  PracticeSessionHeader,
} from "../../practice/components/PracticeSessionFrame";
import {
  getChordDegreeLabel,
  getChordInversionLabel,
  getChordRecognitionCards,
  type ChordPrompt,
  type ChordRecognitionArrangement,
  type ChordTrainingConfig,
} from "../logic/chordTraining";
import { ChordStaffPrompt } from "./ChordStaffPrompt";

const ARRANGEMENT_LABELS: Record<Exclude<ChordRecognitionArrangement, "mixed">, string> = {
  block: "柱式和弦",
  arpeggio: "分解和弦",
};

function formatNoteName(note: ChordPrompt["notes"][number]): string {
  return `${note.letter}${note.accidental === 1 ? "♯" : note.accidental === -1 ? "♭" : ""}${note.octave}`;
}

function LazyChordNotation({ prompt }: { prompt: ChordPrompt }): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || isVisible) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "480px 0px" }
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [isVisible]);

  return (
    <div className="chord-recognition-card-score" ref={frameRef}>
      {isVisible ? (
        <ChordStaffPrompt compact highlightRoot prompt={prompt} />
      ) : (
        <div aria-hidden="true" className="chord-recognition-card-score-placeholder" />
      )}
    </div>
  );
}

export function ChordRecognitionCardGallery({
  config,
  onExit,
}: {
  config: ChordTrainingConfig;
  onExit: () => void;
}): JSX.Element {
  const galleryRef = useRef<HTMLElement | null>(null);
  const cards = getChordRecognitionCards(config);
  const arrangements: readonly Exclude<ChordRecognitionArrangement, "mixed">[] =
    config.recognitionArrangement === "mixed"
      ? ["block", "arpeggio"]
      : [config.recognitionArrangement];

  useEffect(() => {
    if (galleryRef.current) galleryRef.current.scrollTop = 0;
  }, []);

  return (
    <PracticeSessionFrame
      aria-label="和弦认和弦卡片展示"
      className="chord-training-run chord-recognition-card-gallery-shell"
      ref={galleryRef}
    >
      <div className="chord-recognition-card-gallery">
        <PracticeSessionHeader
          title="和弦训练 · 认和弦 · 卡片展示"
          progress={`${cards.length} 张卡片`}
          exitAriaLabel="返回和弦练习设置"
          exitLabel="返回设置"
          onExit={onExit}
          onPauseToggle={() => undefined}
          isPaused={false}
          showPauseAction={false}
        />
        <p className="chord-recognition-card-gallery-intro">
          已显示所选调性、级数、转位和根音基准音区的全部组合。卡片只供查看，不计时、不记录练习结果。
        </p>
        <div aria-label="和弦展示卡片" className="chord-recognition-card-list">
          {cards.map((card, index) => (
            <article
              aria-label={`${card.chord.name}，${getChordInversionLabel(card.inversion)}，根音基准音区 ${card.practiceGroupId}`}
              className="chord-recognition-card"
              key={card.id}
            >
              <header className="chord-recognition-card-heading">
                <span className="chord-recognition-card-title">
                  <span aria-hidden="true" className="chord-recognition-card-index">
                    {index + 1}
                  </span>
                  <span>{card.chord.name}</span>
                </span>
                <span className="chord-recognition-card-meta">
                  {getChordDegreeLabel(card.chord.degree)} 级 ·{" "}
                  {getChordInversionLabel(card.inversion)} · {card.practiceGroupId}
                </span>
              </header>
              <div
                className={`chord-recognition-card-arrangements${arrangements.length === 2 ? " is-mixed" : ""}`}
              >
                {arrangements.map((arrangement) => {
                  const prompt = arrangement === "block" ? card.blockPrompt : card.arpeggioPrompt;
                  return (
                    <section
                      aria-label={ARRANGEMENT_LABELS[arrangement]}
                      className="chord-recognition-card-arrangement"
                      key={arrangement}
                    >
                      <h3>{ARRANGEMENT_LABELS[arrangement]}</h3>
                      <LazyChordNotation prompt={prompt} />
                    </section>
                  );
                })}
              </div>
              <div aria-label="和弦组成音" className="chord-recognition-card-notes">
                {card.blockPrompt.notes.map((note) => {
                  const noteSpelling = `${note.letter}${note.accidental === 1 ? "♯" : note.accidental === -1 ? "♭" : ""}`;
                  return (
                    <span
                      className={noteSpelling === card.chord.rootName ? "is-root" : undefined}
                      key={`${note.letter}-${note.accidental}-${note.octave}`}
                    >
                      {formatNoteName(note)}
                    </span>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      </div>
    </PracticeSessionFrame>
  );
}
