// 참고자료 자동 추출: 내 생기부 전체 글을 프롬프트에 담아 복사 → AI가 책·논문·기사·개념 등을 뽑아 줌 → 붙여 넣으면 참고자료로 저장
import { h, modal, toast, pickFile } from './util.js';
import * as S from './store.js';
import { getPrompt, copyText, packLocked } from './qa.js';
import { parseRefCode, applyRefCode } from './intake.js';

const LIMIT = 18000; // 한 번에 복사하는 글자 수 (AI가 한 번에 쓸 수 있는 답변 길이를 넘지 않게 학년별로 나눔)

// 학년별로, 길면 여러 번으로 나눈 생기부 전체 글
export function refBatches() {
  const out = [];
  for (const g of [1, 2, 3]) {
    const mine = []; let cur = [], size = 0;
    const flush = () => { if (cur.length) { mine.push({ g, text: cur.join('\n\n'), n: cur.length }); cur = []; size = 0; } };
    for (const s of S.list('sub', (x) => x.grade === g)) for (const a of S.list('act', (x) => x.sub === s.id)) {
      const t = a.src && a.src.x ? a.src.x.trim() : ''; if (!t) continue;
      const blk = `<${g}학년 · ${s.name}${a.title ? ' · ' + a.title : ''}>\n${t}`;
      if (cur.length && size + blk.length > LIMIT) flush();
      cur.push(blk); size += blk.length;
    }
    flush();
    mine.forEach((b, i) => { b.label = `${g}학년` + (mine.length > 1 ? ` ${i + 1}/${mine.length}` : ''); out.push(b); });
  }
  return out;
}

// opts: { onDone(결과) }
export function renderRefExtract(box, opts = {}) {
  const bs = refBatches();
  const code = h('input', { class: 'inp', type: 'password', placeholder: '이용 코드' });
  const ta = h('textarea', { class: 'inp tall', rows: 9, placeholder: 'AI가 준 코드 블록 전체를 여기에 붙여 넣으세요 (나눠서 받았다면 이어서 계속 붙여 넣어도 돼요)' });
  const prev = h('div', { class: 'stack' });
  let refs = [];

  const copyBtn = (b) => h('button', { class: 'btn', onclick: async () => {
    try {
      const ok = await copyText(async () => `${await getPrompt('ref', code.value)}\n[생기부 전체]\n${b.text}\n`);
      toast(ok ? `${b.label}을 복사했어요. AI에 붙여 넣으세요.` : '복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.');
    } catch (e) { toast(e.message || '복사하지 못했어요'); }
  } }, `${b.label} 복사 (활동 ${b.n}개)`);

  const analyze = () => {
    refs = parseRefCode(ta.value);
    if (!refs.length) { prev.replaceChildren(...(ta.value.trim() ? [h('p', { class: 'err' }, '코드를 찾지 못했어요. AI가 준 코드 블록 전체를 붙여 넣어 주세요.')] : [])); return; }
    const have = new Set(S.list('ref').map((r) => r.title));
    const fresh = refs.filter((r) => !have.has(r.title)).length;
    prev.replaceChildren(...[
      h('p', null, `참고자료 ${refs.length}개를 찾았어요` + (fresh < refs.length ? ` (새 자료 ${fresh}개, 나머지는 기존 자료의 빈 칸만 채워요)` : '') + '.'),
      ...refs.slice(0, 40).map((r) => h('div', { class: 'list-item' }, h('span', { class: 'grow' }, r.title), h('span', { class: 'tag' }, (r.grade ? r.grade + '학년' : '공통') + (r.kind ? ' · ' + r.kind : '')))),
      refs.length > 40 ? h('p', { class: 'sub' }, `외 ${refs.length - 40}개`) : null,
      h('div', { class: 'row end' }, h('button', { class: 'btn solid', onclick: () => {
        const r = applyRefCode(refs);
        toast(`참고자료 ${r.made}개 추가${r.merged ? `, ${r.merged}개는 기존 자료에 합침` : ''}`);
        opts.onDone && opts.onDone(r);
      } }, '참고자료에 넣기'))].filter(Boolean));
  };

  box.append(...[
    h('div', { class: 'note' }, h('b', null, '참고자료 자동 추출이란?'),
      '내 생기부 글 전체를 AI에 보내면, 생기부에 나온 책·논문·기사·이론·개념을 찾아 참고자료로 정리해 줘요. 어느 활동에서 쓰였는지도 함께 적어 줘요.',
      h('div', { class: 'pre mt' }, '① 아래에서 학년별로 "복사"를 눌러요. 내 생기부 글이 안내문에 자동으로 들어 있어요.\n② 평소 쓰는 AI(ChatGPT·Claude 등)에 붙여 넣어요. 여러 번이면 번호 순서대로 각각 보내세요.\n③ AI가 준 코드 블록을 아래 칸에 붙여 넣어요. 여러 번 받았으면 이어서 붙여 넣으면 돼요.\n④ 미리보기를 확인하고 "참고자료에 넣기"를 눌러요.'),
      h('div', { class: 'sub mt' }, 'AI가 책 내용을 잘못 알 수 있어요. "확인 필요"나 【 】로 표시된 부분은 직접 확인해서 고쳐 주세요. 복사하는 내용에는 생기부 원문이 들어가서 AI 서비스로 전송돼요. 믿을 수 있는 서비스에서만 쓰세요.')),
    !bs.length ? h('div', { class: 'note' }, h('b', null, '먼저 생기부 원문이 필요해요'), '원문이 있는 활동이 없어요. 자료 탭에서 생기부를 먼저 넣어 주세요.') : null,
    h('div', { class: 'card stack' }, h('b', null, '1. 생기부 복사 → AI에 붙여 넣기'), packLocked() ? code : null,
      h('div', { class: 'chips' }, ...bs.map(copyBtn))),
    h('div', { class: 'card stack' }, h('b', null, '2. AI가 준 코드 붙여 넣기'), ta,
      h('div', { class: 'row tight' },
        h('button', { class: 'btn', onclick: async () => { const [file] = await pickFile('.txt,.md'); if (!file) return; const t = await file.text(); ta.value = ta.value ? ta.value + '\n' + t : t; analyze(); } }, '파일로 넣기'),
        h('button', { class: 'btn solid', onclick: analyze }, '분석하기')), prev)].filter(Boolean));
  ta.addEventListener('input', () => { clearTimeout(ta._t); ta._t = setTimeout(analyze, 400); });
}

export function openRefExtract(onDone) {
  const body = h('div', { class: 'stack' });
  const m = modal('생기부에서 참고자료 추출', body, { wide: true });
  renderRefExtract(body, { onDone: (r) => { m.close(); onDone && onDone(r); } });
}
