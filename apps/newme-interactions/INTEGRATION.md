# 接入自己的工具

## 1. 只用前端交互

把 `public/interactions.js`、检测器、worklet 与 `public/sounds/` 放在同一个站点，保留相对目录。已有应用可以直接 import：

```js
import { NewmeInteractions } from './interactions.js';
const kit = new NewmeInteractions({ volume: 0.35, sensitivity: 3 });

// 在用户点击按钮时调用；浏览器会请求麦克风权限。
enableButton.onclick = () => kit.startMicrophone();
disableButton.onclick = () => kit.stopMicrophone();
whipButton.onclick = () => kit.whip();
encourageButton.onclick = () => kit.encourage();

kit.addEventListener('impact', ({ detail }) => {
  if (detail.simulated) return;
  // 此处调用你自己的业务事件；不要把拍击当成已知的具体修改要求。
  console.log('short impulse detected', detail.strength);
});
kit.addEventListener('action', ({ detail }) => {
  // detail.kind 是 whip 或 encourage，可接你自己的角色动画。
});
window.addEventListener('pagehide', () => void kit.destroy());
```

公开事件：`microphone`、`impact`、`action`、`sound`、`error`。`impact` 只含数值特征，没有音频数据。`testImpact()` 会发出 `simulated: true` 的测试事件。

## 2. 服务端反馈接收器

设置 `NEWME_FEEDBACK_URL` 后，服务端只把以下 JSON POST 给该地址：

```json
{
  "schemaVersion": 1,
  "id": "11111111-2222-4333-8444-555555555555",
  "kind": "dissatisfied",
  "message": "请重新检查当前任务的漏项并修正。",
  "createdAt": "2026-10-23T00:00:00.000Z"
}
```

Headers：`Content-Type: application/json`、`Idempotency-Key: <id>`；配置 `NEWME_FEEDBACK_TOKEN` 时另外带 `Authorization: Bearer <token>`。

接收器需自行完成：

1. 验证 token / 来源，按 id 去重。
2. 关联你自己工具中的明确任务，检查任务是否繁忙以及是否允许自动返工。
3. 调用实际工具支持的 API、插件或 hook；不支持时生成待发送草稿。
4. 记录真实执行结果，在原工具里给用户回执。

建议以 202 表示已接受排队；拒绝时返回非 2xx。该组件不解析接收器的响应正文，不将其解释为任务完成。请求超时或断网返回“结果未知”，不会自动重发。本机服务的去重表只在当前进程内有效；接收器需要长期去重时自行持久化。

允许 HTTPS 地址；本机调试可使用 `http://127.0.0.1:端口/feedback`。禁止带用户名密码的 URL 和重定向，token 留在服务端环境变量中。网页的 CSP 只允许请求本机同源服务，不直接连接外部 AI。

## 3. 本地测试接收器

```sh
node examples/receiver.mjs
# 另一个终端：
NEWME_FEEDBACK_URL=http://127.0.0.1:4321/feedback npm start
```

Windows 可以先设置 `$env:NEWME_FEEDBACK_URL = 'http://127.0.0.1:4321/feedback'` 再运行 `npm start`。

示例接收器只打印事件 ID 并返回 202，不调用 AI、不修改文件。用它验证转发链路，再替换成自己的工具适配器。
