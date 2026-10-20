import { getContext } from "tone";
import {
  STAFF_GAME_AUDIO_MASTER_GAIN_LINEAR,
  STAFF_GAME_BACKGROUND_MUSIC_BASE_VOLUME,
} from "./staffGameAudioConfig";
import { connectStaffGameAudioOutputSource } from "./staffGameSounds";

interface StaffGameBackgroundAudioNodes {
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}

const backgroundAudioNodes = new WeakMap<HTMLAudioElement, StaffGameBackgroundAudioNodes>();
const backgroundMusicGain =
  STAFF_GAME_BACKGROUND_MUSIC_BASE_VOLUME * STAFF_GAME_AUDIO_MASTER_GAIN_LINEAR;

/** Route the background track through Web Audio so its gain is adjustable on iOS too. */
export function connectStaffGameBackgroundAudio(audio: HTMLAudioElement): void {
  const existingNodes = backgroundAudioNodes.get(audio);
  if (existingNodes) {
    existingNodes.gain.gain.setValueAtTime(
      backgroundMusicGain,
      getContext().rawContext.currentTime
    );
    return;
  }

  const context = getContext();
  const source = context.createMediaElementSource(audio);
  const gain = context.createGain();
  gain.gain.value = backgroundMusicGain;
  source.connect(gain);
  const nodes = { source, gain };
  backgroundAudioNodes.set(audio, nodes);
  void connectStaffGameAudioOutputSource(gain).then((isLimited) => {
    if (backgroundAudioNodes.get(audio) !== nodes) return;
    if (!isLimited) gain.connect(context.rawContext.destination);
  });
}

export function disconnectStaffGameBackgroundAudio(audio: HTMLAudioElement): void {
  const nodes = backgroundAudioNodes.get(audio);
  if (!nodes) return;
  nodes.source.disconnect();
  nodes.gain.disconnect();
  backgroundAudioNodes.delete(audio);
}
