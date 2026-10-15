# 产品设计决策

本文记录已确认的错题集与闯关产品决策。日期为本次整理日期；除非另有注明，不代表最初讨论日期。

## 错题趋势

### 趋势按整局整体表现计算

- 日期：2026-10-16
- 理由：不同对局的音符池可能不同，共同音符交集会随对局增加而缩小，导致趋势数据减少或消失。
- 影响文件：`src/domain/staffGameWrongNoteTrends.ts`、`src/features/staff-game/components/StaffGameWrongNoteTrendPanel.tsx`、`src/features/staff-game/components/StaffGameWrongNoteTrendChart.tsx`
- 不要改回：趋势按整局统计，不再取多局共同音符交集。

### 趋势只展示准确率和平均用时

- 日期：2026-10-16
- 理由：这两个指标更直接地反映整体表现和反应速度。
- 影响文件：`src/domain/staffGameWrongNoteTrends.ts`、`src/features/staff-game/components/StaffGameWrongNoteTrendPanel.tsx`
- 不要改回：不要在趋势指标中恢复错漏次数、错漏率等其他指标。

### 准确率和平均用时只统计首次答对

- 日期：2026-10-16
- 理由：首次答错后的后续答对不能代表首次识别表现。
- 影响文件：`src/domain/staffGameWrongNoteTrends.ts`、`src/features/staff-game/components/StaffGameWrongNoteTrendPanel.tsx`、`src/features/staff-game/components/StaffGameView.tsx`
- 不要改回：准确率以出题数为分母，只计首次答对；平均用时只统计有效的首次答对反应时长。

### 趋势按天汇总，单日数据按局展示

- 日期：2026-10-16
- 理由：多天数据适合观察每日变化；只有一天时按局展示，避免单日练习数据被压成一个点。
- 影响文件：`src/domain/staffGameWrongNoteTrends.ts`、`src/features/staff-game/components/StaffGameWrongNoteTrendChart.tsx`、`src/features/staff-game/components/StaffGameWrongNoteTrendPanel.tsx`
- 不要改回：多天时按日期展示，同一天多局按出题数和反应样本数加权汇总；只有一天时按局展示并标注时分。少于三个点时仍画图并提示样本较少，不设隐藏图表的硬门槛。

### 趋势只合并练习条件相同的对局

- 日期：2026-10-16
- 理由：不同来源或练习设置下的成绩不应混在同一条趋势中解释。
- 影响文件：`src/domain/staffGameWrongNoteTrends.ts`、`src/features/staff-game/components/StaffGameWrongNoteTrendPanel.tsx`
- 不要改回：趋势分组保持来源、关卡或复习范围、难度、输入方式、音符池范围和出题策略；条件不同的对局不合并。

### 结算对比和趋势图使用不同统计口径

- 日期：2026-10-16
- 理由：趋势回答“我整体在进步吗”，结算对比回答“这次这组相同的音比上次怎么样”。
- 影响文件：`src/domain/staffGameWrongNoteArchives.ts`、`src/domain/staffGameWrongNoteTrends.ts`、`src/features/staff-game/components/StaffGameReviewSummaryContent.tsx`
- 不要改回：趋势按整局整体表现计算；结算对比继续只比较两局共同出现的音符。

## 错题复习与诊断

### 错题复习袋优先覆盖最多 20 个高权重错题音

- 日期：2026-10-16
- 理由：有限的音符袋先保证最需要练习的错题音出现，再按权重抽取补足。
- 影响文件：`src/features/staff-game/logic/staffGameRules.ts`、`src/features/staff-game/components/StaffGameView.tsx`
- 不要改回：每袋最多优先覆盖权重最高的 20 个错题音，各出现至少一次；超过 20 个时不承诺覆盖全部错题音。

### 等待页错题列表显示累计错漏次数和准确率

- 日期：2026-10-16
- 理由：累计错漏次数直观，准确率补充该音在归档中的表现。
- 影响文件：`src/domain/staffGameWrongNoteArchives.ts`、`src/features/staff-game/components/StaffGameView.tsx`、`src/features/staff-game/components/StaffGameReadyPanel.tsx`
- 不要改回：权重可以用于排序和抽取，但不要用“权重 X.X”替代列表中的累计错漏次数。

### 单音诊断展示所有音并按错误率降序排列

- 日期：2026-10-16
- 理由：音符数量有限，直接展示全部音比增加筛选更顺畅。
- 影响文件：`src/domain/staffGameWrongNoteArchives.ts`、`src/features/staff-game/components/StaffGameWrongNoteNoteDiagnosticPanel.tsx`
- 不要改回：不要恢复“全部/最弱”筛选；所有有数据的音都显示，错误率高的排在前面。

### 静态自测结果不写入统计

- 日期：2026-10-16
- 理由：静态浏览和自测用于用户自行复习，不代表正式对局表现。
- 影响文件：`src/features/staff-game/components/StaffGameWrongNoteStudyDialog.tsx`
- 不要改回：不要把静态自测的记住或没记住结果写入对局归档、趋势或错题权重。

## 归档规则

### 全对局保存为仅供趋势使用的记录

- 日期：2026-10-16
- 理由：全对局也是有效表现样本，应参与趋势统计。
- 影响文件：`src/features/staff-game/components/StaffGameView.tsx`、`src/domain/staffGameWrongNoteArchives.ts`
- 不要改回：全对局写入趋势记录，但不进入错题管理、错题复习或错题权重统计。

### 错题复习局始终自动归档

- 日期：2026-10-16
- 理由：错题复习本身就是针对错题的持续练习，不应受闯关设置开关影响。
- 影响文件：`src/features/staff-game/components/StaffGameView.tsx`
- 不要改回：错题复习局自动归档，不受“错题自动归档”开关控制。

### 闯关错漏局按自动归档设置处理

- 日期：2026-10-16
- 理由：闯关是否自动加入错题集由用户设置控制。
- 影响文件：`src/features/staff-game/components/StaffGameView.tsx`、`src/features/staff-game/components/StaffGameSummaryDialog.tsx`
- 不要改回：开关开启时自动归档；关闭时由用户在结算页手动加入；全对局不显示“加入错题集”入口。

### 移除薄弱音加练并清理历史 drill 归档

- 日期：2026-10-16
- 理由：薄弱音加练与错题复习用途重复，错题适合隔一段时间再复习。
- 影响文件：`src/data/db.ts`、`src/domain/staffGameWrongNoteArchives.ts`、`src/domain/types.ts`、`src/features/staff-game/components/StaffGameSummaryDialog.tsx`
- 不要改回：本地 IndexedDB 升级时清理旧 `source: "drill"` 记录；备份导入和合并时也过滤该来源。不要把自由练习的 `note-drill` 当作已移除功能。

### 错题管理按局删除并二次确认

- 日期：2026-10-16
- 理由：按局选择能精确管理记录，二次确认可避免误删。
- 影响文件：`src/domain/staffGameWrongNoteArchives.ts`、`src/features/staff-game/components/StaffGameWrongNoteArchiveManagerDialog.tsx`
- 不要改回：删除按 `runId` 执行；删除选中项前必须二次确认。

## 弱音权重

### 弱音 TTL 和归档衰减以最后出错时间为锚点

- 日期：2026-10-16
- 理由：普通更新时间或答对操作不应延长旧错误的有效期。
- 影响文件：`src/features/staff-game/logic/staffGameWeakNoteHistory.ts`、`src/domain/staffGameWrongNoteArchives.ts`
- 不要改回：弱音历史 TTL 和归档权重衰减使用最后一次实际出错时间；旧归档缺少该时间时回退到对局结束时间。

## 输入与闯关进度

### 虚拟键盘按音名判定，不比较八度

- 日期：2026-10-16
- 理由：屏幕虚拟键盘只有 C 至 B 七个键，每个键代表该音名的所有八度。
- 影响文件：`src/features/staff-game/hooks/useStaffGameScoring.ts`、`src/features/staff-game/components/StaffGameView.tsx`
- 不要改回：虚拟键盘按音名匹配，不要改成严格八度判定；MIDI 和麦克风仍按完整音高判定。

### 错题复习局不写入闯关进度

- 日期：2026-10-16
- 理由：错题复习是独立练习，不应改变闯关最高分、星级、连击或关卡解锁。
- 影响文件：`src/features/staff-game/hooks/useStaffGameScoring.ts`、`src/features/staff-game/components/StaffGameView.tsx`
- 不要改回：错题复习局不要调用 `persistRoundResult`。
