// 파일 읽기: PDF(생기부)·DOCX·TXT 에서 글을 꺼내고, 생기부를 학년 · 과목(영역) · 문단으로 나눈다.
// 모두 이 기기 안에서만 처리한다 (pdf.js 는 같은 폴더의 pdf.min.js / pdf.worker.min.js 를 쓴다).
let pdfjsP = null;
function pdfjs() {
  if (!pdfjsP) pdfjsP = import('./pdf.min.js').then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.js', import.meta.url).href;
    return m;
  });
  return pdfjsP;
}

// ---------- PDF → 줄 ----------
// 반환: 쪽마다 줄 배열. 줄 = { text, x, xEnd, y, h, cells:[{text,x,xEnd}] }  (y 는 위에서 아래로 커지는 값)
export async function pdfLines(file) {
  const lib = await pdfjs();
  const base = new URL('./', import.meta.url).href;
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: base, cMapPacked: true, isEvalSupported: false, useSystemFonts: false }).promise;
  const pages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const H = page.view[3] - page.view[1];
      const tc = await page.getTextContent();
      const items = tc.items.filter((it) => typeof it.str === 'string' && it.str.length && it.transform)
        .map((it) => ({ s: it.str, x: it.transform[4], y: H - it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 10 }));
      pages.push(groupLines(items));
      page.cleanup();
    }
  } finally { doc.destroy(); }
  return pages;
}

function groupLines(items) {
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of items) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(it.y - r.y) <= Math.max(2, Math.min(r.h, it.h) * 0.45)) { r.items.push(it); r.h = Math.max(r.h, it.h); }
    else rows.push({ y: it.y, h: it.h, items: [it] });
  }
  const out = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const it of r.items) {
      const c = cells[cells.length - 1];
      const gap = c ? it.x - c.xEnd : 0;
      if (c && gap <= r.h * 0.9) {
        if (gap > r.h * 0.2 && !c.text.endsWith(' ') && !it.s.startsWith(' ')) c.text += ' ';
        c.text += it.s; c.xEnd = Math.max(c.xEnd, it.x + it.w);
      } else cells.push({ text: it.s, x: it.x, xEnd: it.x + it.w });
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, ' ').trim();
    const cs = cells.filter((c) => c.text);
    if (!cs.length) continue;
    out.push({ text: cs.map((c) => c.text).join(' '), x: cs[0].x, xEnd: cs[cs.length - 1].xEnd, y: r.y, h: r.h, cells: cs });
  }
  return out;
}

// ---------- 줄 → 문단 (이어지는 줄을 합치기) ----------
const END = /[.!?。]["'”’)\]]*\s*$/;
const SEM = /^\(\s*[12]\s*학기\s*\)/;
function rightEdge(lines) { let m = 0; for (const l of lines) m = Math.max(m, l.xEnd); return m; }

// 글 줄들(위→아래)을 문단으로. 문장이 끝났고 줄이 짧거나, "(1학기)" 같은 표시로 시작하면 새 문단
function toParas(segs, edge) {
  // 같은 쪽에서 글줄 사이의 보통 간격(중앙값). 표의 칸이 바뀌면 칸 여백 때문에 간격이 이보다 넓다
  const gaps = [];
  for (let i = 1; i < segs.length; i++) if (segs[i].page === segs[i - 1].page) { const d = segs[i].y - segs[i - 1].y; if (d > 0) gaps.push(d); }
  gaps.sort((a, b) => a - b);
  const pitch = gaps.length ? gaps[Math.floor(gaps.length * 0.4)] : 0;
  const out = []; let cur = null, prev = null;
  for (const s of segs) {
    const hh = Math.max(prev ? prev.h : s.h, 8);
    const brk = !cur || SEM.test(s.text)
      || (END.test(prev.text) && prev.xEnd < edge - hh * 2.5)
      || (s.page === prev.page && s.y - prev.y > Math.max(pitch * 1.3, hh * 1.9));
    if (brk) { cur = { text: s.text, page: s.page, yTop: s.y, yBot: s.y, h: s.h }; out.push(cur); }
    else {
      // 줄이 바뀐 곳은 낱말 중간일 수도 있어서, 문장이 끝났거나 영문·숫자·괄호일 때만 띄어 쓴다
      cur.text += (/[.!?)\]\dA-Za-z,]$/.test(cur.text) || /^[(\[A-Za-z0-9]/.test(s.text) ? ' ' : '') + s.text;
      if (s.page === cur.page) cur.yBot = s.y;
    }
    prev = s;
  }
  return out;
}

// 머리글·쪽번호·표 제목줄 같은 잡음
const NOISE = [/^[-–—]\s*\d{1,3}\s*[-–—]$/, /^\d{1,3}\s*\/\s*\d{1,3}$/, /^학년\s.*(특기사항|종합의견|독서)/, /^학교\s*생활\s*기록부/, /^(성\s*명|학\s*번|주\s*민|생\s*년|학\s*교\s*명)\s*[:：]?/, /^(학년|학기)\s+(창의|교과|과목)/, /^창의적\s*체험\s*활동\s*영역\s*특기\s*사항$/, /^(과목|교과)\s*세부\s*능력\s*및\s*특기\s*사항$/, /^특기\s*사항$/, /^영\s*역\s*특\s*기\s*사\s*항$/, /^(과목\s*또는\s*영역\s*)?독서\s*활동\s*상황$/, /^\*+\s*$/];
const isNoise = (t) => NOISE.some((r) => r.test(t.trim()));
const ns = (t) => t.replace(/\s+/g, '');

const SECTION = [
  [/^(\d+\.?)?창의적체험활동상황$/, 'creative'],
  [/^(\d+\.?)?교과학습발달상황$/, 'grades'],
  [/세부능력및특기사항$|^개인별세부능력/, 'subject'],
  [/^(\d+\.?)?독서활동상황$/, 'reading'],
  [/^(\d+\.?)?행동특성및종합의견$/, 'behavior'],
  [/^(\d+\.?)?(인적·?학적사항|인적사항|학적사항|출결상황|수상경력|자격증및인증취득상황|자격증|진로희망사항|봉사활동실적|봉사활동상황|학교폭력.*|체육·?예술.*)$/, 'skip'],
];
function sectionOf(t) {
  const n = ns(t); if (n.length > 40) return null;
  for (const [re, k] of SECTION) if (re.test(n)) return k;
  return null;
}
const AREAS = ['자율활동', '자치활동', '동아리활동', '봉사활동', '진로활동'];
const gradeOfText = (t) => { const m = t.trim().match(/^[\[<(【\s]*([123])\s*학년[\]>)】\s]*$/); return m ? +m[1] : 0; };

// ---------- 생기부 PDF 줄 → [{grade,label,kind,text}] ----------
export function parseSaenggibu(pages) {
  const sections = []; // {kind, segs:[], labels:[], gradeHead, edge}
  let cur = null, gradeHead = 0;
  for (let pi = 0; pi < pages.length; pi++) {
    // ① 이 쪽의 줄을 구역(창의적 체험활동 / 세특 / …)별 덩어리로 나눈다
    const chunks = [];
    let ck = null;
    for (const l0 of pages[pi]) {
      const l = { ...l0, page: pi };
      const sec = sectionOf(l.text);
      if (sec) { cur = { kind: sec, segs: [], labels: [], gradeHead, edge: 0 }; sections.push(cur); ck = null; continue; }
      const g = gradeOfText(l.text);
      if (g) { gradeHead = g; if (cur) cur.labels.push({ type: 'grade', v: g, y: l.y, page: pi, head: true }); continue; }
      if (!cur || cur.kind === 'skip' || cur.kind === 'grades' || isNoise(l.text)) continue;
      if (!ck || ck.sec !== cur) { ck = { sec: cur, lines: [] }; chunks.push(ck); }
      ck.lines.push(l);
    }
    // ② 덩어리마다 글 칸의 왼쪽 위치(가장 흔한 시작 x)를 찾는다. 학년·영역·과목 이름 칸은 그보다 왼쪽에 있다
    for (const { sec, lines } of chunks) {
      const hist = new Map();
      for (const l of lines) for (const c of l.cells) if (c.text.length >= 15) { const k = Math.round(c.x / 4) * 4; hist.set(k, (hist.get(k) || 0) + 1); }
      let textX = Infinity, best = 0;
      for (const [k, n] of hist) if (n > best || (n === best && k < textX)) { best = n; textX = k; }
      sec.edge = Math.max(sec.edge, rightEdge(lines.filter((l) => l.text.length >= 15)));
      for (const l of lines) {
        let cells = l.cells; let i = 0;
        const dm = sec.kind !== 'subject' && cells[0].text.match(/^([123])\s+(\S.*)$/);
        if (dm) cells = [{ text: dm[1], x: cells[0].x, xEnd: cells[0].x + 6 }, { ...cells[0], text: dm[2], x: cells[0].x + 7 }, ...cells.slice(1)];
        while (i < cells.length && ((cells[i].x < textX - 10 && cells[i].text.length <= 22 && !END.test(cells[i].text)) || (i === 0 && sec.kind !== 'subject' && /^[123]$/.test(cells[0].text)))) {
          const t = cells[i].text;
          if (/^[123]$/.test(t)) sec.labels.push({ type: 'grade', v: +t, y: l.y, page: pi });
          else sec.labels.push({ type: 'name', v: t, y: l.y, page: pi });
          i++;
        }
        let body = cells.slice(i).map((c) => c.text).join(' ').trim();
        if (!body) continue;
        // 이름표 칸을 못 찾은 경우(글 칸 구분이 안 되는 PDF): "자율활동 내용…" 처럼 앞에 영역 이름이 붙어 있으면 떼어 낸다
        if (i === 0 && sec.kind === 'creative') {
          const a = AREAS.find((x) => body.startsWith(x));
          if (a) { sec.labels.push({ type: 'name', v: a, y: l.y, page: pi }); body = body.slice(a.length).trim(); }
        }
        if (body) sec.segs.push({ text: body, x: l.x, xEnd: l.xEnd, y: l.y, h: l.h, page: pi });
      }
    }
  }

  const entries = []; // 순서 유지
  const add = (grade, label, kind, text) => {
    text = text.trim(); if (!text) return;
    let e = entries.find((x) => x.grade === grade && x.label === label);
    if (!e) { e = { grade, label, kind, text: '' }; entries.push(e); }
    e.text += (e.text ? '\n' : '') + text;
  };

  for (const sec of sections) {
    if (!sec.segs.length) continue;
    const paras = toParas(sec.segs, sec.edge || 0);
    const near = (p, type) => {
      let best = null, bd = Infinity;
      for (const lb of sec.labels) {
        if (lb.type !== type || lb.head) continue;
        const d = lb.page === p.page ? Math.max(0, p.yTop - p.h - lb.y, lb.y - p.yBot - p.h) : Infinity;
        if (d < bd && d <= Math.max(p.h, 8) * 1.2) { bd = d; best = lb; }
      }
      return best;
    };
    let lastName = '', lastGrade = sec.gradeHead || 0;
    if (sec.kind === 'creative') {
      // 학년 칸은 여러 영역에 걸쳐 가운데 정렬되어 있으므로, "자율활동으로 되돌아올 때마다 다음 학년"으로 센다
      const gs = sec.labels.filter((l) => l.type === 'grade' && !l.head).map((l) => l.v);
      let gi = -1, prevRank = 99;
      for (const p of paras) {
        const lb = near(p, 'name'); let area = lb ? lb.v : lastName; if (lb) lastName = lb.v;
        const a = AREAS.find((x) => area.replace(/\s+/g, '').startsWith(x)); if (!a) continue;
        const rank = AREAS.indexOf(a);
        if (rank <= prevRank && (a === '자율활동' || a === '자치활동' || gi < 0)) gi++;
        prevRank = rank;
        const grade = gs[Math.min(gi, gs.length - 1)] || (sec.gradeHead || 1) + Math.max(gi, 0);
        if (a === '봉사활동') continue;
        add(grade, a === '자치활동' ? '자율활동' : a, '창의적 체험활동', p.text);
      }
    } else if (sec.kind === 'subject') {
      for (const p of paras) {
        const nm = near(p, 'name'); if (nm) lastName = nm.v;
        const g = gradeFromHead(sec, p) || lastGrade; lastGrade = g;
        add(g || 1, (nm ? nm.v : lastName) || '교과 세부능력', '교과', p.text);
      }
    } else if (sec.kind === 'behavior' || sec.kind === 'reading') {
      const label = sec.kind === 'behavior' ? '행동특성 및 종합의견' : '독서활동상황';
      for (const p of paras) {
        const lb = near(p, 'grade'); const g = lb ? lb.v : (gradeFromHead(sec, p) || lastGrade); lastGrade = g || lastGrade;
        add(g || 1, label, sec.kind === 'behavior' ? '행동특성' : '독서', p.text);
      }
    }
  }
  return entries.filter((e) => e.text.trim().length >= 10);
}
// "1학년" 제목줄이 글 앞쪽에 있었으면 그 학년. 글 문단 앞에 나온 마지막 제목을 쓴다
function gradeFromHead(sec, p) {
  let g = 0;
  for (const l of sec.labels) if (l.head && (l.page < p.page || (l.page === p.page && l.y <= p.yTop + 1))) g = l.v;
  return g || sec.gradeHead || 0;
}

// ---------- 줄 → 통글 ----------
export function pdfPlainText(pages) {
  const out = [];
  for (const lines of pages) {
    const ls = lines.filter((l) => !isNoise(l.text)).map((l, i) => ({ ...l, page: 0 }));
    if (!ls.length) continue;
    ls.sort((a, b) => a.y - b.y || a.x - b.x);
    const segs = ls.map((l) => ({ text: l.text, x: l.x, xEnd: l.xEnd, y: l.y, h: l.h, page: 0 }));
    for (const p of toParas(segs, rightEdge(ls))) out.push(p.text);
  }
  return out.join('\n').trim();
}

// ---------- 붙여 넣은 글 → 과목별 ----------
// "국어: 내용" 이나 "[국어]" 제목 줄로 과목을 나눈다. 줄 하나가 문단 하나
export function parseBulkText(text, grade) {
  const entries = []; let label = '';
  const put = (lb, t) => {
    t = t.trim(); if (!t) return;
    let e = entries.find((x) => x.label === lb);
    if (!e) { e = { grade, label: lb, kind: '', text: '' }; entries.push(e); }
    e.text += (e.text ? '\n' : '') + t;
  };
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim(); if (!line) continue;
    const head = line.match(/^[\[【<]\s*([^\]】>]{1,30}?)\s*[\]】>]\s*$/);
    if (head) { label = head[1].trim(); continue; }
    const kv = line.match(/^(?:\(\s*[12]\s*학기\s*\)\s*)?([^:：.,。!?]{1,20}?)\s*[:：]\s*(\S.*)$/);
    if (kv && !/다$/.test(kv[1].trim()) && !/\s{2,}/.test(kv[1])) { label = kv[1].trim(); put(label, kv[2]); continue; }
    put(label || '기타', line);
  }
  return entries;
}

// ---------- 파일 → 글 ----------
export async function extractText(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return pdfPlainText(await pdfLines(file));
  if (name.endsWith('.docx')) {
    if (typeof JSZip === 'undefined') throw new Error('docx 를 읽는 도구를 불러오지 못했어요');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const f = zip.file('word/document.xml'); if (!f) throw new Error('docx 파일이 아니에요');
    const xml = await f.async('string');
    return xml.replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  return (await file.text()).replace(/\r\n?/g, '\n').trim();
}
