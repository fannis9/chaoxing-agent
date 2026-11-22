# Agent 模式（CX_AGENT_MODE=loop）

刷课不再是一条写死的状态机，而是 `观察 → 决策 → 执行 → 验证` 的循环。
本文件说明它怎么工作、边界在哪、怎么调。

## 一句话

**规则负责常见路径，模型负责陌生和卡住的情况；两者都无法确认时停下来等人。**

## 循环

```
probe（页面内一次性采集）
  → decide（规则优先；异常/陌生/反复卡住 → 模型）
  → act（一个动作）
  → verify（再探一次，看预期变化是否真的发生）
  → 记忆（历史、待补做、成功路径）
```

对应代码：

| 文件 | 角色 |
|---|---|
| [lib/probe.mjs](lib/probe.mjs) | 场景探针：页面类型、章节、任务与状态、播放器、进度、验证码/登录拦截信号 |
| [lib/agent-loop.mjs](lib/agent-loop.mjs) | 规则、模型决策、动作、验证 |
| [chaoxing-agent-control.mjs](chaoxing-agent-control.mjs) | 控制器：循环、心跳、runtime 同步、失败恢复 |
| [lib/quiz-run.mjs](lib/quiz-run.mjs) | 测验：报告 → 作答 → 填卷 → 提交 → 平台核验 |

## 决策优先级

1. **硬红线（规则，永远优先）**：出现验证码 / 人脸核验 / 登录失效 / 反爬页 → `ask_operator`，停下等人。
2. **常规规则**：视频未播→`play_video`；正在播→`wait`；文档→`play_document`；测验→`answer_quiz`；全完成→`next_chapter`；无任务→`mark_deferred`（记完真的前进）。
3. **升级到模型**：页面类型未知、任务类型不在 `video/document/workid` 里、同一章连续 3 次非 `wait` 动作仍无进展、或 `--force-model`。
4. 模型也只能从同一组动作里选，且必须给出 `expect`；动作后一律验证。

## 动作表

| 动作 | 做什么 | 验证方式 |
|---|---|---|
| `play_video` | 先切前台（隐藏标签平台会暂停），再用播放器 API 静音播放 | 进度前进，或任务已完成 |
| `wait` | 什么都不做，等下一轮 | — |
| `play_document` | 交给已验证的单章页面脚本执行（文档接口单独调用会被平台拒绝） | 任务完成或章节变化（5 分钟窗口） |
| `answer_quiz` | 报告 → 作答 → 填卷 → 提交 → 核验 | 平台完成标记 |
| `answer_popup` | 视频弹题：读题 → 模型选一个选项 → 点选并提交 | 弹题消失、播放继续 |
| `next_chapter` | 点「下一节」 | 章节 id 变化 |
| `mark_deferred` | 记待补做并前进 | 章节 id 变化 |
| `activate_tab` / `reload_page` / `open_course` / `ask_operator` / `wait` | 见名 | 视动作而定 |

## 失败与自愈

- 单步异常：记事件后继续，连续 5 次才降级 `needs-review`；
- 探针 `eval` 超时：重试 3 次（1.2/2.4/3.6 秒退避）——页面正在跳转时注入会超时；
- 页面渲染进程卡死：用 `tabs.update` 重载（不依赖渲染进程）；
- 学习标签被关掉/换掉：自动找另一个 `studentstudy` 标签继续；
- 同一章的文档脚本不重复注入。

## 怎么跑

```powershell
# .env
CX_AGENT_MODE=loop        # classic 则走原状态机

node doctor.mjs           # 看完再启动
node dev/agent-dryrun.mjs --rounds=3          # 只观察不动作
node dev/agent-dryrun.mjs --rounds=1 --force-model   # 强制走模型，看它的判断
npm test                  # 离线：规则测试 + hub 传输测试
```

## 字体混淆（为什么不自己解密）

学习通会把题干里的一部分字换成自定义字体，DOM 里取到的是乱码，但**渲染出来的字形是对的**。

我们的做法：答题时把题目截图一起发给模型，让它按图读题（图片走多模态，不受混淆影响）。

OCS.js / Samueli924 的做法是**离线解密**：抓字体文件，逐字渲染成位图，和一份从思源黑体预生成的参考表比对，还原明文。好处是省 token、纯文本更好检索；代价是要维护参考表和字体解析器（FRB2/WOFF），平台一换字体就得重做。

结论：截图已经能绕开这个问题，解密属于**成本优化**，等答题量上来再考虑。

## 已知边界

- 测验（P3）在真实测验章上还没有实机验证过——当前课程没有 `workid` 任务；
- 视频"未允许倍速"时锁 1x，允许时探到 2x；
- 平台反爬（9010）出现时只能停，等人工过验证码；
- 模型调用只在升级路径发生，正常刷课不消耗 token。
