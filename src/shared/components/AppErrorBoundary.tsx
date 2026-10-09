import { Component, type ErrorInfo, type ReactNode } from "react";
import { toast } from "sonner";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  fatalErrorDetails: string | null;
  globalErrors: GlobalErrorRecord[];
  copyStatus: string;
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
  };
  private copyStatusTimeout: number | null = null;

  componentDidMount(): void {
    window.addEventListener("error", this.handleWindowError, true);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
  }

  componentWillUnmount(): void {
    window.removeEventListener("error", this.handleWindowError, true);
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
    if (this.copyStatusTimeout !== null) window.clearTimeout(this.copyStatusTimeout);
  }

  static getDerivedStateFromError(error: unknown): Partial<AppErrorBoundaryState> {
    return { fatalErrorDetails: describeError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({
      fatalErrorDetails: `${describeError(error)}\n\nReact component stack:${info.componentStack || " (unavailable)"}`,
    });
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
    if (!this.state.fatalErrorDetails) {
      toast.error("检测到后台错误", {
        id: "app-global-error-notice",
        description: "页面仍在运行。近期错误已记录，可以复制诊断信息反馈。",
        duration: 8_000,
        action: {
          label: "复制诊断信息",
          onClick: () => void this.copyDebugInfo(),
        },
      });
    }
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

  private buildDebugInfo = (): string => [
    `Browser: ${navigator.userAgent}`,
    `Page: ${window.location.pathname}${window.location.hash}`,
    `Viewport: ${window.innerWidth} × ${window.innerHeight}`,
    `Online: ${navigator.onLine ? "yes" : "no"}`,
    `Time: ${new Date().toISOString()}`,
    "",
    this.state.fatalErrorDetails
      ? `Fatal React render error:\n${this.state.fatalErrorDetails}`
      : "Fatal React render error: none",
    "",
    `Recent unhandled errors (${this.state.globalErrors.length} grouped; limit ${MAX_GLOBAL_ERROR_RECORDS}):`,
    ...(this.state.globalErrors.length > 0
      ? this.state.globalErrors.map((record) => [
        `Source: ${record.source}`,
        `First seen: ${record.firstSeenAt}`,
        `Last seen: ${record.lastSeenAt}`,
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
    if (this.state.globalErrors.length === 0) return null;

    const occurrenceCount = this.state.globalErrors.reduce((total, record) => total + record.count, 0);
    const copyFailed = this.state.copyStatus.startsWith("自动复制失败");

    return (
      <aside aria-label="后台错误诊断" className="app-global-error-notice" role="region">
        <div className="app-global-error-notice-header">
          <div>
            <strong>页面检测到后台错误</strong>
            <span>共记录 {occurrenceCount} 次、{this.state.globalErrors.length} 类，页面仍可继续使用。</span>
          </div>
          <button onClick={() => void this.copyDebugInfo()} type="button">复制诊断信息</button>
        </div>
        <p aria-live="polite" className="app-global-error-notice-copy-status">
          {this.state.copyStatus || "诊断记录会保留到本次页面刷新。"}
        </p>
        <details open={copyFailed}>
          <summary>查看诊断记录（可手动复制）</summary>
          <pre>{this.buildDebugInfo()}</pre>
        </details>
      </aside>
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
              </div>
              <div className="app-error-debug-copy-control">
                <button onClick={() => void this.copyDebugInfo()} type="button">复制调试信息</button>
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
