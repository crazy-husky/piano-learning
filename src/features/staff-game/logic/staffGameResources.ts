import { getPianoSampleLoadError, preloadPianoSamples } from "../../../audio/piano";
import { preloadStaffGameSounds, STAFF_GAME_SOUND_RESOURCES } from "../audio/staffGameSounds";
import gameBackgroundDesktop from "../assets/backgrounds/meadow-desktop.webp";
import gameBackgroundMobile from "../assets/backgrounds/meadow-mobile.webp";
import gameBackgroundMusic from "../assets/audio/relaxed-game-bgm.mp3";
import mascotCelebrationFrames from "../assets/characters/mascot-celebration-frames.webp";
import mascotCheerFrames from "../assets/characters/mascot-cheer-frames.webp";
import mascotPauseFrames from "../assets/characters/mascot-pause-frames.webp";
import mascotSadFrames from "../assets/characters/mascot-sad-frames.webp";
import bubbleShell from "../assets/effects/bubble-shell-empty-center.webp";
import cloudDecorationOne from "../assets/effects/cloud-decoration-1.webp";
import cloudDecorationTwo from "../assets/effects/cloud-decoration-2.webp";
import cloudDecorationThree from "../assets/effects/cloud-decoration-3.webp";
import notationC4Preview from "../assets/notation/treble-staff-c4-note.webp";
import buttonPrimaryArt from "../assets/ui/button-primary-base.webp";
import buttonSecondaryArt from "../assets/ui/button-secondary-base.webp";
import actionHelpArt from "../assets/ui/action-help.webp";
import actionPauseArt from "../assets/ui/action-pause.webp";
import actionResumeArt from "../assets/ui/action-resume.webp";
import actionReturnArt from "../assets/ui/action-return.webp";
import actionSettingsArt from "../assets/ui/action-settings.webp";
import helpTitleArt from "../assets/ui/help-title-tip.webp";
import hudFrameArt from "../assets/ui/hud-frame.webp";
import modalFrameArt from "../assets/ui/modal-frame.webp";
import starParticleArt from "../assets/ui/star-particle.webp";
import settingsPawArt from "../assets/ui/settings-paw.webp";
import levelJumpDecorationArt from "../assets/ui/level-jump-decoration.webp";
import summaryLevelBannerArt from "../assets/ui/summary-level-banner.webp";
import summaryFireworksArt from "../assets/ui/summary-fireworks.webp";
import scoreFont from "../../../assets/fonts/fredoka-score-latin.woff2";

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
  {
    id: "image:background-desktop",
    label: "桌面场景背景",
    source: STAFF_GAME_ART.gameBackgroundDesktop,
  },
  {
    id: "image:background-mobile",
    label: "手机场景背景",
    source: STAFF_GAME_ART.gameBackgroundMobile,
  },
  {
    id: "image:mascot-celebration",
    label: "吉祥物庆祝动画",
    source: STAFF_GAME_ART.mascotCelebrationFrames,
  },
  { id: "image:mascot-cheer", label: "吉祥物欢呼动画", source: STAFF_GAME_ART.mascotCheerFrames },
  { id: "image:mascot-pause", label: "吉祥物暂停动画", source: STAFF_GAME_ART.mascotPauseFrames },
  { id: "image:mascot-sad", label: "吉祥物失败动画", source: STAFF_GAME_ART.mascotSadFrames },
  { id: "image:bubble-shell", label: "泡泡外框", source: STAFF_GAME_ART.bubbleShell },
  { id: "image:cloud-one", label: "云朵装饰 1", source: STAFF_GAME_ART.cloudDecorationOne },
  { id: "image:cloud-two", label: "云朵装饰 2", source: STAFF_GAME_ART.cloudDecorationTwo },
  { id: "image:cloud-three", label: "云朵装饰 3", source: STAFF_GAME_ART.cloudDecorationThree },
  { id: "image:notation-preview", label: "五线谱预览图", source: STAFF_GAME_ART.notationC4Preview },
  { id: "image:button-primary", label: "主要按钮素材", source: STAFF_GAME_ART.buttonPrimaryArt },
  {
    id: "image:button-secondary",
    label: "次要按钮素材",
    source: STAFF_GAME_ART.buttonSecondaryArt,
  },
  { id: "image:action-help", label: "提示按钮素材", source: STAFF_GAME_ART.actionHelpArt },
  { id: "image:action-pause", label: "暂停按钮素材", source: STAFF_GAME_ART.actionPauseArt },
  { id: "image:action-resume", label: "继续按钮素材", source: STAFF_GAME_ART.actionResumeArt },
  { id: "image:action-return", label: "返回按钮素材", source: STAFF_GAME_ART.actionReturnArt },
  { id: "image:action-settings", label: "设置按钮素材", source: STAFF_GAME_ART.actionSettingsArt },
  { id: "image:help-title", label: "帮助标题素材", source: STAFF_GAME_ART.helpTitleArt },
  { id: "image:hud-frame", label: "游戏状态栏素材", source: STAFF_GAME_ART.hudFrameArt },
  { id: "image:modal-frame", label: "弹窗边框素材", source: STAFF_GAME_ART.modalFrameArt },
  { id: "image:star-particle", label: "星星粒子素材", source: STAFF_GAME_ART.starParticleArt },
  { id: "image:settings-paw", label: "设置爪印素材", source: STAFF_GAME_ART.settingsPawArt },
  { id: "image:level-jump", label: "关卡跳转装饰", source: STAFF_GAME_ART.levelJumpDecorationArt },
  {
    id: "image:summary-level-banner",
    label: "关卡结算横幅",
    source: STAFF_GAME_ART.summaryLevelBannerArt,
  },
  {
    id: "image:summary-fireworks",
    label: "结算烟花素材",
    source: STAFF_GAME_ART.summaryFireworksArt,
  },
];

type StaffGameResourceStatus = "loading" | "loaded" | "failed";

export interface StaffGameResourceProgress {
  id: string;
  category: string;
  label: string;
  source: string;
  status: StaffGameResourceStatus;
  error?: string;
}

export interface StaffGameResourceUpdate {
  id: string;
  status: StaffGameResourceStatus;
  error?: string;
}

const STAFF_GAME_RESOURCE_MANIFEST = [
  ...STAFF_GAME_IMAGE_ASSETS.map(({ id, label, source }) => ({
    id,
    category: "图片",
    label,
    source,
  })),
  ...STAFF_GAME_SOUND_RESOURCES.map(({ id, label, source }) => ({
    id,
    category: "音效",
    label,
    source,
  })),
  {
    id: "audio:background-music",
    category: "音频",
    label: "游戏背景音乐",
    source: STAFF_GAME_ART.gameBackgroundMusic,
  },
  {
    id: "audio:piano-samples",
    category: "钢琴音色",
    label: "钢琴采样组",
    source: `${import.meta.env.BASE_URL}audio/salamander/*.mp3`,
  },
  { id: "font:score", category: "字体", label: "闯关计分字体", source: scoreFont },
  { id: "font:digits", category: "字体", label: "数字字体", source: scoreFont },
] satisfies Array<Omit<StaffGameResourceProgress, "status" | "error">>;

export function createStaffGameResourceProgress(): StaffGameResourceProgress[] {
  return STAFF_GAME_RESOURCE_MANIFEST.map((resource) => ({
    ...resource,
    status: "loading" as const,
  }));
}
export const STAFF_GAME_RESOURCE_MAX_RETRIES = 4;
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
    const handleError = (): void => settle(new Error(`Failed to load ${source}`));
    const cleanup = (): void => {
      image.removeEventListener("load", finishLoading);
      image.removeEventListener("error", handleError);
      window.clearTimeout(timeout);
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
    const timeout = window.setTimeout(() => {
      settle(new Error(`Timed out while loading ${source}`));
      image.removeAttribute("src");
    }, STAFF_GAME_IMAGE_TIMEOUT_MS);
    const finishLoading = (): void => {
      if (typeof image.decode !== "function") {
        settle();
        return;
      }
      void image.decode().then(
        () => settle(),
        () => settle(image.naturalWidth > 0 ? undefined : new Error(`Failed to decode ${source}`))
      );
    };

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
    () => pendingStaffGameImageLoads.delete(source)
  );
  return loadPromise;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function trackStaffGameResource(
  id: string,
  load: () => Promise<unknown>,
  onProgress?: (update: StaffGameResourceUpdate) => void
): Promise<number> {
  onProgress?.({ id, status: "loading" });
  try {
    await load();
    onProgress?.({ id, status: "loaded" });
    return 0;
  } catch (error) {
    onProgress?.({ id, status: "failed", error: getErrorMessage(error) });
    return 1;
  }
}

function preloadGameBackgroundMusic(
  audio: HTMLAudioElement,
  signal: AbortSignal,
  retry: boolean
): Promise<void> {
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
      STAFF_GAME_BACKGROUND_AUDIO_TIMEOUT_MS
    );

    audio.addEventListener("canplay", handleCanPlay, { once: true });
    audio.addEventListener("error", handleError, { once: true });
    signal.addEventListener("abort", handleAbort, { once: true });
    audio.preload = "auto";
    audio.src = gameBackgroundMusic;
    audio.load();
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) settle();
  });
}

export async function preloadStaffGameResources(
  backgroundMusic: HTMLAudioElement,
  signal: AbortSignal,
  retry: boolean,
  onProgress?: (update: StaffGameResourceUpdate) => void
): Promise<number> {
  const soundFailures = preloadStaffGameSounds((update) => {
    onProgress?.({ id: `sound:${update.sound}`, status: update.status, error: update.error });
  });
  const failures = await Promise.all([
    ...STAFF_GAME_IMAGE_ASSETS.map(({ id, source }) =>
      trackStaffGameResource(id, () => loadGameImage(source), onProgress)
    ),
    soundFailures,
    trackStaffGameResource(
      "audio:background-music",
      () => preloadGameBackgroundMusic(backgroundMusic, signal, retry),
      onProgress
    ),
    trackStaffGameResource(
      "audio:piano-samples",
      async () => {
        const loaded = await preloadPianoSamples();
        if (!loaded)
          throw new Error(
            getPianoSampleLoadError()?.message ?? "One or more piano samples failed to load"
          );
      },
      onProgress
    ),
    trackStaffGameResource(
      "font:score",
      async () => {
        if (typeof document !== "undefined" && document.fonts) {
          await document.fonts.load('700 48px "Fredoka Rush Score"', "0123456789+");
        }
      },
      onProgress
    ),
    trackStaffGameResource(
      "font:digits",
      async () => {
        if (typeof document !== "undefined" && document.fonts) {
          await document.fonts.load("700 16px FredokaSystemDigits", "0123456789");
        }
      },
      onProgress
    ),
  ]);
  return failures.reduce((total, failureCount) => total + failureCount, 0);
}
