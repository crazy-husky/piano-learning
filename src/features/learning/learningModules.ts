import type { LucideIcon } from "lucide-react";
import { BookOpen, Keyboard, Ruler, Users, Zap } from "lucide-react";
import type { LearningLevelId } from "../../routing/appRoutes";

export interface LearningModuleDefinition {
  id: LearningLevelId;
  name: string;
  summary: string;
  icon: LucideIcon;
  guide: {
    title: string;
    goal: string;
    principle: string;
    highlight: string;
    steps: string[];
  };
}

export const LEARNING_MODULES: readonly LearningModuleDefinition[] = [
  {
    id: 1,
    name: "基础识谱",
    summary: "先看懂五线谱上的位置，再把谱面和琴键连起来。",
    icon: BookOpen,
    guide: {
      title: "告别“数格子”",
      goal: "让眼睛熟悉五线谱，建立音符与琴键的初步映射。",
      principle:
        "用固定的谱号和基准音作参照，反复观察音符落在线上还是间里。位置熟悉后，眼睛可以直接识别音符，不必每次从头数起。",
      highlight: "先认谱号和基准位置，再看音符相对它移动了几级。",
      steps: ["确认高音谱表或低音谱表", "观察音符在线上还是间里", "找到对应的琴键并听辨音高"],
    },
  },
  {
    id: 2,
    name: "单音极速反应",
    summary: "把读谱和找键练成连续、轻松的单手反应。",
    icon: Zap,
    guide: {
      title: "建立“绝对直觉”",
      goal: "逐步把识谱到按键的反应压缩到 1 秒内，实现看谱直弹。",
      principle:
        "短间隔、多次主动提取，让音符位置与按键动作形成稳定联结。练习时先求准确，再逐步加快，避免靠猜测换速度。",
      highlight: "看见音符后先直接定位琴键；答错时停下来确认谱面位置，再继续。",
      steps: ["一次只处理一个音符", "看谱后直接按键", "用稳定准确的反应逐步建立速度"],
    },
  },
  {
    id: 3,
    name: "音名识别与定位",
    summary: "从五线谱认出音名，再把音名映射到键盘位置。",
    icon: Keyboard,
    guide: {
      title: "让谱面、音名和琴键连起来",
      goal: "看谱能说出音名，看到音名也能迅速找到对应的琴键。",
      principle:
        "这一阶段练习两个方向：从五线谱读出音名，建立谱面位置与音名的联系；再从音名找到琴键，建立音名与键盘位置的联系。两个映射分别熟悉后，读谱和演奏时就能更快地连起来。",
      highlight: "先看谱读音名，再把音名对应到键盘；小字一组起步，熟悉后逐步扩大音域。",
      steps: [
        "看五线谱，按 C、D、E、F、G、A、B 说出音名",
        "看到或听到音名，在键盘上找到对应琴键",
        "逐步扩大音域，让识谱和键位定位更连贯",
      ],
    },
  },
  {
    id: 4,
    name: "音距速推",
    summary: "从相邻音的距离推断走向，形成读谱中的预判能力。",
    icon: Ruler,
    guide: {
      title: "看懂音程，提前预判",
      goal: "快速判断相邻音之间的级进、跳进和方向变化。",
      principle:
        "单音极速反应训练的是看见一个音后迅速认出音高并找到琴键；音距速推训练的是相邻音之间的方向和距离。先建立单音与琴键的映射，再学会用已知音推测下一个音，才能从逐个认音过渡到连续读谱。",
      highlight: "先看移动方向和跨越的线间级数，再确认具体音高。",
      steps: ["找到第一个音作为参照", "判断音符向上或向下移动", "按音距推导并核对目标位置"],
    },
  },
  {
    id: 5,
    name: "双手协同",
    summary: "同时跟踪高低声部，让左右手在同一节奏中协作。",
    icon: Users,
    guide: {
      title: "让双手成为一个节奏单元",
      goal: "同时读懂左右手声部，并在稳定节拍中完成协同弹奏。",
      principle:
        "先分别看清两个声部的目标，再把它们放到同一时间轴上。稳定的拍点和分层注意能帮助双手逐步形成协作。",
      highlight: "先看清本拍两只手各自要做什么，再一起落键。",
      steps: ["分别辨认高音与低音声部", "确认两手目标的先后与同时关系", "保持节拍并逐步提高连贯度"],
    },
  },
];

export function getLearningModule(id: LearningLevelId): LearningModuleDefinition {
  return LEARNING_MODULES[id - 1]!;
}
