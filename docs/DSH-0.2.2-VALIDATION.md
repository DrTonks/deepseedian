# DSH 0.2.2 与 Deepseedian 0.7.5 兼容验收

2026-11-26 同步 `origin/main` 后，从 DSH `0.2.1-rc.2` 升级到 npm `latest` 和 `next` 同指的 `0.2.2-rc.5`。`doctor` 检查的七个组件版本一致。新版 DSH 要求 Node.js `24.9.0+`，Obsidian 最低版本仍为 `1.13.7`，插件 ID 为 `deepsidian`。[DSH 官方发行记录](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.5)

## 兼容修复

- **模型与推理档位**。新版 DSH 从历史会话恢复模型选择。未修复时，原会话从 `deepseek-chat` 切到 `deepseek-flash` 并重连，实际请求仍发送给原模型。桥接在发送前应用当前供应商、模型及推理档位，回到「DSH 默认」时恢复供应商默认值。新接口存在时才调用，旧 DSH 继续使用原有桥接路径。
- **网页读取**。新版 DSH 的默认 HTTP provider 支持内网。插件通过 DSH 的公开注册接口提供仅限可验证公网地址的匿名 HTTP(S) 读取。每次连接使用校验后的 DNS 地址，每次同源跳转重新校验，保留时限和响应大小限制。需要代理解析目标的网页会被拒绝。聊天与搜索继续使用各自的 DSH 网络配置。
- **工具和会话**。新版默认工具执行器与会话检查点兼容，保留聊天工具范围和整理器零工具。会话迁移增加 `0.2.1-rc.2`，覆盖历史工具结果、原有分支、从旧边界再分支及重启后的隔离。

DSH 官方 API key 路由可能请求官方模型目录，失败时退回内置目录。DSH 新版对启动目录 `.env` 的 DeepSeek 聊天与搜索端点不再生效，可用对应适配器的 `baseURL` 或启动环境配置。启动失败时 DSH 可能将原始诊断写入插件 `.runtime/logs`，分享日志前请检查内容。

## 自动测试

- `npm run check` 通过 160 项离线测试、类型检查和构建。ESLint 为 0 个错误、530 个既有警告。
- `npm run test:integration` 通过 20 项测试，无跳过。覆盖切换模型、关闭推理后恢复默认档位、跨重启图片和历史、五套运行时迁移、三文件安装、工具隔离及补全取消。
- 网页读取的合成 HTTP 测试确认搜索仍提供引用，私网地址被拒绝且测试服务器未收到网页读取请求。匿名公网 `https://example.com/` 实际读取成功并返回 HTML。
- `npm run package:release` 生成 `main.js`、`manifest.json`、`styles.css`。安装包包含桥接和第三方声明。

```sh
DSH_LEGACY_PACKAGE_ROOT=/path/to/dsh-0.1.5-rc.2 \
DSH_PREVIOUS_PACKAGE_ROOT=/path/to/dsh-0.1.6-alpha.2 \
DSH_BASELINE_PACKAGE_ROOT=/path/to/dsh-0.1.7-rc.2 \
DSH_020_PACKAGE_ROOT=/path/to/dsh-0.2.0-rc.2 \
DSH_021_PACKAGE_ROOT=/path/to/dsh-0.2.1-rc.2 \
npm run test:integration
```

普通 push 的 CI 运行三平台离线检查。手动触发的运行时 CI 使用真实 DSH 和模拟供应商，未配置旧安装时会跳过五项历史迁移。Windows 和 Linux 的运行时测试通过 CI 验证，原生 UI 验收在 macOS 完成。

## 真实付费供应商与 macOS

使用 `deepseek-official / deepseek-flash` 及合成资料。聊天实际调用 `obsidian_context` 并流式输出。记忆整理正例生成原文证据提案，虚构角色反例返回空数组。六轮分支测试通过，重启后父子会话仍各自保留更新。

手动补全 holdout 测试发起 8 次请求。逐项复核后 5 个候选可用，3 次空结果符合预期，0 错误、0 超时且全部有用量记录。暖请求 P50 784 ms、P95 1,119 ms，进程冷启动 662 ms。数据来自一组小样本。

macOS Obsidian `1.14.5` 的独立验收库安装了最终三文件构建。旧分支（4）的标题、来源和历史恢复，续聊准确回忆最初学习行动卡的自检问题，报告 3,944 输入、10 输出 tokens。第一次补全操作未观察到候选，撤销了常规 Tab 编辑。第二次显示灰字“避免每次都从原存储重新读取相同数据。”，Tab 接受和单次撤销均正常。验收后恢复补全设置，五篇 Markdown 哈希及十个历史聊天保留，仅测试分支追加一轮。

本地证据保存在 `.runs/`。`dsh-022-before-route.log` 记录模型切换失败，`dsh-022-final-check.log`、`dsh-022-integration-final.log`、`dsh-022-public-fetch.log` 与 `dsh-022-native-result.json` 记录修复后结果。真实供应商的合成报告目录为 `live-2026-11-26T06-51-52.682Z/`、`live-fork-jMl6Mg/` 和 `live-completion-b2Yxjf/`。
