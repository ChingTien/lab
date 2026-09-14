import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY = 32_768;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const digest = (token) => createHash('sha256').update(token).digest('hex');
const passwordHash = (password, salt) => scryptSync(password, salt, 64).toString('hex');
const isAnswer = (value) => Number.isInteger(value) && value >= 1 && value <= 5;

function validateQuestions(input) {
  if (!Array.isArray(input) || input.length !== 5) throw new HttpError(400, '每一組需要剛好五題。');
  return input.map((item) => {
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    if (!text || text.length > 240) throw new HttpError(400, '請填寫五題，每題不超過 240 字。');
    if (item.answer != null && !isAnswer(item.answer)) throw new HttpError(400, '答案必須是 1 到 5。');
    return { text, answer: item.answer ?? null };
  });
}

function openDatabase(dbPath, adminPassword) {
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL,
      password_hash TEXT NOT NULL, must_change_password INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sets (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published','completed')),
      share_token TEXT UNIQUE, guest_name TEXT, created_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY, set_id TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, text TEXT NOT NULL,
      owner_answer INTEGER, guest_answer INTEGER,
      UNIQUE(set_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_sets_owner ON sets(owner_id, created_at);
  `);
  if (!db.prepare('SELECT id FROM users WHERE username=?').get('admin')) {
    if (!adminPassword) throw new Error('Set ADMIN_INITIAL_PASSWORD before starting the API.');
    if (process.env.NODE_ENV === 'production' && adminPassword.length < 12) {
      throw new Error('A new production admin password must be at least 12 characters.');
    }
    const salt = randomBytes(16).toString('hex');
    db.prepare('INSERT INTO users (id,username,salt,password_hash) VALUES (?,?,?,?)')
      .run(randomUUID(), 'admin', salt, passwordHash(adminPassword, salt));
  }
  return db;
}

function withTransaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function readSet(db, id, userId) {
  const set = db.prepare('SELECT * FROM sets WHERE id=? AND owner_id=?').get(id, userId);
  if (!set) throw new HttpError(404, '找不到這組題目。');
  const questions = db.prepare('SELECT id,position,text,owner_answer,guest_answer FROM questions WHERE set_id=? ORDER BY position').all(id);
  return {
    id: set.id, title: set.title, status: set.status, shareToken: set.share_token,
    guestName: set.guest_name, createdAt: set.created_at, completedAt: set.completed_at,
    questions: questions.map((q) => ({ id: q.id, text: q.text, answer: q.owner_answer, guestAnswer: q.guest_answer })),
  };
}

function inviteView(db, token) {
  const set = db.prepare('SELECT * FROM sets WHERE share_token=?').get(token);
  if (!set || set.status === 'draft') throw new HttpError(404, '邀請連結不存在。');
  const completed = set.status === 'completed';
  const questions = db.prepare('SELECT text,owner_answer,guest_answer FROM questions WHERE set_id=? ORDER BY position').all(set.id);
  return {
    title: set.title, completed, guestName: completed ? set.guest_name : null,
    questions: questions.map((q) => ({
      text: q.text,
      ...(completed ? { answer: q.owner_answer, guestAnswer: q.guest_answer } : {}),
    })),
  };
}

function requestJson(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let length = 0;
    req.on('data', (chunk) => {
      length += chunk.length;
      if (length > MAX_BODY) {
        reject(new HttpError(413, '送出的資料太大。'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, '請提供有效的 JSON。')); }
    });
    req.on('error', reject);
  });
}

export function createApp({
  dbPath = process.env.DB_PATH || './data/value-dialogue.db',
  adminPassword = process.env.ADMIN_INITIAL_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : '1234'),
  corsOrigin = process.env.CORS_ORIGIN || '',
} = {}) {
  const db = openDatabase(dbPath, adminPassword);
  const attempts = new Map();

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && origin === corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };

    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (req.method === 'OPTIONS') return res.writeHead(204).end();
      if (!path.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '不支援此操作。');
        const target = resolve(dist, '.' + decodeURIComponent(path));
        if (target !== dist && !target.startsWith(dist + sep)) throw new HttpError(404, '找不到頁面。');
        const file = (await stat(target).catch(() => null))?.isFile() ? target : join(dist, 'index.html');
        const data = await readFile(file);
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
        res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
        return res.end(req.method === 'HEAD' ? undefined : data);
      }
      if (req.method === 'GET' && path === '/api/health') return send(200, { ok: true });

      if (req.method === 'POST' && path === '/api/login') {
        const { username, password } = await requestJson(req);
        const key = `${req.socket.remoteAddress || ''}:${String(username || '')}`;
        const record = attempts.get(key) || { count: 0, reset: 0 };
        if (Date.now() < record.reset && record.count >= 6) throw new HttpError(429, '嘗試次數太多，請稍後再試。');
        const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
        const derived = passwordHash(typeof password === 'string' ? password : '', user?.salt || '0'.repeat(32));
        const valid = user && timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(user.password_hash, 'hex'));
        if (!valid) {
          attempts.set(key, { count: Date.now() > record.reset ? 1 : record.count + 1, reset: Date.now() > record.reset ? Date.now() + 600_000 : record.reset });
          throw new HttpError(401, '帳號或密碼不正確。');
        }
        attempts.delete(key);
        const token = randomBytes(32).toString('base64url');
        db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
          .run(digest(token), user.id, Date.now() + SESSION_MS);
        return send(200, { token, username: user.username, mustChangePassword: !!user.must_change_password });
      }

      const inviteMatch = path.match(/^\/api\/invites\/([A-Za-z0-9_-]+)(?:\/(submit))?$/);
      if (inviteMatch) {
        const token = inviteMatch[1];
        if (req.method === 'GET' && !inviteMatch[2]) return send(200, inviteView(db, token));
        if (req.method === 'POST' && inviteMatch[2] === 'submit') {
          const { name, answers } = await requestJson(req);
          if (!Array.isArray(answers) || answers.length !== 5 || !answers.every(isAnswer)) throw new HttpError(400, '請完成五題再送出。');
          const guestName = typeof name === 'string' ? name.trim().slice(0, 40) : '';
          withTransaction(db, () => {
            const set = db.prepare('SELECT id,status FROM sets WHERE share_token=?').get(token);
            if (!set) throw new HttpError(404, '邀請連結不存在。');
            if (set.status === 'completed') throw new HttpError(409, '這份邀請已經有人完成。');
            const questions = db.prepare('SELECT id FROM questions WHERE set_id=? ORDER BY position').all(set.id);
            questions.forEach((q, index) => db.prepare('UPDATE questions SET guest_answer=? WHERE id=?').run(answers[index], q.id));
            db.prepare("UPDATE sets SET guest_name=?,status='completed',completed_at=? WHERE id=?")
              .run(guestName || '受邀者', new Date().toISOString(), set.id);
          });
          return send(200, inviteView(db, token));
        }
      }

      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      const tokenHash = bearer ? digest(bearer[1]) : '';
      const user = db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?')
        .get(tokenHash, Date.now());
      if (!user) throw new HttpError(401, '請重新登入。');
      if (req.method === 'GET' && path === '/api/me') return send(200, { username: user.username, mustChangePassword: !!user.must_change_password });

      if (req.method === 'POST' && path === '/api/change-password') {
        const { currentPassword, newPassword } = await requestJson(req);
        if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 200) {
          throw new HttpError(400, '新密碼至少需要 12 個字元。');
        }
        const oldHash = passwordHash(String(currentPassword || ''), user.salt);
        if (!timingSafeEqual(Buffer.from(oldHash, 'hex'), Buffer.from(user.password_hash, 'hex'))) throw new HttpError(403, '舊密碼不正確。');
        const salt = randomBytes(16).toString('hex');
        db.prepare('UPDATE users SET salt=?,password_hash=?,must_change_password=0 WHERE id=?')
          .run(salt, passwordHash(newPassword, salt), user.id);
        db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(user.id, tokenHash);
        return send(200, { username: user.username, mustChangePassword: false });
      }
      if (req.method === 'POST' && path === '/api/logout') {
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
        return send(200, { ok: true });
      }
      if (user.must_change_password) throw new HttpError(403, '請先變更初始密碼。');

      if (req.method === 'GET' && path === '/api/sets') {
        const sets = db.prepare('SELECT id,title,status,share_token,created_at,completed_at,guest_name FROM sets WHERE owner_id=? ORDER BY created_at DESC').all(user.id);
        return send(200, sets.map((s) => ({ id: s.id, title: s.title, status: s.status, shareToken: s.share_token, createdAt: s.created_at, completedAt: s.completed_at, guestName: s.guest_name })));
      }
      if (req.method === 'POST' && path === '/api/sets') {
        const body = await requestJson(req);
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        if (!title || title.length > 80) throw new HttpError(400, '請為這組題目取一個標題（最多 80 字）。');
        const questions = validateQuestions(body.questions);
        const id = randomUUID();
        withTransaction(db, () => {
          db.prepare("INSERT INTO sets (id,owner_id,title,status,created_at) VALUES (?,?,?,'draft',?)")
            .run(id, user.id, title, new Date().toISOString());
          questions.forEach((q, pos) => db.prepare('INSERT INTO questions (id,set_id,position,text,owner_answer) VALUES (?,?,?,?,?)')
            .run(randomUUID(), id, pos, q.text, q.answer));
        });
        return send(201, readSet(db, id, user.id));
      }
      const setMatch = path.match(/^\/api\/sets\/([a-f0-9-]+)(?:\/(publish))?$/);
      if (setMatch) {
        const id = setMatch[1];
        const current = readSet(db, id, user.id);
        if (req.method === 'GET' && !setMatch[2]) return send(200, current);
        if (current.status !== 'draft') throw new HttpError(409, '發布後的題目不能再修改。');
        if (req.method === 'PUT' && !setMatch[2]) {
          const body = await requestJson(req);
          const title = typeof body.title === 'string' ? body.title.trim() : '';
          if (!title || title.length > 80) throw new HttpError(400, '請填寫標題（最多 80 字）。');
          const questions = validateQuestions(body.questions);
          withTransaction(db, () => {
            db.prepare('UPDATE sets SET title=? WHERE id=?').run(title, id);
            db.prepare('DELETE FROM questions WHERE set_id=?').run(id);
            questions.forEach((q, pos) => db.prepare('INSERT INTO questions (id,set_id,position,text,owner_answer) VALUES (?,?,?,?,?)')
              .run(randomUUID(), id, pos, q.text, q.answer));
          });
          return send(200, readSet(db, id, user.id));
        }
        if (req.method === 'POST' && setMatch[2] === 'publish') {
          if (current.questions.some((q) => !isAnswer(q.answer))) throw new HttpError(400, '自己先完成五題，才能發布邀請。');
          db.prepare("UPDATE sets SET status='published',share_token=? WHERE id=?")
            .run(randomBytes(32).toString('base64url'), id);
          return send(200, readSet(db, id, user.id));
        }
      }
      throw new HttpError(404, '找不到此功能。');
    } catch (error) {
      if (res.destroyed) return;
      if (!(error instanceof HttpError)) console.error('Request error:', error);
      send(error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : '服務暫時無法使用。' });
    }
  });
  server.on('close', () => db.close());
  return server;
}
