import { useEffect, useState } from "react";
import { LoadingActivityText } from "./LoadingActivity";

const LOADING_SKELETON_DELAY_MS = 150;

function useDelayedVisibility(delayMs = LOADING_SKELETON_DELAY_MS): boolean {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setIsVisible(true), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs]);

  return isVisible;
}

export function AppStartupSkeleton(): JSX.Element {
  return (
    <main aria-busy="true" aria-label="正在加载应用" className="app-startup" role="status">
      <div className="app-startup-card">
        <span aria-hidden="true" className="app-startup-note">
          ♫
        </span>
        <strong>识谱视奏</strong>
        <span className="app-startup-message">
          <LoadingActivityText kind="dots">正在准备练习空间</LoadingActivityText>
        </span>
        <div aria-hidden="true" className="app-startup-skeleton">
          <div className="app-startup-skeleton-choice-row">
            <i />
            <i />
            <i />
          </div>
          <div className="app-startup-skeleton-panel">
            <i />
            <i />
          </div>
          <div className="app-startup-skeleton-panel app-startup-skeleton-panel-short">
            <i />
            <i />
          </div>
        </div>
        <span aria-hidden="true" className="app-startup-progress">
          <i />
        </span>
      </div>
    </main>
  );
}

export function RouteLoadingSkeleton(): JSX.Element | null {
  const isVisible = useDelayedVisibility();
  if (!isVisible) return null;

  return (
    <section
      aria-busy="true"
      aria-label="正在加载页面"
      className="route-loading-skeleton"
      role="status"
    >
      <span className="loading-sr-only">正在加载页面</span>
      <div aria-hidden="true" className="route-loading-heading" />
      <div aria-hidden="true" className="route-loading-metrics">
        <i />
        <i />
        <i />
      </div>
      <div aria-hidden="true" className="route-loading-panel">
        <i />
        <i />
        <i />
      </div>
      <div aria-hidden="true" className="route-loading-panel route-loading-panel-short">
        <i />
        <i />
      </div>
      <div aria-hidden="true" className="route-loading-panel">
        <i />
        <i />
        <i />
      </div>
    </section>
  );
}

export function ChartLoadingSkeleton(): JSX.Element | null {
  const isVisible = useDelayedVisibility();
  if (!isVisible) return null;

  return (
    <div aria-label="正在加载图表" className="echarts-loading-skeleton" role="status">
      <span className="loading-sr-only">正在加载图表</span>
      <span aria-hidden="true" className="echarts-loading-grid" />
    </div>
  );
}
