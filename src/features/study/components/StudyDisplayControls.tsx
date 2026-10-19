export const STUDY_COLUMN_ORDER_OPTIONS = [
  { id: "circle", label: "五度圈", legacySequence: "4152637" },
  { id: "scale", label: "音阶顺序", legacySequence: "1234567" },
  { id: "thirds", label: "三度跳进", legacySequence: "1357246" },
  { id: "random", label: "随机" },
] as const;

export type StudyColumnOrderId = (typeof STUDY_COLUMN_ORDER_OPTIONS)[number]["id"];

interface StudyDisplayControlsProps {
  columnOrderId: StudyColumnOrderId;
  disabled?: boolean;
  isColumnOrderReversed: boolean;
  label: string;
  onColumnOrderChange?: (columnOrderId: StudyColumnOrderId) => void;
  onColumnOrderReversedChange?: (isReversed: boolean) => void;
  onShowLabelsChange?: (showLabels: boolean) => void;
  showLabelsControl?: boolean;
  showLabels: boolean;
}

export function StudyDisplayControls({
  columnOrderId,
  disabled = false,
  isColumnOrderReversed,
  label,
  onColumnOrderChange,
  onColumnOrderReversedChange,
  onShowLabelsChange,
  showLabelsControl = true,
  showLabels,
}: StudyDisplayControlsProps): JSX.Element {
  return (
    <div
      className={disabled ? "study-controls staff-recall-readonly-controls" : "study-controls"}
      aria-label={label}
    >
      <div className="study-control-block">
        <span className="control-label">顺序</span>
        <div className="segmented study-order-options">
          {STUDY_COLUMN_ORDER_OPTIONS.map((option) => (
            <button
              className={columnOrderId === option.id ? "active" : ""}
              disabled={disabled}
              key={option.id}
              onClick={() => onColumnOrderChange?.(option.id)}
              type="button"
            >
              <span
                title={
                  "legacySequence" in option
                    ? `${option.label}（${option.legacySequence}）`
                    : undefined
                }
              >
                {option.label}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="study-display-side-controls">
        <div className="study-control-block">
          <span className="control-label">方向</span>
          <div className="segmented study-direction-options">
            <button
              className={!isColumnOrderReversed ? "active" : ""}
              disabled={disabled}
              onClick={() => onColumnOrderReversedChange?.(false)}
              type="button"
            >
              正向
            </button>
            <button
              className={isColumnOrderReversed ? "active" : ""}
              disabled={disabled}
              onClick={() => onColumnOrderReversedChange?.(true)}
              type="button"
            >
              反向
            </button>
          </div>
        </div>
        {showLabelsControl ? (
          <div className="study-control-block">
            <span className="control-label">标签</span>
            <div className="segmented study-label-options">
              <button
                className={showLabels ? "active" : ""}
                disabled={disabled}
                onClick={() => onShowLabelsChange?.(true)}
                type="button"
              >
                显示
              </button>
              <button
                className={!showLabels ? "active" : ""}
                disabled={disabled}
                onClick={() => onShowLabelsChange?.(false)}
                type="button"
              >
                隐藏
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
