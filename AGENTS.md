# AGENTS.md

## Development And Verification

- On Windows, run `pnpm` commands with the Windows-side Node.js and pnpm installation. From WSL, use Windows PowerShell and the Windows path to this repository; do not use WSL-side `pnpm`, `npm`, or `node_modules`.
- On macOS, use the macOS Node.js and pnpm installation. Initialize pnpm with `corepack enable pnpm`, install dependencies with `pnpm install`, and do not share `node_modules` with Windows.
- Leave production builds to the repository's pre-commit hook during ordinary implementation. The current frontend build hook uses Windows PowerShell (`pwsh.exe`) and is available on Windows/WSL. On macOS, when a production artifact is required for deployment, run `GITHUB_PAGES=true GITHUB_REPOSITORY=crazy-husky/piano-learning pnpm run build`; this sets the same `/piano-learning/` base path.
- Browser/UI verification is not required by default. Use tests and the pre-commit build unless the user explicitly asks for browser verification or a browser-only failure needs reproduction.
- The user's long-running `127.0.0.1:6136` dev server may be reused for navigation, inspection, performance measurement, and other verification that does not create persisted practice/review/recall records or write test data into the backup.
- For verification that can generate persisted practice, review, staff-recall, or backup test data, start a temporary server on another port so it uses isolated browser storage, and close that temporary server before finishing the turn.

## Deployment

- Deployment is separate from build, commit, and push. The maintainer-only helper in `scripts/deploy/` is ignored by Git and must not be staged or committed.
- Before publishing, create a fresh production build for `/piano-learning/`, then run `bash scripts/deploy/deploy_piano_learning.sh --check`. The check validates the local bundle; `--deploy` uploads only changed static assets and verifies the public HTTPS page. The helper never builds the project.
- On macOS, run the helper from Bash with `python3`, `curl`, `ssh`, `scp`, and `expect` available. On Windows, use Git Bash with the same tools available.
- Set `PRIVATE_DEPLOY_ENV` to a credentials file outside the repository. It supplies values such as `REMOTE_HOST`, `REMOTE_USER`, and `REMOTE_PASSWORD`. Never put real values in tracked files, documentation, shell history, or command output.
- See the README's “发布与预览” section for copyable build and deploy commands.
- Write git commit messages in Chinese.
