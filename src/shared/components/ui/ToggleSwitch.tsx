import * as RadixSwitch from "@radix-ui/react-switch";
import type { ComponentPropsWithoutRef } from "react";

type ToggleSwitchProps = ComponentPropsWithoutRef<typeof RadixSwitch.Root>;

export function ToggleSwitch({ className, ...props }: ToggleSwitchProps): JSX.Element {
  return (
    <RadixSwitch.Root {...props} className={["ui-switch", className].filter(Boolean).join(" ")}>
      <RadixSwitch.Thumb className="ui-switch-thumb" />
    </RadixSwitch.Root>
  );
}
