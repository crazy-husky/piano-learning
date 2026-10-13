# ESLint Cleanup Baseline

Initial baseline measured on 2026-10-11 with ESLint 9.39.5:

- Warnings: 53 across 36 files.
- Errors: 54 across 36 files.
- `react-hooks/rules-of-hooks`: 0 findings; keep at error.
- No single error rule exceeds the 50-finding downgrade threshold.

After downgrading all recommended `jsx-a11y/*` rules to warnings:

- Warnings: 88, including 35 JSX accessibility findings.
- Errors: 19.

## 第 3 阶段清理结果

- 第一批已清除 19 个 ESLint error 报告；当前 error 数为 0。
- 两处 `@typescript-eslint/no-floating-promises` 已处理，当前没有该规则 warning。
- `react-hooks/exhaustive-deps` 基线为 51 条：44 条已修复，7 条诊断由有原因的局部 disable 保留，当前活动 warning 数为 0。
- 2026-10-14 当前全仓 lint 为 16 warnings、0 errors，均为下方 JSX 无障碍待办。
- lint 脚本阈值仍为 200；当前 warning 数为 16。无障碍项清理完成后再收紧到 0。暂存 TypeScript 文件仍使用 0 warning 阈值。

## 待人工复核

1. `src/app/useBackupReminder.ts`：三个 effect 有意按备份摘要字段触发，避免无关 `data` 更新重启检查。为保留原触发时机，局部禁用了 6 条 exhaustive-deps 诊断（缺少完整 `data` 依赖及 `data !== null` 的静态分析提示）。人工复核时应对照 `getBackupReminderState`、`backupConflictDetailsMissing` 和入口预检条件，确认字段集合仍完整。
2. `src/features/staff-game/components/StaffGameView.tsx`：全局按钮音效监听调用由音频 Hook 返回的模块级稳定函数。该 Hook 声明在监听 effect 之后；为满足依赖规则而移动 effect 会改变 effect 注册顺序，因此保留 1 条带说明的局部 disable。后续调整音频 Hook 顺序时可重新评估。

## 后续技术债

1. **游戏音效 Hook 顺序**：`StaffGameView.tsx` 中约第 675 行的按钮监听 effect 引用了约第 789 行才由 `useStaffGameAudio` 返回的 `playGameSound`。局部 disable 抑制的是 exhaustive-deps 诊断，不是运行时 TDZ；若在当前位置把 `playGameSound` 直接放进依赖数组，依赖数组会在该 Hook 初始化之前求值。后续可将 `useStaffGameAudio` 调用移到 effect 之前，再为监听 effect 声明正常依赖。
2. **备份提醒字段监控**：`useBackupReminder.ts` 的三个 effect 依赖备份状态的明确摘要字段，而不是整个 `data` 对象。若 `backupState` 新增字段，需重新检查 `getBackupReminderState`、冲突详情补齐和入口预检逻辑，判断是否应纳入相应依赖数组。

## Error Cleanup Baseline

- `@typescript-eslint/no-unused-vars`: 12.
- `no-irregular-whitespace`: 6.
- `prefer-const`: 1.

以上 19 个 ESLint error 报告已在第一批处理完成，目前没有存量 error。

## 专项清理任务

### JSX Accessibility

The 16 remaining findings are warnings pending a dedicated component review. The current distribution is:

- Missing `alt` text: 0.
- Missing `aria-label`: 0.
- Other: 16, distributed by rule:
  - `jsx-a11y/click-events-have-key-events`: 5.
  - `jsx-a11y/no-noninteractive-element-interactions`: 3.
  - `jsx-a11y/no-static-element-interactions`: 2.
  - `jsx-a11y/no-autofocus`: 4.
  - `jsx-a11y/no-noninteractive-tabindex`: 1.
  - `jsx-a11y/interactive-supports-focus`: 1.

Planned batches:

1. Review click and keyboard semantics in the practice-microphone dialogs, staff-recall map, vocal sidebar, and vocal-pitch view.
2. Review the 4 autofocus usages against each dialog's focus-management behavior.
3. Confirm the data-table scroll region needs keyboard focus and retain or replace its current `tabIndex` accordingly.
