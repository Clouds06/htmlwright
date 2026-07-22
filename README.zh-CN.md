# htmlwright

*[English](./README.md) · 简体中文*

本地 AI-Native 单文件 HTML 编辑器。把 HTML 放进真实浏览器预览，点选元素并描述修改；候选结果先留在内存，完成代码 diff 和视觉检查后才允许写回原文件。

> **平台**：目前仅支持 macOS（路径、浏览器探测、Native Host 注册均按 macOS 实现）。欢迎贡献 Windows / Linux 适配。

## 环境要求

- macOS
- Node.js >= 20.11
- Google Chrome / Chromium / Microsoft Edge 之一
- 本机 Claude Code CLI（已登录），或设置 `ANTHROPIC_API_KEY` 直连 Anthropic API

## 本地开发

```bash
npm install
npm run dev
```

开发服务默认打开示例文件：`http://localhost:4178`。

## 使用

```bash
npm run build
node dist/server/cli.js /absolute/path/to/page.html
```

可用参数：

- `--port 4178`：指定本地端口。
- `--no-open`：不自动打开浏览器。
- `--in-place`：生成候选后立即写回，仍会保留快照。

默认 provider 是本机 Claude Code。启动前要求 `claude auth status` 显示已登录，并且环境中没有 `ANTHROPIC_API_KEY`。需要直连 Anthropic API 时，在环境中设置该变量并在 UI 选择 Anthropic API。

每次接受改动前，原文件会保存到同目录的 `.htmlwright/snapshots/`。预览注入只存在于 HTTP 响应，不会进入原文件。

编辑范围包括元素、当前内容单元、当前页和整个 HTML。对 PPT 做统一换风格时选择“整个 HTML”；只改当前幻灯片时选择“整页”。

## Chrome 扩展（推荐）

扩展可以直接在 Chrome 打开的 `file://` HTML 上点选和审核。Native Host 会按需调用本机 Claude Code、完成视觉验证并安全写回文件，不需要手动启动 localhost 服务。

```bash
npm run native:install
```

首次安装：

1. 打开 Chrome 的 `chrome://extensions`。
2. 开启“开发者模式”，点击“加载已解压的扩展程序”。
3. 选择安装命令输出的扩展目录。
4. 打开扩展详情，开启“允许访问文件网址”。
5. 用 Chrome 打开本地 HTML，点击工具栏中的 htmlwright 图标。

安装完成后的日常操作只有“打开 HTML → 打开扩展 → 点选并修改”。扩展声明的页面权限仅包括 `file://`、`localhost` 和 `127.0.0.1`，不会注入普通网站。

选中元素后会默认切换到“元素”范围，输入框上方会显示本次意见绑定的目标。可直接使用“快速编辑”修改叶子节点文字、文字颜色、背景颜色和字号，这条路径不会调用 Claude。生成候选后仍可在候选页面继续点选元素，多次快速编辑或 AI 修改会累积在同一个候选中；“当前候选包含”会按顺序展示这一批尚未写回的意见、编辑方式、范围和目标元素，不是长期历史记录。“接受并写回”一次性保存并清空列表，“拒绝”则丢弃全部未写回改动。一轮生成对应一条目标绑定；需要修改另一个元素时，先生成当前意见，再点选下一个元素继续。

Claude Code 正在生成时仍可继续点选元素、填写意见并点击“加入生成队列”。每条任务会在入队时固定目标和范围，并按提交顺序串行执行，后续任务始终基于前一条成功生成的候选，避免并行结果互相覆盖。

Claude Code 默认从 `~/.local/bin/claude` 加载，安装器也会自动记录探测到的绝对路径。如果检测失败，扩展会弹出路径设置；也可以随时点击“AI 后端”旁的齿轮重新配置。设置保存在 `~/Library/Application Support/htmlwright/config.json`。

如果通过 npm 全局安装发布包，可运行 `htmlwright-install-native` 安装，运行 `htmlwright-uninstall-native` 卸载。原 localhost 网页版仍可通过 `npm run dev` 启动，供开发调试使用。

## 验证

```bash
npm run check
```

视觉验证优先使用 Playwright 自带 Chromium，其次使用 macOS 已安装的 Chrome。也可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定浏览器可执行文件。

## License

[MIT](./LICENSE)
