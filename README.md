# 学习通任务代理（chaoxing-agent）

一个自包含的学习通刷课/答题控制台：**侧栏 UI + 浏览器扩展 + 本机控制台**都在这个仓库里，
不依赖 Page Bridge、不用 native host、不开调试端口。

```
Edge 扩展（侧栏面板 + 浏览器代理）
   │ 面板：HTTP  http://127.0.0.1:8788
   │ 代理：WS    ws://127.0.0.1:8788/agent?token=…
   ▼
chaoxing-console.mjs（8788）
   ├─ 面板 API（状态、队列、复核、恢复设置）
   ├─ /agent/command  → 转发给扩展执行 tabs/scripting
   └─ 子进程：chaoxing-auto → quiz-control → page-filler / answer-worker
```

扩展用的是你自己的域名权限（只有 `*.chaoxing.com`），不再是"完全接管所有网站"。

## 拓展资料开关

平台把「知识拓展」这类内容挂在章节下，但不计入任务点（`job !== true`）。默认**跳过**它们，只刷平台会计分的任务点。

想让 agent 也播/读这些内容：侧栏「全自动模式」里勾选 **也处理拓展资料**（或 `.env` 设 `CX_PROCESS_OPTIONAL=1`）。

注意：这类内容平台不会标记完成，agent 只处理一遍就前进，不会反复重播。

## 首次安装

1. **填配置**：把 `.env.example` 复制成 `.env`，填模型与密钥。
2. **启动控制台**：

   ```powershell
   node dev/console.mjs        # 前台运行（首次会生成 quiz-reports/console-token）
   node doctor.mjs             # 自检：端口、扩展、模型、队列
   ```

   登录自启：`powershell -File dev/install-autostart.ps1`（用户级计划任务，可撤销）。

3. **加载扩展**：`edge://extensions` → 开发者模式 → 加载已解压 → 选本仓库 `extension/`。
4. **配对**：打开学习通页面 → 点扩展图标打开**侧栏** → 填
   - 控制台端口：`8788`
   - 配对令牌：`quiz-reports/console-token` 的内容（或 `npm run token`）

   徽标变 `ON` 表示浏览器代理已连上。

5. **验证**：

   ```powershell
   npm run test:agent   # 无需浏览器：控制台内嵌 hub + 适配层
   npm run smoke        # 真实浏览器：tabs/open/eval/activate/close
   ```

## 目录

| 路径 | 作用 |
|---|---|
| `chaoxing-console.mjs` | 控制台：面板 API + agent hub + 队列调度 |
| `chaoxing-auto.mjs` | 长驻入口：找标签、开课程、串起控制器与答题 |
| `chaoxing-quiz-control.mjs` | 章节控制器：注入页面脚本、提交、恢复 |
| `chaoxing-autoplay-v3.js` | 页面脚本（视频/文档/测验），由 `dev/build-scripts.mjs` 生成单章版 |
| `chaoxing-page-filler.mjs` / `chaoxing-answer-worker.mjs` | 填答卷 / 调模型答题 |
| `platforms/<id>/index.mjs` | 平台适配器（任务类型、入口、答题）；见 [docs/platform-adapter.md](docs/platform-adapter.md) |
| `lib/bridge-client.mjs` | 浏览器命令客户端（HTTP → 控制台 → 扩展） |
| `lib/agent-hub.mjs` | 控制台内的 WebSocket hub |
| `extension/` | 侧栏面板 + 浏览器代理（一个扩展两件事） |
| `quiz-reports/` | 运行期状态：队列、报告、日志、令牌（不入库） |

## 与 Page Bridge 版的关系

本仓库由 Page Bridge 版重写而来：旧实现保存在 git 分支 `legacy/pagebridge-wip`（以及 `E:\dsh\backups` 里的 zip 存档），需要对照或回退时看那里。差别：

| | Page Bridge 版 | 本仓库 |
|---|---|---|
| 浏览器控制 | 第三方扩展 + `page.mjs` 子进程 | 自己的扩展 + HTTP/WS |
| 单条命令开销 | 300–600ms（spawn node） | 3–40ms |
| 大脚本注入 | 受 Windows 32K 命令行限制 | `executeScript` 传参，无上限 |
| 权限范围 | `<all_urls>` + 完全接管 | 仅 `*.chaoxing.com` |
