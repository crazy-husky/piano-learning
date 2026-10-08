# 五线谱游戏素材核对与切图

## 核对结论

- 收到 3 张图集；原图保存在 `art/staff-game/source/`，切好的独立素材保存在 `src/assets/staff-game/`。
- 闯关运行素材统一压缩为 WebP（图像质量 88、透明度质量 100）；设置蝴蝶结按 68×43 CSS 像素显示，缩至 272×181，约 13 KB。其余高像素气泡与操作图标也按游戏显示尺寸缩小。
- 第 2、3 张图集带真实 PNG 透明通道，已拆分并排除了图集中的标题、分隔线和标注。
- 第 1 张图集是 RGB 图片，棋盘格只是画面内容，并非透明背景。三个角色已清理外围棋盘格；原气泡不可用，因此重新生成了空心玻璃气泡，真正透明的中心孔可以叠加谱面音符。问题样本见 `art/staff-game/review/rejected-bubble-checkerboard-baked.png`。
- 新增了独立的 9:19 手机场景图；闯关页在窄屏切换到竖版场景，桌面使用横版场景。
- 切图已生成预览：`art/staff-game/review/cut-assets-contact-sheet.jpg`。
- 补充素材的生图提示词保存在 `art/staff-game/generation-prompts.md`。
- 图片素材已完成整理并接入闯关页：场景按屏幕比例切换，角色、漂浮云朵、玻璃气泡、谱面预览、HUD、按钮、弹窗、奖章和爆破星粒子均使用对应图片。角色仍是静态图，通过 CSS 做轻微漂浮和状态切换。
- 进入闯关页时会先加载并解码实际使用的 24 张图片，完成后再显示游戏；若有图片加载失败，会提供重试入口。

## 已切素材

| 分类 | 文件 | 像素 | 状态 / 用途 |
| --- | --- | ---: | --- |
| 角色 | `characters/mascot-idle.webp` | 445×475 | 可用；常态角色 |
| 角色 | `characters/mascot-cheer.webp` | 432×450 | 可用；成功/连击反应，原图含装饰星 |
| 角色 | `characters/mascot-wink.webp` | 423×459 | 可用；成功反应，原图含提示线 |
| 角色 | `characters/mascot-level-celebration.webp` | 483×509 | 可用；通关庆祝插画，含音符、星光和云朵 |
| UI | `ui/hud-frame.webp` | 872×246 | 可用；顶部信息面板底图 |
| UI | `ui/button-primary-base.webp` | 663×191 | 可用；主操作按钮底图 |
| UI | `ui/button-secondary-base.webp` | 499×153 | 可用；次操作按钮底图 |
| UI | `ui/modal-frame.webp` | 393×353 | 可用；弹窗面板底图 |
| UI | `ui/settings-bow.webp` | 272×181 | 可用；设置弹窗顶部装饰，约 13 KB |
| UI | `ui/level-medal-frame.webp` | 432×470 | 可用；结算/关卡奖章框，内部可叠加星级或文字 |
| 特效 | `ui/star-particle.webp` | 289×266 | 可用；单颗发光五角星及自带小光点，可复制后做散开、缩放和淡出 |
| 特效 | `effects/bubble-shell-empty-center.webp` | 512×512 | 可用；空心玻璃圆环，WebP 透明中心孔保留，可叠加音符 |
| 特效 | `effects/cloud-decoration-1.webp` | 495×171 | 可用；云朵装饰，可用 CSS 横向漂移 |
| 特效 | `effects/cloud-decoration-2.webp` | 510×177 | 可用；云朵装饰 |
| 特效 | `effects/cloud-decoration-3.webp` | 500×179 | 可用；云朵装饰 |
| 谱面 | `notation/treble-staff-c4-note.webp` | 451×284 | 可用；高音谱号与中央 C 音符参考图，可用于气泡内容示意 |
| 场景 | `backgrounds/meadow-desktop.webp` | 1095×492 | 已接入；横向草地场景，宽屏 cover 裁切 |
| 场景 | `backgrounds/meadow-mobile.webp` | 863×1822 | 已接入；窄屏使用独立 9:19 竖屏构图 |

## 已生成并接入的音效

| 文件 | 时长 | 用途 | 音效质量评估 |
| --- | ---: | --- | --- |
| `audio/bubble-pop.wav` | 0.67 秒 | 答对音符，气泡破裂 | VSS 生成成功；基础 WAV 检查通过 |
| `audio/combo-streak.wav` | 0.89 秒 | 每 3 连击播放一次 | 89/100 |
| `audio/note-missed-soft.wav` | 0.87 秒 | 音符气泡超时飘走 | 82/100 |
| `audio/level-clear.wav` | 1.22 秒 | 本局达到至少 1 星 | 85/100 |
| `audio/microphone-ready.wav` | 0.87 秒 | 麦克风连接成功或恢复 | 85/100 |

五个 WAV 均为 44.1 kHz、16-bit、单声道。单次峰值约 -0.3 dBFS，游戏播放层会按不同用途降音量；连击只在第 3、6、9…次连续答对时播放，避免音效叠得太密。

VSS MCP 的本机 JSON 配置位于 `/Users/husky/.config/piano-learning/vss-mcp.json`，权限为当前用户可读写；密钥没有放入仓库。初始免费余额 50 token，本次生成 5 个音效后显示余额 25。

## 缺项与限制

1. 当前没有独立的麦克风失败音；权限错误和输入故障继续使用页面文字提示。
2. **角色动画素材目前仍是静态图。** 已用 CSS 做漂浮、轻微缩放、连击状态切换、星粒子散射和弹窗过渡；连续眨眼或逐帧动作需要补同尺寸、同视角角色帧。
3. 按钮图只提供底板，没有文字、返回/暂停/麦克风图标，也没有 hover/pressed/disabled 状态。文字由 DOM 绘制，图标使用项目现有图标库，交互状态由 CSS 处理。

## 切图来源范围

- `01-characters-and-bubble.png`：常态角色 `(44,492)-(506,978)`、欢呼角色 `(548,510)-(998,976)`、眨眼角色 `(1028,502)-(1494,976)`。角色用连通区域方式去除外围浅灰棋盘格；原气泡问题样本留在 review 目录。
- `02-ui-and-clouds.png`：HUD、主/次按钮、弹窗、星粒子和三片云分别按图集分区裁出；对透明边界按主体收紧，并剔除了标签和分隔线。
- `03-notation-level-and-backgrounds.png`：高音谱号参考图、通关角色、奖章和两张场景分别裁出；场景切图避开了白色分隔线。
