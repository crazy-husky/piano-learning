import type {
  AppSettings,
  PracticeSessionRecord,
  ReviewRecord,
  StaffRecallRunRecord,
} from "../../../domain/types";
import type { LearningLevelId } from "../../../routing/appRoutes";
import { LearningStatsCenter } from "./LearningStatsCenter";

export function LearningModuleStatsView({
  levelId,
  settings,
  reviews,
  sessions,
  staffRecallRuns,
  onDataChanged,
}: {
  levelId: LearningLevelId;
  settings: AppSettings;
  reviews: ReviewRecord[];
  sessions: PracticeSessionRecord[];
  staffRecallRuns: StaffRecallRunRecord[];
  onDataChanged: () => Promise<void>;
}): JSX.Element {
  return (
    <LearningStatsCenter
      key={levelId}
      levelId={levelId}
      onDataChanged={onDataChanged}
      reviews={reviews}
      sessions={sessions}
      settings={settings}
      staffRecallRuns={staffRecallRuns}
    />
  );
}
