// 처음 설정 직후: 예상질문 넣기 / 참고자료 뽑기 (둘 다 건너뛸 수 있음)
import { h, clear, modal, toast } from './util.js';
import * as S from './store.js';
import { renderConvert, orderedActs } from './convert.js';
import { renderRefExtract } from './refextract.js';
import { parseBulkText } from './files.js';
import { applyEntries } from './intake.js';

export function renderPrep(box, onEnter) {
  const done = { q: false, r: false };

  const hub = () => {
    clear(box); box.classList.remove('wide');
    const tile = (k, title, desc) => h('button', { class: 'tile big' + (done[k] ? '' : ' solid'), onclick: () => page(k) },
      h('b', null, (done[k] ? '✓ ' : '') + title), h('span', { class: 'd' }, done[k] ? '완료했어요. 눌러서 다시 할 수도 있어요.' : desc));
    const all = done.q && done.r;
    box.append(h('p', { class: 'sub' }, '5 / 5'), h('h1', null, '면접 준비 시작하기'),
      h('p', null, `내 생기부 활동 ${orderedActs().length}개가 들어 있어요. 아래 두 가지는 AI를 한 번 거치면 한꺼번에 채워지고, 지금 하지 않고 나중에 해도 돼요.`),
      h('div', { class: 'tiles two' },
        tile('q', '예상질문 넣기', '내가 가진 예상질문 파일을 AI로 내 생기부 활동에 맞게 바꿔 활동별로 저장해요'),
        tile('r', '참고자료 뽑기', '생기부 전체에서 책·논문·기사·개념을 AI로 뽑아 참고자료로 저장해요')),
      h('div', { class: 'stack mt' },
        h('button', { class: 'btn block', onclick: () => pasteGrade(hub) }, '파일에 없는 학년 글 붙여 넣기 (3학년 등)'),
        h('button', { class: 'btn block' + (all ? ' solid' : ''), onclick: onEnter }, all ? '아카이브 입장' : '나중에 하고 입장')));
  };

  function page(kind) {
    clear(box); box.classList.add('wide');
    const body = h('div', { class: 'stack' });
    box.append(h('div', { class: 'prephead' }, h('button', { class: 'btn sm', onclick: hub }, '← 돌아가기'), h('h1', null, kind === 'q' ? '예상질문 넣기' : '참고자료 뽑기')), body);
    const finish = () => { done[kind] = true; hub(); };
    if (kind === 'q') renderConvert(body, { mode: 'acts', onDone: finish });
    else renderRefExtract(body, { onDone: finish });
  }

  function pasteGrade(after) {
    const g = h('select', { class: 'inp' }, ...[1, 2, 3].map((n) => h('option', { value: n, selected: n === 3 }, n + '학년')));
    const ta = h('textarea', { class: 'inp', rows: 10, placeholder: '국어: 수업 시간에 ... 내용\n수학: 확률 단원에서 ... 내용\n\n[동아리활동]\n활동 내용...' });
    const m = modal('생기부 글 붙여 넣기', h('div', null,
      h('div', { class: 'note' }, '과목마다 "국어: 내용"처럼 시작하거나 "[국어]" 제목 줄을 적으면 과목별로 나뉘고, 엔터로 나눈 한 줄이 활동 하나가 돼요.'),
      h('label', { class: 'lbl' }, '학년'), g, ta,
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => m.close() }, '취소'), h('button', { class: 'btn solid', onclick: () => {
        if (!ta.value.trim()) return toast('내용을 붙여 넣어 주세요');
        const es = parseBulkText(ta.value, +g.value); if (!es.length) return toast('과목을 나누지 못했어요');
        const r = applyEntries(es, true); m.close(); after(); toast(`활동 ${r.made}개를 만들었어요`);
      } }, '넣기'))), { wide: true });
  }
  hub();
}
