# 连接任意工具的任务

办公室不要求模型账号，也不内置假定某个软件已经运行的监听器。使用你工具支持的脚本或 HTTP 能力主动发布任务。手动填写任务也可正常使用。

## 本机任务文件

启动目录的 `.newme-office/tasks.json`：

```json
{
  "schemaVersion": 1,
  "tasks": [
    {
      "id": "website-work",
      "turnId": "turn-001",
      "title": "开发网站",
      "status": "working",
      "project": "项目 A",
      "provider": "我的 AI 工具",
      "roleHint": "engineering",
      "activeRoles": ["engineering", "design"],
      "reply": ""
    }
  ]
}
```

- `id`：稳定任务 ID，1–200 个英文字母、数字、下划线或连字符。
- `turnId`：当前工作轮次，格式同 ID。新一轮工作应使用新的 turnId；同一轮从 working 变 done 时保持它，以便完成托盘正确关联交付内容。
- `status`：`working` / `waiting` / `done` / `idle` / `error` / `unknown`。
- `roleHint`：`engineering` / `design` / `research` / `writing` / `pr` / `sales` / `planning` / `operations` / `other`。
- `activeRoles`：可选多部门元数据；不会复制员工。
- `reply`：可选最终交付正文，最多 65,536 字符；实时任务广播不包含它，用户点开确切任务轮次时才读取。
- 可选 `url` 为不带用户名密码的 HTTP/HTTPS 任务链接。

支持最多 500 个任务、4 MiB JSON 文件。建议先写临时文件再原子替换。文件格式错误会保留上一份任务，显示连接未确认，拒绝覆盖坏文件；修好后自动恢复。文件不存在或无法读取不代表任务已完成。

## 命令行

从应用目录执行；它从本机数据目录读取令牌，不打印令牌，不调用模型：

```sh
node scripts/tasks.mjs upsert --id website-work --turn turn-001 --title "开发网站" --project "项目 A" --provider "自己的工具" --role engineering --status working
node scripts/tasks.mjs upsert --id website-work --status done --reply "最终交付内容"
node scripts/tasks.mjs list
node scripts/tasks.mjs remove --id website-work
```

`upsert --file task.json` 可传单个任务 JSON。若端口或数据目录不同，加 `--url http://127.0.0.1:4325/ --data-dir /absolute/path/to/office-data`。不要通过 shell 拼接未经引用的任务正文；复杂内容用 JSON 文件。

## HTTP

`POST http://127.0.0.1:4319/api/tasks` 创建或部分更新单个任务，JSON 字段同上。`GET /api/tasks` 列任务，`DELETE /api/tasks` 使用 `{ "id": "website-work" }` 删除。`PUT /api/tasks` 使用 `{ "tasks": [...] }` 替换任务集合，会覆盖当前列表，调用方应明确选择这一步。

客户端使用 `Authorization: Bearer <本机 .newme-office/api-token 内容>`。令牌只留在本机，不放网页或 Git。浏览器内手动任务编辑采用严格同源与显式操作头；来自任意网站的跨源修改被拒绝。不要将服务暴露到公网。

`GET /api/state` 返回实时显示快照，`GET /api/events` 是 SSE。它们只描述已发布的元数据；发布者负责提供真实状态，办公室不把一个状态字段当成实际进程或项目验收证据。

## 返工反馈

拍击会播放惨叫和触发动画。只有用户开启自动反馈、选中非示例任务，并且该任务空闲/完成/出错时，才发送返工要求。任务进行中时保留待发。手动挥鞭、鼓励和试听不发送反馈。

默认记录在本机 `.newme-office/feedback.json`，返回 `local-only`，不会执行 AI。要接自己的接收器，在启动前设置：

```powershell
$env:NEWME_FEEDBACK_URL = 'https://your-adapter.example/feedback'
# 需要认证时设置 NEWME_FEEDBACK_TOKEN；不要提交真实值。
npm start
```

macOS / Linux：`NEWME_FEEDBACK_URL=https://your-adapter.example/feedback npm start`。调试允许 HTTP localhost 接收器，远程必须 HTTPS，不接受带凭据的 URL 或重定向。`.env` 不自动加载。

接收器收到：

```json
{
  "schemaVersion": 1,
  "id": "11111111-2222-4333-8444-555555555555",
  "kind": "dissatisfied",
  "taskId": "website-work",
  "provider": "我的工具",
  "message": "请重新核对并修正漏项。",
  "createdAt": "2026-10-23T00:00:00.000Z"
}
```

Headers 包括 `Idempotency-Key: <id>` 和可选服务端 Bearer token。接收器需验证来源、按 ID 去重、关联实际工具中的明确任务、检查繁忙状态与操作授权，再调用该工具支持的 API 或队列。2xx 只表示已接受；办公室不会把它当成工作已修正，也不会自行改成 working/done。接收器应通过任务发布接口报告真实执行状态和交付。

结果未知的事件保留，不自动重发；事件 ID 和结果在重启后保留。接收器本身也需持久化去重。没有适配器时请使用本地记录或复制返工文字，不要声称已连接特定 AI 软件。
