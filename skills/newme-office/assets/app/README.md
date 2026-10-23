# newme office

这是完整办公室应用，包含现代和像素两套视图、人物动画、任务展示、拍击惨叫和掌声。完整预览及 Skill 安装方法见 [Skill README](../../README.md)。

需要 Node.js 22+ 和支持 Canvas / Web Audio / AudioWorklet 的现代浏览器。无需 GPT、Codex、模型账号或运行时 npm 包。

```sh
npm start
```

打开 <http://127.0.0.1:4319/>。Ctrl+C 停止。`node server.mjs --port 4325 --data-dir /absolute/path/to/office-data` 可指定端口和数据目录；端口也支持 `PORT` 环境变量。

默认示例任务明确标注，不代表真实执行。添加任务窗口可以移除示例；在新数据目录用 `node server.mjs --empty` 可从空办公室开始。不要覆盖已存在的 `.newme-office/`。麦克风由用户在页面里启用，默认不启动。

任务发布、状态更新、交付内容和可选返工接收器见 [INTEGRATION.md](INTEGRATION.md)。运行 `npm test` 验证任务持久化、通用 CLI/HTTP、双视图模型、完成托盘、反馈去重和音频逻辑。`npm run check` 检查语法。自动化测试不代表所有设备的拍击识别都准确。

代码 MIT；来源和资源许可见 [THIRD_PARTY.md](THIRD_PARTY.md)。
