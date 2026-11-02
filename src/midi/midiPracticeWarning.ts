import type { MidiInputController } from "./useMidiInput";
import { getMidiUnavailableNotice } from "./midiUnavailableNotice";

type MidiPracticeStartWarningContext = "practice" | "midi-required";

type MidiPracticeWarningState = Pick<MidiInputController, "inputs" | "isConnected" | "status">;

function addPracticeModeAlternative(message: string): string {
  return `${message.replace(/[。.!?]+$/, "")}，也可以切换到其他作答方式。`;
}

export function getMidiPracticeStartWarning(
  midi: MidiPracticeWarningState,
  context: MidiPracticeStartWarningContext = "practice"
): string | null {
  if (midi.isConnected) return null;
  if (midi.status === "requesting") return "MIDI 正在连接，请稍候。";

  const unavailableNotice = getMidiUnavailableNotice(midi.status);
  if (unavailableNotice) {
    const message = `${unavailableNotice.title}：${unavailableNotice.description}`;
    return context === "practice" ? addPracticeModeAlternative(message) : message;
  }

  const action = context === "midi-required" ? "左右手合弹" : "练习";
  let message: string;
  switch (midi.status) {
    case "denied":
    case "error":
      message = "MIDI 连接失败，请检查浏览器权限或设备连接后重试。";
      break;
    case "ready":
      message =
        midi.inputs.length > 0
          ? `已检测到 MIDI 设备，请在设备下拉框中选择后开始${action}。`
          : `未检测到 MIDI 设备，请连接后点击“重试”${
              context === "midi-required" ? `，再开始${action}` : ""
            }。`;
      break;
    default:
      message = `请连接并选择 MIDI 键盘后开始${action}。`;
  }

  return context === "practice" ? addPracticeModeAlternative(message) : message;
}
