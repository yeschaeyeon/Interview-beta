// 암호화 도구
// ① 데이터 키(DEK) 32바이트를 무작위로 만들고, 비밀번호와 복구 키 각각으로 감싸서(meta) 저장한다.
// ② 저장하는 모든 데이터(상태·녹음·영상)는 DEK로 AES-256-GCM 암호화한다.
// ③ 비밀번호 → 키는 PBKDF2(SHA-256)로 만든다. 서버가 없으므로 비밀번호를 잃으면 복구할 수 없다.
const enc = new TextEncoder(), dec = new TextDecoder();
const subtle = crypto.subtle;
const PW_ITER = 600000, RK_ITER = 100000;
const CHUNK = 4 * 1024 * 1024; // 녹음·영상은 4MB씩 끊어서 암호화 (큰 파일도 한꺼번에 메모리에 올리지 않음)

export const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
export const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(secret, salt, iter, usages) {
  const base = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, usages);
}
// 프롬프트 묶음(qprompt.js)을 여는 키: 이용 코드 → 키
export const kdf = (code, salt, iter) => pbkdf2(String(code), salt, iter, ['decrypt']);

async function seal(key, bytes) {
  const iv = rand(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
// [iv 12바이트][암호문] → 평문. 키가 틀리거나 손상되면 오류
export async function open(key, bytes) {
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
}
export const dekKey = (raw) => subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

// ---- 복구 키: 헷갈리는 글자(I, L, O, U)를 뺀 32글자로 24자 = 120비트 ----
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newRecoveryKey() {
  const r = rand(24); let s = '';
  for (let i = 0; i < 24; i++) { s += ALPHA[r[i] & 31]; if (i % 4 === 3 && i < 23) s += '-'; }
  return s;
}
const normRk = (s) => String(s || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');

// ---- 감싸기: 비밀번호/복구 키로 만든 키로 DEK를 암호화해 meta에 보관 ----
async function wrap(secret, iter, raw) {
  const salt = rand(16);
  const k = await pbkdf2(secret, salt, iter, ['encrypt']);
  return { salt: b64(salt), iter, ct: b64(await seal(k, raw)) };
}
async function unwrapOne(w, secret) {
  if (!w) return null;
  try { const k = await pbkdf2(secret, unb64(w.salt), w.iter, ['decrypt']); return await open(k, unb64(w.ct)); } catch { return null; }
}
export async function createMeta(password, recoveryKey, raw) {
  return { v: 1, pw: await wrap(password, PW_ITER, raw), rk: await wrap(normRk(recoveryKey), RK_ITER, raw) };
}
// which: 'pw' | 'rk'. 맞으면 DEK(원본 32바이트), 틀리면 null
export async function unwrap(meta, secret, which) {
  if (!meta) return null;
  return unwrapOne(meta[which], which === 'rk' ? normRk(secret) : String(secret));
}
// 비밀번호 또는 복구 키 어느 쪽이든 맞으면 DEK
export async function unwrapAny(meta, secret) {
  return (await unwrap(meta, secret, 'pw')) || (await unwrap(meta, secret, 'rk'));
}
export async function rewrapPw(meta, newPassword, raw) { return { ...meta, pw: await wrap(newPassword, PW_ITER, raw) }; }
export async function rewrapRk(meta, recoveryKey, raw) { return { ...meta, rk: await wrap(normRk(recoveryKey), RK_ITER, raw) }; }

// ---- 상태(JSON) ----
export const sealJSON = (key, obj) => seal(key, enc.encode(JSON.stringify(obj)));
export async function openJSON(key, bytes) { return JSON.parse(dec.decode(await open(key, bytes))); }

// ---- 녹음·영상(Blob): [길이 4바이트][iv+암호문] 조각을 이어 붙인 Blob ----
export async function sealBlob(key, blob) {
  const parts = [];
  for (let off = 0; off < blob.size || off === 0; off += CHUNK) {
    const sealed = await seal(key, new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer()));
    const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, sealed.length);
    parts.push(len, sealed);
    if (blob.size === 0) break;
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}
export async function openBlob(key, blob, type) {
  const out = []; let off = 0;
  while (off < blob.size) {
    const len = new DataView(await blob.slice(off, off + 4).arrayBuffer()).getUint32(0);
    out.push(await open(key, new Uint8Array(await blob.slice(off + 4, off + 4 + len).arrayBuffer())));
    off += 4 + len;
  }
  return new Blob(out, { type: type || 'application/octet-stream' });
}
