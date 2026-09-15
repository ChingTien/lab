const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 32_768;
const PASSWORD_ITERATIONS = 310_000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const encoder = new TextEncoder();
const isAnswer = (value) => Number.isInteger(value) && value >= 1 && value <= 5;
const toHex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/.{2}/g) || [], (pair) => Number.parseInt(pair, 16));

function randomHex(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sha256(value) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function passwordHash(password, saltHex) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: fromHex(saltHex),
    iterations: PASSWORD_ITERATIONS,
  }, material, 256);
  return toHex(bits);
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.CORS_ORIGIN || '').split(',').map((item) => item.trim()).filter(Boolean);
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  return headers;
}

function json(request, env, status, body) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request, env) });
}

async function readJson(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY_BYTES) throw new HttpError(413, '送出的資料太大。');
  const text = await request.text();
  if (encoder.encode(text).byteLength > MAX_BODY_BYTES) throw new HttpError(413, '送出的資料太大。');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, '請提供有效的資料。');
  }
}

function validateQuestions(input) {
  if (!Array.isArray(input) || input.length !== 5) throw new HttpError(400, '每一組需要剛好五題。');
  return input.map((item) => {
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    if (!text || text.length > 240) throw new HttpError(400, '請填寫五題，每題不超過 240 字。');
    if (item.answer != null && !isAnswer(item.answer)) throw new HttpError(400, '答案必須是 1 到 5。');
    return { text, answer: item.answer ?? null };
  });
}

async function ensureAdmin(env) {
  let admin = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind('admin').first();
  if (admin) return admin;
  const initialPassword = String(env.ADMIN_INITIAL_PASSWORD || '');
  if (initialPassword.length < 12) throw new HttpError(503, '管理帳號尚未完成設定。');
  const salt = randomHex(16);
  const hash = await passwordHash(initialPassword, salt);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO users (id,username,salt,password_hash,must_change_password)
    VALUES (?,?,?,?,1)
  `).bind(crypto.randomUUID(), 'admin', salt, hash).run();
  admin = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind('admin').first();
  return admin;
}

function parseSubmission(row) {
  if (!row?.answers_json) return null;
  try {
    const answers = JSON.parse(row.answers_json);
    return Array.isArray(answers) && answers.length === 5 && answers.every(isAnswer)
      ? { guestName: row.guest_name, answers }
      : null;
  } catch {
    return null;
  }
}

async function readSet(env, id, userId) {
  const set = await env.DB.prepare('SELECT * FROM sets WHERE id=? AND owner_id=?').bind(id, userId).first();
  if (!set) throw new HttpError(404, '找不到這組題目。');
  const { results: questions } = await env.DB.prepare(`
    SELECT id,position,text,owner_answer FROM questions WHERE set_id=? ORDER BY position
  `).bind(id).all();
  const submission = parseSubmission(await env.DB.prepare('SELECT * FROM submissions WHERE set_id=?').bind(id).first());
  return {
    id: set.id,
    title: set.title,
    status: set.status,
    shareToken: set.share_token,
    guestName: submission?.guestName || null,
    createdAt: set.created_at,
    completedAt: set.completed_at,
    questions: questions.map((question, index) => ({
      id: question.id,
      text: question.text,
      answer: question.owner_answer,
      guestAnswer: submission?.answers[index] ?? null,
    })),
  };
}

async function inviteView(env, token) {
  const set = await env.DB.prepare('SELECT * FROM sets WHERE share_token=?').bind(token).first();
  if (!set || set.status === 'draft') throw new HttpError(404, '邀請連結不存在。');
  const { results: questions } = await env.DB.prepare(`
    SELECT text,owner_answer FROM questions WHERE set_id=? ORDER BY position
  `).bind(set.id).all();
  const submission = parseSubmission(await env.DB.prepare('SELECT * FROM submissions WHERE set_id=?').bind(set.id).first());
  const completed = set.status === 'completed' && Boolean(submission);
  return {
    title: set.title,
    completed,
    guestName: completed ? submission.guestName : null,
    questions: questions.map((question, index) => ({
      text: question.text,
      ...(completed ? { answer: question.owner_answer, guestAnswer: submission.answers[index] } : {}),
    })),
  };
}

async function authenticate(request, env) {
  const match = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
  if (!match) throw new HttpError(401, '請重新登入。');
  const user = await env.DB.prepare(`
    SELECT users.* FROM sessions
    JOIN users ON users.id=sessions.user_id
    WHERE sessions.token_hash=? AND sessions.expires_at>?
  `).bind(await sha256(match[1]), Date.now()).first();
  if (!user) throw new HttpError(401, '請重新登入。');
  return { user, tokenHash: await sha256(match[1]) };
}

async function login(request, env) {
  await ensureAdmin(env);
  const { username, password } = await readJson(request);
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  const attemptKey = await sha256(`${request.headers.get('CF-Connecting-IP') || 'unknown'}:${normalizedUsername}`);
  const attempt = await env.DB.prepare('SELECT * FROM login_attempts WHERE key=?').bind(attemptKey).first();
  if (attempt && attempt.count >= 6 && attempt.reset_at > Date.now()) {
    throw new HttpError(429, '嘗試次數太多，請稍後再試。');
  }
  const user = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(normalizedUsername).first();
  const salt = user?.salt || '0'.repeat(32);
  const derived = await passwordHash(typeof password === 'string' ? password : '', salt);
  if (!user || !safeEqual(derived, user.password_hash)) {
    const reset = !attempt || attempt.reset_at <= Date.now();
    await env.DB.prepare(`
      INSERT INTO login_attempts (key,count,reset_at) VALUES (?,?,?)
      ON CONFLICT(key) DO UPDATE SET count=excluded.count,reset_at=excluded.reset_at
    `).bind(attemptKey, reset ? 1 : attempt.count + 1, reset ? Date.now() + 600_000 : attempt.reset_at).run();
    throw new HttpError(401, '帳號或密碼不正確。');
  }
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE key=?').bind(attemptKey),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(Date.now()),
    env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
      .bind(await sha256(token), user.id, Date.now() + SESSION_MS),
  ]);
  return { token, username: user.username, mustChangePassword: Boolean(user.must_change_password) };
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '') || '/';
  if (request.method === 'GET' && path === '/health') return { ok: true };
  if (request.method === 'POST' && path === '/login') return login(request, env);

  const inviteMatch = path.match(/^\/invites\/([A-Za-z0-9_-]+)(?:\/(submit))?$/);
  if (inviteMatch) {
    const shareToken = inviteMatch[1];
    if (request.method === 'GET' && !inviteMatch[2]) return inviteView(env, shareToken);
    if (request.method === 'POST' && inviteMatch[2] === 'submit') {
      const { name, answers } = await readJson(request);
      if (!Array.isArray(answers) || answers.length !== 5 || !answers.every(isAnswer)) {
        throw new HttpError(400, '請完成五題再送出。');
      }
      const guestName = typeof name === 'string' ? name.trim().slice(0, 40) : '';
      const set = await env.DB.prepare('SELECT id,status FROM sets WHERE share_token=?').bind(shareToken).first();
      if (!set) throw new HttpError(404, '邀請連結不存在。');
      if (set.status !== 'published') throw new HttpError(409, '這份邀請已經有人完成。');
      try {
        await env.DB.batch([
          env.DB.prepare('INSERT INTO submissions (set_id,guest_name,answers_json,created_at) VALUES (?,?,?,?)')
            .bind(set.id, guestName || '受邀者', JSON.stringify(answers), new Date().toISOString()),
          env.DB.prepare("UPDATE sets SET status='completed',completed_at=? WHERE id=? AND status='published'")
            .bind(new Date().toISOString(), set.id),
        ]);
      } catch (error) {
        if (String(error).includes('UNIQUE') || String(error).includes('PRIMARY KEY')) {
          throw new HttpError(409, '這份邀請已經有人完成。');
        }
        throw error;
      }
      return inviteView(env, shareToken);
    }
  }

  const { user, tokenHash } = await authenticate(request, env);
  if (request.method === 'GET' && path === '/me') {
    return { username: user.username, mustChangePassword: Boolean(user.must_change_password) };
  }
  if (request.method === 'POST' && path === '/change-password') {
    const { currentPassword, newPassword } = await readJson(request);
    if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 200) {
      throw new HttpError(400, '新密碼至少需要 12 個字元。');
    }
    const currentHash = await passwordHash(String(currentPassword || ''), user.salt);
    if (!safeEqual(currentHash, user.password_hash)) throw new HttpError(403, '舊密碼不正確。');
    const salt = randomHex(16);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET salt=?,password_hash=?,must_change_password=0 WHERE id=?')
        .bind(salt, await passwordHash(newPassword, salt), user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').bind(user.id, tokenHash),
    ]);
    return { username: user.username, mustChangePassword: false };
  }
  if (request.method === 'POST' && path === '/logout') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash).run();
    return { ok: true };
  }
  if (user.must_change_password) throw new HttpError(403, '請先變更初始密碼。');

  if (request.method === 'GET' && path === '/sets') {
    const { results } = await env.DB.prepare(`
      SELECT sets.id,sets.title,sets.status,sets.share_token,sets.created_at,sets.completed_at,
             submissions.guest_name
      FROM sets LEFT JOIN submissions ON submissions.set_id=sets.id
      WHERE sets.owner_id=? ORDER BY sets.created_at DESC
    `).bind(user.id).all();
    return results.map((set) => ({
      id: set.id, title: set.title, status: set.status, shareToken: set.share_token,
      createdAt: set.created_at, completedAt: set.completed_at, guestName: set.guest_name,
    }));
  }
  if (request.method === 'POST' && path === '/sets') {
    const body = await readJson(request);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 80) throw new HttpError(400, '請為這組題目取一個標題（最多 80 字）。');
    const questions = validateQuestions(body.questions);
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sets (id,owner_id,title,status,created_at) VALUES (?,?,?,'draft',?)")
        .bind(id, user.id, title, new Date().toISOString()),
      ...questions.map((question, position) => env.DB.prepare(`
        INSERT INTO questions (id,set_id,position,text,owner_answer) VALUES (?,?,?,?,?)
      `).bind(crypto.randomUUID(), id, position, question.text, question.answer)),
    ]);
    return readSet(env, id, user.id);
  }

  const setMatch = path.match(/^\/sets\/([a-f0-9-]+)(?:\/(publish))?$/);
  if (setMatch) {
    const id = setMatch[1];
    const current = await readSet(env, id, user.id);
    if (request.method === 'GET' && !setMatch[2]) return current;
    if (current.status !== 'draft') throw new HttpError(409, '發布後的題目不能再修改。');
    if (request.method === 'PUT' && !setMatch[2]) {
      const body = await readJson(request);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title || title.length > 80) throw new HttpError(400, '請填寫標題（最多 80 字）。');
      const questions = validateQuestions(body.questions);
      await env.DB.batch([
        env.DB.prepare("UPDATE sets SET title=? WHERE id=? AND owner_id=? AND status='draft'").bind(title, id, user.id),
        env.DB.prepare('DELETE FROM questions WHERE set_id=?').bind(id),
        ...questions.map((question, position) => env.DB.prepare(`
          INSERT INTO questions (id,set_id,position,text,owner_answer) VALUES (?,?,?,?,?)
        `).bind(crypto.randomUUID(), id, position, question.text, question.answer)),
      ]);
      return readSet(env, id, user.id);
    }
    if (request.method === 'POST' && setMatch[2] === 'publish') {
      if (current.questions.some((question) => !isAnswer(question.answer))) {
        throw new HttpError(400, '自己先完成五題，才能發布邀請。');
      }
      const shareToken = randomToken();
      const result = await env.DB.prepare(`
        UPDATE sets SET status='published',share_token=? WHERE id=? AND owner_id=? AND status='draft'
      `).bind(shareToken, id, user.id).run();
      if (!result.meta?.changes) throw new HttpError(409, '題目狀態已經改變，請重新整理。');
      return readSet(env, id, user.id);
    }
  }
  throw new HttpError(404, '找不到此功能。');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigins = String(env.CORS_ORIGIN || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (request.method === 'OPTIONS') {
      if (origin && !allowedOrigins.includes(origin)) return json(request, env, 403, { error: '不允許的來源。' });
      const headers = corsHeaders(request, env);
      headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
      headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, OPTIONS';
      headers['Access-Control-Max-Age'] = '86400';
      delete headers['Content-Type'];
      return new Response(null, { status: 204, headers });
    }
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) throw new HttpError(404, '找不到此功能。');
      const data = await handleApi(request, env);
      const status = request.method === 'POST' && url.pathname === '/api/sets' ? 201 : 200;
      return json(request, env, status, data);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Request failed', error);
      return json(request, env, error instanceof HttpError ? error.status : 500, {
        error: error instanceof HttpError ? error.message : '服務暫時無法使用。',
      });
    }
  },
};
