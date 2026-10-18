import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useEffect, useRef, useState } from "react";
import {
  isB6SwiftF0ReminderShownToday,
  markB6SwiftF0ReminderShownToday,
} from "../logic/b6SwiftF0Reminder";

interface B6SwiftF0ReminderDialogProps {
  active: boolean;
}

export function B6SwiftF0ReminderDialog({
  active,
}: B6SwiftF0ReminderDialogProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const evaluatedActivationRef = useRef(false);

  useEffect(() => {
    if (!active) {
      evaluatedActivationRef.current = false;
      setOpen(false);
      return;
    }
    if (evaluatedActivationRef.current) return;
    evaluatedActivationRef.current = true;
    if (isB6SwiftF0ReminderShownToday()) return;

    markB6SwiftF0ReminderShownToday();
    setOpen(true);
  }, [active]);

  if (!open) return null;

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setOpen(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="b6-swiftf0-reminder-overlay" />
        <AlertDialog.Content
          aria-describedby="b6-swiftf0-reminder-description"
          aria-labelledby="b6-swiftf0-reminder-title"
          className="b6-swiftf0-reminder-dialog"
        >
          <AlertDialog.Title className="b6-swiftf0-reminder-title" id="b6-swiftf0-reminder-title">
            B6 麦克风识别提示
          </AlertDialog.Title>
          <AlertDialog.Description
            className="b6-swiftf0-reminder-description"
            id="b6-swiftf0-reminder-description"
          >
            当前算法对 B6 的识别可能不稳定。若遇到识别问题，可前往「设置 → 麦克风答题 →
            识别算法」切换为 SwiftF0。
          </AlertDialog.Description>
          <div className="b6-swiftf0-reminder-actions">
            <AlertDialog.Cancel asChild>
              <button className="b6-swiftf0-reminder-dismiss" type="button">
                知道了
              </button>
            </AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
