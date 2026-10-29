import type { ReactNode } from "react";
import type { LearningModuleDefinition } from "../learningModules";
import type { LearningModuleTab } from "../../../routing/appRoutes";

const TABS: readonly { id: LearningModuleTab; label: string }[] = [
  { id: "guide", label: "导读" },
  { id: "practice", label: "练习" },
  { id: "stats", label: "统计" },
];

export function ModuleLayout({
  activeTab,
  children,
  module,
  onTabChange,
}: {
  activeTab: LearningModuleTab;
  children: ReactNode;
  module: LearningModuleDefinition;
  onTabChange: (tab: LearningModuleTab) => void;
}): JSX.Element {
  return (
    <section aria-labelledby="learning-module-title" className="learning-module-shell">
      <header className="learning-module-header">
        <div className="learning-module-heading-copy">
          <span className="learning-module-eyebrow">学习路线 · LEVEL {module.id}</span>
          <h1 id="learning-module-title">{module.name}</h1>
          <p>{module.summary}</p>
        </div>
        <module.icon
          aria-hidden="true"
          className="learning-module-icon"
          size={30}
          strokeWidth={1.8}
        />
      </header>

      <div aria-label={`${module.name}页签`} className="learning-module-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "is-active" : ""}
            id={`learning-module-tab-${tab.id}`}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            role="tab"
            tabIndex={activeTab === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`learning-module-tab-${activeTab}`}
        className={`learning-module-panel is-${activeTab}`}
        id={`learning-module-panel-${activeTab}`}
        role="tabpanel"
        tabIndex={0}
      >
        {children}
      </div>
    </section>
  );
}
