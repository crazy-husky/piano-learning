import { getContext } from "tone";
import { STAFF_GAME_BACKGROUND_MUSIC_VOLUME } from "./staffGameAudioConfig";

interface StaffGameBackgroundAudioNodes {
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}

const backgroundAudioNodes = new WeakMap<HTMLAudioElement, StaffGameBackgroundAudioNodes>();

/** Route the background track through Web Audio so its gain is adjustable on iOS too. */
export function connectStaffGameBackgroundAudio(audio: HTMLAudioElement): void {
  const existingNodes = backgroundAudioNodes.get(audio);
  if (existingNodes) {
    existingNodes.gain.gain.setValueAtTime(
      STAFF_GAME_BACKGROUND_MUSIC_VOLUME,
      getContext().rawContext.currentTime
    );
    return;
  }

  const context = getContext();
  const source = context.createMediaElementSource(audio);
  const gain = context.createGain();
  gain.gain.value = STAFF_GAME_BACKGROUND_MUSIC_VOLUME;
  source.connect(gain);
  gain.connect(context.rawContext.destination);
  backgroundAudioNodes.set(audio, { source, gain });
}

export function disconnectStaffGameBackgroundAudio(audio: HTMLAudioElement): void {
  const nodes = backgroundAudioNodes.get(audio);
  if (!nodes) return;
  nodes.source.disconnect();
  nodes.gain.disconnect();
  backgroundAudioNodes.delete(audio);
}
