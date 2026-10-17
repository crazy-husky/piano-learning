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

### 错题复习题袋按错音数动态构建并覆盖全部错音

- 日期：2026-10-16
- 理由：固定 20 题会在错音超过 20 个时漏练；动态题袋能覆盖当前范围内所有不同错音，同时通过熟悉音维持练习信心。
- 影响文件：`src/features/staff-game/logic/staffGameWrongNoteReview.ts`、`src/features/staff-game/components/StaffGameView.tsx`、`src/features/staff-game/components/StaffGameReadyPanel.tsx`
- 题袋规则：错题层先让每个错音出现一次，再按错漏权重重复 `ceil(N / 2)` 次；熟悉音目标数为 `N < 5 ? 2N : 10 + round((N - 5) × 0.2)`。熟悉音先从最近 14 个本地日历日内出场至少 3 次且准确率不低于 80% 的已解锁非错音中选，不足时再从任意已解锁非错音补齐；候选不足时缩减熟悉音数量，不强行凑题。
- 时限：`min(180 秒, max(60 秒, 总题数 × 当前难度下落时长 × 0.5))`；题袋耗尽或时限到达时结束，以先发生者为准。暂停时不计时；用户可以提前结束。
- 不要改回：错音按音高去重并全部覆盖；超过 20 个时提示题量较多但仍正常生成，不截断题袋；不改变归档结构、对比算法、单音页签或趋势图口径。

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

### 六档难度、统一按首次答对率评星，并重置旧闯关与歌曲成绩

- 日期：2026-10-16
- 难度：麻瓜 15 秒 / 连击等待 9 秒（6 / 1 分）；悠闲 10 秒 / 6 秒（7 / 2 分）；简单 7 秒 / 4.2 秒（8 / 2 分）；普通 4.9 秒 / 3 秒（10 / 3 分）；困难 3.3 秒 / 2 秒（12 / 4 分）；噩梦 2.2 秒 / 1.3 秒（15 / 5 分）。每档的两项得分分别为单题基础分和连击加分。
- 星级：闯关和歌曲都按首次答对率计算；达到 60%、75%、90% 分别获得 1、2、3 星。错答后重试成功仍记为首次未答对。
- 存档：单人使用，升级时清空旧关卡进度、解锁状态和歌曲成绩，不迁移。歌曲新成绩按歌曲和难度分别保存。
- 理由：延长麻瓜档以支持新手逐键定位；其余难度按稳定比例递进。星级只反映答对比例，积分保留难度差异。重置避免旧的积分和评星规则造成数据不可比。
- 不要改回：旧闯关解锁和分数不迁移；歌曲成绩按难度独立；两个模式共用首次答对率阈值。

### 虚拟键盘按音名判定，不比较八度

- 日期：2026-10-16
- 理由：屏幕虚拟键盘只有 C 至 B 七个键，每个键代表该音名的所有八度。
- 影响文件：`src/features/staff-game/hooks/useStaffGameScoring.ts`、`src/features/staff-game/components/StaffGameView.tsx`
- 不要改回：虚拟键盘按音名匹配，不要改成严格八度判定；MIDI 和麦克风仍按完整音高判定。

### 闯关和歌曲模式默认使用虚拟琴键

- 日期：2026-10-17
- 理由：虚拟琴键无需连接外设或申请麦克风权限，首次进入即可开始游戏。
- 影响文件：`src/features/staff-game/components/StaffGameView.tsx`、`src/features/staff-game/logic/staffGameSettings.ts`
- 不要改回：闯关与歌曲模式的新默认输入方式均为虚拟琴键；两种模式共用输入偏好。已有保存的输入方式继续沿用，不因默认值变化覆盖本地设置。

### 错题复习局不写入闯关进度

- 日期：2026-10-16
- 理由：错题复习是独立练习，不应改变闯关最高分、星级、连击或关卡解锁。
- 影响文件：`src/features/staff-game/hooks/useStaffGameScoring.ts`、`src/features/staff-game/components/StaffGameView.tsx`
- 不要改回：错题复习局不要调用 `persistRoundResult`。

## 谱位间距练习

### 间距推导作为练习页签并独立保留配置

- 日期：2026-10-16
- 理由：看间距与弹奏练习共用同一套谱面和音域配置；保留独立的间距题目设置，并让用户在同一入口切换训练方式。
- 影响文件：`docs/specs/staff-distance-practice.md`、`src/features/practice/components/PracticeSetupView.tsx`、`src/features/practice/components/StaffDistancePracticeView.tsx`、`src/routing/appRoutes.ts`
- 不要改回：间距推导保持为练习页签；路由记住当前页签和看/弹模式；返回练习时回配置页；间距练习设置单独保存，不覆盖自由练习设置。

### 间距推导包含看与弹两种训练方式

- 日期：2026-10-16
- 理由：看模式训练直接判断相邻谱位的步数；弹奏模式先通过谱面起音建立实际琴键位置，再逐音弹奏后续音型。
- 影响文件：`docs/specs/staff-distance-practice.md`、`src/domain/types.ts`、`src/routing/appRoutes.ts`、`src/features/practice/components/StaffDistancePracticeView.tsx`、`src/features/practice/components/StaffDistanceRun.tsx`
- 不要改回：配置页内可选择「看间距」或「弹奏下一个音」；看模式用数字作答；弹奏模式先要求正确弹奏谱面第一个音作为起音，该音不计题、不计成绩；之后弹奏谱面中的后续音，支持 MIDI 精确音高和麦克风识别，不提供虚拟键盘；输入音高必须匹配谱面八度。只校验音高，不验证用户是否通过间距推导得出目标音。未连接 MIDI 时开始按钮仍可点击，点击后提示用户连接 MIDI 或改用麦克风。两个模式共用音域、题目序列、时值、分页、长度和间距规则；看/弹模式及弹奏输入方式写入独立间距偏好和本局记录，路由以 `distanceMode` 保存当前模式。

### 间距按相邻谱位计数并支持同音 0 步

- 日期：2026-10-16
- 理由：用音程度数换算会多一次心算；直接数相邻线位和间位更符合用户要训练的视觉反应。
- 影响文件：`docs/specs/staff-distance-practice.md`、`src/domain/staffDistancePractice.ts`、`src/features/practice/components/StaffDistanceRun.tsx`
- 不要改回：看模式只输入距离数字，方向不影响答案；相邻谱位算 1 步；同音重复可输入 0；最大 7 步要求所选音域覆盖两个连续音组，并且同一谱表内存在相隔 7 步的音对。大谱表中分属高、低音谱的相邻音组不能满足这条音对要求；无法出题时提示用户在中央 C 右侧的高音区或左侧的低音区选择连续多组音符；只有正确作答后，作为目标音的音符才标绿，未答对的音保持默认颜色，粉色定位条标记当前音；3 个及以下答案一排，4 个答案排成 2+2，超过 4 个时尽可能均分成两排且每排最多 4 个，按钮组收窄居中且两排分别居中；固定题数谱面按宽度分页，进度显示题号，不额外显示页码；运行页只提供暂停/继续和结束，不设单独返回按钮；电脑端空格暂停/继续。

### 谱号相关的间距音型与谱面时值由练习设置控制

- 日期：2026-10-16
- 理由：高音谱练近距离视读，低音谱提前熟悉常见和弦分解；不同音符时值用于熟悉谱面记号。
- 影响文件：`docs/specs/staff-distance-practice.md`、`src/domain/staffDistancePractice.ts`、`src/features/practice/components/StaffDistancePracticeView.tsx`、`src/features/practice/components/StaffDistanceRun.tsx`
- 不要改回：高音谱的非同音距离基础概率为 1 步 30%、2 步 30%、3 步 20%、4 步 10%，5–7 步各约 3.3%；启用 0 步时同音占 5%，其余非同音距离按比例缩放。实际出题还受当前音域可用音对、方向平衡和每 20 题段远跳覆盖规则影响。低音谱可出现自然大、小三和弦的分解音型，仍按单音逐题输入距离；最大间距和音域允许时，每个完整 20 题段覆盖上行、下行远跳；全音符、四分、八分、十六分时值支持多选，作为 4/4 节奏生成器的可用音符值；显示 4/4 拍号，节奏连续，不显示休止符或空拍；拍内连梁和小节线按时值生成；每页按可用宽度、节奏间隔和最小可读音符间距计算音符数，利用整段谱面空间并在空间不足时换页，重复上一页末音以保留页边距离题。时值不改变题数、练习计时或距离答案。

### 高低音谱表分开保存音域，大谱表按音高分谱

- 日期：2026-10-16
- 理由：自由练习和间距推导共用范围概念；加练在所选音域两端扩展，单谱超出 C4/B3 分界的部分用于少量跨手位识谱，大谱表始终按中央 C 的固定分界记谱。
- 影响文件：`src/data/db.ts`、`src/domain/notes.ts`、`src/domain/melody.ts`、`src/domain/staffDistancePractice.ts`、`src/shared/components/GlobalRangeControls.tsx`、`src/features/practice/components/PracticeView.tsx`、`src/features/practice/components/StaffDistancePracticeView.tsx`、`src/features/practice/hooks/usePracticeSessionStart.ts`、`src/features/practice/hooks/usePracticeStaffPageFlow.ts`
- 不要改回：高音谱表主体音域从 C4 起，低音谱表主体音域到 B3 止；所有模式都可在音域两端分别加练 3 或 5 个音，只受钢琴可用音域边界限制，向低和向高可同时启用，同一方向只保留一个跨度，改选时替换该侧范围。高音谱表中低于 C4 的加练音、低音谱表中高于 B3 的加练音作为跨手识谱，并保留当前谱号；相关说明用红色突出。大谱表新增音按 C4/B3 分界归入对应谱表，不做单谱模式的跨手交叉练习；点击已高亮选项可取消对应一侧，也可用“取消加练”按钮清除所有加练；高音谱表、低音谱表和大谱表各自记住最近范围，且自由练习与间距推导读取同一份当前配置。
- 大谱表不显示“谱表间加线”选项；即使旧偏好仍开启，也忽略同一音高的另一谱号写法，只按 C4/B3 分界生成，避免交叉练习。
- 大谱表按 C4 分界：C4 及以上在高音谱，B3 及以下在低音谱；自由练习按所选音域同时从高、低音谱表出题，音符始终按 C4/B3 分界记在对应谱表，不因上一题的谱表而锁定整页。间距推导按高、低音谱表交替生成短音段；切换谱表的边界音对不计题并用小节线分隔，不留空拍或显示休止符，每个实际计分音对仍只在同一谱表内，不跨手区跳转。桌面宽谱页应能看到两行谱表都有音符；窄屏可只显示当前可容纳的音段。大谱表加练扩展所选音域，但不改变这条分谱规则。
- 自由练习中已选择的跨组加练音按低频穿插，目标概率为 8%；间距推导继续以主体音域为主并低权重穿插已选边界音。

## 自由练习

### 练习页签使用直观标题和简短说明

- 日期：2026-10-16
- 理由：用户进入页签时能快速理解练习目标，避免把产品术语当作练习名称。
- 影响文件：`src/features/practice/components/PracticeSetupView.tsx`
- 不要改回：自由练习页签标题使用「自由练习」，下方说明识谱和弹奏对应琴键；歌曲页签标题使用「歌曲练习」，下方用一句话说明跟随谱面练习读谱与弹奏。

### 时值支持混选并保留连续谱面流

- 日期：2026-10-16
- 理由：混合节奏帮助熟悉真实谱面记号；逐音答题和自动翻行/滚动沿用现有自由练习流程。
- 影响文件：`src/features/practice/components/PracticeSetupView.tsx`、`src/features/practice/components/PracticeView.tsx`、`src/features/practice/hooks/usePracticeStaffPageFlow.ts`、`src/features/practice/logic/staffPageNotation.ts`
- 不要改回：全音符、四分、八分、十六分音符可多选；多选时按连续 4/4 节奏谱面展示，带拍号、小节线和拍内连梁，仍逐音答题；谱面按现有宽度自动翻行/滚动，去掉页码提示但保留谱面流转；混选时使用谱页显示，单音答题仍可在只选一种时值后使用。大谱表单音谱面中，另一谱表的空拍用不可见占位保持节奏，不显示休止符，谱尾不画终止线。
