import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { resetLegacyDatabaseForAnswerEvents } from "./data/db";
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
  void resetLegacyDatabaseForAnswerEvents().then((ready) => {
    if (!ready) {
      root.innerHTML =
        '<main role="alert" style="padding:2rem">数据结构重置被其他打开的页面阻塞。请关闭此应用的其他标签页后刷新。</main>';
      return;
    }
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <AppErrorBoundary>
          <ConfirmDialogProvider>
            <App />
          </ConfirmDialogProvider>
        </AppErrorBoundary>
      </React.StrictMode>
    );
  });
}
