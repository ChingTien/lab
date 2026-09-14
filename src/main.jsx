import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const choices = [
  { value: 5, label: '非常同意' },
  { value: 4, label: '同意' },
  { value: 3, label: '沒意見' },
  { value: 2, label: '不同意' },
  { value: 1, label: '非常不同意' },
];
const labelOf = (value) => choices.find((item) => item.value === value)?.label || '尚未作答';
const exampleQuestions = [
  '我喜歡獨處來恢復精神。',
  '做重要決定前，我會先和在乎的人討論。',
  '遇到衝突時，我希望當天就把話說開。',
  '我願意為了新體驗改變原本的計畫。',
  '在關係裡，保有各自的空間對我很重要。',
];
const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function api(path, { token, ...options } = {}) {
  let response;
  try {
    response = await fetch(`${apiBase}/api${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new Error('無法連線到伺服器。請確認後端服務已啟動。');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || '伺服器尚未連接，請先完成後端設定。');
  return data;
}

const blankQuestions = () => Array.from({ length: 5 }, () => ({ text: '', answer: null }));
const inviteUrl = (shareToken) => `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(shareToken)}`;

function Brand({ small = false }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-mark" aria-hidden="true">◒</span><span>好好聊<span className="brand-dot">.</span></span></div>;
}

function App() {
  const invite = new URLSearchParams(window.location.search).get('invite');
  const [token, setToken] = useState(() => window.localStorage.getItem('dialogue_token') || '');
  const [profile, setProfile] = useState(null);
  const [checking, setChecking] = useState(Boolean(token));

  useEffect(() => {
    if (!token || invite) return;
    api('/me', { token }).then(setProfile).catch(() => {
      window.localStorage.removeItem('dialogue_token');
      setToken('');
    }).finally(() => setChecking(false));
  }, [token, invite]);

  if (invite) return <InvitePage invite={invite} />;
  if (checking) return <div className="center-message">正在開啟你的對話…</div>;
  if (!token || !profile) return <LoginPage onLogin={(data) => {
    window.localStorage.setItem('dialogue_token', data.token);
    setToken(data.token);
    setProfile(data);
  }} />;
  if (profile.mustChangePassword) return <PasswordPage token={token} onChange={setProfile} />;
  return <Dashboard token={token} onLogout={() => {
    api('/logout', { token, method: 'POST' }).catch(() => {});
    window.localStorage.removeItem('dialogue_token');
    setToken(''); setProfile(null);
  }} />;
}

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try { onLogin(await api('/login', { method: 'POST', body: JSON.stringify({ username, password }) })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="login-layout">
    <section className="login-story">
      <Brand />
      <div className="login-intro">
        <p className="eyebrow">A SPACE FOR TWO</p>
        <h1>答案不同，<br /><em>對話才剛開始。</em></h1>
        <p>挑五個想聊的問題。先寫下自己的答案，再邀請一個人一起對答案。</p>
        <div className="sample-question"><span>一起聊聊 · 01 / 05</span><strong>我喜歡獨處來恢復精神。</strong><div className="sample-options"><i /><i /><i /><i /><i /></div></div>
      </div>
      <span className="login-footer">五題 · 兩個人 · 一場有意思的對話</span>
    </section>
    <section className="login-form-wrap">
      <div className="login-form-card">
        <span className="form-kicker">歡迎回來</span>
        <h2>登入後，開始提問。</h2>
        <p className="muted">你的問題與結果都會保存在這裡。</p>
        <form onSubmit={submit}>
          <label className="field">帳號<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
          <label className="field">密碼<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="button button-dark button-wide" disabled={busy}>{busy ? '登入中…' : '登入 →'}</button>
        </form>
        <p className="login-note">首版只有一個提問帳號；收到分享連結的人不需要登入。</p>
      </div>
    </section>
  </main>;
}

function PasswordPage({ token, onChange }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { onChange(await api('/change-password', { token, method: 'POST', body: JSON.stringify({ currentPassword: oldPassword, newPassword }) })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="single-panel"><Brand /><div className="single-card"><p className="eyebrow">第一次登入</p><h1>先換一組只有你知道的密碼。</h1><p className="muted">更新後，就可以開始建立你的五題。</p><form onSubmit={submit}><label className="field">目前的密碼<input type="password" autoComplete="current-password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} required /></label><label className="field">新密碼（至少 12 個字元）<input type="password" autoComplete="new-password" minLength="12" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /></label>{error && <p className="error" role="alert">{error}</p>}<button className="button button-dark button-wide" disabled={busy}>儲存新密碼 →</button></form></div></main>;
}

function Dashboard({ token, onLogout }) {
  const [sets, setSets] = useState([]);
  const [view, setView] = useState('home');
  const [active, setActive] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setSets(await api('/sets', { token })); }
    catch (err) { setError(err.message); }
  }
  useEffect(() => { refresh(); }, [token]);
  useEffect(() => {
    if (view !== 'detail' || !active || active.status !== 'published') return;
    const timer = window.setInterval(async () => {
      try {
        const next = await api(`/sets/${active.id}`, { token });
        if (next.status !== active.status) { setActive(next); refresh(); }
      } catch { /* Keep the current view if a background refresh fails. */ }
    }, 8000);
    return () => window.clearInterval(timer);
  }, [view, active?.id, active?.status, token]);

  async function openSet(id) {
    setBusy(true); setError('');
    try { setActive(await api(`/sets/${id}`, { token })); setView('detail'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function saveDraft(form, publish, id) {
    setBusy(true); setError('');
    try {
      let next = await api(id ? `/sets/${id}` : '/sets', {
        token, method: id ? 'PUT' : 'POST', body: JSON.stringify(form),
      });
      if (publish) next = await api(`/sets/${next.id}/publish`, { token, method: 'POST' });
      setActive(next); setView('detail'); await refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function publishDraft() {
    setBusy(true); setError('');
    try { const next = await api(`/sets/${active.id}/publish`, { token, method: 'POST' }); setActive(next); await refresh(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const done = sets.filter((s) => s.status === 'completed').length;
  return <div className="app-shell">
    <aside className="sidebar">
      <Brand small />
      <p className="sidebar-label">你的空間</p>
      <button className={`sidebar-link ${view === 'home' ? 'is-active' : ''}`} onClick={() => { setView('home'); setError(''); }}>所有對話 <span>{sets.length}</span></button>
      <button className="sidebar-link" onClick={() => { setActive(null); setView('new'); setError(''); }}>新增五題 <span>＋</span></button>
      <div className="sidebar-bottom"><span className="avatar">A</span><span>admin<small>提問者</small></span><button className="logout" onClick={onLogout}>登出</button></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><span>我的對話空間</span><span className="topbar-right">兩個人，從五題開始 <span className="topbar-mark">✳</span></span></header>
      <div className="main-content">
        {error && <p className="error banner-error" role="alert">{error}</p>}
        {view === 'home' && <>
          <div className="page-heading"><div><p className="eyebrow">YOUR CONVERSATIONS</p><h1>想聊的話，從這裡開始。</h1><p className="muted">把好奇寫成問題，留一個空間給彼此的答案。</p></div><button className="button button-dark" onClick={() => setView('new')}>＋　建立五題</button></div>
          <div className="stats"><div><span>已建立</span><strong>{String(sets.length).padStart(2, '0')}</strong></div><div><span>等待對方</span><strong>{String(sets.filter((s) => s.status === 'published').length).padStart(2, '0')}</strong></div><div><span>已完成</span><strong>{String(done).padStart(2, '0')}</strong></div></div>
          <div className="section-head"><h2>我的題目</h2><span>一次邀請一個人</span></div>
          {sets.length ? <div className="set-list">{sets.map((set, index) => <button className="set-row" key={set.id} onClick={() => openSet(set.id)} disabled={busy}><span className="set-number">{String(sets.length - index).padStart(2, '0')}</span><span className="set-title"><strong>{set.title}</strong><small>{new Date(set.createdAt).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })} · 五個問題</small></span><Status status={set.status} /><span className="set-arrow">↗</span></button>)}</div> : <div className="empty-state"><span className="empty-symbol">✳</span><h3>還沒有題目。</h3><p>寫下你一直想問、但還沒找到機會聊的五件事。</p><button className="button button-outline" onClick={() => setView('new')}>開始建立 →</button></div>}
        </>}
        {(view === 'new' || view === 'edit') && <Editor initial={view === 'edit' ? active : null} onBack={() => setView(active ? 'detail' : 'home')} onSave={(form, publish) => saveDraft(form, publish, view === 'edit' ? active.id : null)} busy={busy} />}
        {view === 'detail' && active && <Detail set={active} onBack={() => { setView('home'); refresh(); }} onEdit={() => setView('edit')} onPublish={publishDraft} busy={busy} />}
      </div>
    </main>
  </div>;
}

function Status({ status }) {
  const text = { draft: '草稿', published: '等待填答', completed: '已完成' }[status];
  return <span className={`status status-${status}`}>● {text}</span>;
}

function ChoiceGroup({ value, onChange, group }) {
  return <div className="choice-group" role="group" aria-label="同意程度">
    {choices.map((choice) => <label className={`choice ${value === choice.value ? 'choice-selected' : ''}`} key={choice.value}>
      <input type="radio" name={group} value={choice.value} checked={value === choice.value} onChange={() => onChange(choice.value)} />
      <span>{choice.label}</span>
    </label>)}
  </div>;
}

function Editor({ initial, onBack, onSave, busy }) {
  const [title, setTitle] = useState(initial?.title || '我們的五個問題');
  const [questions, setQuestions] = useState(initial?.questions.map(({ text, answer }) => ({ text, answer })) || blankQuestions());
  const [validation, setValidation] = useState('');
  const update = (index, patch) => setQuestions((prev) => prev.map((q, position) => position === index ? { ...q, ...patch } : q));
  function save(publish) {
    if (!title.trim() || questions.some((q) => !q.text.trim())) { setValidation('請先填好標題和五個問題。'); return; }
    if (publish && questions.some((q) => !q.answer)) { setValidation('發布前，也請完成自己的五題。'); return; }
    setValidation(''); onSave({ title, questions }, publish);
  }
  return <div className="editor-page">
    <button className="back-link" onClick={onBack}>← 返回</button>
    <div className="page-heading editor-heading"><div><p className="eyebrow">CREATE A CONVERSATION</p><h1>{initial ? '編輯這五題' : '先寫下你想聊的五題。'}</h1><p className="muted">寫成「我……」的句子，彼此更容易用同一把尺回答。</p></div><span className="step-tag">01　寫題目　／　02　邀請　／　03　對答案</span></div>
    <div className="editor-card"><label className="field title-field">這組題目的名稱<input value={title} maxLength="80" onChange={(event) => setTitle(event.target.value)} placeholder="例如：我們如何看待生活" /></label><div className="divider" />
      {questions.map((question, index) => <div className="question-editor" key={index}>
        <div className="question-index">{String(index + 1).padStart(2, '0')}<span>／ 05</span></div>
        <div className="question-body"><label className="field">想問的問題<input value={question.text} maxLength="240" onChange={(e) => update(index, { text: e.target.value })} placeholder={exampleQuestions[index]} /></label><p className="answer-hint">你的答案 <span>完成後才會對受邀者顯示</span></p><ChoiceGroup group={`owner-${index}`} value={question.answer} onChange={(answer) => update(index, { answer })} /></div>
      </div>)}
    </div>
    {validation && <p className="error" role="alert">{validation}</p>}
    <div className="editor-actions"><button className="button button-outline" onClick={() => save(false)} disabled={busy}>{busy ? '儲存中…' : '儲存草稿'}</button><button className="button button-dark" onClick={() => save(true)} disabled={busy}>{busy ? '發布中…' : '完成並發布 →'}</button></div>
  </div>;
}

function Detail({ set, onBack, onEdit, onPublish, busy }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(inviteUrl(set.shareToken)); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
    catch { setCopied(false); }
  }
  return <div className="detail-page"><button className="back-link" onClick={onBack}>← 所有對話</button><div className="page-heading"><div><p className="eyebrow">CONVERSATION DETAILS</p><h1>{set.title}</h1><p className="muted">五個問題 · {new Date(set.createdAt).toLocaleDateString('zh-TW')}</p></div><Status status={set.status} /></div>
    {set.status === 'draft' && <div className="state-card"><div className="state-icon">01</div><div><h2>這份題目還在草稿裡。</h2><p>填完自己的答案，再發布分享給一位想聊的人。</p><div className="button-row"><button className="button button-outline" onClick={onEdit}>繼續編輯</button><button className="button button-dark" onClick={onPublish} disabled={busy || set.questions.some((q) => !q.answer)}>發布邀請 →</button></div></div></div>}
    {set.status === 'published' && <div className="state-card"><div className="state-icon">02</div><div><h2>邀請已準備好，等對方來填答。</h2><p>這個連結只供一位受邀者作答。對方完成後，你的頁面會更新結果。</p><div className="share-field"><input readOnly value={inviteUrl(set.shareToken)} aria-label="邀請連結" onFocus={(e) => e.target.select()} /><button className="button button-dark" onClick={copy}>{copied ? '已複製 ✓' : '複製連結'}</button></div></div></div>}
    {set.status === 'completed' && <Results title={set.title} questions={set.questions} guestName={set.guestName} />}
    {set.status !== 'completed' && <section className="my-answers"><div className="section-head"><h2>你的五題</h2><span>受邀者完成前，答案不會顯示給對方</span></div>{set.questions.map((q, index) => <div className="my-answer-row" key={q.id}><span>{String(index + 1).padStart(2, '0')}</span><strong>{q.text}</strong><span className="my-answer-value">{labelOf(q.answer)}</span></div>)}</section>}
  </div>;
}

function Results({ title, questions, guestName = '受邀者' }) {
  const same = questions.filter((q) => q.answer === q.guestAnswer).length;
  return <section className="results"><div className="results-heading"><div><p className="eyebrow">THE CONVERSATION STARTS HERE</p><h2>兩份答案，放在一起看看。</h2><p>沒有標準答案。挑一題最想知道「為什麼」的，從那裡開始聊。</p></div><div className="same-count"><strong>{same}<span> / 5</span></strong><small>題選了一樣的答案</small></div></div>
    <div className="results-key"><span>● 你的答案</span><span>● {guestName}的答案</span></div>
    <div className="result-list">{questions.map((q, index) => { const gap = Math.abs(q.answer - q.guestAnswer); return <article className="result-row" key={index}><div className="result-prompt"><span>{String(index + 1).padStart(2, '0')} / 05</span><h3>{q.text}</h3></div><div className="result-answers"><div className="answer-cell"><span>提問者</span><strong>{labelOf(q.answer)}</strong></div><div className="answer-cell guest"><span>{guestName}</span><strong>{labelOf(q.guestAnswer)}</strong></div><span className={`gap-tag ${gap === 0 ? 'gap-same' : ''}`}>{gap === 0 ? '一樣！' : gap === 1 ? '很接近' : '值得聊聊'}</span></div></article>; })}</div>
    <div className="results-prompt"><span>下一句可以問</span><strong>「你為什麼會這樣想？」</strong></div>
  </section>;
}

function InvitePage({ invite }) {
  const [data, setData] = useState(null);
  const [name, setName] = useState('');
  const [answers, setAnswers] = useState(Array(5).fill(null));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/invites/${encodeURIComponent(invite)}`).then(setData).catch((err) => setError(err.message)); }, [invite]);
  async function submit(event) {
    event.preventDefault();
    if (answers.some((answer) => !answer)) { setError('五題都選好，再一起對答案。'); return; }
    setBusy(true); setError('');
    try { setData(await api(`/invites/${encodeURIComponent(invite)}/submit`, { method: 'POST', body: JSON.stringify({ name, answers }) })); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (err) { setError(err.message); if (err.message.includes('已經有人完成')) api(`/invites/${encodeURIComponent(invite)}`).then(setData).catch(() => {}); }
    finally { setBusy(false); }
  }
  return <main className="invite-page"><header className="invite-header"><Brand small /><span>一份給你的對話邀請</span></header><div className="invite-content">
    {error && !data && <div className="single-card"><h1>這份邀請暫時打不開。</h1><p className="error">{error}</p></div>}
    {!data && !error && <div className="center-message">正在打開邀請…</div>}
    {data?.completed && <><div className="invite-title"><span className="eyebrow">一起對答案</span><h1>{data.title}</h1></div><Results title={data.title} questions={data.questions} guestName={data.guestName} /></>}
    {data && !data.completed && <><div className="invite-title"><p className="eyebrow">A CONVERSATION FOR TWO</p><h1>{data.title}</h1><p>對方已經寫下答案，正在等你。先依自己的感覺選完五題，再一起看看彼此怎麼想。</p></div><form onSubmit={submit}><div className="guest-name"><label className="field">想讓對方怎麼稱呼你？ <span>選填</span><input value={name} maxLength="40" onChange={(e) => setName(e.target.value)} placeholder="你的名字" /></label></div><div className="invite-questions">{data.questions.map((q, index) => <article className="invite-question" key={index}><span className="question-index">{String(index + 1).padStart(2, '0')} <small>／ 05</small></span><h2>{q.text}</h2><ChoiceGroup group={`guest-${index}`} value={answers[index]} onChange={(answer) => setAnswers((prev) => prev.map((a, i) => i === index ? answer : a))} /></article>)}</div>{error && <p className="error" role="alert">{error}</p>}<div className="invite-submit"><p>提交後就不能修改，也不會再讓第二個人填答。</p><button className="button button-dark" disabled={busy}>{busy ? '正在送出…' : '完成，看看我們的答案 →'}</button></div></form></>}
  </div></main>;
}

createRoot(document.getElementById('root')).render(<App />);
