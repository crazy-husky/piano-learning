import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { toast } from "sonner";
import type { Staff } from "../../../domain/types";
import type { PracticePromptRuntime } from "./usePracticeSessionLifecycle";
import { getDuetWrongHint, type DuetHintContent } from "../logic/practiceViewHelpers";

const DUET_FEEDBACK_MIN_INTERVAL_MS = 1_500;

export interface PendingDuetHandPair {
  prompt: PracticePromptRuntime;
  firstStaff: Staff;
  firstInputAtMs: number;
  wrongStaves: Set<Staff>;
  hasUnknownWrong: boolean;
  timeoutId: number | null;
}

interface PendingDuetHintRequest extends DuetHintContent {
  prompt: PracticePromptRuntime;
}

interface DuetWrongHintBatch {
  prompt: PracticePromptRuntime | null;
  hands: Set<Staff>;
  timeoutId: number | null;
}

export function usePracticeDuetHints(
  promptRef: MutableRefObject<PracticePromptRuntime | null>,
  pendingHandPairRef: MutableRefObject<PendingDuetHandPair | null>
) {
  const wrongHintBatchRef = useRef<DuetWrongHintBatch>({
    prompt: null,
    hands: new Set(),
    timeoutId: null,
  });
  const pendingHintsRef = useRef<PendingDuetHintRequest[]>([]);
  const hintTimeoutRef = useRef<number | null>(null);
  const lastHintAtRef = useRef(Number.NEGATIVE_INFINITY);

  const showDuetHint = useCallback(
    (prompt: PracticePromptRuntime, key: string, message: string): void => {
      const pendingHints = pendingHintsRef.current;
      const currentHints = pendingHints.filter((hint) => hint.prompt === prompt);
      pendingHints.splice(0, pendingHints.length, ...currentHints);
      if (!pendingHints.some((hint) => hint.prompt === prompt && hint.key === key)) {
        pendingHints.push({ key, message, prompt });
      }

      const scheduleNextHint = (): void => {
        if (hintTimeoutRef.current !== null || pendingHints.length === 0) return;
        const delayMs = Math.max(
          0,
          DUET_FEEDBACK_MIN_INTERVAL_MS - (performance.now() - lastHintAtRef.current)
        );
        hintTimeoutRef.current = window.setTimeout(() => {
          hintTimeoutRef.current = null;
          const nextHint = pendingHints.shift();
          if (nextHint && promptRef.current === nextHint.prompt) {
            toast.message(nextHint.message, {
              id: "duet-practice-feedback",
              duration: DUET_FEEDBACK_MIN_INTERVAL_MS,
            });
            lastHintAtRef.current = performance.now();
          }
          scheduleNextHint();
        }, delayMs);
      };

      scheduleNextHint();
    },
    [promptRef]
  );

  const queueDuetWrongHint = useCallback(
    (prompt: PracticePromptRuntime, staff: Staff | null): void => {
      const pendingPair = pendingHandPairRef.current;
      if (pendingPair?.prompt === prompt) {
        if (staff) pendingPair.wrongStaves.add(staff);
        else pendingPair.hasUnknownWrong = true;
        return;
      }

      if (!staff) {
        showDuetHint(prompt, "wrong:unknown", "音符不对，请检查当前谱面目标");
        return;
      }

      const batch = wrongHintBatchRef.current;
      if (batch.prompt !== prompt) {
        if (batch.timeoutId !== null) window.clearTimeout(batch.timeoutId);
        batch.prompt = prompt;
        batch.hands = new Set();
        batch.timeoutId = null;
      }
      batch.hands.add(staff);
      if (batch.timeoutId !== null) return;
      batch.timeoutId = window.setTimeout(() => {
        batch.timeoutId = null;
        if (promptRef.current !== prompt) {
          batch.hands.clear();
          return;
        }
        const hands = [...batch.hands].sort();
        batch.hands.clear();
        const hint = getDuetWrongHint(hands, false);
        if (hint) showDuetHint(prompt, hint.key, hint.message);
      }, 100);
    },
    [pendingHandPairRef, promptRef, showDuetHint]
  );

  useEffect(
    () => () => {
      const wrongHint = wrongHintBatchRef.current;
      if (wrongHint.timeoutId !== null) window.clearTimeout(wrongHint.timeoutId);
      if (hintTimeoutRef.current !== null) window.clearTimeout(hintTimeoutRef.current);
    },
    []
  );

  return { queueDuetWrongHint, showDuetHint };
}
