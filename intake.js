// 가져오기 공통: 과목/활동 만들기, 분류 결과 적용, 참고자료 AI 코드 해석
import * as S from './store.js';
import { tf } from './hl.js';

function pickColor(grade) {
  const used = new Set(S.list('sub', (s) => s.grade === grade).map((s) => s.color));
  for (let i = 0; i < 6; i++) if (!used.has(i)) return i;
  return used.size % 6;
}
export function ensureSubject(grade, name) {
  name = name.trim();
  return S.list('sub', (s) => s.grade === grade && s.name === name)[0] || S.create('sub', { grade, name, color: pickColor(grade) });
}
export function addActivity(sub, props = {}) {
  const n = S.list('act', (a) => a.sub === sub).length + 1;
  return S.create('act', { sub, title: `활동 ${n}`, imp: 0, done: false, src: tf(), ...props });
}
export function autoTitle(piece) {
  const t = piece.replace(/^\s*(?:\(\s*\d\s*학기\s*\))?[^:\n]{1,18}:\s*/, '').trim() || piece.trim();
  return t.length > 16 ? t.slice(0, 16) + '…' : t || '활동';
}

// 분류 결과(rows: {grade,label,text}) → 과목/활동. split이면 문단마다 활동
export function applyEntries(rows, split = true) {
  let made = 0, skip = 0;
  for (const r of rows) {
    const s = ensureSubject(r.grade, r.label);
    const exist = S.list('act', (a) => a.sub === s.id);
    const paras = r.text.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    const pieces = split ? paras : [paras.join('\n')];
    let reuse = exist.length === 1 && !exist[0].src.x ? exist[0] : null;
    for (const piece of pieces) {
      if (S.list('act', (a) => a.sub === s.id).some((a) => a.src.x.trim() === piece)) { skip++; continue; }
      if (reuse) { S.patch(reuse.id, { src: tf(piece), title: autoTitle(piece) }); reuse = null; }
      else addActivity(s.id, { src: tf(piece), title: autoTitle(piece) });
      made++;
    }
  }
  return { made, skip };
}

// ---------- 참고자료 AI 코드 ----------
const RK = { 종류: 'kind', 학년: 'grade', 설명: 'desc', 활용처: 'usage', 내용: 'body', 면접문장: 'line' };
export function parseRefCode(text) {
  const out = []; let cur = null, field = null;
  for (const raw of String(text || '').replace(/＠/g, '@').split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) continue;
    const m = raw.match(/^\s*@@\s*([가-힣]+)\s*(.*)$/);
    if (m && m[1] === '참고') { cur = { title: m[2].trim(), kind: '', grade: 0, desc: '', usage: '', body: '', line: '' }; out.push(cur); field = null; continue; }
    if (m && cur && RK[m[1]]) {
      const k = RK[m[1]], v = m[2].trim();
      if (k === 'grade') { cur.grade = +(v.match(/[123]/) || [0])[0]; field = null; }
      else if (k === 'kind') { cur.kind = v; field = null; }
      else { field = k; if (v) cur[k] += v + '\n'; }
      continue;
    }
    if (cur && field) cur[field] += raw + '\n';
  }
  return out.map((r) => ({ ...r, desc: r.desc.trim(), usage: r.usage.trim(), line: r.line.trim(), body: (r.body.trim() + (r.line.trim() ? '\n\n【면접 문장】\n' + r.line.trim() : '')).trim() })).filter((r) => r.title);
}
export function applyRefCode(refs) {
  let made = 0, merged = 0;
  for (const r of refs) {
    const ex = S.list('ref', (x) => x.title === r.title)[0];
    if (ex) { merged++; const p = {}; if (!(ex.desc && ex.desc.x.trim()) && r.desc) p.desc = tf(r.desc); if (!(ex.usage && ex.usage.x.trim()) && r.usage) p.usage = tf(r.usage); if (!(ex.body && ex.body.x.trim()) && r.body) p.body = tf(r.body); if (Object.keys(p).length) S.patch(ex.id, p); continue; }
    S.create('ref', { title: r.title, kind: r.kind, grade: r.grade, desc: tf(r.desc), usage: tf(r.usage), body: tf(r.body) }); made++;
  }
  return { made, merged };
}
