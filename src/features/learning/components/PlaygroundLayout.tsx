import type { ReactNode } from "react";

export type PlaygroundSongMode = "score" | "bubble" | "stats";
export type PlaygroundChallengeMode = "game" | "stats";

export function PlaygroundLayout({
  activeTab,
  challengeMode,
  children,
  onChallengeModeChange,
  onSongModeChange,
  showChallengeModes = true,
  showSongModes = true,
  songMode,
}: {
  activeTab: "challenge" | "songs" | "stats";
  challengeMode?: PlaygroundChallengeMode;
  children: ReactNode;
  onChallengeModeChange?: (mode: PlaygroundChallengeMode) => void;
  onSongModeChange?: (mode: PlaygroundSongMode) => void;
  showChallengeModes?: boolean;
  showSongModes?: boolean;
  songMode?: PlaygroundSongMode;
}): JSX.Element {
  const hasVisibleModeTabs =
    (activeTab === "challenge" && challengeMode && onChallengeModeChange && showChallengeModes) ||
    (activeTab !== "challenge" && songMode && onSongModeChange && showSongModes);
  const isGameModeLayout =
    hasVisibleModeTabs &&
    ((activeTab === "challenge" && challengeMode === "game") ||
      (activeTab === "songs" && songMode === "bubble"));

  return (
    <section
      aria-label="游乐场"
      className={`playground-layout${isGameModeLayout ? " is-game-mode-layout" : ""}`}
    >
      {activeTab === "challenge" && challengeMode && onChallengeModeChange && showChallengeModes ? (
        <div aria-label="闯关玩法" className="playground-challenge-mode-tabs" role="tablist">
          <button
            aria-selected={challengeMode === "game"}
            className={challengeMode === "game" ? "is-active" : ""}
            onClick={() => onChallengeModeChange("game")}
            role="tab"
            type="button"
          >
            游戏
          </button>
          <button
            aria-selected={challengeMode === "stats"}
            className={challengeMode === "stats" ? "is-active" : ""}
            onClick={() => onChallengeModeChange("stats")}
            role="tab"
            type="button"
          >
            统计
          </button>
        </div>
      ) : null}
      {activeTab !== "challenge" && songMode && onSongModeChange && showSongModes ? (
        <div aria-label="歌曲玩法" className="playground-song-mode-tabs" role="tablist">
          <button
            aria-selected={songMode === "score"}
            className={songMode === "score" ? "is-active" : ""}
            onClick={() => onSongModeChange("score")}
            role="tab"
            type="button"
          >
            五线谱练习
          </button>
          <button
            aria-selected={songMode === "bubble"}
            className={songMode === "bubble" ? "is-active" : ""}
            onClick={() => onSongModeChange("bubble")}
            role="tab"
            type="button"
          >
            气泡游戏
          </button>
          <button
            aria-selected={songMode === "stats"}
            className={songMode === "stats" ? "is-active" : ""}
            onClick={() => onSongModeChange("stats")}
            role="tab"
            type="button"
          >
            统计
          </button>
        </div>
      ) : null}
      <div className={`playground-content is-${activeTab}`}>{children}</div>
    </section>
  );
}
