# 平台适配器

参照 OCS.js 的组织方式：**通用循环 + 每平台一个适配器**。加平台不再改 `lib/`。

## 接口

`platforms/<id>/index.mjs` 导出一个对象：

| 字段 | 作用 | 必须 |
|---|---|---|
| `id` / `name` / `hosts` | 标识与展示 | ✅ |
| `match(url)` | 这个 URL 是不是本平台 | ✅ |
| `taskAction(type)` | 平台任务类型 → 通用动作（`play_video` / `play_document` / `answer_quiz`）；不认识的返回 `null` | ✅ |
| `isStudyPage(url)` / `isEntryPage(url)` | 章节页 / 目录页判定 | ✅ |
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

- 已实现：`platforms/chaoxing`（学习通），循环、入口、答题都已走适配器；
- **感知层（`lib/probe.mjs`）仍是学习通风格**（`AttachmentSetting`、`#prevNextFocusNext`）——这是下一块要收进适配器的：把 `probe` 变成平台的 `readTasks(scene)` 钩子，`probe.mjs` 只保留通用骨架；
- 第二个平台建议先做只读探针，验证接口抽象站得住，再补 `enterCourse` 和 `quiz`。
