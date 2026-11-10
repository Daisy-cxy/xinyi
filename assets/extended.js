(() => {
  'use strict';

  const FILL = Array.isArray(window.FILL_QUESTIONS) ? window.FILL_QUESTIONS : [];
  const ESSAY = Array.isArray(window.ESSAY_QUESTIONS) ? window.ESSAY_QUESTIONS : [];
  const ALL = { fill: FILL, essay: ESSAY };
  const STORAGE_KEY = 'network-quiz-extended-v1';
  const KIND_LABEL = { fill: '填空题', essay: '解答题' };
  const KIND_EYEBROW = { fill: 'FILL IN THE BLANKS', essay: 'SHORT ANSWER' };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function blankStore() {
    return { fillAnswers: {}, fillResults: {}, essayAnswers: {}, essayStatus: {} };
  }

  function loadStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const base = blankStore();
      return {
        fillAnswers: parsed.fillAnswers && typeof parsed.fillAnswers === 'object' ? parsed.fillAnswers : base.fillAnswers,
        fillResults: parsed.fillResults && typeof parsed.fillResults === 'object' ? parsed.fillResults : base.fillResults,
        essayAnswers: parsed.essayAnswers && typeof parsed.essayAnswers === 'object' ? parsed.essayAnswers : base.essayAnswers,
        essayStatus: parsed.essayStatus && typeof parsed.essayStatus === 'object' ? parsed.essayStatus : base.essayStatus
      };
    } catch (_) {
      return blankStore();
    }
  }

  let store = loadStore();
  const state = {
    kind: 'fill',
    reviewOnly: false,
    items: [],
    index: 0,
    showHint: false,
    revealEssay: {},
    completed: false
  };

  function saveStore() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
    catch (_) { showToast('浏览器未允许本地存储，本次进度仅在当前页面保留。', true); }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function normalize(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s，。；、,.!?！？:：'"“”‘’()（）[\]{}<>《》/\-—_]/g, '');
  }

  function isReview(id) {
    return store.fillResults[id]?.correct === false || store.essayStatus[id] === 'review';
  }

  function reviewIds(kind) {
    return ALL[kind].filter(item => isReview(item.id)).map(item => item.id);
  }

  function isAnswered(item) {
    return state.kind === 'fill' ? Boolean(store.fillResults[item.id]) : ['mastered', 'review'].includes(store.essayStatus[item.id]);
  }

  function isCorrect(item) {
    if (state.kind === 'fill') return store.fillResults[item.id]?.correct === true;
    return store.essayStatus[item.id] === 'mastered';
  }

  function setNavActive(action) {
    $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.action === action));
  }

  function closeSidebar() {
    $('#sidebar')?.classList.remove('open');
    $('#sidebarScrim')?.classList.remove('show');
  }

  function showToast(message, error = false) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle('error', error);
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function enter(kind, options = {}) {
    state.kind = kind;
    state.reviewOnly = Boolean(options.reviewOnly);
    state.index = 0;
    state.showHint = false;
    state.revealEssay = {};
    state.completed = false;
    const source = ALL[kind];
    const ids = state.reviewOnly ? new Set(reviewIds(kind)) : null;
    state.items = ids ? source.filter(item => ids.has(item.id)) : [...source];

    $('#homeView').hidden = true;
    $('#quizView').hidden = true;
    $('#resultView').hidden = true;
    $('#floatingSheet').hidden = true;
    const view = $('#extendedView');
    view.hidden = false;
    setNavActive(kind);
    const crumb = $('#breadcrumbCurrent');
    if (crumb) crumb.textContent = `/ ${KIND_LABEL[kind]}练习`;
    closeSidebar();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function leave() {
    const view = $('#extendedView');
    if (view) view.hidden = true;
  }

  function switchKind(kind) {
    if (state.kind === kind && !state.reviewOnly) return;
    enter(kind);
  }

  function startReview() {
    const count = reviewIds(state.kind).length;
    if (!count) {
      showToast('当前题型还没有待复习题目。');
      return;
    }
    enter(state.kind, { reviewOnly: true });
  }

  function render() {
    renderHeader();
    renderPanel();
    if (state.completed) renderComplete();
    else if (!state.items.length) renderEmpty();
    else if (state.kind === 'fill') renderFill();
    else renderEssay();
  }

  function renderHeader() {
    const title = $('#extTitle');
    const subtitle = $('#extSubtitle');
    if (!title || !subtitle) return;
    const eyebrow = $('#extEyebrow');
    if (eyebrow) eyebrow.textContent = KIND_EYEBROW[state.kind];
    const baseCount = ALL[state.kind].length;
    title.textContent = state.reviewOnly ? `${KIND_LABEL[state.kind]}复习` : `${KIND_LABEL[state.kind]}专项`;
    subtitle.textContent = state.reviewOnly
      ? `集中回顾尚未掌握的 ${state.items.length} 道题。`
      : `${baseCount} 道题 · ${state.kind === 'fill' ? '自动判分与即时解析' : '参考答案与评分要点'}`;
    $$('.ext-kind-tab').forEach(btn => {
      const active = btn.dataset.kind === state.kind;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    const reviewTab = $('#extReviewTab');
    if (reviewTab) {
      const count = reviewIds(state.kind).length;
      reviewTab.textContent = `待复习 ${count}`;
      reviewTab.classList.toggle('active', state.reviewOnly);
      reviewTab.disabled = count === 0;
    }
  }

  function renderPanel() {
    const answered = ALL[state.kind].filter(isAnswered).length;
    const correct = ALL[state.kind].filter(isCorrect).length;
    const total = ALL[state.kind].length;
    const review = reviewIds(state.kind).length;
    const percent = total ? Math.round(answered / total * 100) : 0;
    const accuracy = answered ? Math.round(correct / answered * 100) : 0;
    $('#extProgress').textContent = `${percent}%`;
    $('#extProgressBar').style.width = `${percent}%`;
    $('#extAnswered').textContent = `${answered} / ${total}`;
    $('#extCorrect').textContent = String(correct);
    $('#extReview').textContent = String(review);
    $('#extAccuracy').textContent = answered ? `${accuracy}%` : '—';
    $('#extPanelNote').textContent = state.kind === 'fill'
      ? '每个空独立校验；全部答对后本题记为掌握。'
      : '解答题采用参考解析与自评结合，重点是覆盖评分要点。';
  }

  function renderEmpty() {
    const isReview = state.reviewOnly;
    $('#extCard').innerHTML = `
      <div class="extended-empty">
        <span class="extended-empty-icon"><svg class="icon"><use href="#${isReview ? 'i-check' : 'i-info'}"></use></svg></span>
        <p class="eyebrow">${isReview ? 'ALL CLEAR' : 'NO QUESTIONS'}</p>
        <h2>${isReview ? '待复习清单已经清空' : '暂时没有可练习的题目'}</h2>
        <p>${isReview ? '继续练习新题目，系统会自动收集需要回顾的题目。' : '请刷新页面后重试。'}</p>
        <div class="extended-empty-actions">
          ${isReview ? `<button class="primary-button" data-ext-action="back-all">返回${KIND_LABEL[state.kind]}练习</button>` : ''}
          <button class="outline-button" data-action="home">返回学习首页</button>
        </div>
      </div>`;
  }

  function renderComplete() {
    const total = state.items.length;
    const correct = state.items.filter(isCorrect).length;
    const review = state.items.filter(item => isReview(item.id)).length;
    const percent = total ? Math.round(correct / total * 100) : 0;
    $('#extCard').innerHTML = `
      <div class="extended-complete">
        <div class="extended-score" style="--score:${percent}%"><div><strong>${percent}</strong><span>掌握度</span></div></div>
        <p class="eyebrow">SESSION COMPLETE</p>
        <h2>这一组已经完成。</h2>
        <p>${state.kind === 'fill' ? '填空判分完成，错题已经自动加入待复习。' : '参考答案已全部开放，自评结果已保存。'}</p>
        <div class="extended-result-grid">
          <div><span>本轮题目</span><strong>${total}</strong></div>
          <div><span>已掌握</span><strong>${correct}</strong></div>
          <div><span>待复习</span><strong>${review}</strong></div>
        </div>
        <div class="extended-complete-actions">
          <button class="primary-button" data-ext-action="restart">再练一次 <svg class="icon"><use href="#i-refresh"></use></svg></button>
          ${review ? '<button class="outline-button" data-ext-action="review">复习待掌握</button>' : ''}
          <button class="text-button" data-action="home">返回学习首页</button>
        </div>
      </div>`;
  }

  function renderFill() {
    const item = state.items[state.index];
    if (!item) return endSession();
    const saved = store.fillAnswers[item.id] || [];
    const result = store.fillResults[item.id];
    let blankIndex = 0;
    const prompt = escapeHtml(item.q).replace(/\{\{(\d+)\}\}/g, (_, number) => {
      const index = blankIndex++;
      const value = escapeHtml(saved[index] || '');
      const stateClass = result ? (result.blanks[index] ? ' correct' : ' wrong') : '';
      return `<span class="cloze-slot${stateClass}"><span class="cloze-number">${number}</span><input class="cloze-input" data-blank="${index}" type="text" value="${value}" autocomplete="off" aria-label="第 ${number} 空" ${result ? 'disabled' : ''}></span>`;
    });
    const resultHtml = result ? `
      <div class="extended-feedback ${result.correct ? 'correct' : 'wrong'}" role="status">
        <div class="extended-feedback-title">
          <span><svg class="icon"><use href="#${result.correct ? 'i-check' : 'i-x'}"></use></svg>${result.correct ? '全部答对' : '还有空需要修正'}</span>
          <strong>${result.blanks.filter(Boolean).length} / ${item.answers.length} 个空正确</strong>
        </div>
        <p>${escapeHtml(item.e)}</p>
      </div>` : '';
    $('#extCard').innerHTML = `
      <div class="extended-question-head">
        <div><span class="extended-number">${String(state.index + 1).padStart(2, '0')}</span><span class="question-type">填空题</span><span class="question-tag">${escapeHtml(item.c)}</span></div>
        <span class="extended-counter">${state.index + 1} / ${state.items.length}</span>
      </div>
      <div class="extended-progress-line"><span style="width:${(state.index + 1) / state.items.length * 100}%"></span></div>
      <h2 class="extended-question">${prompt}</h2>
      <div class="extended-helper">
        <button class="extended-hint-button" data-ext-action="hint"><svg class="icon"><use href="#i-info"></use></svg>${state.showHint ? '收起提示' : '查看提示'}</button>
        ${state.showHint ? `<p>${escapeHtml(item.hint)}</p>` : ''}
      </div>
      ${resultHtml}
      <div class="extended-actions">
        <button class="ghost-button" data-ext-action="prev" ${state.index === 0 ? 'disabled' : ''}><span>←</span> 上一题</button>
        <div class="action-right">
          ${result
            ? `<button class="outline-button" data-ext-action="retry">重新作答</button><button class="primary-button" data-ext-action="next">${state.index === state.items.length - 1 ? '完成练习' : '下一题'} <svg class="icon"><use href="#i-arrow"></use></svg></button>`
            : `<button class="primary-button" data-ext-action="check">检查答案 <svg class="icon"><use href="#i-check"></use></svg></button>`}
        </div>
      </div>`;
    const first = $('.cloze-input:not([disabled])', $('#extCard'));
    if (first) requestAnimationFrame(() => first.focus({ preventScroll: true }));
  }

  function renderEssay() {
    const item = state.items[state.index];
    if (!item) return endSession();
    const draft = store.essayAnswers[item.id] || '';
    const status = store.essayStatus[item.id];
    const revealed = Boolean(state.revealEssay[item.id] || status);
    const reference = revealed ? `
      <section class="reference-answer">
        <div class="reference-head"><div><p class="eyebrow">REFERENCE ANSWER</p><h3>参考答案</h3></div><span>仅供自评</span></div>
        <p>${escapeHtml(item.reference)}</p>
        <div class="rubric-block">
          <h4>评分要点</h4>
          <ul>${item.points.map(point => `<li><span><svg class="icon"><use href="#i-check"></use></svg></span>${escapeHtml(point)}</li>`).join('')}</ul>
        </div>
        <div class="self-review">
          <div><strong>对照要点，你掌握了吗？</strong><p>如实自评，选择“待复习”的题目会加入清单。</p></div>
          <div>
            <button class="outline-button ${status === 'review' ? 'selected-review' : ''}" data-ext-action="mark-review">待复习</button>
            <button class="primary-button ${status === 'mastered' ? 'selected-mastered' : ''}" data-ext-action="mark-mastered">已掌握</button>
          </div>
        </div>
      </section>` : '';
    $('#extCard').innerHTML = `
      <div class="extended-question-head">
        <div><span class="extended-number">${String(state.index + 1).padStart(2, '0')}</span><span class="question-type essay-type">解答题</span><span class="question-tag">${escapeHtml(item.c)}</span></div>
        <span class="extended-counter">${state.index + 1} / ${state.items.length}</span>
      </div>
      <div class="extended-progress-line"><span style="width:${(state.index + 1) / state.items.length * 100}%"></span></div>
      <h2 class="extended-question">${escapeHtml(item.q)}</h2>
      <div class="essay-editor">
        <label for="essayInput">你的答案</label>
        <textarea id="essayInput" rows="10" placeholder="先组织关键词，再按“结论—机制—场景”的顺序作答…">${escapeHtml(draft)}</textarea>
        <div class="essay-editor-foot"><span id="essayCount">${draft.replace(/\s/g, '').length} 字</span><span>草稿会自动保存在本机</span></div>
      </div>
      <details class="essay-hint"><summary>需要一点提示？</summary><p>${escapeHtml(item.hint)}</p></details>
      ${reference}
      <div class="extended-actions">
        <button class="ghost-button" data-ext-action="prev" ${state.index === 0 ? 'disabled' : ''}><span>←</span> 上一题</button>
        <div class="action-right">
          ${revealed ? `<button class="primary-button" data-ext-action="next">${state.index === state.items.length - 1 ? '完成练习' : '下一题'} <svg class="icon"><use href="#i-arrow"></use></svg></button>` : `<button class="primary-button" data-ext-action="reveal">提交并查看解析 <svg class="icon"><use href="#i-arrow"></use></svg></button>`}
        </div>
      </div>`;
    const textarea = $('#essayInput');
    if (textarea) {
      requestAnimationFrame(() => {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.max(210, textarea.scrollHeight)}px`;
        textarea.focus({ preventScroll: true });
      });
    }
  }

  function inputBlankValues() {
    return $$('.cloze-input', $('#extCard')).map(input => input.value.trim());
  }

  function currentFill() {
    return state.items[state.index];
  }

  function currentEssay() {
    return state.items[state.index];
  }

  function checkFill() {
    const item = currentFill();
    if (!item) return;
    const values = inputBlankValues();
    if (values.some(value => !value)) {
      showToast('请先完成所有空格。', true);
      const empty = $$('.cloze-input', $('#extCard')).find(input => !input.value.trim());
      empty?.focus();
      return;
    }
    const blanks = item.answers.map((accepted, index) => accepted.some(answer => normalize(answer) === normalize(values[index])));
    const result = { correct: blanks.every(Boolean), blanks, at: Date.now() };
    store.fillAnswers[item.id] = values;
    store.fillResults[item.id] = result;
    saveStore();
    render();
  }

  function retryFill() {
    const item = currentFill();
    if (!item) return;
    delete store.fillResults[item.id];
    saveStore();
    render();
  }

  function saveEssayDraft() {
    const item = currentEssay();
    const textarea = $('#essayInput');
    if (!item || !textarea) return;
    store.essayAnswers[item.id] = textarea.value;
    saveStore();
  }

  function revealEssay() {
    const item = currentEssay();
    const textarea = $('#essayInput');
    if (!item || !textarea) return;
    store.essayAnswers[item.id] = textarea.value;
    if (textarea.value.replace(/\s/g, '').length < 12) {
      showToast('先写下至少 12 个字的作答思路，再看参考答案。', true);
      textarea.focus();
      return;
    }
    state.revealEssay[item.id] = true;
    saveStore();
    render();
  }

  function markEssay(status) {
    const item = currentEssay();
    if (!item) return;
    saveEssayDraft();
    store.essayStatus[item.id] = status;
    saveStore();
    showToast(status === 'mastered' ? '已标记掌握。' : '已加入待复习清单。');
    render();
  }

  function goNext() {
    if (state.index >= state.items.length - 1) return endSession();
    state.index += 1;
    state.showHint = false;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goPrev() {
    if (state.index <= 0) return;
    state.index -= 1;
    state.showHint = false;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function endSession() {
    state.completed = true;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function restart() {
    state.completed = false;
    state.index = 0;
    state.showHint = false;
    state.revealEssay = {};
    render();
  }

  function handleExternalAction(action) {
    if (action === 'fill' || action === 'essay') {
      enter(action);
      return true;
    }
    if (['home', 'sequence', 'random', 'exam', 'wrong', 'favorites'].includes(action)) {
      leave();
    }
    return false;
  }

  function bindEvents() {
    document.addEventListener('click', event => {
      const actionEl = event.target.closest('[data-action]');
      if (actionEl && handleExternalAction(actionEl.dataset.action)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      const extEl = event.target.closest('[data-ext-action]');
      if (!extEl) return;
      event.preventDefault();
      const action = extEl.dataset.extAction;
      if (action === 'switch-fill') enter('fill');
      else if (action === 'switch-essay') enter('essay');
      else if (action === 'review') startReview();
      else if (action === 'back-all') enter(state.kind);
      else if (action === 'check') checkFill();
      else if (action === 'retry') retryFill();
      else if (action === 'next') goNext();
      else if (action === 'prev') goPrev();
      else if (action === 'hint') { state.showHint = !state.showHint; render(); }
      else if (action === 'reveal') revealEssay();
      else if (action === 'mark-mastered') markEssay('mastered');
      else if (action === 'mark-review') markEssay('review');
      else if (action === 'restart') restart();
    }, true);

    document.addEventListener('input', event => {
      if (event.target.id === 'essayInput') {
        const count = event.target.value.replace(/\s/g, '').length;
        const counter = $('#essayCount');
        if (counter) counter.textContent = `${count} 字`;
        store.essayAnswers[currentEssay()?.id] = event.target.value;
      }
    });

    document.addEventListener('change', saveEssayDraft);
    document.addEventListener('keydown', event => {
      if (event.target.classList.contains('cloze-input') && event.key === 'Enter') {
        event.preventDefault();
        checkFill();
      }
      if (event.target.id === 'essayInput' && event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        revealEssay();
      }
    });
    window.addEventListener('beforeunload', saveEssayDraft);
  }

  function init() {
    if (!$('#extendedView')) return;
    bindEvents();
    renderPanel();
  }

  init();
})();
