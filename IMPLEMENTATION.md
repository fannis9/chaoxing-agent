# 实施与验收

目标：落实可靠控制、易用性、通用性、复用与长期运行优化。不包含发布到 GitHub、真实作业提交、其他未指定学习平台或多人托管服务。

## 本地已验证

2026-11-19，Windows / Node.js 24 下 `npm test` 的 21 个测试入口全部通过。浏览器测试使用隔离页面与模拟接口。

| 范围 | 实现 | 验证 |
| --- | --- | --- |
| 易用性 | 草稿保留、重复发送拦截、稳定对话、360px 布局 | panel-refresh、panel-browser |
| 连接 | 令牌、来源限制、端口配置 | console-auth |
| 停止 | 协作取消、强制退出后备、页面停止确认、绑定标签 | run-scope、console-pause |
| 桥接 | 共享结构化客户端、旧协议拒绝 | bridge-client、真实 Edge 只读 tabs --json |
| 配置 | 路径探测、doctor、课程预览/核实/排序/备份 | course-config、panel-browser |
| 模型 | 两种协议、能力检测、用量及耗时 | model-client、answer-worker |
| 复核 | 禁止猜答、人工修改、报告哈希、缺失内容确认 | review-store、panel-browser、answer-worker、page-filler |
| 恢复 | 提交意图持久化、核验平台、不明状态不重提 | quiz-journal、submission-recovery、auto-submit |
| 继续 | 重启停止页面、时间戳变化保留复核 | report-recapture |
| 维护 | 日志轮转、可恢复归档、保留未完成报告、脱敏诊断 | maintenance |
| 复用 | 单章脚本由共享源码生成 | build-scripts --check |

## 已提供但未部署验收

- Windows/macOS/Linux 服务模板生成器：只生成，不注册自启动。
- 三系统 Node.js 22 CI：未推送执行，不能视为跨系统通过。
- 安装说明见 docs/LOCAL-SETUP.md；POSIX 权限测试不代表 Windows ACL 验证。

## 本机安装验收与验证边界

- 用户提供的实际侧栏截图已确认加载、配对成功、控制端已连接，并能读取课程与章节。此前仅依赖 Origin 的连接遥测会漏记，已增加通过认证后的版本头记录（不作为扩展身份凭据）；服务重启后已实际收到认证扩展请求。
- 控制台已启动、队列停止；DeepSeek 本机密钥已配置。2026-11-19 实际 deepseek-flash Responses 请求的文本、JSON 结构化输出、图片输入三项均通过，并已写入侧栏检测状态。未发送真实课程题目。
- 实际检测发现内置 PNG 的 IDAT 校验码错误，已替换有效图片，回归测试校验每个 PNG 数据块的 CRC。接口接受图片不代表实际解题准确率。
- 跨课程队列尚未配置；单课程模式不要求此项。真实课程填写、提交未作为测试执行。
- 截图已验证实际侧栏连接及基础展示；GUI 工具此前返回 Edge 未授权，自动化实际侧栏操作尚未验收。

- Windows 隐藏窗口后台启动入口已实际运行，启动命令退出后控制台仍响应；扩展重新连接，模型密钥与能力结果正常，队列保持停止。

本轮实现及 Windows 本机安装验证已完成。跨系统实机部署、远端 CI、真实课程提交不在本机验证结论内，不能据此宣称全平台生产认证。更新说明见 docs/RELEASE-NOTES.md。
