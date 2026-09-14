import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

test('one author and one invitee complete a five-question conversation', async () => {
  const server = createApp({ dbPath: ':memory:', adminPassword: '1234' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}/api`;
  let token;
  async function call(path, { method = 'GET', body, auth = true } = {}) {
    const response = await fetch(root + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }
  try {
    assert.equal((await call('/sets')).status, 401);
    const login = await call('/login', { method: 'POST', auth: false, body: { username: 'admin', password: '1234' } });
    assert.equal(login.status, 200);
    assert.equal(login.data.mustChangePassword, true);
    token = login.data.token;
    assert.equal((await call('/sets')).status, 403);
    assert.equal((await call('/change-password', { method: 'POST', body: { currentPassword: '1234', newPassword: 'my-strong-password-2026' } })).status, 200);

    const questions = Array.from({ length: 5 }, (_, i) => ({ text: `我喜歡做第 ${i + 1} 件事`, answer: i + 1 }));
    const draft = await call('/sets', { method: 'POST', body: { title: '聊聊價值觀', questions } });
    assert.equal(draft.status, 201);
    assert.equal(draft.data.status, 'draft');
    const id = draft.data.id;
    const publish = await call(`/sets/${id}/publish`, { method: 'POST' });
    assert.equal(publish.status, 200);
    const invite = publish.data.shareToken;
    assert.ok(invite.length >= 40);
    const before = await call(`/invites/${invite}`, { auth: false });
    assert.equal(before.status, 200);
    assert.equal(before.data.completed, false);
    assert.equal(JSON.stringify(before.data).includes('owner_answer'), false);
    assert.equal(JSON.stringify(before.data).includes('"answer"'), false);

    const submit = await call(`/invites/${invite}/submit`, {
      method: 'POST', auth: false, body: { name: '朋友', answers: [1, 2, 3, 4, 5] },
    });
    assert.equal(submit.status, 200);
    assert.equal(submit.data.completed, true);
    assert.equal(submit.data.questions[0].answer, 1);
    assert.equal(submit.data.questions[0].guestAnswer, 1);
    assert.equal((await call(`/invites/${invite}/submit`, { method: 'POST', auth: false, body: { answers: [1, 2, 3, 4, 5] } })).status, 409);
    assert.equal((await call(`/sets/${id}`)).data.status, 'completed');
    assert.equal((await call(`/sets/${id}`, { method: 'PUT', body: { title: '改掉', questions } })).status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
