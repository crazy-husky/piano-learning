import type { DuetPracticeLevel, ReviewRecord, Staff } from "../../../domain/types";
import {
  buildDuetPracticeSuggestion,
  buildDuetPracticeSummaryStats,
  formatDuetRate,
  type DuetCountRate,
} from "../../../domain/duetPracticeSummary";

interface DuetPracticeSummaryProps {
  level: DuetPracticeLevel;
  metronomeBpm?: number;
  reviews: ReviewRecord[];
  syncEnabled: boolean;
  strictHandAlternation: boolean;
  allowDottedRhythms: boolean;
  wrongNoteTest: boolean;
}

function rateDescription(rate: DuetCountRate, unit: string): string {
  return rate.total > 0 ? `${rate.correct} / ${rate.total}${unit}` : "暂无样本";
}

function handLabel(staff: Staff): string {
  return staff === "treble" ? "右手" : "左手";
}

export function DuetPracticeSummary({
  level,
  metronomeBpm,
  reviews,
  syncEnabled,
  strictHandAlternation,
  allowDottedRhythms,
  wrongNoteTest,
}: DuetPracticeSummaryProps): JSX.Element {
  const stats = buildDuetPracticeSummaryStats(reviews, syncEnabled);
  const handTargets = [
    stats.hands.treble.correct + stats.hands.bass.correct,
    stats.hands.treble.total + stats.hands.bass.total,
  ] as const;
  const timedTargets =
    stats.timing.early + stats.timing.onTime + stats.timing.late + stats.timing.missed;
  const beatRate = { correct: stats.timing.onTime, total: timedTargets };
  const levelNumber = Number(level.slice(-1));
  const suggestion = buildDuetPracticeSuggestion(stats, {
    allowDottedRhythms,
    level,
    metronomeBpm,
    strictHandAlternation,
    syncEnabled,
    wrongNoteTest,
  });

  return (
    <div className="duet-practice-summary">
      <section className="summary-section duet-summary-section">
        <div className="summary-section-heading">
          <h2>音符与节拍</h2>
          <span>第 {levelNumber} 关</span>
        </div>
        <div className="duet-summary-metrics">
          <article className="duet-summary-metric">
            <span>整体首答正确率</span>
            <strong>
              {handTargets[1] > 0 ? `${Math.round((handTargets[0] / handTargets[1]) * 100)}%` : "—"}
            </strong>
            <small>
              {rateDescription({ correct: handTargets[0], total: handTargets[1] }, "个音")}
            </small>
          </article>
          {(["bass", "treble"] as const).map((staff) => (
            <article className="duet-summary-metric" key={staff}>
              <span>{handLabel(staff)}首答正确率</span>
              <strong>{formatDuetRate(stats.hands[staff])}</strong>
              <small>
                首答 {stats.hands[staff].correct} / {stats.hands[staff].total} 个音
                {stats.hands[staff].total > 0
                  ? ` · 最终完成 ${stats.hands[staff].completed} 个`
                  : ""}
              </small>
            </article>
          ))}
          {syncEnabled ? (
            <article className="duet-summary-metric">
              <span>起音组准拍率</span>
              <strong>{formatDuetRate(beatRate)}</strong>
              <small>
                准拍 {stats.timing.onTime} · 偏早 {stats.timing.early} · 偏晚 {stats.timing.late} ·
                漏拍 {stats.timing.missed} 组
              </small>
            </article>
          ) : null}
        </div>
      </section>

      <section className="summary-section duet-summary-section duet-summary-suggestion">
        <h2>建议</h2>
        <p>{suggestion}</p>
      </section>
    </div>
  );
}
