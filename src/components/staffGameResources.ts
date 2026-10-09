import { preloadPianoSamples } from "../audio/piano";
import { preloadStaffGameSounds } from "../audio/staffGameSounds";
import gameBackgroundDesktop from "../assets/staff-game/backgrounds/meadow-desktop.webp";
import gameBackgroundMobile from "../assets/staff-game/backgrounds/meadow-mobile.webp";
import gameBackgroundMusic from "../assets/staff-game/audio/relaxed-game-bgm.mp3";
import mascotCelebrationFrames from "../assets/staff-game/characters/mascot-celebration-frames.webp";
import mascotCheerFrames from "../assets/staff-game/characters/mascot-cheer-frames.webp";
import mascotPauseFrames from "../assets/staff-game/characters/mascot-pause-frames.webp";
import mascotSadFrames from "../assets/staff-game/characters/mascot-sad-frames.webp";
import bubbleShell from "../assets/staff-game/effects/bubble-shell-empty-center.webp";
import cloudDecorationOne from "../assets/staff-game/effects/cloud-decoration-1.webp";
import cloudDecorationTwo from "../assets/staff-game/effects/cloud-decoration-2.webp";
import cloudDecorationThree from "../assets/staff-game/effects/cloud-decoration-3.webp";
import notationC4Preview from "../assets/staff-game/notation/treble-staff-c4-note.webp";
import buttonPrimaryArt from "../assets/staff-game/ui/button-primary-base.webp";
import buttonSecondaryArt from "../assets/staff-game/ui/button-secondary-base.webp";
import actionHelpArt from "../assets/staff-game/ui/action-help.webp";
import actionPauseArt from "../assets/staff-game/ui/action-pause.webp";
import actionResumeArt from "../assets/staff-game/ui/action-resume.webp";
import actionReturnArt from "../assets/staff-game/ui/action-return.webp";
import actionSettingsArt from "../assets/staff-game/ui/action-settings.webp";
import helpTitleArt from "../assets/staff-game/ui/help-title-tip.webp";
import hudFrameArt from "../assets/staff-game/ui/hud-frame.webp";
import modalFrameArt from "../assets/staff-game/ui/modal-frame.webp";
import starParticleArt from "../assets/staff-game/ui/star-particle.webp";
import settingsPawArt from "../assets/staff-game/ui/settings-paw.webp";
import levelJumpDecorationArt from "../assets/staff-game/ui/level-jump-decoration.webp";
import summaryLevelBannerArt from "../assets/staff-game/ui/summary-level-banner.webp";
import summaryFireworksArt from "../assets/staff-game/ui/summary-fireworks.webp";

export const STAFF_GAME_ART = {
  gameBackgroundDesktop,
  gameBackgroundMobile,
  gameBackgroundMusic,
  mascotCelebrationFrames,
  mascotCheerFrames,
  mascotPauseFrames,
  mascotSadFrames,
  bubbleShell,
  cloudDecorationOne,
  cloudDecorationTwo,
  cloudDecorationThree,
  notationC4Preview,
  buttonPrimaryArt,
  buttonSecondaryArt,
  actionHelpArt,
  actionPauseArt,
  actionResumeArt,
  actionReturnArt,
  actionSettingsArt,
  helpTitleArt,
  hudFrameArt,
  modalFrameArt,
  starParticleArt,
  settingsPawArt,
  levelJumpDecorationArt,
  summaryLevelBannerArt,
  summaryFireworksArt,
} as const;

const STAFF_GAME_IMAGE_ASSETS = [
  STAFF_GAME_ART.gameBackgroundDesktop,
  STAFF_GAME_ART.gameBackgroundMobile,
  STAFF_GAME_ART.mascotCelebrationFrames,
  STAFF_GAME_ART.mascotCheerFrames,
  STAFF_GAME_ART.mascotPauseFrames,
  STAFF_GAME_ART.mascotSadFrames,
  STAFF_GAME_ART.bubbleShell,
  STAFF_GAME_ART.cloudDecorationOne,
  STAFF_GAME_ART.cloudDecorationTwo,
  STAFF_GAME_ART.cloudDecorationThree,
  STAFF_GAME_ART.notationC4Preview,
  STAFF_GAME_ART.buttonPrimaryArt,
  STAFF_GAME_ART.buttonSecondaryArt,
  STAFF_GAME_ART.actionHelpArt,
  STAFF_GAME_ART.actionPauseArt,
  STAFF_GAME_ART.actionResumeArt,
  STAFF_GAME_ART.actionReturnArt,
  STAFF_GAME_ART.actionSettingsArt,
  STAFF_GAME_ART.helpTitleArt,
  STAFF_GAME_ART.hudFrameArt,
  STAFF_GAME_ART.modalFrameArt,
  STAFF_GAME_ART.starParticleArt,
  STAFF_GAME_ART.settingsPawArt,
  STAFF_GAME_ART.levelJumpDecorationArt,
  STAFF_GAME_ART.summaryLevelBannerArt,
  STAFF_GAME_ART.summaryFireworksArt,
];
export const STAFF_GAME_RESOURCE_MAX_RETRIES = 3;
export const STAFF_GAME_RESOURCE_RETRY_DELAY_MS = 500;
const STAFF_GAME_IMAGE_TIMEOUT_MS = 15_000;
const STAFF_GAME_BACKGROUND_AUDIO_TIMEOUT_MS = 15_000;
// Keep decoded images alive across route re-entry; failed loads are removed so retries can fetch them again.
const staffGameImageCache = new Map<string, HTMLImageElement>();
const pendingStaffGameImageLoads = new Map<string, Promise<void>>();

function loadGameImage(source: string): Promise<void> {
  if (staffGameImageCache.has(source)) return Promise.resolve();
  const pendingLoad = pendingStaffGameImageLoads.get(source);
  if (pendingLoad) return pendingLoad;

  const image = new Image();
  const loadPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: number | undefined;
    const handleError = (): void => settle(new Error(`Failed to load ${source}`));
    const cleanup = (): void => {
      image.removeEventListener("load", finishLoading);
      image.removeEventListener("error", handleError);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        staffGameImageCache.set(source, image);
        resolve();
      }
    };
    const finishLoading = (): void => {
      if (typeof image.decode !== "function") {
        settle();
        return;
      }
      void image.decode().then(
        () => settle(),
        () => settle(image.naturalWidth > 0 ? undefined : new Error(`Failed to decode ${source}`)),
      );
    };

    timeout = window.setTimeout(() => {
      settle(new Error(`Timed out while loading ${source}`));
      image.removeAttribute("src");
    }, STAFF_GAME_IMAGE_TIMEOUT_MS);
    image.addEventListener("load", finishLoading, { once: true });
    image.addEventListener("error", handleError, { once: true });
    image.src = source;
    if (image.complete) {
      if (image.naturalWidth > 0) finishLoading();
      else settle(new Error(`Failed to load ${source}`));
    }
  });
  pendingStaffGameImageLoads.set(source, loadPromise);
  void loadPromise.then(
    () => pendingStaffGameImageLoads.delete(source),
    () => pendingStaffGameImageLoads.delete(source),
  );
  return loadPromise;
}

async function preloadStaffGameImages(): Promise<number> {
  const results = await Promise.allSettled(STAFF_GAME_IMAGE_ASSETS.map(loadGameImage));
  return results.filter((result) => result.status === "rejected").length;
}

function preloadGameBackgroundMusic(audio: HTMLAudioElement, signal: AbortSignal, retry: boolean): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve();
  if (retry && audio.error) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("error", handleError);
      signal.removeEventListener("abort", handleAbort);
      window.clearTimeout(timeout);
    };
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const handleCanPlay = (): void => settle();
    const handleError = (): void => settle(new Error("Failed to load game background music"));
    const handleAbort = (): void => settle();
    const timeout = window.setTimeout(
      () => settle(new Error("Timed out while loading game background music")),
      STAFF_GAME_BACKGROUND_AUDIO_TIMEOUT_MS,
    );

    audio.addEventListener("canplay", handleCanPlay, { once: true });
    audio.addEventListener("error", handleError, { once: true });
    signal.addEventListener("abort", handleAbort, { once: true });
    audio.preload = "auto";
    audio.volume = 0.06;
    audio.src = gameBackgroundMusic;
    audio.load();
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) settle();
  });
}

export async function preloadStaffGameResources(
  backgroundMusic: HTMLAudioElement,
  signal: AbortSignal,
  retry: boolean,
): Promise<number> {
  const [imageFailures, soundFailures, backgroundMusicFailures, pianoSampleFailures] = await Promise.all([
    preloadStaffGameImages(),
    preloadStaffGameSounds(),
    preloadGameBackgroundMusic(backgroundMusic, signal, retry).then(() => 0, () => 1),
    preloadPianoSamples().then((loaded) => loaded ? 0 : 1, () => 1),
  ]);
  return imageFailures + soundFailures + backgroundMusicFailures + pianoSampleFailures;
}
