(() => {
  'use strict';

  const QUESTIONS = window.NETWORK_QUESTIONS || [];
  const QUESTION_BY_ID = new Map(QUESTIONS.map(q => [q.id, q]));
  const STORAGE_KEY = 'network-quiz-progress-v1';
  const DAILY_GOAL = 20;
  const CATEGORY_ORDER = ['基础', '体系', '通信', '局域网', '网络层', '传输层', '应用层', '安全'];
  const CATEGORY_NAMES = {基础:'网络基础', 体系:'体系结构', 通信:'数据通信', 局域网:'局域网', 网络层:'网络层', 传输层:'传输层', 应用层:'应用层', 安全:'网络安全'};

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const todayKey = () => new Date().toLocaleDateString('zh-CN');
  const shuffle = arr => {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const formatTime = seconds => {
    const s = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const arraysEqual = (a = [], b = []) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

  function blankStore() {
    return { answered: {}, wrong: [], favorites: [], daily: { date: todayKey(), count: 0 }, lastSession: null };
  }
  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return blankStore();
      const parsed = JSON.parse(raw);
      const base = blankStore();
      const store = { ...base, ...parsed, answered: parsed.answered || {}, wrong: Array.isArray(parsed.wrong) ? parsed.wrong : [], favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [] };
      if (!store.daily || store.daily.date !== todayKey()) store.daily = { date: todayKey(), count: 0 };
      store.wrong = [...new Set(store.wrong.filter(id => QUESTION_BY_ID.has(id)))];
      store.favorites = [...new Set(store.favorites.filter(id => QUESTION_BY_ID.has(id)))];
      return store;
    } catch (_) {
      return blankStore();
    }
  }
  let store = loadStore();

  const state = {
    mode: 'sequence',
    category: '全部',
    items: [],
    index: 0,
    selections: {},
    checked: {},
    results: {},
    exam: false,
    elapsed: 0,
    remaining: 0,
    timerId: null,
    finished: false
  };

  function saveStore() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
    catch (_) { showToast('浏览器未允许本地存储，本次进度仅在当前页面保留。', true); }
  }
  function saveSession() {
    store.lastSession = {
      mode: state.mode,
      items: state.items,
      index: state.index,
      selections: state.selections,
      checked: state.checked,
      results: state.results,
      exam: state.exam,
      elapsed: state.elapsed,
      remaining: state.remaining,
      at: Date.now()
    };
    saveStore();
  }
  function showToast(message, error = false) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.toggle('error', error);
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  function setNavActive(action) {
    $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.action === action));
  }
  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#sidebarScrim').classList.remove('show');
  }
  function showView(name) {
    ['homeView', 'quizView', 'resultView'].forEach(id => { $('#' + id).hidden = id !== `${name}View`; });
    const labels = { home: '/ 学习首页', quiz: '/ 在线答题', result: '/ 练习报告' };
    $('#breadcrumbCurrent').textContent = labels[name] || '';
    if (name !== 'quiz') {
      $('#floatingSheet').hidden = true;
      setNavActive(name === 'home' ? 'home' : state.mode);
    }
    closeSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function answeredUnique() { return Object.keys(store.answered).length; }
  function correctUnique() { return Object.values(store.answered).filter(Boolean).length; }
  function accuracy() {
    const answered = answeredUnique();
    return answered ? Math.round(correctUnique() / answered * 100) : null;
  }

  function updateDashboard() {
    const answered = answeredUnique();
    const acc = accuracy();
    const daily = store.daily.count || 0;
    $('#homeAnswered').innerHTML = `${answered}<small>题</small>`;
    $('#homeAccuracy').textContent = acc === null ? '—' : `${acc}%`;
    $('#homeProgress').innerHTML = `${Math.round(answered / QUESTIONS.length * 100)}<small>%</small>`;
    $('#wrongNavCount').textContent = store.wrong.length;
    $('#favoriteNavCount').textContent = store.favorites.length;
    $('#wrongCardCount').textContent = store.wrong.length;
    $('#goalText').textContent = daily >= DAILY_GOAL ? '今日目标已完成' : `完成 ${Math.max(0, DAILY_GOAL - daily)} 道题`;
    $('#goalBar').style.width = `${Math.min(100, daily / DAILY_GOAL * 100)}%`;
    $('#goalCaption').textContent = daily >= DAILY_GOAL ? '做得很好，明天继续保持。' : `今日已练 ${daily} 道，保持手感。`;
    const bars = CATEGORY_ORDER.map((cat, i) => {
      const count = QUESTIONS.filter(q => q.c === cat).length;
      return `<div class="category-row"><span>${CATEGORY_NAMES[cat]}</span><i style="--w:${count / QUESTIONS.length * 100}%;--o:${.55 + i * .05}"></i><b>${count}</b></div>`;
    }).join('');
    $('#categoryBars').innerHTML = bars;
  }

  function startQuiz(mode, options = {}) {
    let ids;
    let title;
    let subtitle;
    let exam = mode === 'exam';
    let limit = 0;
    if (options.ids) { ids = [...options.ids]; title = options.title || '专项练习'; subtitle = options.subtitle || '针对所选范围完成练习。'; }
    else if (mode === 'sequence') { ids = QUESTIONS.map(q => q.id); title = '顺序练习'; subtitle = '按章节顺序完成题目，提交后立即查看答案解析。'; }
    else if (mode === 'random') { ids = shuffle(QUESTIONS.map(q => q.id)).slice(0, 30); title = '随机练习'; subtitle = '随机抽取 30 道题，检验真实掌握程度。'; }
    else if (mode === 'exam') { ids = shuffle(QUESTIONS.map(q => q.id)).slice(0, 30); title = '模拟考试'; subtitle = '30 道题，45 分钟；交卷后统一查看成绩。'; limit = 45 * 60; }
    else if (mode === 'wrong') {
      ids = [...store.wrong];
      if (!ids.length) { showToast('错题本还是空的，先完成几道练习吧。'); showView('home'); return; }
      title = '错题复习'; subtitle = '重做错题，巩固容易混淆的知识点。';
    } else if (mode === 'favorites') {
      ids = [...store.favorites];
      if (!ids.length) { showToast('还没有收藏题目，点击题目右上角的星标收藏。'); showView('home'); return; }
      title = '我的收藏'; subtitle = '集中复习你标记过的重点题目。';
    } else return;

    ids = ids.filter(id => QUESTION_BY_ID.has(id));
    if (!ids.length) { showToast('当前范围内没有题目。'); return; }
    stopTimer();
    Object.assign(state, { mode, category: options.category || '全部', items: ids, index: 0, selections: {}, checked: {}, results: {}, exam, elapsed: 0, remaining: limit, timerId: null, finished: false });
    $('#quizTitle').textContent = title;
    $('#quizSubtitle').textContent = subtitle;
    $('#timerText').textContent = exam ? formatTime(limit) : '不限时';
    $('#timerPill').classList.toggle('urgent', false);
    $$('.filter-chip').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === state.category));
    setNavActive(mode);
    showView('quiz');
    $('#floatingSheet').hidden = false;
    $('#questionSearch').value = '';
    startTimer();
    renderQuestion();
    saveSession();
  }

  function startTimer() {
    stopTimer();
    state.timerId = setInterval(() => {
      if (state.exam) {
        state.remaining--;
        $('#timerText').textContent = formatTime(state.remaining);
        $('#timerPill').classList.toggle('urgent', state.remaining <= 300);
        if (state.remaining <= 0) { stopTimer(); showToast('考试时间到，系统正在交卷。'); finishQuiz(true); }
      } else {
        state.elapsed++;
      }
      if ((state.exam ? state.remaining : state.elapsed) % 10 === 0) saveSession();
    }, 1000);
  }
  function stopTimer() { if (state.timerId) clearInterval(state.timerId); state.timerId = null; }

  function currentQuestion() { return QUESTION_BY_ID.get(state.items[state.index]); }
  function selectedFor(id) { return state.selections[id] || []; }
  function isCorrect(id) {
    const q = QUESTION_BY_ID.get(id);
    return q && state.results[id] === true;
  }
  function updateChoice(id, optionIndex) {
    if (!state.exam && state.checked[id]) return;
    const q = QUESTION_BY_ID.get(id);
    const selected = selectedFor(id);
    if (q.a.length > 1) {
      state.selections[id] = selected.includes(optionIndex) ? selected.filter(i => i !== optionIndex) : [...selected, optionIndex].sort();
    } else {
      state.selections[id] = [optionIndex];
    }
    renderQuestion();
    saveSession();
  }

  function renderQuestion() {
    if (!state.items.length) return;
    const q = currentQuestion();
    const id = q.id;
    const selected = selectedFor(id);
    const checked = !!state.checked[id];
    $('#questionNo').textContent = String(state.index + 1).padStart(2, '0');
    $('#questionType').textContent = q.a.length > 1 ? '多选题' : '单选题';
    $('#questionTag').textContent = CATEGORY_NAMES[q.c] || q.c;
    $('#questionText').textContent = q.q;
    $('#questionProgressBar').style.width = `${(state.index + 1) / state.items.length * 100}%`;
    $('#favoriteButton').classList.toggle('active', store.favorites.includes(id));
    $('#favoriteButton').setAttribute('aria-pressed', store.favorites.includes(id));
    $('#favoriteButton span').textContent = store.favorites.includes(id) ? '已收藏' : '收藏';
    const letters = ['A', 'B', 'C', 'D', 'E'];
    $('#optionsList').innerHTML = q.o.map((text, index) => {
      const isSelected = selected.includes(index);
      const isAnswer = q.a.includes(index);
      let cls = 'option-button';
      if (isSelected) cls += ' selected';
      if (checked) {
        if (isAnswer) cls += ' correct';
        else if (isSelected) cls += ' incorrect';
      }
      const icon = checked && isAnswer ? 'i-check' : (checked && isSelected ? 'i-x' : 'i-check');
      return `<button class="${cls}" data-option="${index}" ${checked ? 'disabled' : ''} aria-pressed="${isSelected}"><span class="option-letter">${letters[index]}</span><span class="option-text">${text}</span><span class="option-state"><svg class="icon"><use href="#${icon}"></use></svg></span></button>`;
    }).join('');
    $$('.option-button', $('#optionsList')).forEach(btn => btn.addEventListener('click', () => updateChoice(id, Number(btn.dataset.option))));

    const feedback = $('#feedback');
    if (checked && !state.exam) {
      const ok = state.results[id];
      feedback.hidden = false;
      feedback.classList.toggle('error', !ok);
      $('.feedback-icon use', feedback).setAttribute('href', ok ? '#i-check' : '#i-x');
      $('#feedbackTitle').textContent = ok ? '回答正确' : '回答错误';
      $('#feedbackAnswer').textContent = `正确答案：${q.a.map(i => letters[i]).join('、')}`;
      $('#feedbackText').textContent = q.e || `正确答案是 ${q.a.map(i => letters[i]).join('、')}，请记住这个知识点。`;
    } else {
      feedback.hidden = true;
    }

    const last = state.index === state.items.length - 1;
    if (state.exam) {
      $('#submitButton').hidden = true;
      $('#skipButton').hidden = true;
      $('#nextButton').hidden = false;
      $('#nextButton').innerHTML = last ? '提交答卷 <svg class="icon"><use href="#i-arrow"></use></svg>' : '下一题 <svg class="icon"><use href="#i-arrow"></use></svg>';
    } else if (checked) {
      $('#submitButton').hidden = true;
      $('#skipButton').hidden = true;
      $('#nextButton').hidden = false;
      $('#nextButton').innerHTML = last ? '查看结果 <svg class="icon"><use href="#i-arrow"></use></svg>' : '下一题 <svg class="icon"><use href="#i-arrow"></use></svg>';
    } else {
      $('#submitButton').hidden = false;
      $('#skipButton').hidden = false;
      $('#nextButton').hidden = true;
    }
    $('#prevButton').disabled = state.index === 0;
    renderProgress();
    renderSheet();
    saveSession();
  }

  function poolStats() {
    let answered = 0, correct = 0, wrong = 0;
    for (const id of state.items) {
      if (selectedFor(id).length) answered++;
      if (isCorrect(id)) correct++;
      if (state.checked[id] && state.results[id] === false) wrong++;
    }
    return { answered, correct, wrong };
  }
  function renderProgress() {
    const stats = poolStats();
    const pct = Math.round(stats.answered / state.items.length * 100);
    $('#progressPercent').textContent = `${pct}%`;
    $('#progressRing').style.setProperty('--p', pct);
    $('#answeredCount').textContent = `${stats.answered} / ${state.items.length}`;
    $('#correctCount').textContent = stats.correct;
    $('#wrongCount').textContent = stats.wrong;
    $('#sheetProgress').textContent = `${stats.answered}/${state.items.length}`;
  }

  function renderSheet() {
    const grid = $('#sheetGrid');
    grid.innerHTML = state.items.map((id, index) => {
      let cls = 'sheet-number';
      if (index === state.index) cls += ' current';
      if (selectedFor(id).length) cls += ' done';
      if (state.checked[id]) cls += state.results[id] ? ' correct' : ' wrong';
      return `<button class="${cls}" data-index="${index}" aria-label="第 ${index + 1} 题">${index + 1}</button>`;
    }).join('');
    $$('.sheet-number', grid).forEach(btn => btn.addEventListener('click', () => {
      state.index = Number(btn.dataset.index);
      closeDialog($('#sheetDialog'));
      renderQuestion();
    }));
    const stats = poolStats();
    $('#sheetCaption').textContent = `已答 ${stats.answered} / ${state.items.length}`;
    $('#submitExamFromSheet').hidden = !state.exam;
  }

  function gradeCurrent() {
    const q = currentQuestion();
    const selected = selectedFor(q.id);
    if (!selected.length) { showToast('请先选择一个答案。', true); return false; }
    const ok = arraysEqual(selected, q.a);
    state.checked[q.id] = true;
    state.results[q.id] = ok;
    store.answered[q.id] = ok;
    store.daily.count = (store.daily.count || 0) + 1;
    if (ok) store.wrong = store.wrong.filter(id => id !== q.id);
    else if (!store.wrong.includes(q.id)) store.wrong.push(q.id);
    saveStore();
    updateDashboard();
    renderQuestion();
    return true;
  }

  function goNext() {
    if (state.index < state.items.length - 1) {
      state.index++;
      renderQuestion();
    } else if (state.exam) {
      finishQuiz(false);
    } else {
      finishQuiz(false);
    }
  }
  function goPrev() {
    if (state.index > 0) { state.index--; renderQuestion(); }
  }

  function submitExamConfirm() {
    if (!state.exam) return;
    const stats = poolStats();
    const unanswered = state.items.length - stats.answered;
    if (unanswered && !confirm(`还有 ${unanswered} 道题未作答，确定提交答卷吗？`)) return;
    finishQuiz(false);
  }

  function finishQuiz(auto = false) {
    if (state.finished) return;
    state.finished = true;
    stopTimer();
    let correct = 0, wrong = 0, skipped = 0;
    for (const id of state.items) {
      const q = QUESTION_BY_ID.get(id);
      const selected = selectedFor(id);
      if (!selected.length) { skipped++; continue; }
      const ok = arraysEqual(selected, q.a);
      state.checked[id] = true;
      state.results[id] = ok;
      store.answered[id] = ok;
      if (ok) { correct++; store.wrong = store.wrong.filter(w => w !== id); }
      else { wrong++; if (!store.wrong.includes(id)) store.wrong.push(id); }
    }
    saveStore();
    updateDashboard();
    const score = Math.round(correct / state.items.length * 100);
    $('#resultHeading').textContent = score >= 85 ? '掌握得很扎实。' : score >= 60 ? '基础已经建立。' : '再复盘一次，会更牢。';
    $('#resultSubtitle').textContent = state.exam ? '模拟考试成绩已生成，记得重点复习错题。' : '每一次复盘，都会让知识更牢一点。';
    $('#resultScore').textContent = score;
    $('#resultCorrect').textContent = correct;
    $('#resultWrong').textContent = wrong;
    $('#resultSkipped').textContent = skipped;
    $('#resultTime').textContent = state.exam ? formatTime(45 * 60 - Math.max(0, state.remaining)) : formatTime(state.elapsed);
    $('#resultRing').style.setProperty('--p', score);
    $('#resultNote').textContent = auto ? '本次考试因时间用尽自动交卷。' : `本轮共 ${state.items.length} 道题，答对 ${correct} 道。${wrong ? '错题已自动加入错题本。' : '继续保持！'}`;
    $('#reviewWrong').style.display = wrong ? '' : 'none';
    showView('result');
    saveSession();
  }

  function openDialog(dialog) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); }
  function closeDialog(dialog) { if (dialog.open) dialog.close(); else dialog.removeAttribute('open'); }

  function toggleFavorite() {
    const id = state.items[state.index];
    if (store.favorites.includes(id)) store.favorites = store.favorites.filter(x => x !== id);
    else store.favorites.push(id);
    saveStore();
    updateDashboard();
    renderQuestion();
    showToast(store.favorites.includes(id) ? '已加入收藏' : '已取消收藏');
  }

  function handleAction(action) {
    if (action === 'home') { stopTimer(); showView('home'); setNavActive('home'); updateDashboard(); return; }
    if (['sequence', 'random', 'exam', 'wrong', 'favorites'].includes(action)) startQuiz(action);
  }

  function resetAll() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    store = blankStore();
    state.checked = {};
    state.results = {};
    state.selections = {};
    updateDashboard();
    showView('home');
    closeDialog($('#confirmDialog'));
    showToast('学习记录已重置。');
  }

  function initializeSearch() {
    const input = $('#questionSearch');
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      const query = input.value.trim().toLowerCase();
      if (!query) return;
      const matches = QUESTIONS.filter(q => (q.q + q.o.join('') + q.c + q.e).toLowerCase().includes(query));
      if (!matches.length) { showToast('没有找到匹配的题目。', true); return; }
      startQuiz('sequence', { ids: matches.map(q => q.id), title: `搜索：${input.value.trim()}`, subtitle: `找到 ${matches.length} 道相关题目。` });
    });
  }

  function bindEvents() {
    document.addEventListener('click', event => {
      const actionEl = event.target.closest('[data-action]');
      if (actionEl) { event.preventDefault(); handleAction(actionEl.dataset.action); return; }
    });
    $('#mobileMenu').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#sidebarScrim').classList.add('show'); });
    $('#mobileClose').addEventListener('click', closeSidebar);
    $('#sidebarScrim').addEventListener('click', closeSidebar);
    $('#prevButton').addEventListener('click', goPrev);
    $('#submitButton').addEventListener('click', gradeCurrent);
    $('#nextButton').addEventListener('click', goNext);
    $('#skipButton').addEventListener('click', () => {
      if (state.index < state.items.length - 1) { state.index++; renderQuestion(); }
      else showToast('已经是最后一题。');
    });
    $('#favoriteButton').addEventListener('click', toggleFavorite);
    $('#openSheetTop').addEventListener('click', () => { renderSheet(); openDialog($('#sheetDialog')); });
    $('#floatingSheet').addEventListener('click', () => { renderSheet(); openDialog($('#sheetDialog')); });
    $('#closeSheet').addEventListener('click', () => closeDialog($('#sheetDialog')));
    $('#submitExamFromSheet').addEventListener('click', () => { closeDialog($('#sheetDialog')); submitExamConfirm(); });
    $('#showAbout').addEventListener('click', () => openDialog($('#aboutDialog')));
    $('#closeAbout').addEventListener('click', () => closeDialog($('#aboutDialog')));
    $('#resetAll').addEventListener('click', () => openDialog($('#confirmDialog')));
    $('#cancelReset').addEventListener('click', () => closeDialog($('#confirmDialog')));
    $('#confirmReset').addEventListener('click', resetAll);
    $('#reviewWrong').addEventListener('click', () => {
      const wrongIds = state.items.filter(id => state.results[id] === false);
      if (!wrongIds.length) { showToast('本轮没有错题。'); return; }
      startQuiz('wrong', { ids: wrongIds, title: '错题解析', subtitle: `回顾本轮 ${wrongIds.length} 道错题。` });
    });
    $('#restartSame').addEventListener('click', () => startQuiz(state.mode === 'wrong' || state.mode === 'favorites' ? state.mode : state.mode));
    $$('.filter-chip').forEach(btn => btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      $$('.filter-chip').forEach(item => item.classList.toggle('active', item === btn));
      if (filter === '全部') { startQuiz('sequence'); return; }
      const ids = QUESTIONS.filter(q => q.c === filter).map(q => q.id);
      startQuiz('sequence', { ids, category: filter, title: `${CATEGORY_NAMES[filter]}专项`, subtitle: `集中练习 ${ids.length} 道${CATEGORY_NAMES[filter]}题目。` });
    }));
    initializeSearch();
    document.addEventListener('keydown', event => {
      const anyDialog = $$('dialog[open]').length;
      if (anyDialog) return;
      if ($('#quizView').hidden) return;
      if (event.target.matches('input, textarea')) return;
      const key = event.key.toUpperCase();
      if (['A', 'B', 'C', 'D'].includes(key)) {
        const index = ['A', 'B', 'C', 'D'].indexOf(key);
        const q = currentQuestion();
        if (q && index < q.o.length) updateChoice(q.id, index);
      } else if (event.key === 'Enter') {
        if (!$('#submitButton').hidden) gradeCurrent();
        else if (!$('#nextButton').hidden) goNext();
      } else if (event.key === 'ArrowLeft') goPrev();
      else if (event.key === 'ArrowRight') {
        if (state.exam || state.checked[currentQuestion()?.id]) goNext();
        else showToast('请先确认答案，或点击“跳过”。');
      } else if (event.ctrlKey && key === 'S') { event.preventDefault(); toggleFavorite(); }
    });
    window.addEventListener('beforeunload', saveSession);
    [('#sheetDialog'), ('#aboutDialog'), ('#confirmDialog')].forEach(sel => {
      const dialog = $(sel);
      dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(dialog); });
    });
  }

  function init() {
    if (!QUESTIONS.length) { showToast('题库加载失败。', true); return; }
    bindEvents();
    updateDashboard();
    showView('home');
    const session = store.lastSession;
    if (session && session.items?.length && session.mode === 'sequence' && !session.exam && session.index < session.items.length) {
      const primary = $('.hero-actions [data-action="sequence"]');
      if (primary) primary.firstChild.textContent = '继续上次练习 ';
    }
  }

  init();
})();
