type DeviceVibrate = (pattern: VibratePattern) => boolean;

const HIT_VIBRATION_PATTERN: VibratePattern = [24, 16, 32];

function getDeviceVibrate(): DeviceVibrate | null {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return null;
  }

  return navigator.vibrate.bind(navigator);
}

/** Give a brief tactile impact when the player correctly pops a bubble. */
export function triggerStaffGameHitHaptic(
  vibrate: DeviceVibrate | null = getDeviceVibrate()
): void {
  if (!vibrate) return;

  try {
    vibrate(HIT_VIBRATION_PATTERN);
  } catch {
    // Vibration is an optional device capability; unsupported devices stay silent.
  }
}
