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
- 当前全仓 lint 为 35 warnings、0 errors，35 条均为下方 JSX 无障碍待办。
- lint 脚本阈值仍为 200。当前实测 warning 数为 35，可手动收紧到 50；无障碍项清理完后再收紧到 0。暂存 TypeScript 文件仍使用 0 warning 阈值。

## 待人工复核

1. `src/app/useBackupReminder.ts`：三个 effect 有意按备份摘要字段触发，避免无关 `data` 更新重启检查。为保留原触发时机，局部禁用了 6 条 exhaustive-deps 诊断（缺少完整 `data` 依赖及 `data !== null` 的静态分析提示）。人工复核时应对照 `getBackupReminderState`、`backupConflictDetailsMissing` 和入口预检条件，确认字段集合仍完整。
2. `src/features/staff-game/components/StaffGameView.tsx`：全局按钮音效监听调用由音频 Hook 返回的模块级稳定函数。该 Hook 声明在监听 effect 之后；为满足依赖规则而移动 effect 会改变 effect 注册顺序，因此保留 1 条带说明的局部 disable。后续调整音频 Hook 顺序时可重新评估。

## Error Cleanup Baseline

- `@typescript-eslint/no-unused-vars`: 12.
- `no-irregular-whitespace`: 6.
- `prefer-const`: 1.

以上 19 个 ESLint error 报告已在第一批处理完成，目前没有存量 error。

## 专项清理任务

### JSX Accessibility

The 35 findings are warnings pending a dedicated component review. The current distribution is:

- Missing `alt` text: 5.
- Missing `aria-label`: 0; no current finding identifies this issue.
- Other: 30, distributed by rule:
  - `jsx-a11y/click-events-have-key-events`: 10.
  - `jsx-a11y/no-noninteractive-element-interactions`: 6.
  - `jsx-a11y/no-static-element-interactions`: 4.
  - `jsx-a11y/no-autofocus`: 4.
  - `jsx-a11y/label-has-associated-control`: 3.
  - `jsx-a11y/no-noninteractive-tabindex`: 2.
  - `jsx-a11y/interactive-supports-focus`: 1.

Planned batches:

1. Resolve 5 missing image `alt` values and 3 label text/control association findings; target 8 resolved.
2. Review keyboard support, element semantics, and focusability findings; target 23 resolved.
3. Review and remove or replace 4 autofocus usages; target all 35 resolved.
