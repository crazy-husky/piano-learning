export type PausedKeyboardAction = "allow-edit" | "block";

export function getPausedKeyboardAction({
  isEditableTarget,
}: {
  isEditableTarget: boolean;
}): PausedKeyboardAction {
  return isEditableTarget ? "allow-edit" : "block";
}
