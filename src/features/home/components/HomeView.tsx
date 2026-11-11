import { ArrowRight, ChevronDown, Gamepad2, Music, Settings, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { db } from "../../../data/db";
import { ensureSwiftF0PracticeRuntimeReady } from "../../vocal-pitch/logic/swiftF0PracticeClient";
import type { PracticeMicrophoneAlgorithm } from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import type { AppRoutePath } from "../../../routing/appRoutes";
import { getLearningModuleSequenceNumber, LEARNING_MODULES } from "../../learning/learningModules";
import type { LearningLevelId } from "../../../routing/appRoutes";
import {
  evaluateLearningProgress,
  type LearningProgressSummary,
} from "../../learning/learningProgress";

interface HomeViewProps {
  microphoneAlgorithm: PracticeMicrophoneAlgorithm;
  dataSetId: string;
  onNavigate: (path: AppRoutePath) => void;
}

type ModuleProgress = Record<LearningLevelId, LearningProgressSummary>;

const STATUS_COPY = {
  "not-started": "未开始",
  "in-progress": "练习中",
  mastered: "🏆 已掌握",
} as const;

const SIGHT_READING_STEPS = [
  {
    id: "foundation",
    index: "01",
    label: "基础",
    title: "认准音，找到键",
    description: "认清谱号和音符位置，把谱面连到音名与键盘。",
    moduleIds: [1, 2, 3] as const,
    comingSoon: [] as const,
  },
  {
    id: "intermediate",
    index: "02",
    label: "进阶",
    title: "看出音距，协调双手",
    description: "判断音符的方向和跨距，逐步读懂常见音型、节奏与双手关系。",
    moduleIds: [4, 6] as const,
    comingSoon: ["调号与临时记号"] as const,
  },
  {
    id: "advanced",
    index: "03",
    label: "高阶目标",
    title: "提前读谱，拓展整体视野",
    description: "适度提前看后续音符，逐步练习在新谱中保持连贯。",
    moduleIds: [5, 7] as const,
    comingSoon: ["错音后继续弹奏"] as const,
  },
] as const;

export function HomeView({
  microphoneAlgorithm,
  dataSetId,
  onNavigate,
}: HomeViewProps): JSX.Element {
  const [moduleProgress, setModuleProgress] = useState<ModuleProgress | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      db.answerEvents.toArray(),
      db.staffRecallRuns.toArray(),
      db.practiceSessions.toArray(),
    ])
      .then(([events, staffRecallRuns, practiceSessions]) => {
        if (cancelled) return;
        setModuleProgress(
          evaluateLearningProgress({
            answerEvents: events.filter((event) => event.dataSetId === dataSetId),
            staffRecallRuns,
            practiceSessions,
          })
        );
      })
      .catch(() => {
        if (!cancelled) setModuleProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dataSetId]);

  useEffect(() => {
    if (microphoneAlgorithm !== "swiftf0") return;

    type IdleWindow = Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    const idleWindow = window as IdleWindow;
    let scheduledTask: { id: number; type: "idle" | "timeout" } | null = null;
    let started = false;
    const startPrewarm = (): void => {
      scheduledTask = null;
      if (started || document.visibilityState !== "visible") return;
      started = true;
      void ensureSwiftF0PracticeRuntimeReady(60_000).catch(() => undefined);
    };
    const cancelScheduledPrewarm = (): void => {
      if (!scheduledTask) return;
      if (scheduledTask.type === "idle") {
        idleWindow.cancelIdleCallback?.(scheduledTask.id);
      } else {
        window.clearTimeout(scheduledTask.id);
      }
      scheduledTask = null;
    };
    const schedulePrewarm = (): void => {
      if (started || scheduledTask || document.visibilityState !== "visible") return;
      if (idleWindow.requestIdleCallback) {
        scheduledTask = {
          id: idleWindow.requestIdleCallback(startPrewarm, { timeout: 2_000 }),
          type: "idle",
        };
      } else {
        scheduledTask = { id: window.setTimeout(startPrewarm, 500), type: "timeout" };
      }
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        schedulePrewarm();
      } else {
        cancelScheduledPrewarm();
      }
    };

    schedulePrewarm();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelScheduledPrewarm();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [microphoneAlgorithm]);

  return (
    <section aria-labelledby="home-title" className="home-shell">
      <header className="home-heading">
        <span className="home-eyebrow">SIGHT-READING PATH</span>
        <h1 id="home-title">视奏能力进阶路径</h1>
        <p>从基础识谱到连续演奏，按需练习视奏所需的不同能力。</p>
      </header>
      <section aria-labelledby="home-sight-reading-title" className="home-sight-reading-section">
        <header className="home-sight-reading-intro">
          <span className="home-sight-reading-kicker">视奏导读</span>
          <h2 id="home-sight-reading-title">视奏是一种综合能力的体现</h2>
          <div className="home-sight-reading-intro-copy">
            <p>
              很多人觉得视奏难，以为只是认音不够快。其实，读谱定位、判断音符关系、理解节奏和双手协同都会影响演奏连贯度。
            </p>
            <p>
              不必等学完所有乐理再开始：可以从单音识别和键位定位起步，再逐步练习音距与双手配合，熟悉后尝试提前看谱。
            </p>
            <p>持续练习能减少逐音寻找与停顿，让新谱上手更连贯。</p>
            <p className="home-sight-reading-emphasis">
              视奏时，在保证一定正确率的前提下，不要害怕错音，也不要因错音中途折返或停顿；我们追求速度与连贯，不是完美主义。
            </p>
          </div>
        </header>
        <details className="home-sight-reading-guide">
          <summary className="home-sight-reading-toggle">
            <span>
              <strong>视奏能力地图</strong>
              <small>基础 → 进阶 → 高阶</small>
            </span>
            <ChevronDown aria-hidden="true" size={20} />
          </summary>
          <div className="home-sight-reading-content">
            <div className="home-sight-reading-heading">
              <p>台阶表示建议的发展顺序，不是解锁条件；已有练习都可以直接进入。</p>
            </div>
            <ol aria-label="视奏能力发展建议" className="home-sight-reading-steps">
              {SIGHT_READING_STEPS.map((step) => (
                <li className="home-sight-reading-step" data-step={step.id} key={step.id}>
                  <div className="home-sight-reading-step-copy">
                    <span className="home-sight-reading-step-label">
                      {step.index} · {step.label}
                    </span>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                  <div
                    aria-label="相关训练"
                    className="home-sight-reading-module-links"
                    role="group"
                  >
                    {step.moduleIds.map((levelId) => {
                      const module = LEARNING_MODULES.find((item) => item.id === levelId);
                      if (!module) return null;
                      return (
                        <span
                          className={`home-sight-reading-module-entry${module.optional ? " is-optional" : ""}`}
                          key={module.id}
                        >
                          <button
                            aria-label={`打开 Level ${getLearningModuleSequenceNumber(module.id)}：${module.name}`}
                            onClick={() => onNavigate(`/level/${module.id}` as AppRoutePath)}
                            type="button"
                          >
                            Level {getLearningModuleSequenceNumber(module.id)} · {module.name}
                          </button>
                          {module.optional ? (
                            <small className="home-sight-reading-optional-tag">可选增益</small>
                          ) : null}
                        </span>
                      );
                    })}
                    {step.id === "advanced" ? (
                      <span className="home-sight-reading-harmony-entry">
                        <span
                          aria-label="和声走向预判，暂无专项"
                          className="home-sight-reading-unavailable-node"
                        >
                          <strong>和声走向预判</strong>
                          <small>暂无专项</small>
                        </span>
                        <small className="home-sight-reading-optional-tag">可选增益</small>
                      </span>
                    ) : null}
                    {step.comingSoon.map((item) => (
                      <div
                        aria-label={`${item}，待建设`}
                        className="home-sight-reading-unavailable-node"
                        key={item}
                      >
                        <strong>{item}</strong>
                        <small>待建设</small>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </details>
      </section>
      <nav aria-label="快捷入口" className="home-quick-links">
        <span className="home-quick-links-title">快捷入口</span>
        <div className="home-quick-links-grid">
          <button
            className="home-quick-link-challenge"
            onClick={() => onNavigate("/playground/challenge")}
            type="button"
          >
            <Gamepad2 aria-hidden="true" size={19} />
            <span>气泡闯关</span>
            <span aria-label="新功能" className="home-quick-link-new">
              NEW
            </span>
          </button>
          <button onClick={() => onNavigate("/playground/songs/score")} type="button">
            <Music aria-hidden="true" size={19} />
            <span>歌曲律动</span>
          </button>
          <button onClick={() => onNavigate("/metronome")} type="button">
            <Timer aria-hidden="true" size={19} />
            <span>节拍器</span>
          </button>
          <button onClick={() => onNavigate("/settings")} type="button">
            <Settings aria-hidden="true" size={19} />
            <span>设置</span>
          </button>
        </div>
      </nav>
      <ol aria-label="七个学习阶段" className="learning-path-list">
        {LEARNING_MODULES.map((module, index) => {
          const Icon = module.icon;
          const progress = moduleProgress?.[module.id];
          return (
            <li className="learning-path-step" key={module.id}>
              <button
                className="learning-path-card"
                onClick={() => onNavigate(`/level/${module.id}` as AppRoutePath)}
                type="button"
              >
                <span aria-hidden="true" className="learning-path-stage">
                  {index + 1}
                </span>
                <span className="learning-path-icon">
                  <Icon aria-hidden="true" size={23} strokeWidth={2} />
                </span>
                <span className="learning-path-copy">
                  <span className="learning-path-level">
                    LEVEL {getLearningModuleSequenceNumber(module.id)}
                  </span>
                  <span className="learning-path-title-row">
                    <strong>{module.name}</strong>
                    {module.optional ? <span className="learning-path-optional">可选</span> : null}
                  </span>
                  <small>{module.summary}</small>
                </span>
                <span className="learning-path-progress">
                  {progress === undefined ? "读取进度中" : STATUS_COPY[progress.status]}
                  {progress ? <small>{progress.detail}</small> : null}
                </span>
                <ArrowRight aria-hidden="true" className="learning-path-arrow" size={20} />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
