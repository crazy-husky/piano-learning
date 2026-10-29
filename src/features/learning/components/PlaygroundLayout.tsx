import type { ReactNode } from "react";

export type PlaygroundTab = "challenge" | "songs" | "stats";

const TABS: readonly { id: PlaygroundTab; label: string }[] = [
  { id: "challenge", label: "闯关" },
  { id: "songs", label: "歌曲" },
  { id: "stats", label: "统计" },
];

export function PlaygroundLayout({
  activeTab,
  children,
  onTabChange,
}: {
  activeTab: PlaygroundTab;
  children: ReactNode;
  onTabChange: (tab: PlaygroundTab) => void;
}): JSX.Element {
  return (
    <section aria-label="游乐场" className="playground-layout">
      <div aria-label="游乐场页签" className="playground-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "is-active" : ""}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className={`playground-content is-${activeTab}`}>{children}</div>
    </section>
  );
}
