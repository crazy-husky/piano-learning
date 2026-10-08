# 五线谱闯关素材目录

这是闯关游戏素材的总入口，按当前仓库中的素材文件登记用途、尺寸/格式、来源和提示词归档状态。

- [运行素材说明与切图记录](README.md)
- [已保存的生成提示词](generation-prompts.md)
- 原始图集：`source/`
- 切图预览和问题样本：`review/`

## 归档状态说明

- **提示词已归档**：可以在提示词文档中找到当前记录的最终提示词。
- **来源图集已记录**：素材从对应原始图集中切出；图集本身的生成提示词没有保存。
- **提示词未归档**：仓库没有生成时使用的完整提示词。只登记已知需求或来源，不补写猜测的提示词。
- **非独立图片素材**：由 CSS、SVG 或 Canvas 绘制，不需要图像生成提示词。

## 游戏素材清单

### 场景、角色、谱面与特效

| 文件 | 尺寸 / 格式 | 用途与接入状态 | 来源 / 提示词状态 |
| --- | --- | --- | --- |
| `src/assets/staff-game/backgrounds/meadow-desktop.webp` | 1095×492 WebP | 桌面游戏背景；运行中 | `source/03-notation-level-and-backgrounds.png` 切图；来源图集生成提示词未归档 |
| `src/assets/staff-game/backgrounds/meadow-mobile.webp` | 863×1822 WebP | 手机竖屏背景；运行中 | [手机竖屏场景提示词](generation-prompts.md#2-手机竖屏场景候选图) |
| `src/assets/staff-game/characters/mascot-idle.webp` | 445×475 WebP | 角色常态；运行中 | `source/01-characters-and-bubble.png` 切图；来源图集生成提示词未归档 |
| `src/assets/staff-game/characters/mascot-cheer.webp` | 432×450 WebP | 角色欢呼状态；运行中 | `source/01-characters-and-bubble.png` 切图；来源图集生成提示词未归档 |
| `src/assets/staff-game/characters/mascot-wink.webp` | 423×459 WebP | 角色成功反馈状态；运行中 | `source/01-characters-and-bubble.png` 切图；来源图集生成提示词未归档 |
| `src/assets/staff-game/characters/mascot-level-celebration.webp` | 483×509 WebP | 通关庆祝插画；当前代码未引用 | `source/03-notation-level-and-backgrounds.png` 切图；来源图集生成提示词未归档 |
| `src/assets/staff-game/notation/treble-staff-c4-note.webp` | 451×284 WebP | 高音谱号与中央 C 参考图；运行中 | `source/03-notation-level-and-backgrounds.png` 切图；来源图集生成提示词未归档 |
| `src/assets/staff-game/effects/bubble-shell-empty-center.webp` | 512×512 WebP | 气泡透明外壳；运行中 | [空心气泡提示词](generation-prompts.md#1-空心蓝色气泡边框) |
| `src/assets/staff-game/effects/cloud-decoration-1.webp` | 495×171 WebP | 云朵装饰；运行中 | `source/02-ui-and-clouds.png` 切图；没有单独的生成提示词 |
| `src/assets/staff-game/effects/cloud-decoration-2.webp` | 510×177 WebP | 云朵装饰；运行中 | `source/02-ui-and-clouds.png` 切图；没有单独的生成提示词 |
| `src/assets/staff-game/effects/cloud-decoration-3.webp` | 500×179 WebP | 云朵装饰；运行中 | `source/02-ui-and-clouds.png` 切图；没有单独的生成提示词 |

### UI 素材

| 文件 | 尺寸 / 格式 | 用途与接入状态 | 来源 / 提示词状态 |
| --- | --- | --- | --- |
| `src/assets/staff-game/ui/action-help.webp` | 256×256 WebP | 帮助按钮图标；运行中 | 当前仓库未记录原始来源和完整提示词 |
| `src/assets/staff-game/ui/action-pause.webp` | 256×256 WebP | 暂停按钮图标；运行中 | 当前仓库未记录原始来源和完整提示词 |
| `src/assets/staff-game/ui/action-resume.webp` | 256×256 WebP | 继续按钮图标；运行中 | 当前仓库未记录原始来源和完整提示词 |
| `src/assets/staff-game/ui/action-return.webp` | 256×256 WebP | 返回按钮图标；运行中 | 当前仓库未记录原始来源和完整提示词 |
| `src/assets/staff-game/ui/action-settings.webp` | 256×256 WebP | 设置按钮图标；运行中 | 当前仓库未记录原始来源和完整提示词 |
| `src/assets/staff-game/ui/button-primary-base.webp` | 663×191 WebP | 主按钮底图；运行中 | `source/02-ui-and-clouds.png` 切图；来源图集生成提示词未归档 |
| `src/assets/staff-game/ui/button-secondary-base.webp` | 499×153 WebP | 次按钮底图；运行中 | `source/02-ui-and-clouds.png` 切图；来源图集生成提示词未归档 |
| `src/assets/staff-game/ui/hud-frame.webp` | 872×246 WebP | 游戏顶部 HUD 底图；运行中 | `source/02-ui-and-clouds.png` 切图；来源图集生成提示词未归档 |
| `src/assets/staff-game/ui/modal-frame.webp` | 393×353 WebP | 弹窗面板底图；运行中 | `source/02-ui-and-clouds.png` 切图；来源图集生成提示词未归档 |
| `src/assets/staff-game/ui/level-medal-frame.webp` | 432×470 WebP | 关卡奖章框；当前代码未引用 | `source/03-notation-level-and-backgrounds.png` 切图；来源图集生成提示词未归档 |
| `src/assets/staff-game/ui/level-jump-decoration.webp` | 480×479 WebP | 跳级弹窗装饰；运行中 | 来自后续图像生成；完整生成提示词未归档，已有需求描述可回溯对话 |
| `src/assets/staff-game/ui/settings-paw.webp` | 144×144 WebP | 设置弹窗熊掌装饰；运行中 | 来自后续图像生成；完整生成提示词未归档，已有需求描述可回溯对话 |
| `src/assets/staff-game/ui/star-particle.webp` | 289×266 WebP | 五角星粒子；运行中 | `source/02-ui-and-clouds.png` 切图；来源图集生成提示词未归档 |
| `src/assets/staff-game/ui/summary-fireworks.webp` | 560×442 WebP | 结算烟花底图；叠加 Canvas 动画；运行中 | 来自后续图像生成；完整生成提示词未归档，已有需求描述可回溯对话 |
| `src/assets/staff-game/ui/summary-level-banner.webp` | 700×185 WebP | 结算关卡标题横幅；运行中 | 来自后续图像生成；完整生成提示词未归档，已有需求描述可回溯对话 |

### 音频素材

| 文件 | 时长 / 格式 | 用途与接入状态 | 来源 / 提示词状态 |
| --- | --- | --- | --- |
| `src/assets/staff-game/audio/bubble-pop.wav` | 0.67 秒；44.1 kHz、16-bit、单声道 | 答对气泡反馈；运行中 | VSS 生成；仓库保留用途描述和评估，未归档完整生成提示词 |
| `src/assets/staff-game/audio/combo-streak.wav` | 0.89 秒；44.1 kHz、16-bit、单声道 | 连击反馈；运行中 | VSS 生成；仓库保留用途描述和评估，未归档完整生成提示词 |
| `src/assets/staff-game/audio/level-clear.wav` | 1.22 秒；44.1 kHz、16-bit、单声道 | 通关反馈；运行中 | VSS 生成；仓库保留用途描述和评估，未归档完整生成提示词 |
| `src/assets/staff-game/audio/microphone-ready.wav` | 0.87 秒；44.1 kHz、16-bit、单声道 | 麦克风连接或恢复提示；运行中 | VSS 生成；仓库保留用途描述和评估，未归档完整生成提示词 |
| `src/assets/staff-game/audio/note-missed-soft.wav` | 0.32 秒；48 kHz、24-bit、单声道 | 答错或气泡超时反馈；运行中 | [答错/漏答提示词](generation-prompts.md#答错漏答提示音) |
| `src/assets/staff-game/audio/relaxed-game-bgm.mp3` | 20 秒；44.1 kHz、双声道 MP3 | 闯关背景音乐；运行中 | 后续生成素材；完整音乐生成提示词未归档，已有需求描述可回溯对话 |

## 程序绘制的游戏效果

这些效果没有单独的图片文件或图像生成提示词，维护位置如下：

| 效果 | 实现位置 |
| --- | --- |
| 气泡内五线谱与音符 | `src/components/StaffGameView.tsx`（SVG） |
| 萤火虫粒子、流星、连击引线 | `src/components/StaffGameView.tsx`、`src/styles.css` |
| 结算烟花 | `src/components/StaffGameFireworks.tsx`，叠加 `ui/summary-fireworks.webp` |
| 结算极光与光球 | `src/styles.css` |

## 原始资料与预览

| 路径 | 内容 |
| --- | --- |
| `art/staff-game/source/01-characters-and-bubble.png` | 角色与气泡来源图集 |
| `art/staff-game/source/02-ui-and-clouds.png` | UI 与云朵来源图集 |
| `art/staff-game/source/03-notation-level-and-backgrounds.png` | 谱面、奖章和场景来源图集 |
| `art/staff-game/review/cut-assets-contact-sheet.jpg` | 切图预览联系表 |
| `art/staff-game/review/` | 被拒素材与其他核对样本 |

## 后续素材归档规则

新增或替换游戏素材时，在本目录登记文件路径、用途、来源、尺寸/格式和运行状态；将最终生成提示词及负面提示词追加到 `generation-prompts.md`，并在本清单链接到对应小节。若通过源图切片或代码生成，也记录源文件或实现位置。不要把推测的提示词当作历史记录补写。
