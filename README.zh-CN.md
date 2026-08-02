# htmlwright

*[English](./README.md) · 简体中文*

在真实浏览器里点选一个 HTML 元素,用一句话描述改动。AI 改完后先给出**代码 diff** 与**安全检查**(它自动截图前后对比,判断目标是否真的改动、有无溢出或连累其他区域),确认无误才写回原文件。

它不是从零生成网页,而是在已有的单文件 HTML 上做**可指代、可验证、可回退**的精确修改。全过程数据留在本机,写回前自动快照,改坏可撤销。

![htmlwright 网页版工作区](./assets/screenshot-web.png)

## 能做什么

- **点选即改** —— 在真实页面上点中元素,用一句话说想怎么改。
- **快速调整(免 AI)** —— 文字 / 颜色 / 字号直接改,源码级、即时、免费。
- **AI 改** —— 接 Claude Code / Anthropic API / 任意 OpenAI 兼容模型(界面里填 Key,不用改配置)。
- **改前先审** —— 代码 diff + 改前/改后对比 + 安全检查(是否连累别处、有无溢出重叠),确认才写回。
- **版本时间线** —— 累计的每一步改动都可点击回放:看当时的版本 + 定位到改动的元素。
- **边生成边排队** —— 不用等上一条,连续提交多条 AI 改动,串行叠加。
- **数据全本地** —— 写回前自动快照,可撤销;不上传任何内容。

> 想立刻试玩?装好依赖后直接用仓库自带样例:`node dist/server/cli.js sample/landing.html`(先 `npm run build`)。

---

# 一、使用者指南

两种用法都修改**本机的 HTML 文件**,区别只在入口。不确定选哪个见 [如何选择](#如何选择)。

## 首次准备(两种用法都需要)

需在终端执行几条命令完成一次性安装,之后日常仅需鼠标操作。

1. 安装 [Node.js](https://nodejs.org)(20 及以上):
   - macOS:`brew install node`
   - Windows:`winget install OpenJS.NodeJS.LTS`
2. 获取项目并安装依赖:
   ```bash
   git clone https://github.com/Clouds06/htmlwright.git
   cd htmlwright
   npm install
   ```

## 方式 A:浏览器扩展(推荐)

在 Chrome 中打开本地 HTML,点扩展图标,在侧栏点选元素并描述改动,无需常驻服务。

安装扩展、本机宿主并记录 AI 后端路径。命令完成后会打印**扩展目录**,下一步用到:

```bash
cd htmlwright
npm run native:install
```

在 Chrome 中:

1. 打开 `chrome://extensions`,开启**开发者模式**。
2. 点**加载已解压的扩展程序**,选择上一步打印的扩展目录:
   - macOS:`~/Library/Application Support/htmlwright/extension`
   - Windows:`%LOCALAPPDATA%\htmlwright\extension`
3. 进入扩展详情,开启**允许访问文件网址**。

日常操作三步:打开本地 HTML → 点扩展图标 → 点选元素、描述改动、审阅后接受或拒绝。

- 仅阅读时不点图标即可,扩展默认休眠,不干预页面。
- 文字、颜色、字号等小改动用**快速编辑**,不调用 AI、即时生效。
- 可连续点选多个元素累积改动,最后统一**接受并写回**;未写回前**拒绝**可全部丢弃。

## 方式 B:本地命令行

不装扩展。先构建一次,再用本地网页打开指定文件(交互与侧栏一致,并可查看前后截图):

```bash
cd htmlwright
npm run build                                   # 构建(仅首次或更新后需要)
node dist/server/cli.js /绝对路径/page.html      # 打开你的文件
```

常用参数:`--port` 指定端口;`--no-open` 不自动打开浏览器;`--in-place` 生成后立即写回(仍保留快照)。

## 如何选择

| | 方式 A 扩展 | 方式 B 命令行 |
|---|---|---|
| 适合 | 日常反复编辑 | 临时改单个文件 |
| 安装后 | 纯鼠标操作 | 每次一条命令 |
| 截图对比 | 仅显示检查结论 | 可查看前后截图 |

## 配置 AI 后端

htmlwright 不自带模型,需接入一个,三选一:

1. **已使用 Claude Code**(已安装并登录 `claude`):零配置,默认启用。
2. **拥有 API Key**(OpenAI / OpenRouter / 硅基流动 / 本地 Ollama):点侧栏 **AI 后端** 旁的齿轮,填入 API Key、Base URL、模型名并保存。**推荐非技术用户使用此项。**
3. **拥有 Anthropic 官方 Key**:设置 `ANTHROPIC_API_KEY`,在界面选 Anthropic API。

> ⚠️ 请选择通用大模型或代码模型(如 DeepSeek-V3、Qwen-Coder、GPT-4o、Claude)。翻译专用小模型(名称含 MT / Translation)不会输出完整 HTML,会报 "no complete HTML"。

---

# 二、开发者指南

## 本地开发

```bash
cd htmlwright
npm install      # 安装依赖
npm run dev      # 启动开发服务,打开示例文件 http://localhost:4178
npm run build    # 类型检查 + 打包
npm run check    # 单元测试 + 扩展结构校验 + typecheck
```

## 核心结构

- `server/session.ts` —— 候选 / 写回 / 快照 / 撤销状态机(两种用法共用)。
- `server/providers.ts` —— 模型后端工厂与 `LLMProvider` 接口(Claude Code / Anthropic API / OpenAI 兼容 / demo)。
- `server/verifier.ts` —— Playwright 截图与逐块视觉验证。
- `server/quick-edit.ts` —— parse5 源码级改写(不调用模型)。
- `server/platform.ts` —— 跨平台路径与命令。
- `server/native-host.ts` —— 扩展的原生消息宿主。
- `extension/` —— Chrome MV3:`content-script` / `sidepanel` / `service-worker`。
- `scripts/` —— native host 安装 / 卸载(macOS 写目录,Windows 写注册表)。

## 环境变量(均可选,见 [`.env.example`](./.env.example))

| 变量 | 作用 |
|---|---|
| `ANTHROPIC_API_KEY` | 启用 Anthropic API provider |
| `HTMLWRIGHT_MODEL` | Anthropic API 模型 id(默认 `claude-sonnet-4-5`) |
| `HTMLWRIGHT_OPENAI_API_KEY` | 启用 OpenAI 兼容 provider(或复用 `OPENAI_API_KEY`) |
| `HTMLWRIGHT_OPENAI_BASE_URL` | OpenAI 兼容 base URL(默认 `https://api.openai.com/v1`) |
| `HTMLWRIGHT_OPENAI_MODEL` | OpenAI 兼容模型 id(默认 `gpt-4o`) |
| `HTMLWRIGHT_CLAUDE_EXECUTABLE` | Claude Code 可执行文件路径 |
| `HTMLWRIGHT_CONFIG_FILE` | 覆盖配置文件位置 |
| `HTMLWRIGHT_ENABLE_DEMO` | 设 `1` 启用 demo provider(不调模型) |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | 视觉验证用的浏览器可执行文件 |

## 安全写回

接受前,原文件快照至同目录 `.htmlwright/snapshots/`。预览注入仅存在于 HTTP 响应,不写入磁盘。视觉验证优先使用 Playwright 自带 Chromium,否则回退本机 Chrome / Edge。

全局安装发布包后,可用 `htmlwright-install-native` 安装、`htmlwright-uninstall-native` 卸载。

---

## 获取与分发

目前需要**自行克隆仓库并构建运行**(见上文)。`package.json` 已配好 `bin` / `files`,`npm publish` 后即可 `npx htmlwright 文件.html` 零克隆运行、或全局安装——发布在计划中。

## 平台支持

- **macOS** —— 完整支持。
- **Windows** —— 实验性(native host 走注册表、`.bat` wrapper),尚未充分验证。
- **Linux** —— 暂未适配,欢迎贡献。

## License

[MIT](./LICENSE) © 2026 clouds
