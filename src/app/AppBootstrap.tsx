import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Database, RefreshCw } from "lucide-react";
import { App } from "./App";
import { finalizeStaffGameDataReset, openDatabaseForInitialization } from "../data/db";
import { AppErrorBoundary } from "../shared/components/AppErrorBoundary";
import { ConfirmDialogProvider } from "../shared/components/ui/ConfirmDialog";
import { BROWSER_SUPPORT_REQUIREMENTS, inspectBrowserSupport } from "../browserSupport";
import type { BrowserSupportResult } from "../browserSupport";

type InitializationStatus = "checking" | "blocked" | "database-failed" | "cleanup-failed" | "ready";

export function AppBootstrap(): JSX.Element {
  const browserSupport = useMemo(inspectBrowserSupport, []);
  const [status, setStatus] = useState<InitializationStatus>("checking");
  const [attempt, setAttempt] = useState(0);
  const [forcedEntry, setForcedEntry] = useState(false);

  useEffect(() => {
    if (!browserSupport.supported) return;
    let isCurrentAttempt = true;
    setStatus("checking");

    void (async () => {
      let ready: boolean;
      try {
        ready = await openDatabaseForInitialization();
      } catch {
        if (isCurrentAttempt) setStatus("database-failed");
        return;
      }
      if (!isCurrentAttempt) return;
      if (!ready) {
        setStatus("blocked");
        return;
      }

      try {
        await finalizeStaffGameDataReset();
        if (isCurrentAttempt) setStatus("ready");
      } catch {
        if (isCurrentAttempt) setStatus("cleanup-failed");
      }
    })();

    return () => {
      isCurrentAttempt = false;
    };
  }, [attempt, browserSupport.supported]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  if (!browserSupport.supported) {
    return <BrowserUpgradeNotice result={browserSupport} />;
  }

  if (status === "ready" || forcedEntry) {
    return (
      <React.StrictMode>
        <AppErrorBoundary>
          <ConfirmDialogProvider>
            <App skipPendingAnswerEventRetry={forcedEntry} />
          </ConfirmDialogProvider>
        </AppErrorBoundary>
      </React.StrictMode>
    );
  }

  if (status === "checking") {
    return (
      <main aria-busy="true" aria-live="polite" className="app-initialization-page">
        <section className="app-initialization-card">
          <span aria-hidden="true" className="app-initialization-icon is-loading">
            <Database size={28} />
          </span>
          <h1>正在准备应用</h1>
          <p>正在检查并整理本地数据，请稍候。</p>
        </section>
      </main>
    );
  }

  const isBlocked = status === "blocked";
  const isDatabaseFailure = status === "database-failed";
  const canForceEnter = status === "cleanup-failed";
  return (
    <main className="app-initialization-page">
      <section
        aria-labelledby="app-initialization-title"
        className="app-initialization-card"
        role="alert"
      >
        <span aria-hidden="true" className="app-initialization-icon is-error">
          <AlertTriangle size={28} />
        </span>
        <h1 id="app-initialization-title">
          {isBlocked ? "数据重置被阻塞" : isDatabaseFailure ? "本地数据初始化失败" : "数据清理失败"}
        </h1>
        <p>
          {isBlocked
            ? "请关闭本应用的其他网页标签页。"
            : isDatabaseFailure
              ? "本地数据库无法打开。请关闭其他标签页，并检查浏览器存储权限后重试。"
              : "这可能是由于浏览器隐私设置限制，或存储空间已满。"}
        </p>
        <div className="app-initialization-actions">
          <button className="app-initialization-primary" onClick={retry} type="button">
            <RefreshCw aria-hidden="true" size={17} />
            {isBlocked ? "重新检测" : "重试"}
          </button>
          {canForceEnter ? (
            <button
              className="app-initialization-secondary"
              onClick={() => setForcedEntry(true)}
              type="button"
            >
              强制进入应用
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function BrowserUpgradeNotice({ result }: { result: BrowserSupportResult }): JSX.Element {
  return (
    <main className="app-initialization-page">
      <section aria-labelledby="browser-support-title" className="app-initialization-card">
        <span aria-hidden="true" className="app-initialization-icon is-error">
          <AlertTriangle size={28} />
        </span>
        <h1 id="browser-support-title">请升级浏览器后再使用</h1>
        <p>当前浏览器或设备系统版本过低，暂时无法运行识谱视奏。</p>
        {result.versionIssue ? <p>{result.versionIssue}</p> : null}
        {result.missingFeatures.length > 0 ? (
          <p>缺少运行所需的浏览器功能：{result.missingFeatures.join("、")}。</p>
        ) : null}
        <p className="app-initialization-secondary-copy">
          最低支持：{BROWSER_SUPPORT_REQUIREMENTS}。请升级浏览器或设备系统后重新检测。
        </p>
        <div className="app-initialization-actions">
          <button
            className="app-initialization-primary"
            onClick={() => window.location.reload()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={17} />
            重新检测
          </button>
        </div>
      </section>
    </main>
  );
}
