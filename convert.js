// 예상질문 변환: 내가 가진 예상질문 파일을 AI로 "내 생기부 활동"에 맞게 바꿔서
// ① 활동별 예상질문으로 저장하거나 ② 모의면접 질문 목록에 넣는다. (질문은 새로 만들지 않고 분류만 한다)
import { h, modal, toast, pickFile, debounce } from './util.js';
import * as S from './store.js';
import { tf } from './hl.js';
import { getPrompt, copyText, packLocked, parseBatch, UNSORTED } from './qa.js';

export const code6 = (a) => a.id.replace(/-/g, '').slice(0, 6);
const label = (s, a) => `${s.grade}학년 · ${s.name} · ${a.title || '활동'}`;

// 학년 → 과목 → 활동 순서(화면과 같은 순서)로, 원문이 있는 활동만
export function orderedActs() {
  const out = [];
  for (const g of [1, 2, 3]) for (const s of S.list('sub', (x) => x.grade === g)) for (const a of S.list('act', (x) => x.sub === s.id)) {
    if (a.src && a.src.x && a.src.x.trim()) out.push({ a, s });
  }
  return out;
}
// 활동이 많아도 한 번에 복사할 수 있게, 활동당 원문 앞부분만 보낸다 (전체 약 4만 자 안쪽)
export const limFor = (n) => Math.max(120, Math.min(600, Math.floor(40000 / Math.max(n, 1)) - 60));
function listText(acts) {
  const lim = limFor(acts.length);
  return acts.map(({ a, s }) => {
    const t = a.src.x.replace(/\s+/g, ' ').trim();
    return `[[#${code6(a)}]] ${label(s, a)}\n${t.length > lim ? t.slice(0, lim) + '…' : t}`;
  }).join('\n\n');
}

// 활동에 질문 넣기 (이미 있는 같은 질문은 건너뜀). 새로 넣은 개수를 돌려줌
function addQs(actId, items) {
  const have = new Set(S.list('q', (q) => q.act === actId).map((q) => q.q.x.trim()));
  let n = 0;
  for (const it of items) {
    const t = it.q.trim(); if (!t || have.has(t)) continue;
    have.add(t); S.create('q', { act: actId, q: tf(t), a: tf((it.a || '').trim()) }); n++;
  }
  return n;
}
const countNew = (actId, items) => {
  const have = new Set(S.list('q', (q) => q.act === actId).map((q) => q.q.x.trim()));
  return new Set(items.map((i) => i.q.trim()).filter((t) => t && !have.has(t))).size;
};

// opts: { mode: 'acts' | 'mock', mock: 기존 모의면접(없으면 새로 만듦), onDone(결과) }
export function renderConvert(box, opts = {}) {
  const mockMode = opts.mode === 'mock';
  const acts = orderedActs();
  const known = new Set(acts.map(({ a }) => code6(a)));
  const byCode = new Map(acts.map((x) => [code6(x.a), x]));
  const f = { includeUn: true, alsoActs: false };
  let seq = [], groups = [], unsorted = [];

  const code = h('input', { class: 'inp', type: 'password', placeholder: '이용 코드' });
  const ta = h('textarea', { class: 'inp tall', rows: 9, placeholder: 'AI가 준 코드 블록 전체를 여기에 붙여 넣으세요 (나눠서 받았다면 이어서 계속 붙여 넣어도 돼요)' });
  const prev = h('div', { class: 'stack' });

  const copy = h('button', { class: 'btn solid', disabled: !mockMode && !acts.length, onclick: async () => {
    try {
      const ok = await copyText(async () => {
        const p = await getPrompt('convert', code.value);
        const list = acts.length ? listText(acts) : '(원문이 있는 활동이 없어요. 모든 질문을 [[#미분류]]에 넣어 줘.)';
        return `${p}\n[활동 목록]\n${list}\n\n[내 예상질문]\n(여기에 내 예상질문을 붙여 넣거나, 이 메시지에 파일을 첨부하세요)\n`;
      });
      toast(ok ? '복사했어요. AI에 붙여 넣고, 내 예상질문 파일도 같이 넣어 주세요.' : '복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.');
    } catch (e) { toast(e.message || '복사하지 못했어요'); }
  } }, `1. 프롬프트 복사 · 활동 ${acts.length}개`);

  const analyze = () => {
    const blocks = parseBatch(ta.value, known);
    seq = blocks.flatMap((b) => b.items.map((it) => ({ ...it, code: b.code })));
    const map = new Map();
    for (const b of blocks) { if (!map.has(b.code)) map.set(b.code, []); map.get(b.code).push(...b.items); }
    groups = [...map].filter(([c]) => c !== UNSORTED).map(([c, items]) => ({ ...byCode.get(c), items }));
    unsorted = (map.get(UNSORTED) || []).map((it) => ({ ...it, to: '' }));
    draw();
  };

  function saveActs() {
    let n = 0;
    for (const g of groups) n += addQs(g.a.id, g.items);
    for (const u of unsorted) if (u.to && S.get(u.to)) n += addQs(u.to, [u]);
    if (!n) return toast('새로 넣을 질문이 없어요 (이미 있는 질문이에요)');
    toast(`예상질문 ${n}개를 활동별로 넣었어요`);
    opts.onDone && opts.onDone({ n });
  }
  function mockItems() {
    const base = opts.mock ? opts.mock.qs.filter((q) => q.q.trim() || q.a.trim()) : [];
    const have = new Set(base.map((q) => q.q.trim()));
    const add = [];
    for (const it of seq) {
      if (!f.includeUn && it.code === UNSORTED) continue;
      const t = it.q.trim(); if (!t || have.has(t)) continue;
      have.add(t); add.push({ q: t, a: (it.a || '').trim() });
    }
    return { base, add };
  }
  function saveMock() {
    const { base, add } = mockItems();
    if (!add.length) return toast('새로 넣을 질문이 없어요 (이미 있는 질문이에요)');
    const qs = base.concat(add);
    let m = opts.mock;
    if (m) S.patch(m.id, { qs }); else m = S.create('mock', { name: '예상질문 모의면접', qs, shuffle: false, intro: true });
    let extra = 0;
    if (f.alsoActs) for (const g of groups) extra += addQs(g.a.id, g.items);
    toast(`모의면접에 질문 ${add.length}개를 넣었어요` + (extra ? ` (활동 예상질문 ${extra}개도 저장)` : ''));
    opts.onDone && opts.onDone(m);
  }

  function draw() {
    if (!seq.length) {
      prev.replaceChildren(...(ta.value.trim() ? [h('p', { class: 'err' }, '질문을 찾지 못했어요. AI가 준 코드 블록 전체를 붙여 넣었는지 확인해 주세요.')] : []));
      return;
    }
    const nodes = [];
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    if (mockMode) {
      const { add } = mockItems();
      nodes.push(h('p', null, `질문 ${seq.length}개를 찾았어요 · 활동 ${groups.length}개에 ${total}개, 미분류 ${unsorted.length}개`),
        h('p', { class: 'sub' }, opts.mock ? `"${opts.mock.name}"에 새 질문 ${add.length}개를 넣어요 (이미 있는 질문은 건너뛰어요).` : `새 모의면접을 만들고 질문 ${add.length}개를 넣어요.`));
      if (unsorted.length) nodes.push(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.includeUn, onchange: (e) => { f.includeUn = e.target.checked; draw(); } }), h('span', null, '활동에 안 맞는 질문(미분류)도 넣기')));
      if (groups.length) nodes.push(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.alsoActs, onchange: (e) => { f.alsoActs = e.target.checked; } }), h('span', null, '활동 예상질문에도 저장하기')));
      nodes.push(h('div', { class: 'row end' }, h('button', { class: 'btn solid', onclick: saveMock }, opts.mock ? '모의면접에 넣기' : '모의면접 만들기')));
    } else {
      const fresh = groups.reduce((n, g) => n + countNew(g.a.id, g.items), 0);
      nodes.push(h('p', null, `활동 ${groups.length}개에 질문 ${total}개를 넣어요` + (fresh < total ? ` (이미 있는 ${total - fresh}개는 건너뛰어요)` : '') + '.'));
      for (const g of groups.slice(0, 40)) nodes.push(h('div', { class: 'list-item' }, h('span', { class: 'grow' }, label(g.s, g.a)), h('span', { class: 'tag' }, g.items.length + '개')));
      if (groups.length > 40) nodes.push(h('p', { class: 'sub' }, `외 ${groups.length - 40}개 활동`));
      if (unsorted.length) {
        nodes.push(h('div', { class: 'card stack' }, h('b', null, `미분류 질문 ${unsorted.length}개`),
          h('p', { class: 'sub' }, '어느 활동에도 안 맞는다고 AI가 본 질문이에요. 넣을 활동을 고르면 그 활동에 저장하고, 고르지 않으면 저장하지 않아요. (지원동기·자기소개 같은 질문은 모의면접 만들기에서 쓸 수 있어요)'),
          ...unsorted.map((u) => h('div', { class: 'stack' }, h('div', { class: 'pre' }, u.q),
            h('select', { class: 'inp', onchange: (e) => { u.to = e.target.value; } }, h('option', { value: '' }, '저장 안 함'), ...acts.map(({ a, s }) => h('option', { value: a.id, selected: u.to === a.id }, label(s, a))))))));
      }
      nodes.push(h('div', { class: 'row end' }, h('button', { class: 'btn solid', onclick: saveActs }, '활동에 저장')));
    }
    prev.replaceChildren(...nodes);
  }

  ta.addEventListener('input', debounce(analyze, 400));
  const lim = limFor(acts.length);
  box.append(...[
    h('div', { class: 'note' }, h('b', null, '예상질문 변환이란?'),
      '내가 가진 예상질문 파일을 AI가 내 생기부 활동에 맞게 분류해 줘요. 질문은 내가 쓴 그대로 들어가고, AI가 새로 만들지 않아요.' + (mockMode ? ' 결과는 모의면접 질문 목록에 들어가요.' : ' 결과는 활동별 예상질문 칸에 들어가요.'),
      h('div', { class: 'pre mt' }, '① "프롬프트 복사"를 눌러요. 내 생기부 활동 목록이 안내문에 자동으로 들어 있어요.\n② 평소 쓰는 AI(ChatGPT·Claude 등)에 붙여 넣고, 내 예상질문 파일을 같이 올리거나 맨 아래 칸에 붙여 넣어요.\n③ AI가 준 코드 블록 전체를 아래 칸에 붙여 넣어요.\n④ 미리보기를 확인하고 저장해요.'),
      h('div', { class: 'sub mt' }, '복사하는 내용에는 생기부 원문 일부(활동당 약 ' + lim + '자)와 내 예상질문이 들어가서 AI 서비스로 전송돼요. 믿을 수 있는 서비스에서만 쓰세요.')),
    !mockMode && !acts.length ? h('div', { class: 'note' }, h('b', null, '먼저 생기부 원문이 필요해요'), '원문이 있는 활동이 하나도 없어요. 자료 탭에서 생기부를 먼저 넣어 주세요.') : null,
    h('div', { class: 'card stack' }, packLocked() ? code : null, copy),
    h('div', { class: 'card stack' }, h('b', null, '2. AI 결과 붙여 넣기'), ta,
      h('div', { class: 'row tight' },
        h('button', { class: 'btn', onclick: async () => { const [file] = await pickFile('.txt,.md'); if (!file) return; ta.value = ta.value ? ta.value + '\n' + await file.text() : await file.text(); analyze(); } }, '파일로 넣기'),
        h('button', { class: 'btn solid', onclick: analyze }, '분석하기')),
      prev)].filter(Boolean));
}

export function openConvert(opts = {}) {
  const body = h('div', { class: 'stack' });
  const m = modal(opts.mode === 'mock' ? '예상질문 변환 · 모의면접에 넣기' : '예상질문 가져오기', body, { wide: true });
  renderConvert(body, { ...opts, onDone: (r) => { m.close(); opts.onDone && opts.onDone(r); } });
}
