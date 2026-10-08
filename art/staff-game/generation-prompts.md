# 补充美术素材：生图提示词

> 当前已登记素材、来源和提示词归档情况见 [五线谱闯关素材目录](asset-catalog.md)。本文只包含仓库里可追溯的提示词；目录中标注“未归档”的历史提示词不能从成品素材可靠还原。

按核对结果补充了不合格或不足的视觉素材，并单独生成了关卡音效。已有场景、HUD、按钮、弹窗、星粒子、云朵、谱号和奖章继续沿用；角色静态图保留作造型参考，运行时使用下文登记的逐帧动作图集。

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

游戏音效保存在 `src/assets/staff-game/audio/`，并由 `src/audio/staffGameSounds.ts` 统一预载与播放。原有 4 个 WAV 由 VSS Sound Studio 制作（44.1 kHz、16-bit、单声道）；`note-missed-soft.wav` 后按下方的新提示重新合成（48 kHz、24-bit、单声道）。之后用户提供了菜单点击音、三条连击鼓励语音和一条背景音乐，经过裁静音、响度平衡或压缩后接入；素材来源和处理后的规格记录在 [音频素材清单](asset-catalog.md#音频素材)。

- `bubble-pop.wav`：答对目标音符时的清脆水泡破裂和星光散开声。
- `combo-streak.wav`：每 3 次连续答对时的渐升连击提示，VSS 候选评分 89/100。
- `note-missed-soft.wav`：答错或气泡超时提示；按下方提示定制合成，48 kHz、24-bit、单声道，约 0.32 秒。
- `level-clear.wav`：至少获得 1 星时的短暂通关闪耀声，VSS 候选评分 85/100。
- `microphone-ready.wav`：麦克风连接成功或暂停后恢复时的轻柔双闪提示，VSS 候选评分 85/100。

### 答错/漏答提示音

```text
Prompt: Cartoon game wrong input sound effect, about 0.3 seconds. A soft, round low marimba note followed by a very short descending muted synth tone (a gentle "doo-doot" going down). Slight jelly bubble muffled texture. Gentle, clean, playful, non-threatening, signaling "oops, try again". 48kHz, 24-bit WAV.
Negative prompt: Voice, speech, harsh alarm, electronic beep, metal scraping, heavy bass impact, sad failure chord, long reverb, background music, sharp high frequencies, disturbing.
```

成品替换 `src/assets/staff-game/audio/note-missed-soft.wav`，同时供错误作答和气泡超时播放。

本机 MCP 密钥配置单独保存在 `/Users/husky/.config/piano-learning/vss-mcp.json`，不加入素材目录或版本控制。

## 4. 角色动作帧图集

每组图集均为 3×3 网格、共 9 帧，按从左到右、从上到下的顺序播放。生成画布为 1024×1024；接入游戏前压缩到 768×768、保留透明通道并转换为 WebP（质量 82、透明度质量 90），每帧仍有 256×256 像素。角色固定在每格中央，方便 CSS 使用 `background-size: 300% 300%` 切帧。参考图均使用项目中登记的静态角色图或难过表情参考图。

### 待机呼吸与眨眼

参考图：`src/assets/staff-game/characters/mascot-idle.webp`。

```text
Use case: stylized-concept
Asset type: transparent 3-by-3 sprite sheet for a polished children's music game mascot idle loop.
Input images: Image 1 is the exact character identity and rendering reference.
Primary request: Create a clean 3x3 sprite sheet, exactly nine equal square cells, read left-to-right then top-to-bottom. Each cell contains one full-body frame of the same blue water-drop music mascot from Image 1. Animate a subtle idle cycle: neutral, breathe in, body gently rises, peak, breathe out, settles, blink begins, eyes closed, eyes open back to neutral. Keep the movements small, calm, and loopable.
Composition: 3 columns by 3 rows, no gutters or borders, same character scale and centered position in every cell, feet on the same baseline, full head and feet inside every cell. Square 1024x1024 canvas; genuine transparent background in every cell.
Constraints: preserve exact silhouette, face proportions, blue glossy jelly material, eyes, yellow musical-note ornament, short limbs and soft 3D cartoon style. The pose/expression may change only as required by the sequence. No ground shadow.
Avoid: panels, grid lines, cell dividers, overlapping characters, crop, scale changes between cells, text, numbers, labels, props, extra characters, background, watermark, extra accessories.
```

### 待机动作扩帧版

本轮用内置 ImageGen 以旧待机图集为角色参考，生成更连续的 4×4 待机动作。以下是根据实际生成目标整理、便于复用的提示词；**不是逐字保存的生成调用文本**。生成后统一帧内比例和脚底基线，末帧复用首帧姿势，再压缩为 WebP。

```text
Use the supplied idle sprite sheet as the exact identity and rendering reference. Create a transparent 4-by-4 sprite sheet with sixteen frames of the same blue water-drop music mascot, read left-to-right then top-to-bottom. Keep the body silhouette, scale, pose, and foot baseline identical in every frame. Animate only a natural, friendly blink using small eyelid changes; do not breathe, sway, squash, stretch, or resize the body. Keep the mascot centered and fully inside every square cell. Preserve the exact blue glossy jelly silhouette, face proportions, yellow musical-note ornament, and soft 3D cartoon style. Genuine transparent background; no ground shadow, text, labels, dividers, extra characters, props, or stray pixels.
```

### 答对欢呼

参考图：`src/assets/staff-game/characters/mascot-cheer.webp`、`src/assets/staff-game/characters/mascot-idle.webp`。

```text
Use case: stylized-concept
Asset type: transparent 3-by-3 sprite sheet for a short correct-answer cheer animation in a children's music game.
Input images: Image 1 is the exact happy mascot identity reference. Image 2 is the same mascot's neutral identity reference.
Primary request: Create a clean 3x3 sprite sheet, exactly nine equal square cells, read left-to-right then top-to-bottom. Each cell contains one full-body frame of the same blue water-drop music mascot. Animate one complete cheerful hop: ready pose, crouch slightly, begin takeoff, rise with arms lifting, joyful peak with eyes happily closed, hold the peak, begin descending, land with a soft squash, spring back to the neutral standing pose.
Composition: 3 columns by 3 rows, no gutters or borders, same character scale and centered position in every cell, feet aligned to the same baseline except while airborne, full head and feet inside each cell. Square 1024x1024 canvas; genuine transparent background in every cell.
Constraints: preserve the exact face, water-drop silhouette, blue glossy jelly material, yellow musical-note ornament, small limbs, and soft 3D cartoon style from the references. Motion is compact and readable at small on-screen size. No ground shadow.
Avoid: panels, grid lines, cell dividers, overlapping characters, crop, character redesign, text, numbers, labels, trophy, props, extra characters, background, watermark, extra sparkles.
```

### 答错难过与恢复

参考图：`source/mascot-sad-expression-reference.webp`、`src/assets/staff-game/characters/mascot-idle.webp`。

```text
Use case: stylized-concept
Asset type: transparent 3-by-3 sprite sheet for a gentle wrong-answer reaction in a children's music game.
Input images: Image 1 is the exact sad-expression design reference for the mascot. Image 2 is the same mascot's exact neutral identity reference.
Primary request: Create a clean 3x3 sprite sheet, exactly nine equal square cells, read left-to-right then top-to-bottom. Each cell contains one full-body frame of the same blue water-drop music mascot. Animate a gentle reaction: neutral, small sympathetic flinch, eyebrows turn concerned, shoulders and arms lower, gaze dips, hold a mild sad frown, take a small breath, lift gaze, return to a warm neutral expression. The emotion is “oops, try again”; never make the character cry or look frightened.
Composition: 3 columns by 3 rows, no gutters or borders, same character scale and centered position in every cell, feet on the same baseline, full head and feet inside each cell. Square 1024x1024 canvas; genuine transparent background in every cell.
Constraints: preserve exact silhouette, face proportions, large blue eyes, bright blue glossy jelly material, yellow musical-note ornament, and soft 3D cartoon rendering. Only expression and small body posture change.
Avoid: tears, sobbing, anger, fear, harsh failure symbols, speech bubble, props, extra sparkles, extra characters, crop, scale changes, panels, grid lines, dividers, text, labels, background, watermark.
```

### 暂停眨眼

参考图：`src/assets/staff-game/characters/mascot-wink.webp`、`src/assets/staff-game/characters/mascot-idle.webp`。

```text
Use case: stylized-concept
Asset type: transparent 3-by-3 sprite sheet for a subtle pause/wink animation in a children's music game.
Input images: Image 1 is the exact winking mascot identity reference. Image 2 is the same mascot's neutral identity reference.
Primary request: Create a clean 3x3 sprite sheet, exactly nine equal square cells, read left-to-right then top-to-bottom. Each cell contains one full-body frame of the same blue water-drop music mascot. Animate one gentle wink: relaxed neutral, one eyelid starts closing, wink nearly closed, full friendly wink, hold briefly with a tiny head tilt, eyelid opens, return to relaxed neutral. Keep the mood calm and reassuring, appropriate for a paused game.
Composition: 3 columns by 3 rows, no gutters or borders, same character scale and centered position in every cell, feet on the same baseline, full head and feet inside each cell. Square 1024x1024 canvas; genuine transparent background in every cell.
Constraints: preserve exact silhouette, face proportions, glossy blue material, yellow musical-note ornament, and soft 3D cartoon style from the references. Small expression changes only.
Avoid: panels, grid lines, dividers, crop, scale changes, tears, exaggerated expressions, extra characters, props, text, labels, background, watermark.
```

### 通关庆祝

参考图：`src/assets/staff-game/characters/mascot-level-celebration.webp`、`src/assets/staff-game/characters/mascot-cheer.webp`。

```text
Use case: stylized-concept
Asset type: transparent 3-by-3 sprite sheet for a short level-clear celebration animation in a children's music game.
Input images: Image 1 is the exact mascot identity and celebration-style reference. Image 2 is the same mascot's joyful style reference.
Primary request: Create a clean 3x3 sprite sheet, exactly nine equal square cells, read left-to-right then top-to-bottom. Each cell contains one full-body frame of the same blue water-drop music mascot. Animate one celebratory jump: anticipatory smile, bends knees, starts jumping, rises with arms up, reaches a joyful peak, holds the peak with eyes closed, begins to descend, lands with a soft squash, returns to a happy standing pose. Make it feel more special than the regular answer cheer but keep the character simple.
Composition: 3 columns by 3 rows, no gutters or borders, same character scale and centered position in every cell, feet aligned to the same baseline except while airborne, full head and feet inside each cell. Square 1024x1024 canvas; genuine transparent background in every cell.
Constraints: preserve exact water-drop silhouette, face proportions, bright glossy blue jelly material, yellow musical-note ornament, and polished soft 3D cartoon rendering. No cloud, no star, no extra object; those can be drawn by the game.
Avoid: panels, grid lines, dividers, overlapping/cropped character, inconsistent proportions, character redesign, text, numbers, props, extra characters, background, watermark, multiple poses outside the cells.
```

## 5. 中性待机角色

参考图：`src/assets/staff-game/characters/mascot-sad-frames.webp` 的难过帧。生成参数：`transparent_background: true`。生成后只取眉毛和嘴部，合成到原图集第 6 帧；眼睛、身体和轮廓继续使用原始帧。此第 6 帧同时用于待机，保证动画结束后不再切换素材。

```text
Use case: calm neutral face variant for the exact same mascot pose. Image 1 is the last frame of the game's sad animation. Preserve its precise character silhouette, body proportions, pose, framing, scale, position, arms, hands, feet, eyes, eye size, iris size, eye positions, colors, highlights, shading, and 3D material. Change only the eyebrows to relaxed, nearly level brows and replace the sad mouth with a tiny closed neutral line. Do not redraw, shrink, move, or reshape either eye. No smile, frown, tears, or excited expression. Keep the original transparent background. Do not redraw or resize the body, move any feature outside the face, or add any objects.
```

最终素材：`src/assets/staff-game/characters/mascot-neutral-idle.webp`。以难过图集索引 6 的 260×260 原图为底，只合成生成结果中的眉毛和嘴部，原眼睛像素保持不变；质量 100 的透明 WebP，约 17 KiB。该图已合入 `mascot-sad-frames.webp` 索引 6，运行时动画尾帧和待机共用同一格。当前难过序列只使用索引 1–6；原本带笑脸的索引 0、7、8 没有运行时用途，现已用这张中性帧覆盖并保留原坐标，避免后续误引用时再次出现笑脸。

## 6. 帮助弹窗提示标题

参考图：用户提供的帮助弹窗截图用于确定标题位置；橙色粗描边字样用于字体质感参考。使用 ImageGen 生成透明标题图，清理透明区游离像素并转换为 WebP。

```text
Use case: stylized-concept
Asset type: transparent UI title graphic for a children's music-learning game help dialog
Input images: Image 1 is a help-dialog screenshot for layout context only. Image 2 is a reference for the playful orange cartoon lettering style.
Primary request: create only the Chinese title text “提示”, inspired by Image 2's playful orange cartoon lettering. Image 1 is layout context only: the title will sit centered near the top of a cream-and-cyan framed help panel.
Style/medium: chunky hand-drawn display lettering, warm orange fill, thick dark brown outline, a thin pale cream outer keyline, subtle dimensional highlights and a soft restrained shadow. Friendly, energetic, polished game UI lettering.
Composition/framing: the two Chinese characters “提示” centered, compact horizontal wordmark, generous transparent padding, legible at small UI size.
Color palette: vivid orange, golden yellow highlights, dark cocoa outline, pale cream keyline.
Text (verbatim): “提示”
Constraints: render the exact Chinese characters “提示” only, correctly formed and readable. Transparent background. No stars, sparkles, icons, symbols, panels, scenery, extra text, watermark, or background. Keep edges clean.
```

最终素材：`src/assets/staff-game/ui/help-title-tip.webp`，1345×724，119,264 字节（约 117 KiB）；接入帮助弹窗标题，替换原有文字标题和顶部星星装饰。

## 共用交付要求

- 静态素材每个需求单独生成一张图，一个 PNG 只包含一个主体，不交付展示板或拼图。角色动作图集是例外：每组动作按本节提示交付一张 3×3 九帧透明图集，不要额外把多组动作拼在一起。
- 需要抠图的角色、道具、特效必须输出真实透明 alpha；“透明棋盘格”不能画进像素里。不得带图注、尺寸字样、分隔线、水印或界面文字。
- 游戏风格统一为清新、明亮、柔和的卡通 3D；蓝色水滴角色和青蓝色玻璃质感为主要视觉锚点，黄色高光作点缀。
- 场景背景单独出图，不附带 UI。手机背景按 9:19 狭长竖屏构图，为落下的音符留出低细节空间。
- 角色动作通过上述五组逐帧图集实现；音效已在首版生成并接入，目前没有单独的麦克风故障音。
