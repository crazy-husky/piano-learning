# ESLint Cleanup Baseline

Initial baseline measured on 2026-10-11 with ESLint 9.39.5:

- Warnings: 53 across 36 files.
- Errors: 54 across 36 files.
- `react-hooks/rules-of-hooks`: 0 findings; keep at error.
- No single error rule exceeds the 50-finding downgrade threshold.

After downgrading all recommended `jsx-a11y/*` rules to warnings:

- Warnings: 88, including 35 JSX accessibility findings.
- Errors: 19.

## Warning Cleanup Batches

1. Reduce `react-hooks/exhaustive-deps` from 51 to 34 findings by reviewing 17 findings. Do not apply dependency autofixes without checking effect behavior.
2. Reduce `react-hooks/exhaustive-deps` from 34 to 17 by reviewing the next 17 findings.
3. Clear the remaining 17 `react-hooks/exhaustive-deps` findings.
4. Resolve the 2 `@typescript-eslint/no-floating-promises` findings.

After warning counts reach 50, the maintainer can tighten the lint script threshold from 200 to 50. After all warnings are cleared, tighten it from 50 to 0. Staged TypeScript files will use a zero-warning threshold from the start.

## Error Cleanup Baseline

- `@typescript-eslint/no-unused-vars`: 12.
- `no-irregular-whitespace`: 6.
- `prefer-const`: 1.

The remaining 19 errors are candidates for mechanical cleanup.

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
