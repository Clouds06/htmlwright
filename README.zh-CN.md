# htmlwright

*[English](./README.md) · 简体中文*

在真实浏览器里点选一个 HTML 元素，用一句话说想怎么改。AI 改完不直接落盘，先给你**代码 diff** 和**安全检查**——它自动截图改前改后做对比，确认目标真的变了、没有溢出、也没连累周围，你点确认才写回原文件。

它不负责从零生成网页，而是在你已有的单文件 HTML 上做**可指代、可验证、可回退**的精确修改。全程数据留在本机，写回前自动快照，改坏了能撤销。

![htmlwright 网页版工作区](./assets/screenshot-web.png)

## 能做什么

- **点选即改**——在真实页面上点中元素，用一句话说想怎么改。
- **快速调整（免 AI）**——文字、颜色、字号直接改，源码级、即时、不花钱。
- **AI 改**——接 Claude Code、Anthropic API，或任意 OpenAI 兼容模型（界面里填 Key，不用碰配置文件）。
- **改前先审**——代码 diff ＋ 改前 / 改后对比 ＋ 安全检查，确认无误才写回。
- **改哪一块自己定**——不选元素改整个文件；点中某处就只改这一处；多页文档还能只改当前这一页。
- **版本时间线**——累计的每一步改动都能点开回放：还原当时的版本，并定位到被改的元素。
- **边生成边排队**——不用等上一条跑完，连续提交多条 AI 改动，串行叠加。
- **多文件站点也能改**——界面里浏览本机目录打开任意 HTML；查看模式下点页面里的本地链接，直接跳过去编辑，一个「返回」退回来。
- **数据全本地**——写回前自动快照、可撤销，不上传任何内容。

> 想立刻试玩？装好依赖后直接用仓库自带样例：先 `npm run build`，再 `node dist/server/cli.js sample/landing.html`。

---

# 一、使用者指南

两种用法都只改**你本机上的 HTML 文件**，区别只在入口。不确定选哪个，看 [如何选择](#如何选择)。

## 首次准备（两种用法都要）

需要在终端敲几条命令做一次性安装，装完之后日常只用鼠标。

1. 安装 [Node.js](https://nodejs.org)（20 及以上版本）：
   - macOS：`brew install node`
   - Windows：`winget install OpenJS.NodeJS.LTS`
2. 拉代码并装依赖：
   ```bash
   git clone https://github.com/Clouds06/htmlwright.git
   cd htmlwright
   npm install
   ```

## 方式 A：浏览器扩展（推荐）

在 Chrome 里打开本地 HTML，点一下扩展图标，就能在侧栏点选元素、描述改动，不用一直开着服务。

![htmlwright 浏览器扩展侧栏](./assets/screenshot-extension.png)

先装扩展和本机宿主。命令跑完会打印出**扩展目录**，下一步要用：

```bash
cd htmlwright
npm run native:install
```

然后在 Chrome 里：

1. 打开 `chrome://extensions`，右上角开启**开发者模式**。
2. 点**加载已解压的扩展程序**，选上一步打印的扩展目录：
   - macOS：`~/Library/Application Support/htmlwright/extension`
   - Windows：`%LOCALAPPDATA%\htmlwright\extension`
3. 进扩展详情页，打开**允许访问文件网址**。

日常就三步：打开本地 HTML → 点扩展图标 → 点选元素、描述改动、审阅后接受或拒绝。

- 只想看不想改，不点图标就行，扩展默认休眠，不动你的页面。
- 文字、颜色、字号这类小改动用**快速调整**，不走 AI、即时生效。
- 可以连续点选多个元素、攒一批改动，最后一起**接受并写回**；写回前**拒绝**能全部丢掉。

## 方式 B：本地命令行

不装扩展。先构建一次，再用本地网页打开一个起始文件（交互和侧栏跟扩展一致，还能看改前 / 改后截图）：

```bash
cd htmlwright
npm run build                                   # 构建（仅首次或更新后需要）
node dist/server/cli.js /绝对路径/page.html      # 打开你的文件
```

启动后不用回命令行：界面左上角点**打开文件**能浏览本机目录、换别的 HTML；查看模式下点页面里的本地链接，会直接跳进那一页编辑，「返回」退回上一页——适合改带跳转的多文件站点。

常用参数：`--port` 指定端口；`--no-open` 不自动开浏览器；`--in-place` 生成后立刻写回（仍会留快照）。

## 如何选择

| | 方式 A 扩展 | 方式 B 命令行 |
|---|---|---|
| 适合 | 日常反复编辑 | 临时改单个 / 一组文件 |
| 装好之后 | 纯鼠标操作 | 每次敲一条命令启动 |
| 截图对比 | 只给检查结论 | 能看改前 / 改后截图 |

## 配置 AI 后端

htmlwright 本身不带模型，得接一个，三选一：

1. **已经在用 Claude Code**（装了 `claude` 并登录过）：零配置，默认就走它。（如果环境里设了 `ANTHROPIC_API_KEY`，会自动改走 Anthropic API，避免误用订阅额度。）
2. **手上有 API Key**（OpenAI、OpenRouter、硅基流动、本地 Ollama 等）：点侧栏**模型**旁边的齿轮，填 API Key、Base URL、模型名，保存即可。**非技术用户推荐用这个。**
3. **有 Anthropic 官方 Key**：设置好 `ANTHROPIC_API_KEY`，在界面里选 Anthropic API。

> ⚠️ 请选通用大模型或代码模型（如 DeepSeek-V3、Qwen-Coder、GPT-4o、Claude）。翻译专用小模型（名字带 MT / Translation）不会输出完整 HTML，会报 “no complete HTML”。

## 关于视觉安全检查

改前那条自动检查（目标是否真的变了、有没有连累别处、内容溢出、元素重叠）需要系统里装了 **Chrome / Chromium / Edge / Brave** 中的任意一个——htmlwright 会自动找到并调用它，无需手动配置。找不到时这条检查会自动跳过并给出提示，**代码 diff 与改前/改后预览照常可用，编辑流程不受影响**。用浏览器扩展的用户天然满足；Windows 自带的 Edge 也可用。

---

# 二、开发者指南

## 本地开发

```bash
cd htmlwright
npm install      # 安装依赖
npm run dev      # 起开发服务，自动打开示例 http://localhost:4178
npm run build    # 类型检查 ＋ 打包
npm run check    # 单元测试 ＋ 扩展结构校验 ＋ 类型检查
```

## 核心结构

- `server/session.ts`——候选 / 写回 / 快照 / 撤销的状态机（两种用法共用）。
- `server/providers.ts`——模型后端工厂与 `LLMProvider` 接口（Claude Code / Anthropic API / OpenAI 兼容 / demo）。
- `server/verifier.ts`——Playwright 截图与逐块视觉验证。
- `server/quick-edit.ts`——parse5 源码级改写（不调用模型）。
- `server/platform.ts`——跨平台路径与命令。
- `server/native-host.ts`——扩展的原生消息宿主。
- `extension/`——Chrome MV3：`content-script` / `sidepanel` / `service-worker`。
- `scripts/`——native host 安装 / 卸载（macOS 写目录，Windows 写注册表）。

## 环境变量（均可选，见 [`.env.example`](./.env.example)）

| 变量 | 作用 |
|---|---|
| `ANTHROPIC_API_KEY` | 启用 Anthropic API provider |
| `HTMLWRIGHT_MODEL` | Anthropic API 模型 id（默认 `claude-sonnet-4-5`） |
| `HTMLWRIGHT_OPENAI_API_KEY` | 启用 OpenAI 兼容 provider（或复用 `OPENAI_API_KEY`） |
| `HTMLWRIGHT_OPENAI_BASE_URL` | OpenAI 兼容 base URL（默认 `https://api.openai.com/v1`） |
| `HTMLWRIGHT_OPENAI_MODEL` | OpenAI 兼容模型 id（默认 `gpt-4o`） |
| `HTMLWRIGHT_CLAUDE_EXECUTABLE` | Claude Code 可执行文件路径 |
| `HTMLWRIGHT_CONFIG_FILE` | 覆盖配置文件位置 |
| `HTMLWRIGHT_ENABLE_DEMO` | 设 `1` 启用 demo provider（不调模型） |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | 视觉验证用的浏览器可执行文件 |

## 安全写回

接受前，原文件先快照到同目录的 `.htmlwright/snapshots/`。预览注入只存在于 HTTP 响应里，不落磁盘。视觉验证优先用 Playwright 自带的 Chromium，没有再回退到本机 Chrome / Edge。

全局安装发布包后，可用 `htmlwright-install-native` 安装、`htmlwright-uninstall-native` 卸载。

---

## 获取与分发

目前需要**自己克隆仓库、构建后运行**（见上文）。`package.json` 里的 `bin` / `files` 已配好，`npm publish` 之后就能 `npx htmlwright 文件.html` 零克隆运行、或全局安装——发布还在计划中。

## 平台支持

- **macOS**——完整支持。
- **Windows**——实验性（native host 走注册表、`.bat` wrapper），还没充分验证。
- **Linux**——暂未适配，欢迎贡献。

## License

[MIT](./LICENSE) © 2026 clouds
