import type { MetronomeController } from "../useMetronomeController";
import { MetronomeCore } from "./MetronomeCore";

export function MetronomePage({ controller }: { controller: MetronomeController }): JSX.Element {
  return (
    <section aria-label="木鱼节拍器" className="metronome-page-shell">
      <MetronomeCore controller={controller} variant="page" />
    </section>
  );
}
