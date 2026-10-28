import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, readFile, unlink } from 'node:fs/promises';
import { Store } from './src/store.mjs';
import { createApp } from './src/http.mjs';
import { sampleProject } from './src/sample.mjs';

const data = resolve(process.env.TASK_GRAPH_DATA ?? fileURLToPath(new URL('./data/', import.meta.url)));
const port = Number(process.env.PORT ?? 4310);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 必须是 0–65535（0 为自动分配）');
const store = new Store(data); await store.init();
const lockPath = resolve(data, '.server.lock');
async function acquireLock() {
  try { const handle = await open(lockPath, 'wx'); await handle.writeFile(String(process.pid)); await handle.close(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lockPath, 'utf8')); let running = true;
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') running = false; else throw e; }
    if (running) throw new Error(`数据目录正由进程 ${pid} 使用，请不要同时启动两个服务。`);
    await unlink(lockPath); await acquireLock();
  }
}
await acquireLock();
const release = async () => { try { await unlink(lockPath); } catch (error) { if (error.code !== 'ENOENT') console.error(error); } };
try {
  if (!(await store.list()).length) await store.exclusive(() => store.commit(sampleProject()));
  const app = createApp(store);
  app.on('error', async error => { console.error(error); await release(); process.exit(1); });
  app.listen(port, '127.0.0.1', () => console.log(`Task Graph → http://127.0.0.1:${app.address().port}\n数据目录：${data}`));
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (closing) return; closing = true;
    app.close(async () => { await store.queue; await release(); process.exit(0); });
  });
} catch (error) { await release(); throw error; }
