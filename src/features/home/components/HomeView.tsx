import { BarChart3, BookOpen, Dumbbell, Music2, Settings } from "lucide-react";
import type { AppRoutePath } from "../../../routing/appRoutes";

interface HomeViewProps {
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
    description: "听音作答，支持跳级",
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

export function HomeView({ onNavigate }: HomeViewProps): JSX.Element {
  return (
    <section aria-labelledby="home-title" className="home-shell">
      <header className="home-heading">
        <span className="home-eyebrow">PIANO LEARNING</span>
        <h1 id="home-title">识谱视奏</h1>
        <p>选择一个入口，开始今天的音乐练习吧～</p>
      </header>
      <div className="home-menu-grid">
        {menuItems.map(({ description, hideOnMobile, icon: Icon, isNew, label, path, tone }) => (
          <button
            className={`home-menu-card tone-${tone}${hideOnMobile ? " home-menu-hide-on-mobile" : ""}`}
            key={path}
            onClick={() => onNavigate(path)}
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
