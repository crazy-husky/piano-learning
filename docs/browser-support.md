# 浏览器支持范围

最低支持版本：

- Chrome / Chromium 内核浏览器：108+
- Microsoft Edge：108+
- Firefox：101+
- Safari、iOS / iPadOS 浏览器：16.4+

其他浏览器会按实际运行能力判断。iOS 上的第三方浏览器使用系统 WebKit，因此最低要求按 iOS / iPadOS 16.4 检查；UA 未标明浏览器版本时，还会检查关键 API。

这个下限由当前应用的全屏布局和运行时能力共同决定。代码使用动态视口单位 `dvh`、`ResizeObserver`、Pointer Events 的 `setPointerCapture`、`Array.prototype.at`、`String.prototype.replaceAll` 和 `Promise.allSettled`。清唱音高识别还依赖 WebAssembly SIMD；Safari 16.4 加入了这项支持，因此它决定了 Safari/iOS 的最低版本。若能力检查不通过，应用不会挂载 React 页面，而会显示升级提示；不支持 ES Modules 的浏览器会看到 `index.html` 中的静态升级说明。

`vite.config.ts` 的 `build.target` 必须与这里的最低版本保持一致。兼容策略或目标版本改变时，请同时更新兼容性检查、入口提示和本文档。
