// 제작자용 도구 화면: 프롬프트 2개(convert, ref)를 암호화해서 qprompt.js 로 내려받는다.
// 암호화 방식은 prompt-pack.js 의 buildPack 과 같다 (경로 문제를 피하려고 여기에 그대로 넣음).
const enc = new TextEncoder();
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const PACK_ITER = 150000;
async function buildPack(text, code) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', enc.encode(code || 'sgb-pack-v1'), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PACK_ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return { v: 1, locked: !!code, salt: b64(salt), ct: b64(out) };
}
const toModule = (pack) => `// 자동 생성 파일 (tools/prompt-pack.html 로 만든 암호화된 프롬프트 묶음). 직접 수정하지 마세요.\nexport const PACK = ${JSON.stringify(pack)};\n`;

const $ = (id) => document.getElementById(id);
$('go').addEventListener('click', async () => {
  const msg = $('msg'); msg.textContent = '';
  const convert = $('p0').value.trim(), ref = $('p1').value.trim();
  if (!convert || !ref) { msg.textContent = '두 칸을 모두 채워 주세요.'; return; }
  const code = $('c').value.trim();
  const btn = $('go'); btn.disabled = true; msg.textContent = '만드는 중…';
  try {
    const pack = await buildPack(JSON.stringify({ convert, ref }), code);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toModule(pack)], { type: 'text/javascript' }));
    a.download = 'qprompt.js'; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    msg.textContent = code ? 'qprompt.js를 만들었어요. 이용 코드를 사용자에게 따로 알려 주세요.' : 'qprompt.js를 만들었어요. 사이트의 qprompt.js 를 이 파일로 바꿔 주세요.';
  } catch (e) { msg.textContent = '실패했어요: ' + e.message; } finally { btn.disabled = false; }
});
