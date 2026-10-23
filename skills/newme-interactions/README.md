# newme interactions skill

> **需要完整办公室？请安装 [newme-office](../newme-office/README.md)**：现代/像素两套视图、人物动画、任务展示、拍击惨叫和掌声都在新 Skill 中。本目录仅是独立交互组件，默认端口 4320；完整办公室默认端口 4319。

拍一下，叫一声；挥鞭催工配卡通惨叫，鼓励配掌声。可选连接自己的 AI 工具接收“不满意”反馈。

这是完整的 **Agent Skill**：包含 `SKILL.md`、安装脚本和可独立运行的源码。**无需 GPT、Codex、模型账号或 API Key**。支持读取 SKILL.md 的助手可以按技能说明执行；不使用助手也能直接运行。

![预览](assets/app/docs/preview.png)

## 给 AI 助手安装

把这个目录的链接发给支持安装 GitHub skill 的助手，并说明：

> 安装公开仓库 69755354/newme 中的 skills/newme-interactions，按 SKILL.md 在我的工作目录运行。先验证页面和手动按钮，麦克风由我在页面里开启；暂不连接自动返工。

公开地址：<https://github.com/69755354/newme/tree/main/skills/newme-interactions>

如果工具需要手动安装，克隆或下载仓库，把**整个 `skills/newme-interactions` 文件夹**放进该工具要求的 skills 目录。只复制 `SKILL.md` 会缺失运行资源。随后按该工具的方式重新加载技能；支持 `$技能名` 的工具可调用 `$newme-interactions`。

不同助手的技能安装入口和目录不同；这里不要求使用 OpenAI 工具。`agents/openai.yaml` 是可选显示信息，其他工具可忽略。

## 不用助手，直接运行

先安装 Node.js 22+，然后：

```sh
git clone https://github.com/69755354/newme.git
cd newme/skills/newme-interactions/assets/app
npm start
```

打开 **http://127.0.0.1:4320/**。无需 `npm install`。Windows 也可以双击这个目录里的 `start-windows.cmd`。

## 让助手创建独立副本

`scripts/install.mjs` 把随技能携带的应用复制到指定的新目录，保留已安装技能的原文件。目标路径必须是绝对路径且父目录已存在；已有目录会被拒绝，不覆盖文件。

```sh
node /absolute/path/to/newme-interactions/scripts/install.mjs /absolute/path/to/workspace/newme-interactions-app
```

在生成的应用目录里运行 `npm test`、`npm start`。停止服务用 Ctrl+C；停止识别或关闭页面会释放麦克风。端口冲突时通过 `PORT` 另选端口。

## 内容与接入范围

```text
newme-interactions/
  SKILL.md              助手的工作说明
  agents/openai.yaml    可选 UI 元信息
  scripts/install.mjs   在工作目录创建应用副本
  assets/app/           完整源码、演示、测试和音效
  LICENSE               MIT
```

- 声音仅在本机分析，不保存录音、不上传麦克风音频；拍击识别和自动反馈默认关闭。
- 声音启发式检测可能把拍手、键盘或桌面碰撞识别成拍击，没有跨设备准确率保证。
- 挥鞭、鼓励和模拟拍击只演示声音与动画，不发送返工要求。
- 默认本地示例不执行 AI 任务。自动返工需接自己的适配器，关联明确任务并验证执行；接收成功不等于工作已修正。
- 发布的是通用交互模块，未包含私人照片、原办公室场景或聊天数据。

运行详情见 [应用说明](assets/app/README.md)，前端复用和反馈协议见 [接入说明](assets/app/INTEGRATION.md)。代码 MIT，程序合成音效 CC0。
