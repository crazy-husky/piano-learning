import { RotateCcw, SlidersHorizontal } from "lucide-react";
import type { AnswerEvent } from "../../../domain/types";
import type { ChordTask } from "../logic/chordTraining";

function taskLabel(task: ChordTask): string {
  return task === "recognize" ? "认和弦" : task === "block" ? "柱式和弦" : "分解和弦";
}

export function ChordTrainingSummary({
  completed,
  elapsedMs,
  events,
  saved,
  task,
  onReturnToSetup,
}: {
  completed: boolean;
  elapsedMs: number;
  events: AnswerEvent[];
  saved: boolean;
  task: ChordTask;
  onReturnToSetup: () => void;
}): JSX.Element {
  const firstTryCorrect = events.filter((event) => event.isCorrectFirstTry === true).length;
  const accuracy = events.length === 0 ? 0 : Math.round((firstTryCorrect / events.length) * 100);
  const minutes = Math.floor(elapsedMs / 60_000);
  const seconds = Math.floor((elapsedMs % 60_000) / 1000);

  return (
    <section aria-labelledby="chord-training-summary-title" className="chord-training-summary">
      <span className="chord-training-kicker">{taskLabel(task)} · 本次结果</span>
      <h2 id="chord-training-summary-title">{completed ? "练习完成" : "练习提前结束"}</h2>
      <p className="chord-training-summary-message">
        {saved
          ? "本轮已计入和弦训练统计。"
          : completed && events.length === 0
            ? "本轮没有完成题目，暂无练习记录。"
            : "本轮未达到设定长度，结果没有计入统计。"}
      </p>

      <div className="chord-training-summary-metrics">
        <div>
          <span>完成和弦组</span>
          <strong>{events.length}</strong>
        </div>
        <div>
          <span>首答正确率</span>
          <strong>{events.length > 0 ? `${accuracy}%` : "—"}</strong>
        </div>
        <div>
          <span>练习时长</span>
          <strong>
            {minutes}:{String(seconds).padStart(2, "0")}
          </strong>
        </div>
      </div>

      <div className="chord-training-summary-actions">
        <button onClick={onReturnToSetup} type="button">
          <SlidersHorizontal aria-hidden="true" size={18} />
          返回设置
        </button>
        <button className="primary" onClick={onReturnToSetup} type="button">
          <RotateCcw aria-hidden="true" size={18} />
          再练一次
        </button>
      </div>
    </section>
  );
}
