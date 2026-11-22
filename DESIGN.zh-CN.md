# htmlwright 设计文档

> 本地 AI-native 单文件 HTML 可视化编辑器 —— 技术选型、架构、模块实现与难点复盘。
> 仓库:https://github.com/Clouds06/htmlwright ｜ 许可:MIT

---

## 1. 项目简介

htmlwright 让你在**真实浏览器里点选一个 HTML 元素、用一句话描述想要的改动**,AI 改完后先给出**代码 diff + 视觉验证**,你确认后才写回原文件。

它不是"从零生成页面",而是**在已有单文件 HTML 上做可指代、可验证、可回退的精确修改**——数据始终留在用户本地。核心安全底线:

- 改动先进内存(候选),`accept` 前绝不碰磁盘;
- 写回前把原文件存快照,支持 `undo`;
- 写回前跑代码 diff + Playwright 视觉验证,并检测越界/溢出。

两种用法,共用同一套核心:

| 链路 | 入口 | 用途 |
|------|------|------|
| **Chrome 扩展 + Native Host**(主) | 直接打开 `file://` HTML | 日常使用,无需常驻服务 |
| **localhost Web 版** | `npm run dev`(React + Express) | 开发调试、截图审阅 |

平台:目前 **macOS only**(路径、浏览器探测、Native Host 注册按 macOS 实现)。

---

## 2. 技术选型(及理由)

| 选型 | 用途 | 为什么 |
|------|------|--------|
| TypeScript + Node ≥20 | server / native host | 类型安全;单文件工具无需重框架 |
| Express 5 | localhost HTTP | 轻量,只服务 dev/web 路径 |
| **parse5** | HTML 源码级解析 | 快速编辑要在**源码层**精确改,保留原始格式,不能靠 DOM 序列化 |
| **Playwright-core + pixelmatch + pngjs** | 视觉验证 | 无头截图前后逐像素对比,判断"目标真的变了 / 有没有连累别处" |
| diff | 生成 unified diff | 审阅面板展示代码差异 |
| React + Vite | localhost Web UI | 开发态富交互 + 截图审阅 |
| Chrome MV3 扩展 + **Native Messaging** | 直接改 `file://` | 浏览器沙箱内改不了本地文件;Native Host 桥到本机,并复用已登录的 Claude Code |
| Provider 抽象 | 模型后端 | Claude Code CLI / Anthropic API / **OpenAI 兼容** / demo,一个接口多后端 |

---

## 3. 架构

### 3.1 核心模块(`server/`)
- `session.ts` —— 候选/写回/快照/撤销状态机(两条链路共用)。
- `providers.ts` —— 模型后端工厂 `createProvider` + `LLMProvider` 接口。
- `verifier.ts` —— Playwright 视觉验证。
- `quick-edit.ts` —— parse5 源码级样式/文字改写(不调模型)。
- `preview.ts` —— 预览注入(`<base>` + 选择 bridge)、剥离运行时属性。
- `types.ts` —— 共享类型。

### 3.2 Chrome 扩展(`extension/`)
- `content-script.js` —— 注入本地页面,负责点选/高亮/候选预览 iframe。
- `sidepanel.{html,css,js}` —— 侧栏 UI(编辑意图、审核、设置)。
- `service-worker.js` —— 编排:开侧栏、转发命令、**判定侧栏生死**。
- `native-host`(`server/native-host.ts` 构建产物)—— 收扩展消息,调 provider、跑验证、安全写回。

### 3.3 数据流(native 主链路)
```
打开 file://HTML
  → content-script 点选元素(发 selected 给 SW → 侧栏)
  → 侧栏写意图/范围,选后端
  → native-host 调 provider 生成候选(仅在内存)
  → verifier 截图对比,产出 diff + 检查项
  → 侧栏审核 → accept:快照原文件 → 写回;或 reject 丢弃
```

---

## 4. 模块实现要点

- **session.ts**:维护 `disk / baseline / candidate` 三份 HTML;`pending` 落盘 `.htmlwright/pending-*.json`(靠 `diskHash` 防串档);`accept` 先快照到 `.htmlwright/snapshots/` 再写回;`onExternalChange` 比对磁盘 hash 做冲突检测。
- **providers.ts**:`LLMProvider { edit(), status() }`。`extractHtml` 做容错——优先 `<<<START>>>/<<<END>>>` 标记,其次剥 markdown 代码块,再退回抓 `<html>…</html>`,**不完整就拒收、绝不写回**。Claude Code 链路会主动 `delete ANTHROPIC_API_KEY` 避免误走计费;OpenAI 兼容用 `baseURL + key + model` 三参数,吃下 OpenAI/OpenRouter/本地 Ollama 等。
- **verifier.ts**:无头 Chromium 打开 baseline/candidate,`settle` 等字体与网络空闲后 `fullPage` 截图,`pixelmatch` 比对;同时按内容单元(section/card/...)做**越界检测**,并查内容溢出/元素重叠。找不到 bundled Chromium 时兜底到本机 Chrome。
- **quick-edit.ts**:用 parse5 按 `sourcePath`(浏览器 DOM 里算出的子节点索引路径)定位元素,在**源码字节层**替换文字/内联样式,免模型、即时、免费。带 `tagName` 校验兜底,结构对不上就报错不写坏。
- **preview.ts**:`injectPreview` 给预览 HTML 注入 `<base>` + 选择 bridge 脚本;`stripRuntimeAttributes` 在喂模型前去掉运行时注入的 `data-htmlwright-*`。

---

## 5. 难点与复盘 ⭐

### 5.1 候选安全(不误写用户文件)
内存候选 + 代码 diff + 视觉验证 + 写前快照 + 外部改动冲突检测,五层兜底。

### 5.2 视觉验证怎么判"改对了"
不只看整页像素差,还按**内容单元**逐块对比,报告"目标块变了没 / 有没有连累非目标块",避免 AI 悄悄改坏别处。

### 5.3 让浏览器扩展改本地文件
浏览器沙箱不能写 `file://`。解法:Native Messaging——扩展经 SW 连本机 Native Host(一个 node 进程),由它读写文件、调本机 Claude Code。安装脚本负责注册 native manifest(macOS 放固定目录)、生成 wrapper、探测 claude 路径。

### 5.4 多模型支持
`openai-compatible` provider 一把解决"用别家 key / OpenRouter / 本地免费模型",配合 `extractHtml` 容错让弱模型也能安全落地。

### 5.5 Chrome 扩展开发那些"看不见的坑"(本次踩全了)

**A. 改了源码 Chrome 不自动生效。** 扩展从"加载目录"运行;改仓库源码后要 `npm run native:install` 复制到该目录、在 `chrome://extensions` reload,**而且 content-script 不会重新注入已打开的页面**——必须刷新页面。这一步反复被漏,坑了好几轮。
> 对策:①`onInstalled` 里自动 `reload` 已开的 `file://` 标签页;②给 manifest 加**可见版本号**(0.1.x),一眼确认加载的是哪一版,终结"到底改没改上"的扯皮。

**B. Side panel 生命周期是最大坑。**
- "只在当前 tab 显示 / 不自动跟随" 与 "任意 tab 点图标都能开" 在 Chrome side panel API 下**不可兼得**:把某 tab 设 `enabled:false` 会**连带禁掉那个 tab 的点击打开**。
- `sidePanel.open()` **必须在用户手势的同步上下文**里调;`await setOptions()` 之后再 `open()` 会被拒——表现为"**点图标没反应**"。
- **关闭侧栏时,Chrome 不销毁面板上下文、不发 `visibilitychange`、也不断开面板内发起的 port**——所以"面板自己感知关闭"(port/心跳/visibilitychange)统统不可靠。
> 最终解法:**由 Service Worker 持有面板的一条常驻端口**。SW 是稳定观察者,面板真正销毁时它**必定**收到 `onDisconnect`,再由 SW 通知页面复位。这是检测面板关闭的可靠方式。

**C. 高亮残留连环 bug(经控制台取证定位)。**
- 关侧栏 → 页面变宽 → 触发 `resize` → 处理器无脑 `position(target, box)` **把刚隐藏的选中框又显示出来**(scroll 同理)。→ 改成**仅在选择态才重定位**,并在 deactivate 时清空 target。
- 候选预览是一个铺满页面的 **iframe**,里面那套 bridge 画的框**独立于内容脚本**,内容脚本的 deactivate 管不到它。→ deactivate 时**一并移除候选 iframe**,关侧栏即回到干净原始页。

**D. 调试方法论。** 反复盲猜改代码是最低效的。转折点是**往页面注入一次性诊断打印**(`selected` 节点数 / `display` / `html` 上的 class / 有无候选 iframe),拿到运行态的确凿证据后,一次改对。

### 5.6 交互模型演进:「按需激活」
从"全局侧栏(到处弹)" → "URL 判断(只在本地 HTML)" → "严格按 tab" 的取舍后,定稿为:
- **默认休眠**:打开本地 HTML 不点图标 = 纯阅读,无十字光标/不高亮/不拦点击;
- **点图标才激活**该 tab;**关侧栏自动复位**(靠 5.5B 的 SW 端口);
- **快速改(免 AI)** 与 **用 AI 改** 拆成两张卡,不逼用户选模式;
- **范围**大白话「这一处 / 这一页 / 整个文件」,并随"是否多页(PPT)"自适应;
- UI 走 shadcn 单色系,信息卡片化分层。

---

## 6. 目录速览
```
server/        核心:session/providers/verifier/quick-edit/preview/native-host/cli
extension/     Chrome MV3:content-script/sidepanel/service-worker/manifest
src/           localhost React Web 版
scripts/       native host 安装/卸载
tests/         node --test 单元 + 扩展结构校验
```

## 7. 已知限制 / 待办
- 跨平台:目前 macOS only(Native Host 注册、`open`、浏览器探测按 mac 写死)。
- 无 CI(建议 GitHub Actions 跑 `npm run check`)。
- 模型/超时/viewport/pixelmatch 阈值等仍写死,待配置化。
- 字符串以中文为主,国际化(i18n)待做。
- 扩展 native 模式下 OpenAI key 需在设置弹窗填(已支持)。
