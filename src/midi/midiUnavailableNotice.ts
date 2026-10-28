import type { MidiAccessStatus } from "./midiInput";

export interface MidiUnavailableNotice {
  description: string;
  title: string;
}

function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent ?? "";
  const platform = navigator.platform ?? "";
  return (
    /iPhone|iPad|iPod/i.test(`${platform} ${userAgent}`) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function getMidiUnavailableNotice(status: MidiAccessStatus): MidiUnavailableNotice | null {
  if (status === "unsupported") {
    return isIOSDevice()
      ? {
          title: "iOS 设备需要 MIDIWeb",
          description:
            "当前浏览器暂不支持 MIDI 输入。请前往 App Store 下载 MIDIWeb，再用 MIDIWeb 打开本页面并连接 MIDI 键盘。",
        }
      : {
          title: "当前浏览器不支持 MIDI",
          description:
            "当前浏览器环境无法使用 MIDI 输入。请更换支持 MIDI 的浏览器或设备后，再连接 MIDI 键盘开始练习。",
        };
  }

  if (status === "insecure-context") {
    return {
      title: "当前页面无法启用 MIDI",
      description: "浏览器要求通过安全连接使用 MIDI。请通过 HTTPS 地址重新打开本页面后再试。",
    };
  }

  return null;
}
