# 平台适配器

参照 OCS.js 的组织方式：**通用循环 + 每平台一个适配器**。加平台不再改 `lib/`。

## 接口

`platforms/<id>/index.mjs` 导出一个对象：

| 字段 | 作用 | 必须 |
|---|---|---|
| `id` / `name` / `hosts` | 标识与展示 | ✅ |
| `match(url)` | 这个 URL 是不是本平台 | ✅ |
| `taskAction(type)` | 平台任务类型 → 通用动作（`play_video` / `play_document` / `answer_quiz`）；不认识的返回 `null` | ✅ |
| `readTasks()` | **页面内**读取任务列表（会被序列化注入页面），返回 `{tasks, defaults, containerDepth, nextAvailable, popup}` | ✅ |
| `pageKind(url)` / `chapterId(url)` | Node 侧判定页面类型与章节 id | ✅ |
| `isStudyPage(url)` / `isEntryPage(url)` | 章节页 / 目录页判定 | ✅ |
| `experimental: true` | 未实测平台：控制器拒绝动作，只允许 dry-run 只读 | 可选 |
| `enterCourse(ctx)` | 从目录进入章节页（学习通要两步换 enc） | ✅ |
| `quiz.ensureReport(ctx)` / `quiz.run(ctx)` | 测验报告与作答提交链路 | 可选 |

`ctx` 目前是 `{bridge, tab, course, cpi, chapterId, root, dataDir, report}`。

## 注册

`platforms/registry.mjs` 里登记即可：

```js
const adapters = [chaoxing, zhs /* ... */];
export function detectPlatform(url) { /* 逐个 match */ }
```

## 循环怎么用它

| 位置 | 用法 |
|---|---|
| `lib/agent-loop.mjs` `ruleDecide` | `platform.taskAction(pending.type)` 决定动作；**未知平台或未知任务类型 → 返回 `null` → 升级给模型** |
| `lib/agent-loop.mjs` `act('open_course')` | `platform.enterCourse` |
| `chaoxing-agent-control.mjs` 测验分支 | `platform.quiz` |
| 控制器找标签 | `platform.isStudyPage(url)` |

## 新增一个平台

1. 新建 `platforms/<id>/index.mjs`，实现上表钩子（`quiz` 可以先不写，先用 `ask_operator` 兜底）；
2. 在 `registry.mjs` 注册；
3. 写 `dev/platform-test.mjs` 里的检测/映射断言；
4. 用 `node dev/agent-dryrun.mjs --tab=<标签> --rounds=3` 先只读跑几轮，确认页面类型、任务列表、播放器都能读出来；
5. 再开 `--act` 小步验证（先文档章，再视频章，最后测验）。

## 现状与下一步

- 已实现：`platforms/chaoxing`（学习通），**感知/循环/入口/答题都已走适配器**；
- 只读探针：`platforms/zhihuishu`（智慧树，`experimental`，没有账号实测，`--act` 会被拒绝）；
- 感知层已抽象：`lib/probe.mjs` 只采集通用信号（播放器、拦截、可见性），任务与页面类型由平台提供；
- 第二个平台（智慧树）目前只有只读探针，等真实页面验证后再补 `enterCourse` / `quiz` 并去掉 `experimental`。
