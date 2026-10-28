import { layoutGraph } from './model.mjs';

export function sampleProject() {
  const now = new Date().toISOString();
  const task = (id, title, status, owner, description, standards) => ({ id, title, status, owner, description, criteria: standards.map((text, i) => ({ id: `${id}-c${i}`, text, result: status === 'done' ? 'passed' : 'pending', evidence: status === 'done' ? '示例证据：用于演示完成后的展示效果，非真实执行记录。' : '' })), documentIds: ['doc-plan'], position: null, updatedAt: now });
  const project = {
    id: 'project-demo', name: '构建下一站', description: '示例项目 · 从一个想法，到一次可靠交付。所有进度与证据均为演示数据。', revision: 1, createdAt: now, updatedAt: now,
    tasks: [
      task('scope', '定义目标与边界', 'done', 'YOU', '明确为什么做、为谁做，以及如何判断完成。', ['目标与范围已形成书面共识', '关键风险与约束已记录']),
      task('design', '方案与执行计划', 'done', 'AGENT', '拆解阶段、梳理依赖，将验收标准提前写入计划。', ['设计与 Roadmap 可供查阅', '每个阶段都有可检验的标准']),
      task('build', '实现核心能力', 'active', 'AGENT', '沿着计划逐步实现。每次验证结果，都留下可追溯的证据。', ['关键流程可完整运行', '失败与边界情况有明确处理', '自动化测试通过']),
      task('experience', '打磨交互体验', 'review', 'YOU + AGENT', '让复杂关系变得直观，确保信息层级清晰、操作反馈及时。', ['图形关系清晰，状态易辨认', '窄屏下仍能查看和操作']),
      task('integrate', '集成与回归', 'backlog', 'AGENT', '合并并行工作的结果，验证完整流程。', ['完整用户流程通过', '已有能力无回归']),
      task('risk', '解除交付阻塞', 'blocked', 'YOU', '示例阻塞：等待确认交付环境。请在描述与记录中保留原因和下一步。', ['交付环境已确认']),
      task('accept', '最终验收', 'backlog', 'YOU', '对照所有标准逐项验证，不能用主观完成感代替证据。', ['关键验收项全部通过', '结果与证据已归档']),
      task('ship', '交付与归档', 'backlog', 'AGENT', '交付可用成果，同时保存上下文，让下一次继续工作有据可依。', ['交付说明和恢复记录完整'])
    ],
    edges: [{ from: 'scope', to: 'design' }, { from: 'design', to: 'build' }, { from: 'design', to: 'experience' }, { from: 'build', to: 'integrate' }, { from: 'experience', to: 'integrate' }, { from: 'design', to: 'risk' }, { from: 'risk', to: 'accept' }, { from: 'integrate', to: 'accept' }, { from: 'accept', to: 'ship' }],
    documents: [
      { id: 'doc-plan', title: '执行计划', type: 'plan', updatedAt: now, content: '# 执行计划\n\n> 这是演示文档。请替换成你的真实项目计划。\n\n## 项目目标\n\n将长期任务拆成可验收、可恢复的阶段。\n\n## 工作方式\n\n- 先读取当前任务图与最新计划。\n- 只推进前置条件已经满足的阶段。\n- 实现完成后记录测试命令与实际结果。\n- 遇到阻塞，说明原因、所需输入和下一步。\n\n## 恢复上下文\n\n每次结束前，把当前阶段、最近验证和下一步保存到工作记录。' },
      { id: 'doc-roadmap', title: '项目 Roadmap', type: 'roadmap', updatedAt: now, content: '# 项目 Roadmap\n\n> 演示数据，不代表承诺日期。\n\n## 01 · 方向\n\n定义目标 → 方案与计划。\n\n## 02 · 构建\n\n核心能力与交互体验并行推进。\n\n## 03 · 验证\n\n集成回归，解除阻塞，逐项验收。\n\n## 04 · 交付\n\n交付成果，归档文档与恢复记录。' },
      { id: 'doc-notes', title: '工作记录 / Handoff', type: 'notes', updatedAt: now, content: '# 工作记录\n\n## 当前状态\n\n这是一个示例项目，用于展示长程任务的依赖关系。\n\n## 下一步\n\n创建自己的项目，写下第一阶段与验收标准。\n\n## 代理交接模板\n\n- 当前任务 ID：\n- 已完成工作：\n- 验证命令与结果：\n- 阻塞原因：\n- 下一步：' }
    ],
    activity: [{ at: now, text: '载入示例项目 · 所有进度为演示数据' }]
  };
  const positions = layoutGraph(project); for (const t of project.tasks) t.position = positions[t.id];
  return project;
}
