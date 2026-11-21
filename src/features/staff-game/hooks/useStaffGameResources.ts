import { useEffect, useRef, useState } from "react";
import { disconnectStaffGameBackgroundAudio } from "../audio/staffGameBackgroundAudio";
import {
  createStaffGameResourceProgress,
  preloadStaffGameResources,
  STAFF_GAME_RESOURCE_MAX_RETRIES,
  STAFF_GAME_RESOURCE_RETRY_DELAY_MS,
  type StaffGameResourceProgress,
  type StaffGameResourceUpdate,
} from "../logic/staffGameResources";

export function useStaffGameResources() {
  const [resourceLoadState, setResourceLoadState] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [resourceProgress, setResourceProgress] = useState<StaffGameResourceProgress[]>(
    createStaffGameResourceProgress
  );
  const [resourceLoadAttempt, setResourceLoadAttempt] = useState(0);
  const [resourceLoadRetryCount, setResourceLoadRetryCount] = useState(0);
  const backgroundMusicRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let active = true;
    let retryTimer: number | null = null;
    let retryCount = 0;
    const backgroundMusicPreloadController = new AbortController();
    const backgroundMusic = new Audio();
    backgroundMusic.loop = true;
    backgroundMusic.preload = "auto";
    backgroundMusicRef.current = backgroundMusic;
    setResourceLoadState("loading");
    setResourceLoadRetryCount(0);
    setResourceProgress(createStaffGameResourceProgress());
    const updateResourceProgress = (update: StaffGameResourceUpdate): void => {
      if (!active) return;
      setResourceProgress((resources) =>
        resources.map((resource) =>
          resource.id === update.id
            ? { ...resource, status: update.status, error: update.error }
            : resource
        )
      );
    };
    const loadResources = async (): Promise<void> => {
      const failureCount = await preloadStaffGameResources(
        backgroundMusic,
        backgroundMusicPreloadController.signal,
        retryCount > 0,
        updateResourceProgress
      );
      if (!active) return;
      if (failureCount === 0) {
        setResourceLoadState("ready");
        return;
      }
      if (retryCount >= STAFF_GAME_RESOURCE_MAX_RETRIES) {
        setResourceLoadState("error");
        return;
      }

      retryCount += 1;
      setResourceLoadRetryCount(retryCount);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void loadResources();
      }, STAFF_GAME_RESOURCE_RETRY_DELAY_MS * retryCount);
    };
    void loadResources();
    return () => {
      active = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      backgroundMusicPreloadController.abort();
      backgroundMusic.pause();
      disconnectStaffGameBackgroundAudio(backgroundMusic);
      backgroundMusic.removeAttribute("src");
      backgroundMusic.load();
      if (backgroundMusicRef.current === backgroundMusic) backgroundMusicRef.current = null;
    };
  }, [resourceLoadAttempt]);

  return {
    backgroundMusicRef,
    resourceLoadRetryCount,
    resourceLoadState,
    resourceProgress,
    setResourceLoadAttempt,
  };
}
