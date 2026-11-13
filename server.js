import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const seed = [
  ['Start with a problem, not a feature', 'start-with-a-problem', 'Discovery', 'A small observation can become a useful first product.', 'Keep a notebook of small frustrations around you. Pick one person affected by a problem, then ask how they handle it today.\n\nBefore writing code, describe the smallest change that would make their day easier. Test that idea with a sketch and a conversation.', 'published'],
  ['Your first prototype only needs one job', 'first-prototype', 'Building', 'Make one useful action work before adding everything else.', 'Choose the single action that proves your idea is useful. A prototype can be a screen, a form, or a simple working flow.\n\nAsk someone to try it without explaining the interface. Watch where they hesitate. Improve that moment before adding another feature.', 'published'],
  ['A launch is the start of a conversation', 'launch-and-listen', 'Launch', 'Share with a few real people, listen carefully, and iterate.', 'Write a short invitation that explains who your product helps and what it does. Share it with a small, relevant group.\n\nAsk what worked, what was confusing, and whether they would use it again. Keep a short list of improvements and choose one to make next.', 'published']
];

export function createApp({ dbPath = join(root, 'data/blog.sqlite'), editorKey = process.env.EDITOR_KEY || 'local-demo-only' } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL, excerpt TEXT NOT NULL, body TEXT NOT NULL,
      author TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS posts_status_updated ON posts(status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY) STRICT;`);
  if (!db.prepare('SELECT version FROM migrations WHERE version=1').get()) {
    db.exec('BEGIN');
    try {
      const insert = db.prepare('INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?,?)');
      const now = new Date().toISOString();
      for (const [title, slug, category, excerpt, body, status] of seed) insert.run(randomUUID(), title, slug, category, excerpt, body, 'Builder Lab · demo article', status, now, now);
      db.exec('INSERT INTO migrations VALUES (1); COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
  ]);
  function authorized(req) {
    const actual = Buffer.from(req.headers['x-editor-key'] || '');
    const expected = Buffer.from(editorKey);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
  function requireEditor(req) {
    if (!authorized(req)) fail(401, 'Editor key required.');
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) fail(403, 'Cross-origin writes are not allowed.');
  }
  async function readJson(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Use application/json.');
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 65536) fail(413, 'Request exceeds 64 KB.'); chunks.push(chunk); }
    try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (!value || Array.isArray(value) || typeof value !== 'object') fail(400, 'Expected a JSON object.'); return value; }
    catch (error) { if (error.status) throw error; fail(400, 'Invalid JSON.'); }
  }
  function validate(input, previous = {}) {
    const allowed = ['title', 'slug', 'category', 'excerpt', 'body', 'author', 'status'];
    if (Object.keys(input).some(key => !allowed.includes(key))) fail(422, 'Unknown post field.');
    const post = { ...previous, ...input };
    for (const [key, max] of Object.entries({ title: 160, slug: 180, category: 60, excerpt: 300, body: 30000, author: 100 })) {
      if (typeof post[key] !== 'string' || !post[key].trim() || post[key].length > max) fail(422, `${key} is required and must be at most ${max} characters.`);
      post[key] = post[key].trim();
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)) fail(422, 'Slug must use lowercase letters, numbers and single hyphens.');
    if (!['draft', 'published'].includes(post.status)) fail(422, 'Status must be draft or published.');
    return post;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    function json(status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/health') return json(200, { ok: true, storage: 'SQLite' });
      if (url.pathname === '/api/posts' && req.method === 'GET') {
        const all = url.searchParams.get('all') === '1';
        if (all) requireEditor(req);
        const limit = Number(url.searchParams.get('limit') ?? 12);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0) fail(400, 'Invalid pagination.');
        const search = (url.searchParams.get('q') || '').trim().slice(0, 160);
        const where = `WHERE (?=1 OR status='published') AND (instr(lower(title),lower(?))>0 OR instr(lower(body),lower(?))>0)`;
        const total = db.prepare(`SELECT count(*) AS total FROM posts ${where}`).get(Number(all), search, search).total;
        const posts = db.prepare(`SELECT * FROM posts ${where} ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`).all(Number(all), search, search, limit, offset);
        return json(200, { posts, total, limit, offset });
      }
      if (url.pathname === '/api/posts' && req.method === 'POST') {
        requireEditor(req); const post = validate(await readJson(req));
        const id = randomUUID(), now = new Date().toISOString();
        db.prepare('INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, post.title, post.slug, post.category, post.excerpt, post.body, post.author, post.status, now, now);
        return json(201, db.prepare('SELECT * FROM posts WHERE id=?').get(id));
      }
      const match = url.pathname.match(/^\/api\/posts\/([a-zA-Z0-9-]+)$/);
      if (match) {
        const post = db.prepare('SELECT * FROM posts WHERE id=?').get(match[1]);
        if (!post || (req.method === 'GET' && post.status === 'draft' && !authorized(req))) fail(404, 'Post not found.');
        if (req.method === 'GET') return json(200, post);
        requireEditor(req);
        if (req.method === 'PATCH') {
          const p = validate(await readJson(req), post);
          db.prepare('UPDATE posts SET title=?,slug=?,category=?,excerpt=?,body=?,author=?,status=?,updated_at=? WHERE id=?').run(p.title, p.slug, p.category, p.excerpt, p.body, p.author, p.status, new Date().toISOString(), post.id);
          return json(200, db.prepare('SELECT * FROM posts WHERE id=?').get(post.id));
        }
        if (req.method === 'DELETE') { db.prepare('DELETE FROM posts WHERE id=?').run(post.id); res.writeHead(204); return res.end(); }
        fail(405, 'Method not allowed.');
      }
      if (assets.has(url.pathname) && (req.method === 'GET' || req.method === 'HEAD')) {
        const [file, mime] = assets.get(url.pathname); res.writeHead(200, { 'Content-Type': mime }); return res.end(req.method === 'HEAD' ? undefined : readFileSync(join(root, 'public', file)));
      }
      fail(404, 'Not found.');
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) return json(409, { error: 'That slug is already used. Choose a different slug.' });
      json(error.status || 500, { error: error.status ? error.message : 'Unexpected server error.' });
    }
  });
  return { server, close: () => db.close() };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = createApp();
  const port = Number(process.env.PORT || 4318);
  app.server.listen(port, '127.0.0.1', () => console.log(`Builder Lab ready at http://127.0.0.1:${port}`));
  const shutdown = () => app.server.close(() => { app.close(); process.exit(0); });
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
