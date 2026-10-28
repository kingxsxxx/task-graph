import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/markdown.js';
test('Markdown renders headings, lists and fenced code while keeping hostile HTML inert', () => {
  const html = renderMarkdown('# 计划\n\n- **实现**\n- 验证\n\n```js\n<script>alert(1)</script>\n```\n\n<img src=x onerror=alert(2)>');
  assert.ok(html.includes('<h1>计划</h1>')); assert.ok(html.includes('<strong>实现</strong>'));
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img'));
});
test('links reject javascript and data schemes but allow HTTPS', () => {
  const html = renderMarkdown('[危险](javascript:alert) [数据](data:text/html,test) [文档](https://example.com/docs)');
  assert.ok(!html.includes('href="javascript:')); assert.ok(!html.includes('href="data:')); assert.ok(html.includes('href="https://example.com/docs"'));
});
