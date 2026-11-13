import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

const key = 'test-editor-key';
const post = { title: 'Testing a first idea', slug: 'testing-first-idea', category: 'Discovery', excerpt: 'Start with one useful question.', body: 'Talk to a potential user. Then build a small prototype.', author: 'Test author', status: 'draft' };
async function run(dbPath = ':memory:') { const app = createApp({ dbPath, editorKey: key }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${app.server.address().port}`; return { ...app, base, stop: async () => { await new Promise(resolve => app.server.close(resolve)); app.close(); } }; }
function request(base, path, method = 'GET', body, auth = true, extraHeaders = {}) { return fetch(base + path, { method, headers: { ...(auth ? { 'X-Editor-Key': key } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) }); }

test('post lifecycle, draft privacy, search, duplicate slug, update and delete', async () => {
  const app = await run();
  try {
    let res = await request(app.base, '/api/posts', 'POST', post); assert.equal(res.status, 201); const saved = await res.json();
    assert.equal((await request(app.base, `/api/posts/${saved.id}`, 'GET', undefined, false)).status, 404);
    const publicPosts = await (await request(app.base, '/api/posts', 'GET', undefined, false)).json(); assert.ok(!publicPosts.posts.some(p => p.id === saved.id));
    assert.equal((await request(app.base, '/api/posts', 'POST', post)).status, 409);
    res = await request(app.base, `/api/posts/${saved.id}`, 'PATCH', { status: 'published', title: 'A published discovery' }); assert.equal(res.status, 200);
    const result = await (await request(app.base, '/api/posts?q=published&limit=1&offset=0', 'GET', undefined, false)).json(); assert.equal(result.total, 1); assert.equal(result.posts[0].id, saved.id);
    assert.equal((await request(app.base, `/api/posts/${saved.id}`, 'GET', undefined, false)).status, 200);
    assert.equal((await request(app.base, `/api/posts/${saved.id}`, 'DELETE')).status, 204);
    assert.equal((await request(app.base, `/api/posts/${saved.id}`)).status, 404);
  } finally { await app.stop(); }
});

test('rejects unauthenticated writes, cross-origin writes, bad inputs and pagination', async () => {
  const app = await run();
  try {
    assert.equal((await request(app.base, '/api/posts', 'POST', post, false)).status, 401);
    assert.equal((await request(app.base, '/api/posts?all=1', 'GET', undefined, false)).status, 401);
    assert.equal((await request(app.base, '/api/posts', 'POST', post, true, { Origin: 'https://example.org' })).status, 403);
    for (const invalid of [{ ...post, title: '' }, { ...post, slug: '../path' }, { ...post, body: 'a'.repeat(30001) }, { ...post, status: 'invalid' }, { ...post, id: 'injected' }]) assert.equal((await request(app.base, '/api/posts', 'POST', invalid)).status, 422);
    for (const query of ['limit=0', 'limit=51', 'offset=-1', 'offset=abc']) assert.equal((await request(app.base, `/api/posts?${query}`)).status, 400);
    const malformed = await fetch(app.base + '/api/posts', { method: 'POST', headers: { 'X-Editor-Key': key, 'Content-Type': 'application/json' }, body: '{broken' }); assert.equal(malformed.status, 400);
    assert.equal((await request(app.base, '/api/posts', 'POST', { ...post, body: 'a'.repeat(70000) })).status, 413);
    assert.equal((await fetch(app.base + '/server.js')).status, 404);
    assert.equal((await fetch(app.base + '/')).headers.get('x-content-type-options'), 'nosniff');
  } finally { await app.stop(); }
});

test('treats markup and SQL-like text as plain content; persists changes across restarts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'builder-lab-test-')); const path = join(directory, 'blog.sqlite'); let app;
  try {
    app = await run(path); const payload = { ...post, title: "<script>alert(1)</script> '); DROP TABLE posts;--" };
    const saved = await (await request(app.base, '/api/posts', 'POST', payload)).json(); await app.stop(); app = null;
    app = await run(path); const loaded = await (await request(app.base, `/api/posts/${saved.id}`)).json(); assert.equal(loaded.title, payload.title);
    const list = await (await request(app.base, '/api/posts?all=1')).json(); assert.equal(list.total, 4);
  } finally { if (app) await app.stop(); rmSync(directory, { recursive: true, force: true }); }
});
