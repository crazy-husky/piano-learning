# Spec: 和弦训练 Level 8

## Objective

在现有学习路线中新增独立的「和弦训练」模块（路由与数据 ID 为 8），练习调内三和弦与七和弦；在「视奏能力地图」中的建议顺序为 Level 5，作为音距后的进阶选修，不作为后续关卡的解锁条件。它包含看谱选择和弦名称，以及通过 MIDI 弹奏柱式和弦、分解和弦。成功标准：入口、导读、练习、统计和首页进度均能使用；音符只来自所选大调音阶，不出调；和弦练习记录不会混入单音或双手协同统计。

## Product scope

- 和弦根音调：12 个常用大调，默认 C 大调。
- 和弦集合：用户可自由勾选调内 I、V、vi、IV、ii、iii、vii°级，按流行歌曲常见程度排序；默认仅选择 I 级和弦组。
- 练习音区：可多选大字组至小字三组，不提供音区加练；默认 C4–B4。和弦最低音落入所选音区，转位后的其他和弦音按和弦结构排列。
- 和弦类型：三和弦、七和弦，可同时选择；默认仅三和弦。
- 转位：复选根音、第一转位、第二转位；仅练七和弦时可再选第三转位。可同时勾选多种，题目从所选转位中随机抽取；默认根音。认和弦默认要求用户回答转位，可在更多配置中关闭；回答时展示当前和弦类型的所有有效转位供选择；弹奏模式不显示此选项。
- 训练和弦选项展示当前调性下的和弦音名，并保留罗马数字级数和功能名；选项按常见流行和弦顺序排列。
- 谱面固定钢琴大谱表；和弦全部由单手演奏，不提供谱表或双手拆分选项。和弦根据所选音区显示在合适的谱号上。
- 练习方式：认和弦、弹奏柱式和弦、弹奏分解和弦；默认认和弦。后两种方式仅支持 MIDI。
- 练习长度沿用开放练习、固定题数及固定时长；固定题数快捷档为 30/70/200，支持自定义。
- 认和弦依次回答根音、和弦性质和转位；关闭转位要求时，回答和弦性质后结束本题。根音选错时留在根音步骤，仅将误选项标红约 800 毫秒后恢复，不提示正确根音，用户选对后才进入下一步。和弦性质、转位或弹奏答案错误时停留在本题并显示正确答案，需由用户点击“下一题”后继续；正确答案沿用短暂反馈后自动进入下一题。提示内容默认隐藏，点击提示按钮后与按钮同行显示，进入下一题后再次隐藏。根音在谱面上以红色标记，和弦时值按流行伴奏常见程度加权抽取，四分、二分音符常见，八分音符较少，全音符最少。
- 每组和弦算一道题；答错不重复计题，结算显示首答正确率和本局题数。练习页内容可纵向滚动，保证答案提示可见。
- 练习结果保存为独立的 `chord-training` 答题事件，支持首页学习进度、备份和专属统计；不转换成单音 ReviewRecord。

## Tech stack

React 18、TypeScript 5.9、VexFlow 5、Web MIDI。复用现有学习模块壳、MIDI 设备选择器、答题事件持久化和夜间主题。

## Commands

- Dev: `pnpm dev:local`
- Type check: `pnpm typecheck`
- Lint: `pnpm lint`
- Formatting check: `pnpm format:check`
- Production build (only when preparing deployment): `GITHUB_PAGES=true GITHUB_REPOSITORY=crazy-husky/piano-learning pnpm run build`

## Project structure

- `src/features/chord-training/logic/`: major-key diatonic chord generation, chord labels, MIDI target pitches and inversion ordering.
- `src/features/chord-training/components/`: setup/run/session summary, staff prompt and dedicated stats view.
- `src/styles/chord-training.css`: responsive styles using existing page theme tokens.
- `src/routing/`, `src/features/learning/`, `src/features/home/`: Level 8 route, module definition, progress and home entry.
- `docs/product-decisions.md`: durable product decisions.

## Code style

Keep chord theory and input matching as pure functions, separate from React state and drawing. Persist only complete runs.

```ts
const chord = generateDiatonicChord({
  key: "C",
  degree: 4,
  quality: "triad",
  inversion: 1,
  octave: 4,
});
```

Use typed discriminants for task type and quality, narrow helper functions, named accessible controls, and existing theme colors.

## Verification strategy

Run type check, lint and formatting check. Do not run the test suite or add tests unless the user asks. Browser/device MIDI verification is outside this implementation pass; report that limitation separately from static checks.

## Boundaries

- Always: preserve existing Level 1–7 behavior; validate saved setup preferences; keep chord events out of single-note and duet review flows; require MIDI for chord performance; keep every chord in the chosen major key and show every prompt on the grand staff for one hand to play.
- Ask first: adding out-of-key chords, microphone/virtual input, new dependencies, or changing existing accompaniment levels.
- Never: reinterpret a chord group as several unrelated single-note questions; persist incomplete runs as completed sessions.

## Implementation tasks

- [ ] Register Level 8 in routing, module guide, home learning path and progress model.
- [ ] Add chord theory model and VexFlow notation for triads/sevenths, inversions and clefs.
- [ ] Implement setup, score recognition, MIDI block/broken-chord input, pause/length handling and completed-run summary.
- [ ] Persist complete chord answer events and display dedicated statistics.
- [ ] Add responsive dark/light themed styles and verify static checks.

## Success criteria

- `#/level/8` opens a dedicated module with guide, practice and stats tabs.
- Users can configure key, individual in-key chord degrees, practice register groups, chord quality, selected inversions and practice length; chord degree options show key-specific chord symbols and function labels in common pop-song order. Defaults are C major, C4–B4, only I degree, triads and root position. All notation uses grand staff, and all chord notes are played by one hand.
- Recognition accepts chord-name selection with distractors drawn from other diatonic chords in the current key and selected chord types; block/arpeggiated performance accepts MIDI only.
- MIDI matching compares complete chord pitch sets; arpeggio matching follows the displayed low-to-high note order.
- Fixed-count and fixed-duration runs end at their selected limits; pause freezes active time.
- Completed-run summary and Level 8 statistics report chord-level questions and first-try accuracy.
- Chord-training progress appears in the home learning path and as the optional Level 5 stage in the sight-reading map; its route and stored event IDs remain 8 so existing records and links stay stable.

## Open questions

None blocking. Initial defaults are chosen to keep the first release focused; they can be adjusted from usage feedback.
