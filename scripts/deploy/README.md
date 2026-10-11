# 远程部署

此部署流程只发布 `dist/` 中的前端静态文件，不上传项目源码，不运行后端，也不创建服务器数据目录。用户数据由页面按应用现有设置保存在用户浏览器或用户选择的位置。

部署目标是远程 Windows 主机上的固定绝对路径：

```text
C:/Users/Administrator/Desktop/code/frontend/homepage/public/piano-learning
```

SSH 远端命令使用 `C:/...` Windows 盘符绝对路径。此服务器的 SFTP 根目录是 `/C:/Users/Administrator`，因此 SCP/SFTP 传输使用 `/C:/...` 绝对路径，避免按登录目录拼接。临时上传文件写入 `C:/Users/Administrator/Desktop/code/frontend/homepage`；暂存和备份目录位于上述 Web 目录旁边。部署仅替换 `piano-learning` 目录，不改动同级站点或服务器配置。

## 配置来源

`PRIVATE_DEPLOY_ENV` 是本机 shell 环境变量，用来指定一个 Bash 配置文件。脚本通过 `source` 读取该文件；它不是从 GitHub 下载或由构建命令生成的。此维护机上此前使用的私有文件位于 `$HOME/.config/captcha-recognition/deploy.env`。脚本当前的默认值绑定在维护机的用户目录；在其他机器上应将配置保存在仓库外，并显式设置 `PRIVATE_DEPLOY_ENV`。

配置文件使用 Bash 赋值格式，包含以下字段：

| 字段                       | 用途                              | 获取方式                                                                      |
| -------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `REMOTE_HOST`              | 远程 Windows 主机的 DNS 名称或 IP | 从服务器提供商控制台或服务器管理员处获取；使用当前 SSH 服务可连接的地址       |
| `REMOTE_USER`              | 可通过 SSH 登录的 Windows 账户    | 从服务器管理员处确认，并确认该账户的公钥登录已启用                            |
| `REMOTE_WEB_ERROR_LOG_WIN` | Web 服务错误日志的绝对文件路径    | 可选；文件不存在或未配置时读取 Windows Application 事件日志最近 50 条错误事件 |

示意格式如下，尖括号内容需要在本机私有配置文件中替换，不能把实际值复制到此文档：

```bash
REMOTE_HOST="<服务器地址>"
REMOTE_USER="<SSH账户>"
```

SSH 使用本机 `~/.ssh/id_ed25519` 私钥；脚本仅允许此公钥认证，不读取 SSH 密码。SSH 端口固定为 `51234`。

将配置文件权限限制为当前用户可读：

```bash
chmod 600 "$HOME/.config/captcha-recognition/deploy.env"
```

部署时还需在当前 shell 设置：

| 字段               | 用途                                                        | 获取方式                                                                                           |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `PIANO_PUBLIC_URL` | 发布后的 HTTPS 页面完整地址，必须以 `/piano-learning/` 结尾 | 使用已配置 TLS 证书且映射到该站点的公开域名；本项目演示地址为 `https://gohusky.cn/piano-learning/` |

本机部署脚本将 Web 目录固定为 `C:/Users/Administrator/Desktop/code/frontend/homepage/public/piano-learning`，临时上传目录固定为 `C:/Users/Administrator/Desktop/code/frontend/homepage`。这两个路径不是环境覆盖项。

SSH 和 SCP 使用 `-i ~/.ssh/id_ed25519`、`IdentitiesOnly=yes` 和端口 `51234`。首次连接时脚本使用 `StrictHostKeyChecking=accept-new` 自动记录主机密钥；之后仍会校验已记录的密钥。

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

若私有配置文件或错误日志不在默认位置，可按实际路径设置：

```bash
export PRIVATE_DEPLOY_ENV="/absolute/path/to/deploy.env"
export REMOTE_WEB_ERROR_LOG_WIN="C:/path/to/web-error.log"
```

部署脚本从 `PRIVATE_DEPLOY_ENV` 读取远端主机和账户，比较远端文件 SHA-256 后只上传变化文件。切换目录前会确认上传文件位于指定的绝对路径，并在暂存目录检查 `index.html`、其 JavaScript 入口和所有文件哈希。发布后必须得到 HTTP 200 且 `index.html` 哈希匹配；失败时会恢复旧目录，并校验旧 `index.html` 及整个文件树的哈希。只有远端恢复成功才会输出“回滚成功”；无法确认恢复时会输出严重错误、保留备份和状态文件并以非零状态退出。HTTPS 健康检查为非 200 时会打印配置的远端错误日志末尾 50 行；未配置或日志文件不存在时会读取 Windows Application 事件日志最近 50 条错误事件。

## Windows 部署

在 Windows 上使用已安装 Bash、Python 3、`curl`、OpenSSH、`scp` 和 `expect` 的 Git Bash。产物构建命令见项目根目录 README 中的 Windows/WSL 步骤。部署前确认 Git Bash 能读取仓库外的私有配置文件，并按 macOS 步骤运行 `--check` 和 `--deploy`。

部署不会执行 Git commit 或 push。部署脚本和凭据文件均应留在本机，不要暂存或提交；本 README 是被 Git 跟踪的维护说明。
