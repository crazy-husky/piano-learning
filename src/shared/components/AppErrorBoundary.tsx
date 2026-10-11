import { Component, type ErrorInfo, type ReactNode } from "react";
import { formatDateTime } from "../formatDateTime";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  fatalErrorDetails: string | null;
  globalErrors: GlobalErrorRecord[];
  copyStatus: string;
  globalErrorNoticeVisible: boolean;
  globalErrorNoticeSecondsRemaining: number;
  errorDetailsOpen: boolean;
}

type GlobalErrorSource = "window.error" | "unhandledrejection" | "resource-load-error";

interface GlobalErrorRecord {
  source: GlobalErrorSource;
  details: string;
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
}

const MAX_GLOBAL_ERROR_RECORDS = 20;
const GLOBAL_ERROR_DEDUPE_WINDOW_MS = 30_000;
const MAX_GLOBAL_ERROR_DETAILS_LENGTH = 12_000;
const GLOBAL_ERROR_NOTICE_DURATION_SECONDS = 10;
const MODULE_LOAD_RETRY_SESSION_KEY = `app-module-load-retry:${__APP_BUILD_ID__}`;
const MODULE_LOAD_FAILURE_PATTERN = /importing a module script failed|failed to fetch dynamically imported module|unable to preload (?:css|module)|loading chunk .* failed/i;

function describeError(error: unknown): string {
  if (typeof error === "string") return `Message: ${error}`;
  if (error && typeof error === "object") {
    const value = error as { name?: unknown; message?: unknown; stack?: unknown; cause?: unknown };
    const name = typeof value.name === "string" ? value.name : "Error";
    const message = typeof value.message === "string" && value.message.length > 0
      ? value.message
      : "(message unavailable)";
    const stack = typeof value.stack === "string" && value.stack.length > 0
      ? value.stack
      : "(stack unavailable)";
    const details = [`Name: ${name}`, `Message: ${message}`, `Stack:\n${stack}`];
    if (value.cause && value.cause !== error) details.push(`Cause:\n${describeError(value.cause)}`);
    return details.join("\n");
  }
  try {
    return `Thrown value: ${JSON.stringify(error, null, 2) ?? String(error)}`;
  } catch {
    return `Thrown value: ${String(error)}`;
  }
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    fatalErrorDetails: null,
    globalErrors: [],
    copyStatus: "",
    globalErrorNoticeVisible: false,
    globalErrorNoticeSecondsRemaining: 0,
    errorDetailsOpen: false,
  };
  private copyStatusTimeout: number | null = null;
  private globalErrorNoticeInterval: number | null = null;

  componentDidMount(): void {
    window.addEventListener("error", this.handleWindowError, true);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
    window.addEventListener("vite:preloadError", this.handleVitePreloadError);
  }

  componentWillUnmount(): void {
    window.removeEventListener("error", this.handleWindowError, true);
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
    window.removeEventListener("vite:preloadError", this.handleVitePreloadError);
    if (this.copyStatusTimeout !== null) window.clearTimeout(this.copyStatusTimeout);
    this.clearGlobalErrorNoticeInterval();
  }

  componentDidUpdate(_previousProps: AppErrorBoundaryProps, previousState: AppErrorBoundaryState): void {
    if (!previousState.fatalErrorDetails && this.state.fatalErrorDetails) {
      this.clearGlobalErrorNoticeInterval();
      if (this.state.globalErrorNoticeVisible) {
        this.setState({ globalErrorNoticeVisible: false, globalErrorNoticeSecondsRemaining: 0 });
      }
    }
  }

  static getDerivedStateFromError(error: unknown): Partial<AppErrorBoundaryState> {
    return { fatalErrorDetails: describeError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const errorDetails = describeError(error);
    this.setState({
      fatalErrorDetails: `${errorDetails}\n\nReact component stack:${info.componentStack || " (unavailable)"}`,
    });

    if (MODULE_LOAD_FAILURE_PATTERN.test(errorDetails)) this.retryModuleLoadOnce();
  }

  private captureGlobalError = (source: GlobalErrorSource, details: string): void => {
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const boundedDetails = details.length > MAX_GLOBAL_ERROR_DETAILS_LENGTH
      ? `${details.slice(0, MAX_GLOBAL_ERROR_DETAILS_LENGTH)}\n… (error details truncated)`
      : details;

    this.setState((current) => {
      const duplicateIndex = current.globalErrors.findIndex((record) => (
        record.source === source
        && record.details === boundedDetails
        && now - Date.parse(record.lastSeenAt) <= GLOBAL_ERROR_DEDUPE_WINDOW_MS
      ));

      let globalErrors: GlobalErrorRecord[];
      if (duplicateIndex >= 0) {
        globalErrors = current.globalErrors.map((record, index) => index === duplicateIndex
          ? { ...record, lastSeenAt: timestamp, count: record.count + 1 }
          : record);
      } else {
        globalErrors = [...current.globalErrors, {
          source,
          details: boundedDetails,
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
          count: 1,
        }].slice(-MAX_GLOBAL_ERROR_RECORDS);
      }

      return { globalErrors };
    });
    if (!this.state.fatalErrorDetails) this.showGlobalErrorNotice();
  };

  private clearGlobalErrorNoticeInterval = (): void => {
    if (this.globalErrorNoticeInterval === null) return;
    window.clearInterval(this.globalErrorNoticeInterval);
    this.globalErrorNoticeInterval = null;
  };

  private showGlobalErrorNotice = (): void => {
    this.clearGlobalErrorNoticeInterval();
    this.setState({
      globalErrorNoticeVisible: true,
      globalErrorNoticeSecondsRemaining: GLOBAL_ERROR_NOTICE_DURATION_SECONDS,
    });

    let elapsedSeconds = 0;
    this.globalErrorNoticeInterval = window.setInterval(() => {
      elapsedSeconds += 1;
      const secondsRemaining = Math.max(0, GLOBAL_ERROR_NOTICE_DURATION_SECONDS - elapsedSeconds);
      this.setState({
        globalErrorNoticeSecondsRemaining: secondsRemaining,
        globalErrorNoticeVisible: secondsRemaining > 0,
      });
      if (secondsRemaining === 0) this.clearGlobalErrorNoticeInterval();
    }, 1_000);
  };

  private dismissGlobalErrorNotice = (): void => {
    this.clearGlobalErrorNoticeInterval();
    this.setState({ globalErrorNoticeVisible: false, globalErrorNoticeSecondsRemaining: 0 });
  };

  private refreshPage = (clearRetryGuard = true): void => {
    try {
      if (clearRetryGuard) window.sessionStorage.removeItem(MODULE_LOAD_RETRY_SESSION_KEY);
    } catch {
      // Storage may be unavailable in private browsing; the page can still navigate.
    }

    // A cache-busting document navigation avoids racing Service Worker updates with reloads
    // in iOS browsers. App.tsx removes this temporary query once the app has booted.
    const refreshUrl = new URL(window.location.href);
    refreshUrl.searchParams.set("__app_refresh", String(Date.now()));
    window.location.replace(refreshUrl.toString());
  };

  private retryModuleLoadOnce = (): void => {
    try {
      if (window.sessionStorage.getItem(MODULE_LOAD_RETRY_SESSION_KEY) === "1") return;
      window.sessionStorage.setItem(MODULE_LOAD_RETRY_SESSION_KEY, "1");
    } catch {
      // Do not auto-retry when the guard cannot be persisted; that could cause a reload loop.
      return;
    }

    window.setTimeout(() => this.refreshPage(false), 0);
  };

  private handleWindowError = (event: Event): void => {
    if (!(event instanceof ErrorEvent)) {
      const target = event.target;
      // Recoverable image/font failures should not replace the entire app with a crash screen.
      // A failed script should be recorded too; React render failures are handled by the boundary below.
      if (!(target instanceof HTMLScriptElement)) return;
      const failedElement = `script src=${target.src}`;
      this.captureGlobalError("resource-load-error", `Failed element: ${failedElement}`);
      return;
    }
    const location = event.filename
      ? `Location: ${event.filename}:${event.lineno}:${event.colno}`
      : "Location: (unavailable)";
    this.captureGlobalError("window.error", [
      `Browser message: ${event.message || "(message unavailable)"}`,
      location,
      event.error ? describeError(event.error) : "Error object: (unavailable)",
    ].join("\n"));
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    this.captureGlobalError("unhandledrejection", `Reason: ${describeError(event.reason)}`);
  };

  private handleVitePreloadError = (event: VitePreloadErrorEvent): void => {
    this.captureGlobalError("resource-load-error", `Vite module preload error:\n${describeError(event.payload)}`);
    this.retryModuleLoadOnce();
  };

  private buildDebugInfo = (): string => [
    `Browser: ${navigator.userAgent}`,
    `Page: ${window.location.pathname}${window.location.hash}`,
    `Viewport: ${window.innerWidth} × ${window.innerHeight}`,
    `Online: ${navigator.onLine ? "yes" : "no"}`,
    `Version: ${__APP_VERSION__}`,
    `Build ID: ${__APP_BUILD_ID__}`,
    `Build time: ${formatDateTime(__APP_BUILD_TIME__)}`,
    `Report time: ${formatDateTime(Date.now())}`,
    "",
    this.state.fatalErrorDetails
      ? `Fatal React render error:\n${this.state.fatalErrorDetails}`
      : "Fatal React render error: none",
    "",
    `Recent unhandled errors (${this.state.globalErrors.length} grouped; limit ${MAX_GLOBAL_ERROR_RECORDS}):`,
    ...(this.state.globalErrors.length > 0
      ? this.state.globalErrors.map((record) => [
        `Source: ${record.source}`,
        `First seen: ${formatDateTime(record.firstSeenAt)}`,
        `Last seen: ${formatDateTime(record.lastSeenAt)}`,
        `Occurrences: ${record.count}`,
        record.details,
      ].join("\n"))
      : ["(none)"]),
  ].join("\n");

  private copyWithTextarea = (text: string): boolean => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0.01";
    textarea.style.fontSize = "16px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    textarea.parentNode?.removeChild(textarea);
    return copied;
  };

  private showCopyStatus = (status: string, autoDismiss = false): void => {
    if (this.copyStatusTimeout !== null) {
      window.clearTimeout(this.copyStatusTimeout);
      this.copyStatusTimeout = null;
    }
    this.setState({ copyStatus: status });
    if (autoDismiss) {
      this.copyStatusTimeout = window.setTimeout(() => {
        this.copyStatusTimeout = null;
        this.setState({ copyStatus: "" });
      }, 2_000);
    }
  };

  private copyDebugInfo = async (): Promise<void> => {
    this.showCopyStatus("");
    const text = this.buildDebugInfo();
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        this.showCopyStatus("调试信息已复制", true);
        return;
      }
    } catch {
      // Fall through to the selection-based copy path for older browsers and denied clipboard access.
    }

    const copied = this.copyWithTextarea(text);
    this.showCopyStatus(copied ? "调试信息已复制" : "自动复制失败，请长按下方文字手动复制", copied);
  };

  private renderGlobalErrorNotice(): ReactNode {
    if (this.state.globalErrors.length === 0 || this.state.fatalErrorDetails) return null;

    const occurrenceCount = this.state.globalErrors.reduce((total, record) => total + record.count, 0);
    const copyFailed = this.state.copyStatus.startsWith("自动复制失败");

    return (
      <>
        {this.state.globalErrorNoticeVisible && (
          <div className="app-global-error-badge" role="status">
            <button
              aria-label={`打开错误详情，${this.state.globalErrorNoticeSecondsRemaining} 秒后提示自动关闭`}
              className="app-global-error-badge-details"
              onClick={() => this.setState({ errorDetailsOpen: true })}
              type="button"
            >
              <span aria-hidden="true" className="app-global-error-badge-icon">!</span>
              <span className="app-global-error-badge-countdown">
                {this.state.globalErrorNoticeSecondsRemaining}秒
              </span>
            </button>
            <button
              aria-label="关闭错误提示"
              className="app-global-error-badge-close"
              onClick={this.dismissGlobalErrorNotice}
              type="button"
            >
              ×
            </button>
          </div>
        )}
        {this.state.errorDetailsOpen && (
          <div
            className="app-global-error-dialog-backdrop"
            onClick={() => this.setState({ errorDetailsOpen: false })}
          >
            <section
              aria-labelledby="app-global-error-dialog-title"
              aria-modal="true"
              className="app-global-error-dialog"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              <header className="app-global-error-dialog-header">
                <div>
                  <h2 id="app-global-error-dialog-title">页面运行错误</h2>
                  <p>已记录 {occurrenceCount} 次、{this.state.globalErrors.length} 类。页面仍可继续使用。</p>
                </div>
                <button
                  aria-label="关闭错误详情"
                  className="app-global-error-dialog-close"
                  onClick={() => this.setState({ errorDetailsOpen: false })}
                  type="button"
                >
                  ×
                </button>
              </header>
              <p className="app-global-error-build-info">
                版本 {__APP_VERSION__} · 构建时间 {formatDateTime(__APP_BUILD_TIME__)}
              </p>
              <div className="app-global-error-dialog-actions">
                <button onClick={() => void this.copyDebugInfo()} type="button">复制诊断信息</button>
                <button onClick={() => void this.refreshPage()} type="button">刷新页面</button>
              </div>
              <p aria-live="polite" className="app-global-error-dialog-copy-status">
                {this.state.copyStatus || "诊断记录会保留到本次页面刷新。"}
              </p>
              <details open={copyFailed}>
                <summary>错误详情（可手动复制）</summary>
                <pre>{this.buildDebugInfo()}</pre>
              </details>
            </section>
          </div>
        )}
      </>
    );
  }

  render(): ReactNode {
    if (this.state.fatalErrorDetails) {
      return (
        <main className="app-error-debug" role="alert">
          <section className="app-error-debug-card">
            <div className="app-error-debug-toolbar">
              <div>
                <h1>页面渲染失败</h1>
                <p>当前页面无法正常显示。请复制调试信息并反馈，方便定位问题。</p>
                <p className="app-error-build-info">
                  版本 {__APP_VERSION__} · 构建时间 {formatDateTime(__APP_BUILD_TIME__)}
                </p>
              </div>
              <div className="app-error-debug-copy-control">
                <div className="app-error-debug-actions">
                  <button onClick={() => void this.copyDebugInfo()} type="button">复制调试信息</button>
                  <button onClick={() => void this.refreshPage()} type="button">刷新页面</button>
                </div>
                <p aria-live="polite" className="app-error-debug-copy-status">{this.state.copyStatus}</p>
              </div>
            </div>
            <pre>{this.buildDebugInfo()}</pre>
          </section>
        </main>
      );
    }
    return (
      <>
        {this.props.children}
        {this.renderGlobalErrorNotice()}
      </>
    );
  }
}
