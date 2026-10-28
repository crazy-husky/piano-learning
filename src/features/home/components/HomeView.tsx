import { BarChart3, BookOpen, Dumbbell, Music2, Settings, Timer } from "lucide-react";
import { useEffect } from "react";
import { ensureSwiftF0PracticeRuntimeReady } from "../../vocal-pitch/logic/swiftF0PracticeClient";
import type { PracticeMicrophoneAlgorithm } from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import type { AppRoutePath } from "../../../routing/appRoutes";

interface HomeViewProps {
  microphoneAlgorithm: PracticeMicrophoneAlgorithm;
  onOpenMetronome: () => void;
  onNavigate: (path: AppRoutePath) => void;
}

const menuItems: Array<{
  description: string;
  icon: typeof BookOpen;
  isNew?: boolean;
  hideOnMobile?: boolean;
  label: string;
  path: AppRoutePath;
  tone: string;
}> = [
  {
    label: "学习",
    description: "按谱面熟悉音符位置",
    icon: BookOpen,
    path: "/study",
    tone: "mint",
  },
  {
    label: "五线谱-自由练习",
    description: "根据需要自由组合练习，更具针对性",
    icon: Dumbbell,
    path: "/practice",
    tone: "blue",
  },
  {
    label: "五线谱游戏-闯关模式",
    description: "听音作答，可选择关卡",
    icon: Music2,
    isNew: true,
    path: "/practice/game",
    tone: "orange",
  },
  {
    label: "五线谱游戏-歌曲模式",
    description: "跟随旋律连续弹奏",
    icon: Music2,
    isNew: true,
    path: "/practice/game/songs",
    tone: "pink",
  },
  {
    label: "节拍器",
    description: "调节速度，跟随木鱼节拍练习",
    icon: Timer,
    path: "/metronome",
    tone: "orange",
  },
  {
    label: "统计",
    description: "查看练习与识别表现",
    icon: BarChart3,
    path: "/stats",
    tone: "violet",
  },
  // 清唱菜单入口暂时隐藏；恢复时重新导入 AudioLines 并取消此段注释。
  /*
  {
    label: "清唱",
    description: "查看音高与音域",
    icon: AudioLines,
    path: "/vocal",
    tone: "pink",
    hideOnMobile: true,
  },
  */
  {
    label: "设置",
    description: "调整显示和输入设备",
    icon: Settings,
    path: "/settings",
    tone: "slate",
  },
];

export function HomeView({
  microphoneAlgorithm,
  onNavigate,
  onOpenMetronome,
}: HomeViewProps): JSX.Element {
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
        <span className="home-eyebrow">SIGHT READING</span>
        <h1 id="home-title">识谱视奏</h1>
        <p>选择一个入口，开始今天的音乐练习吧～</p>
      </header>
      <div className="home-menu-grid">
        {menuItems.map(({ description, hideOnMobile, icon: Icon, isNew, label, path, tone }) => (
          <button
            className={`home-menu-card tone-${tone}${hideOnMobile ? " home-menu-hide-on-mobile" : ""}`}
            key={path}
            onClick={() => (path === "/metronome" ? onOpenMetronome() : onNavigate(path))}
            type="button"
          >
            <span className="home-menu-icon">
              <Icon aria-hidden="true" size={25} strokeWidth={2.2} />
            </span>
            <span className="home-menu-copy">
              <strong>
                {label}
                {isNew ? <span className="home-menu-new-badge">new</span> : null}
              </strong>
              <small>{description}</small>
            </span>
            <span aria-hidden="true" className="home-menu-arrow">
              ›
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
