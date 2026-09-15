import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import worker from '../worker/index.js';

class D1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new D1Statement(this.database, this.sql, values);
  }

  first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }

  all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class TestD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((item) => item.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

const origin = 'https://chingtien.github.io';

function makeClient(env) {
  return async function api(method, path, { body, token, requestOrigin = origin } = {}) {
    const headers = { Origin: requestOrigin };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await worker.fetch(new Request(`https://api.example.test/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    const payload = response.status === 204 ? null : await response.json();
    return { response, payload };
  };
}

test('Cloudflare Worker completes the owner and guest flow', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const env = {
    DB: new TestD1Database(sqlite),
    CORS_ORIGIN: origin,
    ADMIN_INITIAL_PASSWORD: 'temporary-admin-password',
  };
  const api = makeClient(env);

  const health = await api('GET', '/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.ok, true);
  assert.equal(health.response.headers.get('Access-Control-Allow-Origin'), origin);

  const forbiddenPreflight = await api('OPTIONS', '/login', { requestOrigin: 'https://attacker.example' });
  assert.equal(forbiddenPreflight.response.status, 403);

  const loggedIn = await api('POST', '/login', {
    body: { username: 'admin', password: 'temporary-admin-password' },
  });
  assert.equal(loggedIn.response.status, 200);
  assert.equal(loggedIn.payload.mustChangePassword, true);
  const initialToken = loggedIn.payload.token;

  const blockedBeforePasswordChange = await api('GET', '/sets', { token: initialToken });
  assert.equal(blockedBeforePasswordChange.response.status, 403);

  const changed = await api('POST', '/change-password', {
    token: initialToken,
    body: { currentPassword: 'temporary-admin-password', newPassword: 'a-new-secure-password' },
  });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.payload.mustChangePassword, false);

  const questions = [
    '我喜歡獨處充電',
    '我會直接說出不同意見',
    '我喜歡事先安排週末',
    '我重視規律的聯絡',
    '我願意認識想法不同的人',
  ].map((text, index) => ({ text, answer: index + 1 }));
  const created = await api('POST', '/sets', {
    token: initialToken,
    body: { title: '認識彼此', questions },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.status, 'draft');

  const published = await api('POST', `/sets/${created.payload.id}/publish`, { token: initialToken });
  assert.equal(published.response.status, 200);
  assert.equal(published.payload.status, 'published');
  assert.ok(published.payload.shareToken.length >= 40);

  const invitation = await api('GET', `/invites/${published.payload.shareToken}`);
  assert.equal(invitation.response.status, 200);
  assert.equal(invitation.payload.completed, false);
  assert.equal('answer' in invitation.payload.questions[0], false);

  const answered = await api('POST', `/invites/${published.payload.shareToken}/submit`, {
    body: { name: '小明', answers: [5, 4, 3, 2, 1] },
  });
  assert.equal(answered.response.status, 200);
  assert.equal(answered.payload.completed, true);
  assert.equal(answered.payload.questions[0].answer, 1);
  assert.equal(answered.payload.questions[0].guestAnswer, 5);

  const duplicate = await api('POST', `/invites/${published.payload.shareToken}/submit`, {
    body: { name: '第二位', answers: [1, 1, 1, 1, 1] },
  });
  assert.equal(duplicate.response.status, 409);

  const ownerResult = await api('GET', `/sets/${created.payload.id}`, { token: initialToken });
  assert.equal(ownerResult.payload.status, 'completed');
  assert.equal(ownerResult.payload.guestName, '小明');

  const loggedOut = await api('POST', '/logout', { token: initialToken });
  assert.equal(loggedOut.response.status, 200);
  const rejectedToken = await api('GET', '/me', { token: initialToken });
  assert.equal(rejectedToken.response.status, 401);

  const newLogin = await api('POST', '/login', {
    body: { username: 'admin', password: 'a-new-secure-password' },
  });
  assert.equal(newLogin.response.status, 200);
  assert.equal(newLogin.payload.mustChangePassword, false);

  sqlite.close();
});
