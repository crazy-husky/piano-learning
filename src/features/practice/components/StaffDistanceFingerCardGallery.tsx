import type {
  StaffDistanceFingerHand,
  StaffDistanceFingerNumber,
  TargetNote,
} from "../../../domain/types";
import type { StaffDistanceFingerCard } from "../../../domain/staffDistanceFinger";
import { staffPosition } from "../../../domain/staffDistancePractice";
import { PracticeSessionFrame, PracticeSessionHeader } from "./PracticeSessionFrame";
import { StaffPagePrompt } from "./StaffPagePrompt";
import { PRACTICE_STAFF_REFERENCE_NOTE_COLUMN_WIDTH_PX } from "../../../shared/staff/staffLayoutProfiles";
import { PRACTICE_PAGE_STAFF_LAYOUT } from "../../../shared/staff/staffLayoutProfiles";

interface StaffDistanceFingerCardGalleryProps {
  cards: readonly StaffDistanceFingerCard[];
  fingerHand: StaffDistanceFingerHand;
  fingerNumber: StaffDistanceFingerNumber;
  onExit: () => void;
}

function getShiftAnswer(reference: TargetNote, target: TargetNote): string {
  const distance = staffPosition(target) - staffPosition(reference);
  if (distance === 0) return "手位不移动";
  return `手位${distance > 0 ? "右" : "左"}移 ${Math.abs(distance)} 格`;
}

export function StaffDistanceFingerCardGallery({
  cards,
  fingerHand,
  fingerNumber,
  onExit,
}: StaffDistanceFingerCardGalleryProps): JSX.Element {
  const handLabel = fingerHand === "right" ? "右手" : "左手";
  const clefLabel = fingerHand === "right" ? "高音谱" : "低音谱";
  const notationMode = fingerHand === "right" ? "treble-only" : "bass-only";

  return (
    <PracticeSessionFrame
      aria-label="音距速推单指专项卡片展示"
      className="staff-distance-run-shell staff-distance-finger-gallery-run"
    >
      <div
        aria-label={`${handLabel}${fingerNumber}指移动卡片`}
        className="staff-distance-finger-gallery"
      >
        <PracticeSessionHeader
          title="音距速推 · 单指专项 · 卡片展示"
          progress={`${cards.length} 张卡片`}
          exitAriaLabel="返回单指专项设置"
          exitLabel="返回设置"
          onExit={onExit}
          onPauseToggle={() => undefined}
          isPaused={false}
          showPauseAction={false}
        />
        <p className="staff-distance-finger-gallery-intro">
          按参考音和目标音判断手位移动方向。答案直接显示在每张卡片下方。
        </p>
        {cards.map((card, index) => {
          const notes = [card.reference, card.target];
          const cardLabel = `${handLabel}${fingerNumber}指，第${index + 1}张，${card.batch === "line" ? "线上" : "间上"}参考音`;
          return (
            <article
              aria-label={cardLabel}
              className="staff-distance-finger-gallery-card"
              key={`${card.batch}-${card.target.pitchId}`}
            >
              <header className="staff-distance-finger-gallery-card-heading">
                <span className="staff-distance-finger-gallery-card-heading-main">
                  <span aria-hidden="true" className="staff-distance-finger-gallery-card-index">
                    {index + 1}
                  </span>
                  <span>
                    {clefLabel} · {card.batch === "line" ? "线上参考音" : "间上参考音"}
                  </span>
                </span>
                <span>
                  {handLabel} · {fingerNumber} 指
                </span>
              </header>
              <div className="staff-distance-finger-gallery-score">
                <StaffPagePrompt
                  notes={notes}
                  completedCount={0}
                  noteDuration="quarter"
                  noteDurations={["quarter", "quarter"]}
                  noteMeasures={[0, 0]}
                  noteOnsets={[0, 1]}
                  noteBeamGroups={[0, 1]}
                  noteLabelsAbove={[`${fingerNumber}指`, undefined]}
                  noteLabelsAboveStaffTopLinePx={44}
                  staffNotationMode={notationMode}
                  useLedgerGap={false}
                  layout={{
                    ...PRACTICE_PAGE_STAFF_LAYOUT,
                    notationScale: 1.12,
                    vertical: {
                      ...PRACTICE_PAGE_STAFF_LAYOUT.vertical,
                      trebleOnlyYPx: 0,
                      bassOnlyYPx: 0,
                      viewHeightPx: 150,
                    },
                  }}
                  noteCenterGapPx={PRACTICE_STAFF_REFERENCE_NOTE_COLUMN_WIDTH_PX * 1.5}
                  notesPerRow={2}
                  maxRowCount={1}
                  visibleRowCount={1}
                  minDisplayWidthPx={0}
                />
              </div>
              <p className="staff-distance-finger-gallery-answer">
                {getShiftAnswer(card.reference, card.target)}
              </p>
            </article>
          );
        })}
      </div>
    </PracticeSessionFrame>
  );
}
