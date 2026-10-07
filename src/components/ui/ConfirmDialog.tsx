import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export interface ConfirmDialogOptions {
  cancelLabel?: string;
  confirmLabel?: string;
  description: string;
  destructive?: boolean;
  title: string;
}

type ConfirmDialog = (options: ConfirmDialogOptions) => Promise<boolean>;

const ConfirmDialogContext = createContext<ConfirmDialog | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }): JSX.Element {
  const [request, setRequest] = useState<ConfirmDialogOptions | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const finish = useCallback((confirmed: boolean): void => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }, []);

  const confirm = useCallback<ConfirmDialog>((options) => new Promise((resolve) => {
    resolverRef.current?.(false);
    resolverRef.current = resolve;
    setRequest(options);
  }), []);

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      <AlertDialog.Root open={request !== null} onOpenChange={(open) => { if (!open) finish(false); }}>
        {request ? (
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="ui-confirm-overlay" />
            <AlertDialog.Content className="ui-confirm-content">
              <AlertDialog.Title className="ui-confirm-title">{request.title}</AlertDialog.Title>
              <AlertDialog.Description className="ui-confirm-description">
                {request.description}
              </AlertDialog.Description>
              <div className="ui-confirm-actions">
                <AlertDialog.Cancel asChild>
                  <button className="ui-confirm-cancel" onClick={() => finish(false)} type="button">
                    {request.cancelLabel ?? "取消"}
                  </button>
                </AlertDialog.Cancel>
                <AlertDialog.Action asChild>
                  <button
                    className={request.destructive ? "ui-confirm-action is-destructive" : "ui-confirm-action"}
                    onClick={() => finish(true)}
                    type="button"
                  >
                    {request.confirmLabel ?? "确认"}
                  </button>
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        ) : null}
      </AlertDialog.Root>
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog(): ConfirmDialog {
  const confirm = useContext(ConfirmDialogContext);
  if (!confirm) throw new Error("useConfirmDialog requires ConfirmDialogProvider");
  return confirm;
}
