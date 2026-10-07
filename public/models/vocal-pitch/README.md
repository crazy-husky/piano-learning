# 清唱增强分析模型

这些 ONNX 文件不属于 PWA 首次加载资源，按功能需要加载并缓存：SwiftF0 用于麦克风练习时首次下载，FCPE 仅在用户选择增强录音分析后下载。

- `fcpe-v1.onnx`: 从 `torchfcpe==0.0.4` 的官方 FCPE Conv-only 权重导出，SHA-256 为 `d425a36c66d751558574f230dd6caff682d2b1bdccf57315e3c907677e8b1d1c`。
- `swift-f0-v0.3.0.onnx`: 来自 `swift-f0==0.3.0`，大小 135090 bytes，SHA-256 为 `6385e8c2ebc3872e82c9ff5946228de44cd3be77a750ea53698b7dbfe94b0a22`。官方有声默认阈值为 0.5；本项目实时识别使用 0.6。

两者均使用各自项目的 MIT 许可。重新生成时运行：

```powershell
uv run --project analysis\pitch python analysis\pitch\export_browser_models.py
```

生成后必须先跑固定音频对比和浏览器模型测试；只有结果仍符合当前基线，才更新代码中的模型版本与校验值。
