import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { AppErrorBoundary } from "./shared/components/AppErrorBoundary";
import { ConfirmDialogProvider } from "./shared/components/ui/ConfirmDialog";
import { inspectBrowserSupport, renderBrowserUpgradeNotice } from "./browserSupport";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Application root element was not found.");
}

const browserSupport = inspectBrowserSupport();

if (!browserSupport.supported) {
  renderBrowserUpgradeNotice(root, browserSupport);
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <ConfirmDialogProvider>
          <App />
        </ConfirmDialogProvider>
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}
