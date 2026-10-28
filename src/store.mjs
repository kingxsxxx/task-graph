import { mkdir, readFile, writeFile, rename, readdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { applyCommand, validateProject, safeId, makeId, AppError } from './model.mjs';

export class Store {
  constructor(directory) { this.directory = resolve(directory); this.queue = Promise.resolve(); }
  async init() { await mkdir(join(this.directory, 'projects'), { recursive: true }); }
  exclusive(work) {
    const result = this.queue.then(work); this.queue = result.catch(() => {}); return result;
  }
  async list() {
    const entries = await readdir(join(this.directory, 'projects'), { withFileTypes: true });
    const projects = [];
    for (const entry of entries) if (entry.isDirectory()) {
      const root = join(this.directory, 'projects', safeId(entry.name));
      // Uncommitted initial generations (e.g. power interruption) are not projects.
      try { await readFile(join(root, 'HEAD')); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const p = await this.get(entry.name);
      projects.push({ id: p.id, name: p.name, description: p.description, revision: p.revision, updatedAt: p.updatedAt, taskCount: p.tasks.length, doneCount: p.tasks.filter(t => t.status === 'done').length });
    }
    return projects.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }
  async get(id) { return (await this.readCommitted(id)).project; }
  async readCommitted(id) {
    const root = join(this.directory, 'projects', safeId(id));
    try {
      const head = (await readFile(join(root, 'HEAD'), 'utf8')).trim(); safeId(head);
      return { project: validateProject(JSON.parse(await readFile(join(root, 'revisions', head, 'snapshot.json'), 'utf8'))), generation: head, root };
    } catch (error) {
      if (error.code === 'ENOENT') throw new AppError('项目不存在', 404);
      throw error;
    }
  }
  async storage(id) {
    const {project,generation,root} = await this.readCommitted(id), destination = join(root,'revisions',generation);
    const folder = async path => {
      try { await access(path); return {path,exists:true}; }
      catch (error) { if (error.code === 'ENOENT') return {path,exists:false}; throw error; }
    };
    const nodePath = taskId => join(destination,'tasks',safeId(taskId),'documents');
    const acceptancePath = doc => join(destination,doc.archived?'archived-tasks':'tasks',safeId(doc.taskId),'acceptance');
    const archived = [...new Map((project.acceptanceDocuments ?? []).filter(d=>d.archived).map(d=>[d.taskId,d])).values()];
    return {
      projectId: project.id, revision: project.revision, generation,
      projectFolder: await folder(join(destination,'documents')),
      tasks: await Promise.all(project.tasks.map(async t=>({taskId:t.id,...await folder(nodePath(t.id))}))),
      documents: project.documents.map(d=>({documentId:d.id,taskId:d.taskId??null,path:join(d.taskId ? nodePath(d.taskId) : join(destination,'documents'),`${safeId(d.id)}.md`)})),
      acceptanceFolders: {
        tasks: await Promise.all(project.tasks.map(async t=>({taskId:t.id,...await folder(acceptancePath({taskId:t.id,archived:false}))}))),
        archived: await Promise.all(archived.map(async d=>({taskId:d.taskId,title:d.archivedTaskTitle,...await folder(acceptancePath(d))})))
      },
      acceptanceDocuments: (project.acceptanceDocuments ?? []).map(d=>({documentId:d.id,taskId:d.taskId,archived:d.archived,path:join(acceptancePath(d),`${safeId(d.id)}.md`)}))
    };
  }
  async writeArtifacts(destination, project) {
    await mkdir(join(destination, 'documents'), { recursive: true });
    for (const task of project.tasks) await mkdir(join(destination,'tasks',safeId(task.id),'documents'),{recursive:true});
    for (const task of project.tasks) await mkdir(join(destination,'tasks',safeId(task.id),'acceptance'),{recursive:true});
    for (const doc of project.documents) {
      const directory = doc.taskId ? join(destination,'tasks',safeId(doc.taskId),'documents') : join(destination,'documents');
      await writeFile(join(directory,`${safeId(doc.id)}.md`),doc.content,'utf8');
    }
    for (const doc of project.acceptanceDocuments ?? []) {
      const directory=join(destination,doc.archived?'archived-tasks':'tasks',safeId(doc.taskId),'acceptance');
      await mkdir(directory,{recursive:true});await writeFile(join(directory,`${safeId(doc.id)}.md`),doc.content,'utf8');
    }
    await writeFile(join(destination, 'snapshot.json'), JSON.stringify(project, null, 2) + '\n', 'utf8');
  }
  async commit(project) {
    validateProject(project);
    const root = join(this.directory, 'projects', project.id), generation = makeId(`r${project.revision}`);
    const destination = join(root, 'revisions', generation);
    // HEAD only changes after every artifact has been written successfully.
    await this.writeArtifacts(destination, project);
    const temporary = join(root, makeId('head'));
    await writeFile(temporary, generation + '\n', 'utf8');
    await rename(temporary, join(root, 'HEAD'));
    return structuredClone(project);
  }
  create(input) {
    return this.exclusive(async () => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('项目资料格式不合法');
      const now = new Date().toISOString();
      return this.commit({ id: makeId('project'), name: input.name ?? '未命名项目', description: input.description ?? '', revision: 1, tasks: [], edges: [], documents: [], activity: [{ at: now, text: '创建项目' }], createdAt: now, updatedAt: now });
    });
  }
  import(input) {
    return this.exclusive(async () => {
      validateProject(input); const project = structuredClone(input);
      project.id = makeId('project'); project.revision = 1; project.updatedAt = new Date().toISOString();
      project.activity = [{ at: project.updatedAt, text: '导入项目快照' }, ...(project.activity ?? [])].slice(0, 200);
      return this.commit(project);
    });
  }
  command(id, revision, command) {
    return this.exclusive(async () => {
      const project = await this.get(id);
      if (revision !== project.revision) throw new AppError('项目已被其他窗口或代理更新。请刷新后重试；你的未保存内容仍保留在编辑框中。', 409);
      const next = applyCommand(project, command); next.revision = project.revision + 1;
      return this.commit(next);
    });
  }
}
