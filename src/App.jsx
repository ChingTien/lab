import React, { useState, useEffect } from 'react';

const OPTIONS = [
  { label: '非常同意', value: 5, color: 'bg-emerald-500 text-white' },
  { label: '同意', value: 4, color: 'bg-emerald-100 text-emerald-800' },
  { label: '沒意見', value: 3, color: 'bg-gray-100 text-gray-700' },
  { label: '不同意', value: 2, color: 'bg-rose-100 text-rose-800' },
  { label: '非常不同意', value: 1, color: 'bg-rose-500 text-white' },
];

const DEFAULT_QUESTIONS = [
  "我喜歡獨處充電勝過於參加社交聚會",
  "遇到爭執時，我習慣先冷靜各自思考，而不是當下一定要解決",
  "我認為情侶之間應該要完全坦白，不該有任何秘密",
  "對於未來的理財規劃，我傾向保守儲蓄而非高風險投資",
  "我認為工作只是生活的手段，追求生活品質比事業成功更重要"
];

export default function App() {
  const [step, setStep] = useState('login');
  const [password, setPassword] = useState('');
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);
  const [hostAnswers, setHostAnswers] = useState({});
  const [guestAnswers, setGuestAnswers] = useState({});
  const [shareUrl, setShareUrl] = useState('');

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#/quiz/')) {
      try {
        const encodedData = hash.replace('#/quiz/', '');
        const decoded = JSON.parse(atob(decodeURIComponent(encodedData)));
        setQuestions(decoded.q);
        setHostAnswers(decoded.a);
        if (decoded.ga) {
          setGuestAnswers(decoded.ga);
          setStep('result');
        } else {
          setStep('guest_answer');
        }
      } catch (e) {
        alert('無效的問卷連結');
      }
    }
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    if (password === '1234') {
      setStep('admin_edit');
    } else {
      alert('密碼錯誤！預設密碼為 1234');
    }
  };

  const handleQuestionChange = (index, value) => {
    const newQ = [...questions];
    newQ[index] = value;
    setQuestions(newQ);
  };

  const handlePublish = () => {
    if (Object.keys(hostAnswers).length < questions.length) {
      alert('請先完成所有題目的填答！');
      return;
    }
    const payload = { q: questions, a: hostAnswers };
    const encoded = encodeURIComponent(btoa(JSON.stringify(payload)));
    const url = `${window.location.origin}${window.location.pathname}#/quiz/${encoded}`;
    setShareUrl(url);
    setStep('share');
  };

  const handleGuestSubmit = () => {
    if (Object.keys(guestAnswers).length < questions.length) {
      alert('請完成所有題目的填答！');
      return;
    }
    const hash = window.location.hash.replace('#/quiz/', '');
    const decoded = JSON.parse(atob(decodeURIComponent(hash)));
    const fullData = { ...decoded, ga: guestAnswers };
    const newEncoded = encodeURIComponent(btoa(JSON.stringify(fullData)));
    window.location.hash = `#/quiz/${newEncoded}`;
    setStep('result');
  };

  const getDiffStyle = (valA, valB) => {
    const diff = Math.abs(valA - valB);
    if (diff === 0) return 'border-emerald-500 bg-emerald-50';
    if (diff === 1) return 'border-blue-300 bg-blue-50';
    return 'border-rose-400 bg-rose-50';
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 sm:p-8 flex flex-col items-center">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-slate-900">✨ 價值觀對對碰</h1>
        <p className="text-slate-500 text-sm mt-1">透過真實對話拉近彼此距離</p>
      </header>

      <main className="w-full max-w-xl bg-white rounded-2xl shadow-xl border border-slate-100 p-6 sm:p-8">
        {step === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <h2 className="text-xl font-bold">🔒 管理員登入</h2>
            <div>
              <label className="block text-sm text-slate-600 mb-1">請輸入預設密碼 (1234)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="1234"
              />
            </div>
            <button type="submit" className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition">
              進去設定題目
            </button>
          </form>
        )}

        {step === 'admin_edit' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold">設計 5 題價值觀題目</h2>
            {questions.map((q, idx) => (
              <div key={idx} className="space-y-1">
                <label className="text-sm font-medium text-slate-600">第 {idx + 1} 題</label>
                <input
                  type="text"
                  value={q}
                  onChange={(e) => handleQuestionChange(idx, e.target.value)}
                  className="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            ))}
            <button
              onClick={() => setStep('admin_answer')}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition"
            >
              下一步：填寫我自己的答案
            </button>
          </div>
        )}

        {step === 'admin_answer' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold">先填寫你自己的答案</h2>
            {questions.map((q, qIdx) => (
              <div key={qIdx} className="space-y-2 border-b border-slate-100 pb-4">
                <p className="font-medium text-slate-800">{qIdx + 1}. {q}</p>
                <div className="grid grid-cols-5 gap-1 sm:gap-2">
                  {OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setHostAnswers({ ...hostAnswers, [qIdx]: opt.value })}
                      className={`py-2 text-xs sm:text-sm rounded-lg font-medium border transition ${
                        hostAnswers[qIdx] === opt.value
                          ? `${opt.color} border-transparent shadow-sm`
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button
              onClick={handlePublish}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition"
            >
              發布並產生分享連結
            </button>
          </div>
        )}

        {step === 'share' && (
          <div className="space-y-6 text-center">
            <h2 className="text-2xl font-bold text-emerald-600">🎉 題目發布成功！</h2>
            <p className="text-slate-600 text-sm">複製下方連結發送給對方，當對方填答完畢後即可直接查看對比結果：</p>
            <div className="p-3 bg-slate-100 rounded-xl text-xs sm:text-sm break-all font-mono select-all">
              {shareUrl}
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(shareUrl);
                alert('連結已複製到剪貼簿！');
              }}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition"
            >
              複製分享連結
            </button>
          </div>
        )}

        {step === 'guest_answer' && (
          <div className="space-y-6">
            <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl text-indigo-900 text-sm">
              👋 你的朋友邀請你一起對答案！請根據真實想法回答以下 5 題。
            </div>
            {questions.map((q, qIdx) => (
              <div key={qIdx} className="space-y-2 border-b border-slate-100 pb-4">
                <p className="font-medium text-slate-800">{qIdx + 1}. {q}</p>
                <div className="grid grid-cols-5 gap-1 sm:gap-2">
                  {OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setGuestAnswers({ ...guestAnswers, [qIdx]: opt.value })}
                      className={`py-2 text-xs sm:text-sm rounded-lg font-medium border transition ${
                        guestAnswers[qIdx] === opt.value
                          ? `${opt.color} border-transparent shadow-sm`
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button
              onClick={handleGuestSubmit}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition"
            >
              完成填答，查看雙方對比
            </button>
          </div>
        )}

        {step === 'result' && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold">💬 價值觀對比結果</h2>
              <p className="text-xs text-slate-500 mt-1">綠色代表想法一致，紅色代表有討論空間</p>
            </div>

            <div className="space-y-4">
              {questions.map((q, idx) => {
                const hVal = hostAnswers[idx];
                const gVal = guestAnswers[idx];
                const hOpt = OPTIONS.find(o => o.value === hVal);
                const gOpt = OPTIONS.find(o => o.value === gVal);
                const diffStyle = getDiffStyle(hVal, gVal);

                return (
                  <div key={idx} className={`p-4 rounded-xl border-2 transition ${diffStyle}`}>
                    <p className="font-semibold text-slate-800 text-sm mb-3">
                      {idx + 1}. {q}
                    </p>
                    <div className="grid grid-cols-2 gap-3 text-xs sm:text-sm">
                      <div className="bg-white/80 p-2.5 rounded-lg border border-slate-200">
                        <span className="text-slate-400 block text-[10px] font-bold">出題者</span>
                        <span className="font-semibold text-slate-700">{hOpt?.label}</span>
                      </div>
                      <div className="bg-white/80 p-2.5 rounded-lg border border-slate-200">
                        <span className="text-slate-400 block text-[10px] font-bold">回答者</span>
                        <span className="font-semibold text-slate-700">{gOpt?.label}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
