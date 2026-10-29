import type { AppSettings, PracticeSessionRecord, ReviewRecord } from "../../../domain/types";
import { StatsView } from "../../stats/components/StatsView";

export function SingleNoteStats({
  settings,
  reviews,
  sessions,
  onSettingsSaved,
}: {
  settings: AppSettings;
  reviews: ReviewRecord[];
  sessions: PracticeSessionRecord[];
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
}): JSX.Element {
  return (
    <StatsView
      moduleScope="single-note"
      onSettingsSaved={onSettingsSaved}
      reviews={reviews}
      sessions={sessions}
      settings={settings}
    />
  );
}
