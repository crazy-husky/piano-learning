import type { DuetPracticeLevel, ReviewRecord, Staff } from "../../../domain/types";
import {
  buildDuetPracticeSummaryStats,
  formatDuetRate,
  type DuetCountRate,
} from "../../../domain/duetPracticeSummary";

interface DuetPracticeSummaryProps {
  level: DuetPracticeLevel;
  reviews: ReviewRecord[];
  syncEnabled: boolean;
}

function rateDescription(rate: DuetCountRate, unit: string): string {
  return rate.total > 0 ? `${rate.correct} / ${rate.total}${unit}` : "暂无样本";
}

function handLabel(staff: Staff): string {
  return staff === "treble" ? "右手" : "左手";
}

export function DuetPracticeSummary({
  level,
  reviews,
  syncEnabled,
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
  const weakerHand: Staff | undefined =
    stats.hands.treble.total > 0 && stats.hands.bass.total > 0
      ? stats.hands.treble.correct / stats.hands.treble.total <=
        stats.hands.bass.correct / stats.hands.bass.total
        ? "treble"
        : "bass"
      : undefined;
  const suggestion =
    syncEnabled && stats.timing.correctOffbeatTargets > 0
      ? `有 ${stats.timing.correctOffbeatTargets} 个音高正确但没有踩准拍，下一局先跟稳节拍。`
      : stats.timing.wrongOnTimeAttempts > 0
        ? `有 ${stats.timing.wrongOnTimeAttempts} 次踩准拍但音高错误，下一局多核对谱面音高。`
        : weakerHand && stats.hands[weakerHand].total > 0
          ? `下次可以多留意${handLabel(weakerHand)}。`
          : "继续保持双手和节拍的稳定。";

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
          {(["treble", "bass"] as const).map((staff) => (
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
              <span>目标音准拍率</span>
              <strong>{formatDuetRate(beatRate)}</strong>
              <small>
                准拍 {stats.timing.onTime} · 偏早 {stats.timing.early} · 偏晚 {stats.timing.late} ·
                漏拍 {stats.timing.missed}
              </small>
            </article>
          ) : null}
        </div>
      </section>

      <section className="summary-section duet-summary-section">
        <div className="summary-section-heading">
          <h2>题型表现</h2>
        </div>
        <div className="duet-summary-breakdown">
          <article>
            <span>{syncEnabled ? "单音准拍首答率" : "单音首答正确率"}</span>
            <strong>{formatDuetRate(stats.singleNoteEvents)}</strong>
            <small>{rateDescription(stats.singleNoteEvents, " 组单音")}</small>
          </article>
          {levelNumber > 1 ? (
            <article>
              <span>{syncEnabled ? "多音同拍完整率" : "多音首答完整率"}</span>
              <strong>{formatDuetRate(stats.multiNoteEvents)}</strong>
              <small>{rateDescription(stats.multiNoteEvents, " 组多音")}</small>
            </article>
          ) : null}
          {levelNumber > 1 ? (
            <article>
              <span>{syncEnabled ? "双手同拍完整率" : "双手首答完整率"}</span>
              <strong>{formatDuetRate(stats.bothHandEvents)}</strong>
              <small>{rateDescription(stats.bothHandEvents, " 组双手合奏")}</small>
            </article>
          ) : null}
          {syncEnabled ? (
            <>
              <article>
                <span>踩准拍的错音</span>
                <strong>{stats.timing.wrongOnTimeAttempts}</strong>
                <small>按次计数</small>
              </article>
              <article>
                <span>音高正确但偏拍</span>
                <strong>{stats.timing.correctOffbeatTargets}</strong>
                <small>按目标音计数</small>
              </article>
              <article>
                <span>漏拍音符</span>
                <strong>{stats.timing.missed}</strong>
                <small>节拍窗口内未完成</small>
              </article>
            </>
          ) : null}
        </div>
        <p className="duet-summary-note">
          {syncEnabled
            ? "节拍数据按正确音符相对目标拍点的落点统计；首答错音不计入正确音踩拍率。"
            : "本次未开启节拍同步，因此不统计节拍表现。"}
        </p>
      </section>

      <section className="summary-section duet-summary-section duet-summary-suggestion">
        <h2>下次建议</h2>
        <p>{suggestion}</p>
      </section>
    </div>
  );
}
