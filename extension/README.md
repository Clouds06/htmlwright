# htmlwright Chrome Extension

这是 htmlwright 的 Chrome 扩展界面。默认通过 Native Host 使用本机 Claude Code 并直接编辑 `file://` HTML；localhost Helper 仅作为开发调试入口。

## 安装

1. 在项目根目录运行 `npm install` 和 `npm run native:install`。
2. 在 Chrome 打开 `chrome://extensions` 并开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择安装命令输出的扩展目录。
4. 在扩展详情中开启“允许访问文件网址”。
5. 用 Chrome 打开任意本地 HTML，点击工具栏中的 htmlwright 图标即可编辑。

Native Host 会按需启动，不需要保持终端或 localhost 服务运行。扩展仅能访问用户主动打开的本地文件以及 `localhost` 调试入口。

点选元素后会默认进入“元素”范围，输入框上方会明确显示本次意见的目标。“快速编辑”可以直接修改文字、文字色、背景色和字号，不调用 Claude。候选生成后可以继续在候选页面逐个点选并追加 AI 或快速修改，审核区会保留每条意见与目标元素的对应记录，最后统一接受写回。

AI 正在生成时可以继续提交其他目标的意见，按钮会切换为“加入生成队列”。队列按顺序串行处理，避免多个 Claude Code 结果覆盖同一份候选。

Claude Code 默认路径是 `~/.local/bin/claude`。检测失败时侧栏会自动显示路径设置，也可点击“AI 后端”旁的齿轮修改。
