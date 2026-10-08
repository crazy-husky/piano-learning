import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  errorDetails: string | null;
  copyStatus: string;
}

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
  state: AppErrorBoundaryState = { errorDetails: null, copyStatus: "" };
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
    return { errorDetails: describeError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({
      errorDetails: `${describeError(error)}\n\nReact component stack:${info.componentStack || " (unavailable)"}`,
    });
  }

  private captureGlobalError = (details: string): void => {
    this.setState((current) => current.errorDetails ? null : { errorDetails: details });
  };

  private handleWindowError = (event: Event): void => {
    if (!(event instanceof ErrorEvent)) {
      const target = event.target;
      // Recoverable image/font failures should not replace the entire app with a crash screen.
      // A failed script can prevent the application from starting, so report it globally.
      if (!(target instanceof HTMLScriptElement)) return;
      const failedElement = `script src=${target.src}`;
      this.captureGlobalError(["Source: resource-load-error", `Failed element: ${failedElement}`].join("\n"));
      return;
    }
    const location = event.filename
      ? `Location: ${event.filename}:${event.lineno}:${event.colno}`
      : "Location: (unavailable)";
    this.captureGlobalError([
      "Source: window.error",
      `Browser message: ${event.message || "(message unavailable)"}`,
      location,
      event.error ? describeError(event.error) : "Error object: (unavailable)",
    ].join("\n"));
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    this.captureGlobalError([
      "Source: unhandledrejection",
      `Reason: ${describeError(event.reason)}`,
    ].join("\n"));
  };

  private buildDebugInfo = (): string => [
    `Browser: ${navigator.userAgent}`,
    `Page: ${window.location.pathname}${window.location.hash}`,
    `Viewport: ${window.innerWidth} × ${window.innerHeight}`,
    `Online: ${navigator.onLine ? "yes" : "no"}`,
    `Time: ${new Date().toISOString()}`,
    "",
    this.state.errorDetails ?? "(error details unavailable)",
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

  render(): ReactNode {
    if (this.state.errorDetails) {
      return (
        <main className="app-error-debug" role="alert">
          <section className="app-error-debug-card">
            <div className="app-error-debug-toolbar">
              <div>
                <h1>应用出现错误</h1>
                <p>请复制调试信息并反馈，方便定位页面或浏览器兼容问题。</p>
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
    return this.props.children;
  }
}
