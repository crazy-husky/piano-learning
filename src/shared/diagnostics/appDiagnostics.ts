export type AppDiagnosticSource = "app-update" | "service-worker-update" | "backend";

export interface AppDiagnostic {
  source: AppDiagnosticSource;
  details: string;
  notify?: boolean;
}

export interface BackendErrorContext {
  /** Stable action name, such as "save-practice-history". */
  operation: string;
  method?: string;
  /** URL or path. Query parameters and fragments are removed before recording. */
  endpoint?: string;
  status?: number;
  code?: string;
  /** A server correlation ID, when the API provides one. */
  requestId?: string;
}

export const APP_DIAGNOSTIC_EVENT = "app-diagnostic";

export function reportAppDiagnostic(diagnostic: AppDiagnostic): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AppDiagnostic>(APP_DIAGNOSTIC_EVENT, { detail: diagnostic })
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const lines = [
      `Name: ${error.name}`,
      `Message: ${error.message || "(message unavailable)"}`,
      `Stack:\n${error.stack || "(stack unavailable)"}`,
    ];
    if (error.cause !== undefined && error.cause !== error) {
      lines.push(`Cause:\n${describeError(error.cause)}`);
    }
    return lines.join("\n");
  }
  if (typeof error === "string") return `Message: ${error}`;
  try {
    return `Thrown value: ${JSON.stringify(error, null, 2) ?? String(error)}`;
  } catch {
    return `Thrown value: ${String(error)}`;
  }
}

function sanitizeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint, window.location.origin);
    return url.origin === window.location.origin ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return endpoint.split(/[?#]/, 1)[0];
  }
}

function safeDiagnosticText(value: string, maxLength = 200): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function optionalContextLine(label: string, value: string | number | undefined): string[] {
  if (value === undefined || value === "") return [];
  return [`${label}: ${typeof value === "string" ? safeDiagnosticText(value) : value}`];
}

/**
 * Add a caught backend request error to the shared diagnostic panel.
 * Pass only safe request context; do not include credentials or request bodies.
 */
export function reportBackendError(error: unknown, context: BackendErrorContext): void {
  const operation = safeDiagnosticText(context.operation) || "unspecified";
  const details = [
    "Category: backend request",
    `Operation: ${operation}`,
    ...optionalContextLine("Method", context.method?.toUpperCase()),
    ...optionalContextLine(
      "Endpoint",
      context.endpoint ? sanitizeEndpoint(context.endpoint) : undefined
    ),
    ...optionalContextLine("HTTP status", context.status),
    ...optionalContextLine("Error code", context.code),
    ...optionalContextLine("Request ID", context.requestId),
    `Error:\n${describeError(error)}`,
  ].join("\n");

  reportAppDiagnostic({ source: "backend", details });
}
