import type { LucideIcon } from "lucide-react";
import { BookOpen, Eye, EyeOff, Keyboard, Ruler, Users, Zap } from "lucide-react";
import type { LearningLevelId } from "../../routing/appRoutes";
import type { DuetPracticeLevel, PreReadingBufferSize } from "../../domain/types";

export type GraduationCriteria =
  | { kind: "staff-recall"; completedRuns: number; description: string }
  | {
      kind: "single-note";
      sampleCount: number;
      minFirstTryAccuracy: number;
      maxAverageResponseMs: number;
      description: string;
    }
  | {
      kind: "name-mapping";
      sampleCountPerDirection: number;
      minFirstTryAccuracy: number;
      description: string;
    }
  | {
      kind: "distance";
      sampleCount: number;
      minFirstTryAccuracy: number;
      description: string;
    }
  | {
      kind: "pre-reading";
      buffers: readonly PreReadingBufferSize[];
      sampleCountPerBuffer: number;
      minFirstTryAccuracy: number;
      description: string;
    }
  | {
      kind: "duet";
      levels: readonly DuetPracticeLevel[];
      sampleCountPerLevel: number;
      minFirstTryAccuracy: number;
      description: string;
    }
  | {
      kind: "blind-practice";
      sampleCount: number;
      minFirstTryAccuracy: number;
      description: string;
    };

export interface LearningModuleDefinition {
  id: LearningLevelId;
  name: string;
  summary: string;
  icon: LucideIcon;
  optional?: boolean;
  graduationCriteria: GraduationCriteria;
  guide: {
    title: string;
    goal: string;
    principle: string;
    highlight: string;
    steps: string[];
    methods?: { title: string; description: string }[];
  };
}

const LEARNING_MODULES_BY_ID: readonly LearningModuleDefinition[] = [
  {
    id: 1,
    name: "基础识谱",
    summary: "先看懂五线谱上的位置，再把谱面和琴键连起来。",
    icon: BookOpen,
    graduationCriteria: {
      kind: "staff-recall",
      completedRuns: 2,
      description: "在同一音域完成 2 轮基础识谱默写。",
    },
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
    graduationCriteria: {
      kind: "single-note",
      sampleCount: 20,
      minFirstTryAccuracy: 0.9,
      maxAverageResponseMs: 1200,
      description: "至少完成 20 题，首次答对率达到 90%，平均反应时间不超过 1.2 秒。",
    },
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
    graduationCriteria: {
      kind: "name-mapping",
      sampleCountPerDirection: 20,
      minFirstTryAccuracy: 0.9,
      description: "看谱认音和音名找键各完成至少 20 题，两个方向首次答对率都达到 90%。",
    },
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
    graduationCriteria: {
      kind: "distance",
      sampleCount: 20,
      minFirstTryAccuracy: 0.9,
      description: "看谱或弹奏音距至少完成 20 题，首次判断正确率达到 90%。",
    },
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
    name: "提前识谱",
    summary: "打破逐音视奏，训练眼睛走在手的前面。",
    icon: Eye,
    graduationCriteria: {
      kind: "pre-reading",
      buffers: [1, 2],
      sampleCountPerBuffer: 20,
      minFirstTryAccuracy: 0.85,
      description: "提前 1 个音和提前 2 个音各完成至少 20 题，首次答对率都达到 85%。",
    },
    guide: {
      title: "让视线走在手前面",
      goal: "弹奏当前音时，提前读懂后一个或后两个音，建立连续视奏。",
      principle:
        "视奏的关键是眼睛永远比手快 1 秒。视线先落到后续音符，大脑便能预先组织下一步动作，减少逐音停顿。",
      highlight: "不要死盯当前音符，用余光感受手的起落，让视线提前准备下一个音。",
      steps: [
        "看清当前音后，把视线移向后一个音",
        "用余光感受当前按键动作",
        "熟悉后把预读范围扩展到后两个音",
      ],
    },
  },
  {
    id: 6,
    name: "双手协同",
    summary: "同时跟踪高低声部，让左右手在同一节奏中协作。",
    icon: Users,
    graduationCriteria: {
      kind: "duet",
      levels: ["level-1", "level-2", "level-3", "level-4", "level-5", "level-6"],
      sampleCountPerLevel: 10,
      minFirstTryAccuracy: 0.8,
      description: "6 个难度各完成至少 10 题，每个难度的首次答对率达到 80%。",
    },
    guide: {
      title: "让双手成为一个节奏单元",
      goal: "同时读懂左右手声部，并在稳定节拍中完成协同弹奏。",
      principle:
        "先分别看清两个声部的目标，再把它们放到同一时间轴上。稳定的拍点和分层注意能帮助双手逐步形成协作。",
      highlight: "先看清本拍两只手各自要做什么，再一起落键。",
      steps: ["分别辨认高音与低音声部", "确认两手目标的先后与同时关系", "保持节拍并逐步提高连贯度"],
    },
  },
  {
    id: 7,
    name: "盲弹练习",
    summary: "不看键盘，借助黑键组在不同音组间移动找音。",
    icon: EyeOff,
    optional: true,
    graduationCriteria: {
      kind: "blind-practice",
      sampleCount: 20,
      minFirstTryAccuracy: 0.8,
      description: "完成至少 20 题，首次答对率达到 80%。",
    },
    guide: {
      title: "不看键盘，也能找到目标音",
      goal: "逐步建立不依赖视觉查看键位的定位能力。",
      principle:
        "常见的盲弹练习有两种定位思路：一种先建立身体与键盘的固定参照，另一种利用键盘结构判断当前位置。本练习以第二种相对定位为核心。",
      highlight: "看清目标音名后不看键盘，用两黑键组、三黑键组判断位置；题目会在不同音组间跳转。",
      steps: [
        "读出当前目标音名，随后把注意力放到手和键盘的触感上",
        "摸清附近的两黑键组、三黑键组，判断目标音与黑键组的相对位置",
        "弹出目标音后继续下一题，在跨音组移动中练习重新定位",
      ],
      methods: [
        {
          title: "绝对定位法 · 身体对齐中央 C",
          description:
            "用身体中线（例如鼻尖）与中央 C 对齐，建立身体和键盘的固定位置关系，再从这个基准寻找其他音。它适合作为进阶定位方法，要形成稳定感觉，需要长期反复练习；这里仅作介绍。",
        },
        {
          title: "相对定位法 · 借助两黑键、三黑键组",
          description:
            "不要求身体始终对齐某一个固定琴键，而是通过触摸两黑键组、三黑键组判断手当前所在的位置，再推断目标音。盲弹练习会让目标音在不同音组间随机跳转，重点训练这种相对找位能力。",
        },
      ],
    },
  },
];

export const LEARNING_MODULES: readonly LearningModuleDefinition[] = [
  ...LEARNING_MODULES_BY_ID.slice(0, 4),
  LEARNING_MODULES_BY_ID[5]!,
  LEARNING_MODULES_BY_ID[4]!,
  LEARNING_MODULES_BY_ID[6]!,
];

export function getLearningModule(id: LearningLevelId): LearningModuleDefinition {
  return LEARNING_MODULES_BY_ID.find((module) => module.id === id)!;
}

export function getLearningModuleSequenceNumber(id: LearningLevelId): number {
  const index = LEARNING_MODULES.findIndex((module) => module.id === id);
  return index < 0 ? id : index + 1;
}
