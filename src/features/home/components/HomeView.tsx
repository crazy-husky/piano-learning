import { ArrowRight, Gamepad2, Music, Settings, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { db } from "../../../data/db";
import { ensureSwiftF0PracticeRuntimeReady } from "../../vocal-pitch/logic/swiftF0PracticeClient";
import type { PracticeMicrophoneAlgorithm } from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import type { AppRoutePath } from "../../../routing/appRoutes";
import { LEARNING_MODULES } from "../../learning/learningModules";

interface HomeViewProps {
  microphoneAlgorithm: PracticeMicrophoneAlgorithm;
  onNavigate: (path: AppRoutePath) => void;
}

type ModuleProgressCounts = Record<1 | 2 | 3 | 4 | 5 | 6, number>;

const EMPTY_PROGRESS_COUNTS: ModuleProgressCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

export function HomeView({ microphoneAlgorithm, onNavigate }: HomeViewProps): JSX.Element {
  const [progressCounts, setProgressCounts] = useState<ModuleProgressCounts | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([db.answerEvents.toArray(), db.staffRecallRuns.count()])
      .then(([events, recallRunCount]) => {
        if (cancelled) return;
        const counts = { ...EMPTY_PROGRESS_COUNTS, 1: recallRunCount };
        for (const event of events) {
          if (event.mode === "name-to-key" || event.mode === "staff-to-name") counts[3] += 1;
          if (event.mode === "staff-distance") counts[4] += 1;
          if (event.mode === "pre-reading") counts[5] += 1;
          if (event.mode !== "free-practice") continue;
          const isDuet =
            Boolean(event.duetTargetNoteIds?.length) ||
            event.duetDifficulty !== undefined ||
            event.duetLevel !== undefined ||
            event.targetMidiHigh !== undefined ||
            event.targetMidiLow !== undefined;
          counts[isDuet ? 6 : 2] += 1;
        }
        setProgressCounts(counts);
      })
      .catch(() => {
        if (!cancelled) setProgressCounts(EMPTY_PROGRESS_COUNTS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        <span className="home-eyebrow">LEARNING PATH</span>
        <h1 id="home-title">学习路线</h1>
        <p>从看懂谱面开始，逐步练到双手协同。每个阶段都可以随时进入。</p>
      </header>
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
      <ol aria-label="五个学习阶段" className="learning-path-list">
        {LEARNING_MODULES.map((module) => {
          const Icon = module.icon;
          const progress = progressCounts?.[module.id];
          return (
            <li className="learning-path-step" key={module.id}>
              <button
                className="learning-path-card"
                onClick={() => onNavigate(`/level/${module.id}` as AppRoutePath)}
                type="button"
              >
                <span aria-hidden="true" className="learning-path-stage">
                  {module.id}
                </span>
                <span className="learning-path-icon">
                  <Icon aria-hidden="true" size={23} strokeWidth={2} />
                </span>
                <span className="learning-path-copy">
                  <span className="learning-path-level">LEVEL {module.id}</span>
                  <strong>{module.name}</strong>
                  <small>{module.summary}</small>
                </span>
                <span className="learning-path-progress">
                  {progressCounts === null
                    ? "读取进度中"
                    : progress
                      ? `已完成 ${progress} ${module.id === 1 ? "次学习" : "道练习"}`
                      : "尚未开始 · 随时可练"}
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
