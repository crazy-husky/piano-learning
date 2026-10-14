# 已知测试基线

## 麦克风偏好测试与 SwiftF0 默认值不一致（已修复）

- **确认日期**：2026-10-15
- **基线提交**：`62ad977`
- **复现命令**：`pnpm exec vitest run src/features/vocal-pitch/logic/practiceMicrophonePreferences.test.ts`
- **基线结果**：在本次错题集改动全部 stash、工作区干净时，9 项中仍有 4 项失败，因此不是本次改动引入。
- **根因**：提交 `6d48886` 将默认算法从 `mpm-c` 改为 `swiftf0`，但测试仍有断言沿用 MPM-C 的有效阈值和无效算法回退值。
- **判断**：4 项失败均为过时的测试预期；实现按算法和灵敏度档位读取阈值配置，行为与 SwiftF0 默认值一致，没有代码 bug。

失败项和实际值如下：

1. `defaults to SwiftF0 with the standard sensitivity level`：有效 SwiftF0 配置实际为 `confidenceThreshold: 0.6`、`primaryClarityThreshold: 0.65`；测试仍期待 MPM-C 的 `0.75` 和 `0.8`。默认偏好对象本身的断言通过；失败的是解析后的有效配置断言。
2. `maps each sensitivity level to progressively stricter thresholds and stability`：SwiftF0 实际阈值为 `[0.4, 0.5, 0.6, 0.7, 0.8]`；测试期待 `[0.6, 0.675, 0.75, 0.825, 0.9]`，这是 MPM-C/YIN 的档位值。
3. `uses debug parameters only while debug mode is enabled`：关闭调试模式时，SwiftF0 实际阈值为 `0.6`；测试期待旧的 `0.75`。调试模式开启后使用自定义参数的断言通过。
4. `normalizes invalid values in the current preference shape`：无效算法实际回退为当前默认算法 `swiftf0`；测试仍期待旧默认值 `mpm-c`。

**修复**：测试预期已更新为 SwiftF0 实际档位值；MPM-C 阈值仍由显式指定 `mpm-c` 的断言覆盖，无效算法回退断言跟随当前默认算法。麦克风识别实现未改动。
