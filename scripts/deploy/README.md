# 远程部署

此部署流程只发布 `dist/` 中的前端静态文件，不上传项目源码，不运行后端，也不创建服务器数据目录。用户数据由页面按应用现有设置保存在用户浏览器或用户选择的位置。

部署目标是远程 Windows 主机上的：

```text
<REMOTE_CODE_ROOT_WIN>/frontend/homepage/public/piano-learning
```

脚本默认 `REMOTE_CODE_ROOT_WIN=C:/Users/Administrator/Desktop/code`。该目录下必须已有 `frontend/homepage/public`。部署仅替换 `piano-learning` 子目录，不改动同级站点或服务器配置。

## 配置来源

`PRIVATE_DEPLOY_ENV` 是本机 shell 环境变量，用来指定一个 Bash 配置文件。脚本通过 `source` 读取该文件；它不是从 GitHub 下载或由构建命令生成的。此维护机上此前使用的私有文件位于 `$HOME/.config/captcha-recognition/deploy.env`。脚本当前的默认值绑定在维护机的用户目录；在其他机器上应将配置保存在仓库外，并显式设置 `PRIVATE_DEPLOY_ENV`。

配置文件使用 Bash 赋值格式，包含以下字段：

| 字段 | 用途 | 获取方式 |
| --- | --- | --- |
| `REMOTE_HOST` | 远程 Windows 主机的 DNS 名称或 IP | 从服务器提供商控制台或服务器管理员处获取；使用当前 SSH 服务可连接的地址 |
| `REMOTE_USER` | 可通过 SSH 登录的 Windows 账户 | 从服务器管理员处确认，并确认该账户允许密码认证 |
| `REMOTE_PASSWORD` | 上述 SSH 账户的密码 | 从维护者使用的密码管理器或服务器管理员处获取，不要写入仓库、命令行或聊天记录 |

示意格式如下，尖括号内容需要在本机私有配置文件中替换，不能把实际值复制到此文档：

```bash
REMOTE_HOST="<服务器地址>"
REMOTE_USER="<SSH账户>"
REMOTE_PASSWORD="<SSH密码>"
```

将配置文件权限限制为当前用户可读：

```bash
chmod 600 "$HOME/.config/captcha-recognition/deploy.env"
```

部署时还需在当前 shell 设置：

| 字段 | 用途 | 获取方式 |
| --- | --- | --- |
| `PIANO_PUBLIC_URL` | 发布后的 HTTPS 页面完整地址，必须以 `/piano-learning/` 结尾 | 使用已配置 TLS 证书且映射到该站点的公开域名；本项目演示地址为 `https://gohusky.cn/piano-learning/` |
| `REMOTE_CODE_ROOT_WIN` | 远程服务器上包含 `frontend/homepage/public` 的代码根目录 | 使用脚本默认值，或向服务器管理员确认实际 Windows 路径后在部署前覆盖 |

SSH 首次连接前，需按组织的服务器验证流程确认主机密钥并加入本机 `known_hosts`。脚本启用 `StrictHostKeyChecking=yes`，不会自动信任未知主机密钥。

## macOS 部署

需要 Bash、Python 3、Node.js、pnpm、`curl`、`ssh`、`scp` 和 `expect`。缺少 `expect` 时可用 Homebrew 安装：

```bash
brew install expect
```

先在仓库根目录构建适用于 `/piano-learning/` 的生产产物，再运行部署检查：

```bash
GITHUB_PAGES=true GITHUB_REPOSITORY=crazy-husky/piano-learning pnpm run build
bash scripts/deploy/deploy_piano_learning.sh --check
```

`--check` 只验证本地产物，不需要服务器凭据，也不会连接远程主机。确认检查通过后，在同一终端设置部署配置并发布：

```bash
export PRIVATE_DEPLOY_ENV="$HOME/.config/captcha-recognition/deploy.env"
export PIANO_PUBLIC_URL="https://gohusky.cn/piano-learning/"
bash scripts/deploy/deploy_piano_learning.sh --deploy
```

若配置文件或远程代码根目录不在默认位置，可按实际路径覆盖：

```bash
export PRIVATE_DEPLOY_ENV="/absolute/path/to/deploy.env"
export REMOTE_CODE_ROOT_WIN="C:/Users/Administrator/Desktop/code"
```

不要把密码直接写在命令行参数中。部署脚本从 `PRIVATE_DEPLOY_ENV` 读取凭据，比较远端文件 SHA-256 后只上传变化文件；替换目录后，会校验公开 HTTPS 页面和 `index.html`。远端切换或页面校验失败时会尝试回滚。

## Windows 部署

在 Windows 上使用已安装 Bash、Python 3、`curl`、OpenSSH、`scp` 和 `expect` 的 Git Bash。产物构建命令见项目根目录 README 中的 Windows/WSL 步骤。部署前确认 Git Bash 能读取仓库外的私有配置文件，并按 macOS 步骤运行 `--check` 和 `--deploy`。

部署不会执行 Git commit 或 push。部署脚本和凭据文件均应留在本机，不要暂存或提交；本 README 是被 Git 跟踪的维护说明。
