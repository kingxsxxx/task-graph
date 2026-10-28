# Task Graph Skill 第一版验证

范围：封装现有本地 API，不改变网站模型、服务或生产项目。源码 `skills/task-graph/`；本机使用单一用户级安装入口。无新增 npm 依赖，无 MCP、定时器或远程部署。

## 先验证缺口

只读评估代理仅拿到原 `AGENT_GUIDE.md`，没有新 Skill。它能够遵守计划/执行边界与版本协议，但无法找到一个有文档的可执行客户端；指出项目绑定、文档内指令信任边界、人工验收和不确定提交的恢复方式缺少显式说明。原话：“No installed helper is identified by the guide. Its concrete interface is curl, not a documented helper CLI.”

不是所有边界都出现违规；已有正确行为予以保留，没有据此扩张授权。新 Skill 为现有操作提供可发现的入口、参考与客户端。

## 客户端 RED → GREEN

先加入 `tests/skill-client.test.mjs`，实测 10 项全部失败：目标客户端尚不存在。再实现客户端，10 项通过。

使用真实 `Store` 和 HTTP API、独立临时目录/随机端口验证：

- 帮助和项目创建/读取，中文与 shell 字符保持为数据。
- 节点专属路线、独立验收文档、原子关联及磁盘重读。
- 版本冲突不重试、不重设版本、不覆盖用户修改。
- 无版本/无效 JSON/未知命令/无效 ID/未知选项拒绝写入。
- 删除必须额外显式标志；服务器验证失败不伪装成功。
- 恢复时区分进行中、可开始、待验收和阻塞；未完成前置的下游不可开始。
- 拒绝远程/带凭据/带路径的服务 URL。
- 写入响应丢失只提交一次，结果标为 unknown，要求核对。

Skill frontmatter 验证及 Node 语法检查通过。整个项目 `npm test`：54/54 通过。浏览器产品代码未修改，本轮不宣称重新跑过浏览器测试。

## 行为验证与安装

独立代理使用新 Skill，在 `/tmp/task-graph-skill-eval-qS0fKL` 的临时看板实例（随机端口 45637）完成行为验证：

- 创建隔离项目及两个有前置依赖的节点，写入节点技术路线和关联独立验收文档。
- 实际执行 `node /tmp/task-graph-skill-eval-qS0fKL/validate.mjs`，在 revision 7、9 两次通过；记录的是看板操作验证，不冒充网站开发成果。
- 首节点进入 review；自动检查有真实证据，人工可视验收保持 pending。后续节点保持 backlog，不出现在 ready 的可开始集合。
- 保存交接文档，再从 get/ready/storage 恢复，保留文档归属和验收关联。
- 故意用旧 revision 7 写入当前 revision 9：退出码 3 / HTTP 409，未覆盖或重试，revision 仍为 9。
- 阅读场景评估正确区分项目歧义、计划授权、嵌入指令、人工验收、冲突和未知提交。客户端丢失响应不重试另由自动测试故障注入验证。

评估进程 PID 815405 经校验后 SIGTERM 结束，仅留上述临时测试产物供检查。未访问生产端口 4310。没有发现重要接口/安全约定不一致。

安装入口 `/home/king/.codex/skills/task-graph` 为源码目录的符号链接。通过安装路径执行帮助、frontmatter 校验和只读生产 list/ready，均正常；三个真实项目的 revision 保持 77、28、1。安装完成时当前会话技能列表不会由这些验证刷新；新会话或重启 Codex 后再检查发现结果。

限制：技能发现依赖宿主环境，新会话应重新加载；Skill 不是常驻 Agent。数据内容中的文字不授予新的操作权限。CLI 的删除标志不替代真实用户授权。当前服务只支持本机访问，云端会话不能仅凭此 Skill 访问用户电脑上的 localhost。
