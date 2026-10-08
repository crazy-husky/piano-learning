# 补充美术素材：生图提示词

按核对结果只补了不合格或不足的视觉素材；随后单独生成了关卡音效。已有角色、HUD、按钮、弹窗、星粒子、云朵、谱号、奖章和宽屏场景继续沿用。

## 1. 空心蓝色气泡边框

工具参数：`transparent_background: true`。先用本对话中的三张素材图确定蓝色水滴角色的卡通 3D 风格，再以生成的气泡为编辑目标，按下面的最终提示修正中心透明孔和内侧高光。

```text
Use case: precise-object-edit
Asset type: final transparent game sprite, a hollow circular glass rim.
Input image: Image 1 is the edit target. Preserve its circular cyan-blue rim, thickness, smooth 3D cartoon gloss, and outer-edge shine.
Primary request: Clean up the hollow center. Remove the large oval white reflections at the upper-left and lower-right that intrude into the center opening. Every reflection must stay entirely on the cyan rim; the central opening should be a clean uninterrupted transparent hole at least 56% of the image width. The center hole must contain absolutely no blue fill, glow, haze, white highlight, or stray pixel. Keep small specular streaks only on the ring itself.
Scene/backdrop: none. True transparent PNG background, including a transparent central hole.
Composition: one centered shell with about 10% canvas breathing room, square 1:1 canvas, no crop.
Constraints: edit only the intrusive highlights and clean alpha in the hole. Do not alter the cyan rim style, color, or thickness. No other assets.
Avoid: opaque/semtransparent interior, objects crossing the inner edge, checkerboard, grids, background, note, staff, mascot, stars, text, logo, watermark, sheet.
```

运行素材：`src/assets/staff-game/effects/bubble-shell-empty-center.webp`，512×512。由透明 PNG 缩放并转换为 WebP，alpha 中心孔保持全透明；外部无棋盘格。

## 2. 手机竖屏场景候选图

工具参数：`transparent_background: false`；参考素材图 2、3 的天空、草地、柔和卡通 3D 风格。该竖版场景现已接入窄屏游戏背景；桌面仍使用横版场景。

```text
Use case: illustration-story
Asset type: full-bleed portrait background for a mobile music-learning game; this is a background image, not a UI mockup.
Input images: Images 2 and 3 are visual style references only. Match the cheerful polished 3D storybook/cartoon rendering, clear cyan-blue sky, soft white clouds, vivid but gentle green meadow, and sunny family-friendly mood. Do not copy their sheet layout, white dividers, labels, interface panels, or crop framing.
Primary request: A tall, narrow phone-screen view of an open sky above a peaceful green meadow. Keep the middle 65% of the image spacious, calm, and low-detail so animated falling note bubbles remain clearly visible. Put a soft distant horizon and lake near the lower third, rolling grassy hills and a few tiny flowers along the bottom edge, and fluffy clouds mostly toward the upper corners. Use gentle depth and soft sunlight; keep the sky and grass color balance consistent with the reference images.
Composition: portrait 9:19 mobile wallpaper composition, edge-to-edge scene, designed to fit a narrow phone viewport without cropping important focal objects. Background only; no foreground subject.
Constraints: no UI, no cards, no buttons, no HUD, no score, no note bubbles, no mascot, no piano, no staff or notation, no people, no text, no logo, no watermark. Keep the central play area visually quiet and readable.
```

运行素材：`src/assets/staff-game/backgrounds/meadow-mobile.webp`，863×1822，RGB WebP。当前由闯关页在窄屏设备上使用。

## 3. 游戏音效

使用 VSS Sound Studio 生成 5 个独立 WAV；均为 44.1 kHz、16-bit、单声道。以“轻、短、明亮、动画游戏反馈”为共同锚点，AI 设计四层后自动混音。各音效保存在 `src/assets/staff-game/audio/`，并由 `src/audio/staffGameSounds.ts` 统一预载与播放。

- `bubble-pop.wav`：答对目标音符时的清脆水泡破裂和星光散开声。
- `combo-streak.wav`：每 3 次连续答对时的渐升连击提示，VSS 候选评分 89/100。
- `note-missed-soft.wav`：气泡超时飘走时轻柔下行的漏答提示，VSS 候选评分 82/100。
- `level-clear.wav`：至少获得 1 星时的短暂通关闪耀声，VSS 候选评分 85/100。
- `microphone-ready.wav`：麦克风连接成功或暂停后恢复时的轻柔双闪提示，VSS 候选评分 85/100。

本机 MCP 密钥配置单独保存在 `/Users/husky/.config/piano-learning/vss-mcp.json`，不加入素材目录或版本控制。

## 共用交付要求

- 每个需求单独生成一张图；一个 PNG 只包含一个静态主体/帧，不交付多格图集、展示板或拼图。
- 需要抠图的角色、道具、特效必须输出真实透明 alpha；“透明棋盘格”不能画进像素里。不得带图注、尺寸字样、分隔线、水印或界面文字。
- 游戏风格统一为清新、明亮、柔和的卡通 3D；蓝色水滴角色和青蓝色玻璃质感为主要视觉锚点，黄色高光作点缀。
- 场景背景单独出图，不附带 UI。手机背景按 9:19 狭长竖屏构图，为落下的音符留出低细节空间。
- 音效已在首版生成并接入；没有逐帧角色动作，也没有单独的麦克风故障音。
