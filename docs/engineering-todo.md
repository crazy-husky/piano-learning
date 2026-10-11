# 工程待办

## Service Worker 更新接管

- **背景**：这是历史遗留项，不是第 3 阶段引入的变更。
- **现状**：Service Worker 没有 `activate` 事件处理器或 `clients.claim()`，因此激活后不会主动接管已经打开的页面。当前脚本保留了消息触发的 `self.skipWaiting()`；更新流程应只在用户确认后发送相应消息。
- **后续处理**：评估在 `activate` 事件中调用 `self.clients.claim()`，并确认用户确认更新后才触发 `self.skipWaiting()`。验证打开中的页面、旧 worker 控制的页面和离线缓存的更新行为。
