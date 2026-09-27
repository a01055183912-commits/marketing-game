/* 캠페인 기획 연습장 · 화면 로직 (외부 라이브러리 없음)
   - 개인 진도(본 장·아는 용어·게임 최고점)는 브라우저에 저장
   - 조별 활동지·게임 점수·평가·강사 제어는 서버에 저장해 모두에게 공유 */
'use strict';

/* ───────────── 공통 도구 ───────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
const won = (n) => Math.round(n).toLocaleString('ko-KR');
const man = (n) => n >= 1e8 ? (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + '억' : n >= 1e4 ? (n / 1e4).toFixed(1).replace(/\.0$/, '') + '만' : won(n);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } },
};
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(arr, seed) { const r = seed == null ? Math.random : rng(seed); const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('save failed');
  return r.json();
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2200); }

/* ───────────── 가이드 데이터 가공 ───────────── */
const SLIDES = GUIDE.slides;
const SL = (n) => SLIDES[n - 1];
const TERMS = GUIDE.glossary.flatMap((c) => c.terms.map((t) => ({ ...t, cat: c.cat })));
const termKeys = (t) => t.split(/\s*\/\s*|\s*\(|\)/).map((x) => x.trim()).filter((x) => x.length >= 2);
const slideText = (s) => [s.title, s.core, s.one, ...s.know, ...s.bullets, ...s.script.map((x) => x.say || x.do), s.steps, s.watch, s.next, ...s.table.flat()].join(' ');
const SLIDE_TERMS = SLIDES.map((s) => { const tx = slideText(s); return TERMS.filter((t) => termKeys(t.t).some((k) => tx.includes(k))).map((t) => t.t); });
const TERM_SLIDES = Object.fromEntries(TERMS.map((t) => [t.t, SLIDES.filter((s, i) => SLIDE_TERMS[i].includes(t.t)).map((s) => s.no)]));
const stageOf = (n) => STAGES.find((g) => n >= g.from && n <= g.to);
const SHEET = (ws) => SHEETS.find((s) => s.id === ws);
const sheetBySlide = (n) => SHEETS.find((s) => s.slide === n || s.ex === n);
const isEx = (n) => SHEETS.some((s) => s.ex === n);
const GAME = (id) => GUIDE.games.find((g) => g.id === id);

/* ───────────── 상태 ───────────── */
let S = { v: 0, teams: {}, sheets: {}, games: {}, evals: {}, control: { teamCount: 4, bingoSeed: 1, bingoIdx: -1 }, scores: { s: [0, 0, 0, 0, 0, 0] } };
let V = 0;
let TEAM = store.get('cp2_team', '');
const IS_TEACHER = () => location.hash === '#teacher';
let view = store.get('cp2_view', 'home');
let cur = { slide: store.get('cp2_slide', 1), sheet: store.get('cp2_sheet', 'w1'), game: null, ref: 'w1', gcat: '', gq: '', gmode: 'list' };
const P = { seen: new Set(store.get('cp2_seen', [])), known: new Set(store.get('cp2_known', [])), best: store.get('cp2_best', {}), hide: store.get('cp2_hide', false), big: false };
const saveP = () => { store.set('cp2_seen', [...P.seen]); store.set('cp2_known', [...P.known]); store.set('cp2_best', P.best); store.set('cp2_hide', P.hide); };
const pending = {}; const timers = {};

const teamNo = (t) => Number(String(t).replace('team', ''));
const teamIds = () => Array.from({ length: S.control.teamCount || 4 }, (_, i) => 'team' + (i + 1));
const teamName = (t) => (S.teams[t] && S.teams[t].name) ? `${teamNo(t)}조 · ${S.teams[t].name}` : `${teamNo(t)}조`;
const sheetOf = (t, ws) => ((S.sheets[t] || {})[ws]) || {};
const exLocked = () => !!S.control.lockEx && !IS_TEACHER();

function applyPending() {
  for (const [key, v] of Object.entries(pending)) { const [t, ws, k] = key.split('|'); const tt = (S.sheets[t] = S.sheets[t] || {}); const w = (tt[ws] = tt[ws] || {}); w[k] = v; }
}
function save(ws, k, v, t = TEAM) {
  if (!t) { toast('먼저 우리 조를 고르십시오.'); return; }
  const key = `${t}|${ws}|${k}`; pending[key] = v; applyPending();
  clearTimeout(timers[key]);
  timers[key] = setTimeout(async () => {
    try { await api('/api/sheet', { team: t, ws, k, v }); if (pending[key] === v) delete pending[key]; setOnline(true); }
    catch (e) { setOnline(false); timers[key] = setTimeout(() => save(ws, k, pending[key] ?? v, t), 3000); }
  }, 500);
}
function control(key, value) { S.control[key] = value; return api('/api/control', { key, value }).then(() => poll()).catch(() => toast('저장 실패')); }
function setOnline(ok) { const d = $('#net'); if (d) { d.textContent = ok ? '저장됨' : '연결 끊김 · 다시 시도 중'; d.className = 'net ' + (ok ? 'ok' : 'bad'); } }
async function poll() {
  try {
    const r = await fetch('/api/state?v=' + V, { cache: 'no-store' }); setOnline(true);
    if (r.status === 204) return;
    S = await r.json(); V = S.v; applyPending(); onState();
  } catch (e) { setOnline(false); }
}
function saveGame(g, data) { (S.games[g] = S.games[g] || {})[TEAM] = data; if (TEAM) api('/api/game', { team: TEAM, g, data }).catch(() => {}); }
function best(g, score) { P.best[g] = Math.max(P.best[g] || 0, score); saveP(); }

/* ───────────── 시트 스키마 도구 ───────────── */
function sheetKeys(sh) {
  const keys = [];
  for (const p of sh.parts) {
    if (p.type === 'table') p.rows.forEach((r) => p.cols.forEach((c) => { if (c.t !== 'auto' && c.t !== 'ref') keys.push(`${r.k}_${c.k}`); }));
    else if (p.type === 'fields' || p.type === 'grid4' || p.type === 'checks') p.items.forEach((i) => keys.push(i.k));
  }
  return keys;
}
function progress(t, ws) {
  const keys = sheetKeys(SHEET(ws)).filter((k) => !/_(use|pri|type|str)$|^c[1-4]$|_src$/.test(k));
  const d = sheetOf(t, ws); const filled = keys.filter((k) => String(d[k] ?? '').trim() !== '').length;
  return keys.length ? Math.round((filled / keys.length) * 100) : 0;
}
function finalSlogan(t) {
  const d = sheetOf(t, 'w4'); const f = d.final; if (!f) return '';
  const n = (d[f + '_name'] || '').trim(), s = (d[f + '_slogan'] || '').trim();
  return [n, s && `"${s}"`].filter(Boolean).join(' · ');
}

/* ───────────── 입력 요소 ───────────── */
function inputHTML(ws, key, col, val, ro, ph) {
  const a = `data-ws="${ws}" data-k="${key}" ${ro ? 'disabled' : ''}`; const v = val ?? '';
  switch (col.t) {
    case 'text': return `<textarea ${a} rows="2" placeholder="${esc(ph || '')}">${esc(v)}</textarea>`;
    case 'line': return `<input type="text" ${a} value="${esc(v)}" placeholder="${esc(ph || '')}">`;
    case 'num': return `<input type="text" inputmode="numeric" class="numin" ${a} value="${esc(v)}" placeholder="${esc(ph || '')}">`;
    case 'sel': return `<select ${a}>${col.opts.map((o) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${o === '' ? '선택' : esc(o)}</option>`).join('')}</select>`;
    case 'chk': return `<label class="chk"><input type="checkbox" ${a} ${v === 'Y' ? 'checked' : ''}><span>사용</span></label>`;
    case 'auto': return `<span class="auto num" data-auto="${key}"></span>`;
    default: return '';
  }
}
const TAGS = ['데이터', '관찰', '가정'];
const tagBar = (ws, key, ro) => ro ? '' : `<div class="tagbar">${TAGS.map((t) => `<button type="button" class="tagbtn" data-tag="${t}" data-for="${ws}|${key}">[${t}]</button>`).join('')}</div>`;
function renderParts(sh, d, ro) {
  const ws = sh.id;
  return sh.parts.map((p) => {
    if (p.type === 'table') {
      return `${p.note ? `<p class="tnote">${esc(p.note)}</p>` : ''}<div class="tblwrap"><table class="ws"><thead><tr><th class="rowh">${esc(p.head)}</th>${p.cols.map((c) => `<th class="${c.wide ? 'wide' : c.t === 'sel' ? 'mid' : ['num', 'chk'].includes(c.t) ? 'narrow' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
        ${p.rows.map((r) => `<tr><th class="rowh" scope="row">${esc(r.label)}${r.src ? `<small>${esc(r.src)}</small>` : ''}</th>
          ${p.cols.map((c) => { const key = `${r.k}_${c.k}`;
            if (c.t === 'ref') return `<td data-label="${esc(c.label)}" class="refcell">${esc(r.ref)}</td>`;
            const col = r.num ? { ...c, t: 'num' } : c;
            return `<td data-label="${esc(c.label)}">${inputHTML(ws, key, col, d[key], ro)}${c.tag ? tagBar(ws, key, ro) : ''}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>`;
    }
    if (p.type === 'fields') {
      return `${p.head ? `<h4 class="parthead">${esc(p.head)}</h4>` : ''}<div class="fields">${p.items.map((i) => `<label class="field ${i.t === 'text' ? 'full' : ''}"><span>${esc(i.label)}</span>${inputHTML(ws, i.k, i, d[i.k], ro, i.ph)}
        ${i.pull === 'insight' && !ro ? `<button type="button" class="btn sm ghost" data-act="pullInsight">③ 가장 강한 인사이트 가져오기</button>` : ''}</label>`).join('')}</div>`;
    }
    if (p.type === 'grid4') return `<div class="grid4">${p.items.map((i, n) => `<label class="story s${n + 1}"><b>${esc(i.label)}</b><small>${esc(i.sub)}</small><textarea data-ws="${ws}" data-k="${i.k}" rows="5" ${ro ? 'disabled' : ''}>${esc(d[i.k] || '')}</textarea></label>`).join('')}</div>`;
    if (p.type === 'checks') return `<div class="checks">${p.items.map((i) => `<label class="chk big"><input type="checkbox" data-ws="${ws}" data-k="${i.k}" ${d[i.k] === 'Y' ? 'checked' : ''} ${ro ? 'disabled' : ''}><span>${esc(i.label)}</span></label>`).join('')}</div>`;
    if (p.type === 'readaloud') return `<div class="readaloud" data-read="${ws}"></div>`;
    if (p.type === 'calc') return `<div class="calc" data-calc="${p.fn}"></div>`;
    if (p.type === 'pull') return ro ? '' : `<div class="pullbar"><button type="button" class="btn" data-act="pull11">①~⑩에서 가져오기 (빈 칸만)</button><button type="button" class="btn ghost" data-act="pull11all">전부 다시 가져오기</button><button type="button" class="btn ghost" data-act="print11">1페이지 인쇄 · PDF</button></div>`;
    if (p.type === 'poster') return `<div class="poster" data-poster></div>`;
    return '';
  }).join('');
}

/* ───────────── 자동 계산 · 점검 ───────────── */
const W6ROWS = () => SHEET('w6').parts[0].rows;
function w6Sums(d) { const g = { off: 0, digital: 0, infl: 0 }; let sum = 0; W6ROWS().forEach((r) => { const v = num(d[r.k + '_pct']); sum += v; g[r.grp] += v; }); return { sum, g }; }
const reached = (total, goal) => goal > 0 && total >= goal * 0.98;   // 가이드: 약 1만 + 5만 + 4만 = 약 10만 → 달성
function w6Reach(d) { const organic = num(d.followers) * num(d.rate) / 100; const total = organic + num(d.adReach) + num(d.infReach); return { organic, total, goal: num(d.reachGoal) }; }
function w9Rows(d) { const total = num(d.total); let sum = 0; const amt = {}; SHEET('w9').parts[1].rows.forEach((r) => { const p = num(d[r.k + '_pct']); sum += p; amt[r.k] = total * p / 100; }); return { total, sum, amt }; }
const badge = (ok, msg) => `<li class="${ok === true ? 'ok' : ok === false ? 'warn' : 'info'}">${ok === true ? '✓' : ok === false ? '!' : 'i'} ${msg}</li>`;
const hasNum = (s) => /\d/.test(s || '');

function checksFor(ws, t) {
  const d = sheetOf(t, ws); const out = []; const f = (k) => String(d[k] ?? '').trim() !== '';
  const w2 = sheetOf(t, 'w2'); const main = num(w2.mainNum); const prevN = num(w2.prevNum);
  if (ws === 'w1') {
    const R = ['cond', 'visit', 'insta', 'ytapp', 'rival', 'prev'];
    out.push(badge(R.filter((r) => f(r + '_ours')).length >= 3 ? true : 'info', `우리 지점 현황 ${R.filter((r) => f(r + '_ours')).length}/6칸 · 출처 ${R.filter((r) => f(r + '_src')).length}칸`));
    ['s1', 's2', 's3'].forEach((s, i) => { if (f(s + '_trend') || f(s + '_signal')) out.push(badge(hasNum(d[s + '_signal']), `신호 ${i + 1} — ${hasNum(d[s + '_signal']) ? '숫자로 확인' : '트렌드 이름만 있고 숫자가 없습니다'}`)); });
    out.push(badge(f('pick'), f('pick') ? `신호 ${d.pick}번 하나만 남김` : `딱 하나만 고르십시오`));
    out.push(badge(f('type') && f('bench'), `유형 ${esc(d.type || '—')} · 사례 ${esc(d.bench || '—')}`));
    if (f('sentence')) out.push(badge(hasNum(d.sentence) ? true : 'info', hasNum(d.sentence) ? '한 문장에 목표 숫자가 있습니다' : '한 문장 끝에 목표(숫자)를 넣으십시오'));
  } else if (ws === 'w2') {
    const pr = ['g1', 'g2', 'g3', 'g4'].map((g) => d[g + '_pri']);
    const a = pr.filter((x) => x === '주').length, b = pr.filter((x) => x === '부').length;
    out.push(badge(a === 1, `주 목표 ${a}개 (하나만)`)); out.push(badge(b === 1, `부 목표 ${b}개 (하나만)`));
    out.push(badge(main > 0, main > 0 ? `주 목표 수치 ${won(main)}${prevN ? ` · 지난번의 ${(main / prevN).toFixed(1)}배` : ''}` : '주 목표 수치를 숫자로 적으십시오'));
    out.push(badge(f('why_A') && f('why_B'), `'오지 않는 이유' ${['why_A', 'why_B'].filter(f).length}/2칸`));
  } else if (ws === 'w3') {
    ['i1', 'i2', 'i3'].forEach((i, n) => { const s = d[i + '_text'] || ''; if (!s.trim()) return;
      const ok = /때|는데|는 데|해서|어서|아서|라서|지만|면서/.test(s) && !/좋아할|좋아한다|것이다|중시한다/.test(s);
      out.push(badge(ok, `${n + 1}번 — ${ok ? '상황이 보입니다' : "'좋아할 것이다' 같은 추측인지 다시 보십시오"}`));
      if (!f(i + '_basis')) out.push(badge(false, `${n + 1}번 근거가 비어 있습니다`)); });
    out.push(badge(f('pick') && f('rival'), `가장 강한 것 ${d.pick || '—'} · 경쟁사가 안 건드린 것 ${d.rival || '—'}`));
  } else if (ws === 'w4') {
    out.push(badge(!!d.final, d.final ? `최종 ${d.final}안 — ${esc(finalSlogan(t)) || '캠페인명·슬로건을 채우십시오'}` : '최종 선택안을 고르십시오'));
    const cons = ['A', 'B', 'C'].filter((x) => f(x + '_name') && !f(x + '_con')).length; if (cons) out.push(badge(false, `걱정 칸이 빈 안 ${cons}개`));
    if (['A', 'B', 'C'].some((x) => /최고의|최상의|만나보세요/.test(d[x + '_slogan'] || ''))) out.push(badge(false, `'최고의 ○○' 같은 자랑형 문장이 있습니다`));
    out.push(badge(['c1', 'c2', 'c3', 'c4'].every((k) => d[k] === 'Y') ? true : 'info', `체크리스트 ${['c1', 'c2', 'c3', 'c4'].filter((k) => d[k] === 'Y').length}/4`));
  } else if (ws === 'w5') {
    out.push(badge(['p1', 'p2', 'p3', 'p4'].every(f), `네 칸 중 ${['p1', 'p2', 'p3', 'p4'].filter(f).length}칸`));
    if (/매출|실적|점유율/.test(d.p1 || '')) out.push(badge(false, '① 문제가 회사 문제처럼 보입니다 — 고객이 뭘 힘들어하나요?'));
    if (/최고|1등|최상/.test(d.p4 || '')) out.push(badge(false, '④에 자랑이 들어 있습니다'));
  } else if (ws === 'w6') {
    const { sum } = w6Sums(d);
    out.push(badge(sum > 0 && sum <= 100, `채널 비중 합계 ${sum}% · 나머지 ${Math.max(0, 100 - sum)}%는 ⑨에서`));
    W6ROWS().forEach((r) => { const use = d[r.k + '_use'] === 'Y', p = num(d[r.k + '_pct']);
      if (!use && p > 0) out.push(badge(false, `${esc(r.label)} — 미사용인데 ${p}%`));
      if (use && !f(r.k + '_role')) out.push(badge(false, `${esc(r.label)} — 역할을 하나 정하십시오`)); });
    if (num(d.app_pct) >= 10) out.push(badge(false, `앱 푸시 ${num(d.app_pct)}% — 신규 고객에게는 닿지 않습니다`));
    if (W6ROWS().every((r) => d[r.k + '_use'] === 'Y')) out.push(badge('info', '모든 채널에 체크했습니다 — 쓰지 않을 채널도 전략입니다'));
    const rc = w6Reach(d); if (rc.goal) out.push(badge(reached(rc.total, rc.goal), `도달 약 ${man(rc.total)} / 목표 ${man(rc.goal)}`));
  } else if (ws === 'w7') {
    const rows = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
    out.push(badge(rows.filter((s) => f(s + '_msg')).length === 7, `메시지 ${rows.filter((s) => f(s + '_msg')).length}/7`));
    out.push(badge(rows.filter((s) => f(s + '_next')).length >= 6, `넘기는 장치 ${rows.filter((s) => f(s + '_next')).length}/7`));
    const toks = finalSlogan(t).replace(/[·"'",.]/g, ' ').split(/\s+/).filter((w) => w.length >= 2);
    if (toks.length) { const hit = rows.filter((s) => toks.some((w) => (d[s + '_msg'] || '').includes(w))).length; out.push(badge(hit >= 4 ? true : 'info', `슬로건 단어가 들어간 메시지 ${hit}/7`)); }
    out.push(badge(f('break'), `끊기는 지점 ${f('break') ? '찾음' : '미작성'}`));
  } else if (ws === 'w8') {
    const R = ['period', 'place', 'partner', 'staff'];
    out.push(badge(R.every((r) => f(r + '_reason')), `근거 ${R.filter((r) => f(r + '_reason')).length}/4칸`));
    const v = ['p1', 'p2', 'p3'].map((p) => num(d['vis_' + p])); const tot = v.reduce((a, b) => a + b, 0); const peak = v[1] > v[0] && v[1] > v[2];
    if (tot) out.push(badge(peak ? true : 'info', peak ? `2주차가 피크 · 합계 ${won(tot)}명` : `3주의 강약을 다시 보십시오 · 합계 ${won(tot)}명`));
    if (tot && main) out.push(badge('info', `주 목표 ${won(main)} ÷ 방문 ${won(tot)} = 방문자의 ${Math.round(main / tot * 100)}%가 가입해야 합니다`));
  } else if (ws === 'w9') {
    const { total, sum } = w9Rows(d); const w6 = w6Sums(sheetOf(t, 'w6'));
    out.push(badge(total > 0, total ? `총예산 ${won(total)}원` : '총예산을 숫자로 적으십시오'));
    out.push(badge(sum === 100, `비중 합계 ${sum}%`)); out.push(badge(num(d.reserve_pct) > 0, `예비비 ${num(d.reserve_pct)}%`));
    if (w6.sum) {
      out.push(badge(num(d.digital_pct) === w6.g.digital, `디지털 — ⑥ ${w6.g.digital}% vs ⑨ ${num(d.digital_pct)}%`));
      out.push(badge(num(d.infl_pct) === w6.g.infl, `인플루언서·라이브 — ⑥ ${w6.g.infl}% vs ⑨ ${num(d.infl_pct)}%`));
      const off = num(d.space_pct) + num(d.content_pct); out.push(badge(off === w6.g.off ? true : 'info', `오프라인 — ⑥ ${w6.g.off}% vs ⑨ 공간+콘텐츠 ${off}%`));
    }
    if (total && main && prevN) out.push(badge(main >= prevN * 2 ? true : 'info', `1인당 ${won(total / main)}원 · 지난번 ${won(total / prevN)}원`));
  } else if (ws === 'w10') {
    const rows = ['aw', 'in', 'ac', 'cv', 'lo']; const pr = rows.filter((r) => d[r + '_pri'] === '주');
    out.push(badge(pr.length >= 1 && pr.length <= 2, `주 지표 ${pr.length}개 (1~2개)`));
    if (d.cv_pri === '주') out.push(badge(false, '매출(전환)을 주 지표로 두었습니다 — 신규 고객이 목표면 인지·행동이 먼저입니다'));
    out.push(badge(rows.filter((r) => f(r + '_meas')).length === 5, `측정 방법 ${rows.filter((r) => f(r + '_meas')).length}/5`));
    if (main) { const hit = pr.some((r) => (d[r + '_goal'] || '').replace(/,/g, '').includes(String(main))); out.push(badge(hit ? true : 'info', hit ? `주 지표에 ② 주 목표(${won(main)})가 있습니다` : `② 주 목표(${won(main)})가 주 지표의 목표값과 같은지 확인하십시오`)); }
    out.push(badge(f('q2'), `미달 시 설명 ${f('q2') ? '준비됨' : '미작성'}`));
  } else if (ws === 'w11') {
    const rows = ['tr', 'tg', 'nm', 'st', 'ch', 'op', 'bu', 'kp'];
    out.push(badge(rows.every((r) => f(r + '_txt')), `여덟 칸 중 ${rows.filter((r) => f(r + '_txt')).length}칸`));
    const w4 = sheetOf(t, 'w4'); const sl = w4.final ? (w4[w4.final + '_slogan'] || '') : '';
    const key = sl.replace(/[,."'·]/g, ' ').split(/\s+/).filter((w) => w.length >= 2).sort((a, b) => b.length - a.length)[0];
    if (key) { const hit = rows.filter((r) => (d[r + '_txt'] || '').includes(key)).length; out.push(badge(hit >= 2 ? true : 'info', `슬로건 핵심어 '${esc(key)}'가 나오는 칸 ${hit}개`)); }
  } else if (ws === 'w12') {
    const sc = ['e1', 'e2', 'e3', 'e4'].map((e) => num(d[e + '_score']));
    out.push(badge(sc.every((x) => x <= 25), `자체 평가 ${sc.reduce((a, b) => a + b, 0)} / 100`));
    out.push(badge(['e1', 'e2', 'e3', 'e4'].every((e) => f(e + '_note')), `코멘트 ${['e1', 'e2', 'e3', 'e4'].filter((e) => f(e + '_note')).length}/4`));
  }
  return out.join('');
}

function calcHTML(fn, t) {
  const d = sheetOf(t, fn); const w2 = sheetOf(t, 'w2'); const main = num(w2.mainNum); const prevN = num(w2.prevNum);
  const row = (a, b) => `<div class="calcrow"><b>${a}</b><span class="num">${b}</span></div>`;
  if (fn === 'w6') {
    const { sum, g } = w6Sums(d); const rc = w6Reach(d);
    const seg = [['off', '오프라인', 'c4'], ['digital', '디지털', 'c1'], ['infl', '인플루언서·라이브', 'c2']];
    return row('채널 비중 합계', `${sum}% · ⑨로 넘길 나머지 ${Math.max(0, 100 - sum)}%`) +
      `<div class="stack">${seg.map(([k, l, c]) => g[k] ? `<span class="${c}" style="width:${g[k]}%">${l} ${g[k]}%</span>` : '').join('')}</div>` +
      row('오가닉 도달 (팔로워 × 도달률)', `${won(rc.organic)}명`) + row('총 도달 (오가닉 + 광고 + 인플루언서)', `${won(rc.total)}명${rc.goal ? ` / 목표 ${won(rc.goal)} ${reached(rc.total, rc.goal) ? `✓ 약 ${man(rc.total)} · 달성` : '· ' + won(rc.goal - rc.total) + '명 모자람'}` : ''}`);
  }
  if (fn === 'w8') {
    const v = ['p1', 'p2', 'p3'].map((p) => num(d['vis_' + p])); const tot = v.reduce((a, b) => a + b, 0);
    return row('예상 방문객 합계', `${won(tot)}명`) + (tot ? row('주차별 비중', `오프닝 ${Math.round(v[0] / tot * 100)}% · 피크 ${Math.round(v[1] / tot * 100)}% · 마무리 ${Math.round(v[2] / tot * 100)}%`) : '');
  }
  if (fn === 'w9') {
    const { total, sum, amt } = w9Rows(d);
    return row('비중 합계', `${sum}% · ${won(total * sum / 100)}원`) +
      row('1인당 획득 비용 (총예산 ÷ ② 주 목표)', main && total ? `${won(total / main)}원` : '—') +
      row('지난번 1인당 (총예산 ÷ 지난번 실적)', prevN && total ? `${won(total / prevN)}원${main ? ` → 이번은 ${Math.round(prevN / main * 100)}% 수준` : ''}` : '—') +
      row('예비비', amt.reserve ? `${won(amt.reserve)}원` : '—');
  }
  if (fn === 'w10') {
    const total = num(sheetOf(t, 'w9').total);
    return row('② 주 목표 · 지난번', `${main ? won(main) : '—'} · ${prevN ? won(prevN) : '—'}`) + row('⑨ 1인당 획득 비용 (이번 → 지난번)', main && total ? `${won(total / main)}원 → ${prevN ? won(total / prevN) + '원' : '—'}` : '—');
  }
  if (fn === 'w12') { const sc = ['e1', 'e2', 'e3', 'e4'].map((e) => num(d[e + '_score'])); return row('자체 평가 합계', `${sc.reduce((a, b) => a + b, 0)} / 100`); }
  return '';
}

/* ⑪ 자동 채움 · 포스터 */
function gen11(t) {
  const [w1, w2, w3, w5, w6, w7, w8, w9, w10] = ['w1', 'w2', 'w3', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10'].map((ws) => sheetOf(t, ws));
  const J = (...a) => a.filter((x) => x && String(x).trim()).join(' ');
  const cut = (s, n) => { s = (s || '').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
  const pk = w1.pick ? 's' + w1.pick : ''; const mk = ['g1', 'g2', 'g3', 'g4'].find((g) => w2[g + '_pri'] === '주');
  const ch = W6ROWS().filter((r) => w6[r.k + '_use'] === 'Y').sort((a, b) => num(w6[b.k + '_pct']) - num(w6[a.k + '_pct'])).map((r) => `${r.label.split(' (')[0]} ${num(w6[r.k + '_pct'])}`).join(' · ');
  const b = w9Rows(w9); const main = num(w2.mainNum);
  const bu = SHEET('w9').parts[1].rows.filter((r) => num(w9[r.k + '_pct'])).map((r) => `${r.label.split(' · ')[0]} ${num(w9[r.k + '_pct'])}`).join(' · ');
  const vis = ['p1', 'p2', 'p3'].map((p) => num(w8['vis_' + p])).reduce((a, c) => a + c, 0);
  const kp = ['aw', 'in', 'ac', 'cv', 'lo'].filter((r) => w10[r + '_pri'] === '주').map((r) => `${w10[r + '_kpi'] || ''} ${w10[r + '_goal'] || ''}`.trim()).join(' · ');
  return {
    tr: pk ? J(`${w1[pk + '_trend'] || ''}(${cut(w1[pk + '_signal'], 50)})`, w1.type && `→ ${w1.type}`, w1.bench && `· ${w1.bench} 벤치마킹`) : '',
    tg: J(mk && `${w2[mk + '_target'] || ''} ·`, w2.age_A && `${w2.age_A} ·`, w3.pick && w3['i' + w3.pick + '_text'] && `"${cut(w3['i' + w3.pick + '_text'], 60)}"`),
    nm: finalSlogan(t),
    st: [w5.p1, w5.p2, w5.p3, w5.p4].some(Boolean) ? [w5.p1, w5.p2, w5.p3, w5.p4].map((x) => cut(x, 40)).join(' → ') : '',
    ch: J(ch && `${ch}(%)`, w7.repeat && `/ 반복 메시지: ${cut(w7.repeat, 50)}`),
    op: J(w8.period_content, w8.off_p2 && `· 피크: ${cut(w8.off_p2, 40)}`, vis && `· 방문 ${man(vis)}`),
    bu: J(b.total && `${man(b.total)}:`, bu && `${bu}(%)`),
    kp: J(kp, main && b.total && `· 1인당 ${won(b.total / main)}원`),
  };
}
function posterHTML(t) {
  const d = sheetOf(t, 'w11'); const w4 = sheetOf(t, 'w4'); const w2 = sheetOf(t, 'w2'); const w9 = sheetOf(t, 'w9'); const w8 = sheetOf(t, 'w8'); const w6 = sheetOf(t, 'w6');
  const f = w4.final; const total = num(w9.total); const main = num(w2.mainNum);
  const vis = ['p1', 'p2', 'p3'].map((p) => num(w8['vis_' + p])).reduce((a, b) => a + b, 0); const rc = w6Reach(w6); const info = S.teams[t] || {};
  const box = (h, k) => `<div class="pbox"><h4>${h}</h4><p>${esc(d[k + '_txt'] || '—')}</p></div>`;
  return `<div class="pposter"><div class="phead"><small>${esc(teamName(t))}${info.store ? ' · ' + esc(info.store) : ''} · 캠페인 기획안</small><h3>${esc(f ? w4[f + '_name'] || '캠페인명' : '캠페인명')}</h3><p class="pslogan">${esc(f ? w4[f + '_slogan'] || '' : '슬로건')}</p></div>
    <div class="pnums"><div><b class="num">${main ? won(main) : '—'}</b><span>주 목표</span></div><div><b class="num">${rc.total ? man(rc.total) : '—'}</b><span>총 도달</span></div>
      <div><b class="num">${total ? man(total) : '—'}</b><span>총예산</span></div><div><b class="num">${main && total ? won(total / main) : '—'}</b><span>1인당 비용(원)</span></div><div><b class="num">${vis ? man(vis) : '—'}</b><span>예상 방문</span></div></div>
    <div class="pgrid">${box('1 트렌드 · 방향', 'tr')}${box('2 목표 · 타깃 · 인사이트', 'tg')}${box('3 캠페인명 · 슬로건', 'nm')}${box('4 브랜드 스토리', 'st')}${box('5 채널 · IMC', 'ch')}${box('6 운영계획', 'op')}${box('7 예산', 'bu')}${box('8 KPI', 'kp')}</div></div>`;
}

/* ───────────── 틀 ───────────── */
const NAV = [['home', '홈'], ['slides', '장별 대본'], ['glossary', '용어사전'], ['game', '게임'], ['guide', '실습 가이드'], ['sheet', '캠페인 활동지'], ['compare', '프로모션 vs 캠페인'], ['present', '발표·평가']];
function renderTop() {
  const nav = NAV.concat(IS_TEACHER() ? [['teacher', '강사']] : []);
  $('#nav').innerHTML = nav.map(([k, l]) => `<button type="button" class="${view === k ? 'on' : ''}" data-view="${k}">${l}</button>`).join('');
  $('#teamSel').innerHTML = `<option value="">우리 조 선택</option>` + teamIds().map((t) => `<option value="${t}" ${TEAM === t ? 'selected' : ''}>${esc(teamName(t))}</option>`).join('');
  const known = TERMS.filter((x) => P.known.has(x.t)).length; const played = ALL_GAME_IDS.filter((g) => P.best[g] != null).length;
  const sheetPct = TEAM ? Math.round(SHEETS.reduce((a, x) => a + progress(TEAM, x.id), 0) / 12) : 0;
  const bar = (label, val, pct, v) => `<button type="button" class="pbarx" data-view="${v}"><span>${label}</span><b class="num">${val}</b><i style="--p:${pct}%"></i></button>`;
  $('#progStrip').innerHTML = bar('대본', `${P.seen.size}/56`, P.seen.size / 56 * 100, 'slides') + bar('용어', `${Math.round(known / TERMS.length * 100)}%`, known / TERMS.length * 100, 'glossary') +
    bar('게임', `${played}/${ALL_GAME_IDS.length}`, played / ALL_GAME_IDS.length * 100, 'game') + bar('활동지', TEAM ? `${sheetPct}%` : '조 선택', sheetPct, 'sheet');
  $('#scoreStrip').innerHTML = teamIds().map((t) => `<span class="${t === TEAM ? 'me' : ''}">${teamNo(t)}조 <b class="num">${totalScore(t)}</b></span>`).join('') +
    (S.control.slide && !(view === 'slides' && cur.slide === S.control.slide) ? `<button type="button" class="follow" data-follow>선생님은 지금 ${S.control.slide}장 →</button>` : '');
  renderTimer();
}
function go(v) { view = v; store.set('cp2_view', v); P.big = false; if (v === 'game') cur.game = null; render(); window.scrollTo(0, 0); }
function render() {
  if (view === 'teacher' && !IS_TEACHER()) view = 'home';
  document.body.classList.toggle('big', P.big && view === 'slides');
  renderTop();
  const fn = { home: vHome, slides: vSlides, glossary: vGlossary, game: vGame, guide: vGuide, sheet: vSheet, compare: vCompare, present: vPresent, teacher: vTeacher }[view] || vHome;
  $('#main').innerHTML = fn();
  if (view === 'sheet') { refreshSheet(); autosizeAll(); }
}
function onState() {
  renderTop();
  const a = document.activeElement; const typing = a && $('#main').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
  if (view === 'sheet') {
    const sig = [S.control.lockEx, JSON.stringify(S.teams[TEAM] || {}), num(sheetOf(TEAM, cur.sheet).hints)].join('|');
    if (onState.sig !== undefined && sig !== onState.sig && !typing) { onState.sig = sig; const y = scrollY; render(); scrollTo(0, y); return; }
    onState.sig = sig; syncInputs(); refreshSheet(); return;
  }
  if (typing) return;
  if (['teacher', 'home', 'present'].includes(view) || (view === 'game' && cur.game === 'bingo') || (view === 'slides' && isEx(cur.slide))) { const y = scrollY; render(); scrollTo(0, y); }
}

/* 공용 실습 타이머 (강사가 시작하면 모두에게 보임) */
function renderTimer() {
  const el = $('#timer'); const end = num(S.control.timerEnd);
  if (!end || end < Date.now() - 60000) { el.hidden = true; return; }
  el.hidden = false; const left = Math.round((end - Date.now()) / 1000);
  el.className = 'timerchip' + (left <= 60 ? ' late' : '');
  el.innerHTML = `<small>${esc(S.control.timerLabel || '실습')}</small><b class="num">${left > 0 ? `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}` : '시간 종료'}</b>`;
}
setInterval(renderTimer, 1000);

/* ───────────── 홈 ───────────── */
function vHome() {
  const t = TEAM; const info = S.teams[t] || {};
  const seen = P.seen.size, known = TERMS.filter((x) => P.known.has(x.t)).length, played = ALL_GAME_IDS.filter((g) => P.best[g] != null).length;
  const sheetAvg = t ? SHEETS.reduce((a, s) => a + progress(t, s.id), 0) / 12 : 0;
  return `<section class="hero"><div><p class="eyebrow">롯데 LIFT 유통·리테일 · 부산3반 · 상품 마케팅 이해 03 · 3-2</p>
      <h2>캠페인 기획 <em>연습장</em></h2>
      <p class="lead">장별 대본으로 배우고, 용어와 게임으로 익히고, 활동시트 ①~⑫로 우리 조 캠페인을 한 장까지 완성합니다. 실습 케이스 수치는 PPT에 표기된 교육용 가상 데이터입니다.</p>
      <div class="row"><button type="button" class="btn big" data-goslide="${cur.slide}">${seen ? `이어서 보기 · ${cur.slide}장` : '1장부터 시작'}</button><button type="button" class="btn big ghost" data-view="sheet">활동지 쓰기</button></div></div>
    <div class="card teamcard"><h3>우리 조</h3>
      <div class="teamgrid">${teamIds().map((x) => `<button type="button" class="tpick ${x === t ? 'on' : ''}" data-team="${x}">${teamNo(x)}조${S.teams[x] && S.teams[x].name ? `<small>${esc(S.teams[x].name)}</small>` : ''}</button>`).join('')}</div>
      ${t ? `<label class="field"><span>팀명</span><input type="text" id="tName" value="${esc(info.name || '')}" placeholder="예: MOOD SHIFT"></label>
      <label class="field"><span>우리가 고른 백화점 · 지점</span><input type="text" id="tStore" value="${esc(info.store || '')}" placeholder="예: 롯데백화점 광복점"></label>
      <label class="field"><span>작성자</span><input type="text" id="tAuthor" value="${esc(info.author || '')}" placeholder="조원 이름"></label>
      <button type="button" class="btn" data-act="saveTeam">저장</button>` : `<p class="muted">조를 고르면 활동지와 게임 점수가 조원끼리 함께 보입니다.</p>`}</div></section>
  <section class="progress3">
    <button type="button" class="card stat" data-view="slides"><b class="num">${seen}<small>/56</small></b><span>본 장</span><i style="--p:${seen / 56 * 100}%"></i></button>
    <button type="button" class="card stat" data-view="glossary"><b class="num">${Math.round(known / TERMS.length * 100)}<small>%</small></b><span>아는 용어 ${known}/${TERMS.length}</span><i style="--p:${known / TERMS.length * 100}%"></i></button>
    <button type="button" class="card stat" data-view="game"><b class="num">${played}<small>/${ALL_GAME_IDS.length}</small></b><span>해 본 게임</span><i style="--p:${played / ALL_GAME_IDS.length * 100}%"></i></button>
    ${t ? `<button type="button" class="card stat" data-view="sheet"><b class="num">${Math.round(sheetAvg)}<small>%</small></b><span>우리 조 활동지</span><i style="--p:${sheetAvg}%"></i></button>` : ''}
  </section>
  <section><h3 class="sec">강의를 여는 세 가지 질문</h3><div class="qs">${INTRO.qs.map((q) => `<article class="card"><h4>${esc(q.q)}</h4><p>${esc(q.a)}</p></article>`).join('')}</div>
    <p class="exline">${esc(INTRO.example)}</p></section>
  <section><h3 class="sec">오늘의 흐름 · 5단계와 실습 12개</h3>${flowTable()}</section>`;
}
function flowTable() {
  return `<div class="tblwrap"><table class="ws res flowtbl"><thead><tr><th>단계</th><th>장</th><th>실습</th></tr></thead><tbody>${STAGES.map((g) => `<tr>
    <th>${esc(g.t)}</th><td><button type="button" class="linkbtn" data-goslide="${g.from}">${g.from}~${g.to}장</button> <span class="muted small">${Array.from({ length: g.to - g.from + 1 }, (_, i) => g.from + i).filter((n) => P.seen.has(n)).length}/${g.to - g.from + 1}</span></td>
    <td>${g.ws.length ? g.ws.map((ws) => { const s = SHEET(ws); return `<button type="button" class="linkbtn" data-gosheet="${ws}">실습 ${s.no} ${esc(s.title)} (${s.min}분)</button>`; }).join('<br>') : '—'}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ───────────── 복사 ───────────── */
async function copyText(text, label) {
  let ok = false;
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
  if (!ok) {   // http 주소·구형 브라우저용
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove();
  }
  toast(ok ? `${label} 복사했습니다` : '복사하지 못했습니다 · 글자를 길게 눌러 직접 복사하십시오');
}
const lines = (arr) => arr.filter(Boolean).join('\n');
const scriptText = (s) => lines(s.script.map((x) => x.say ? `“${x.say}”` : `(${x.do})`));
function slideText2(s, mode) {
  if (mode === 'core') return s.core;
  if (mode === 'script') return scriptText(s);
  if (mode === 'next') return s.next;
  const table = s.table.length ? lines(s.table.map((r) => r.join(' | '))) : '';
  return lines([
    `[${s.no}장] ${s.title}`,
    isEx(s.no) ? '※ 정답이 아니라 참고 예시예요.' : '',
    `■ 핵심: ${s.core}`,
    s.know.length || s.bullets.length ? `■ 선생님이 먼저 알아 둘 것\n${lines(s.know.concat(s.bullets.map((b) => '- ' + b)))}` : '',
    table ? `■ 표\n${table}` : '',
    s.req.length ? `■ 담당자 요청: ${s.req.join(' / ')}` : '',
    s.script.length ? `■ 대본\n${scriptText(s)}` : '',
    s.steps ? `■ 진행 순서: ${s.steps}` : '', s.watch ? `■ 돌면서 볼 것: ${s.watch}` : '',
    s.next ? `■ 넘어가는 한마디: ${s.next}` : '',
  ]);
}
const canCopy = (n) => !(isEx(n) && exLocked());
const copyRange = (from, to, mode) => SLIDES.slice(from - 1, to).filter((s) => canCopy(s.no)).map((s) => mode === 'script' ? lines([`[${s.no}장] ${s.title}`, scriptText(s)]) : slideText2(s, 'all')).join('\n\n────────\n\n');

/* ───────────── 장별 대본 ───────────── */
function vSlides() {
  const s = SL(cur.slide); const g = stageOf(s.no); const sh = sheetBySlide(s.no); const ex = isEx(s.no); const locked = ex && exLocked();
  const list = STAGES.map((st) => `<div class="sgroup"><h5>${esc(st.t)}</h5>${SLIDES.slice(st.from - 1, st.to).map((x) => `<button type="button" class="${x.no === s.no ? 'on' : ''}" data-goslide="${x.no}"><span class="num">${x.no}</span><span class="t">${esc(x.title)}</span>${P.seen.has(x.no) ? '<i>✓</i>' : ''}</button>`).join('')}</div>`).join('');
  const terms = SLIDE_TERMS[s.no - 1];
  return `<div class="slidelayout">
    <nav class="slidenav">${list}</nav>
    <article class="slide">
      <header class="slidehead"><div><p class="eyebrow">${esc(g.t)} · ${s.no} / 56</p><h2>${s.no}장 · ${esc(s.title)}</h2></div>
        <div class="row"><button type="button" class="btn sm ghost" data-act="toggleHide">${P.hide ? '대본 보이기' : '대본 가리기 (연습)'}</button><button type="button" class="btn sm ghost" data-act="toggleBig">${P.big ? '작게 보기' : '크게 보기 (강의 모드)'}</button>
        ${IS_TEACHER() ? `<button type="button" class="btn sm" data-act="syncSlide">학생 화면을 ${s.no}장으로</button>` : ''}</div></header>
      ${locked ? '' : `<div class="copybar"><span>복사</span><button type="button" class="btn sm ghost" data-copy="all">📋 이 장 전체</button><button type="button" class="btn sm ghost" data-copy="script">📋 대본만</button><button type="button" class="btn sm ghost" data-copy="core">📋 핵심 한 줄</button><button type="button" class="btn sm ghost" data-copy="stage">📋 ${esc(g.t)} (${g.from}~${g.to}장)</button><button type="button" class="btn sm ghost" data-copy="allScript">📋 1~56장 대본 전체</button></div>`}
      ${locked ? `<div class="card lockbox"><b>예시 답안은 선생님이 공개하면 볼 수 있습니다.</b><p class="muted">먼저 우리 조 활동지를 채우십시오.</p>${sh ? `<button type="button" class="btn" data-gosheet="${sh.id}">실습 ${sh.no} 활동지로</button>` : ''}</div>` : `
      ${ex ? `<p class="exnote">정답이 아니라 참고 예시예요.</p>` : ''}
      <div class="core"><small>핵심</small><p>${esc(s.core)}</p><button type="button" class="copyone light" data-copy="core" title="핵심 복사">복사</button></div>
      ${s.know.length || s.bullets.length ? `<section class="know"><h4>선생님이 먼저 알아 둘 것</h4>${s.know.map((k) => `<p>${esc(k)}</p>`).join('')}${s.bullets.length ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}</section>` : ''}
      ${s.table.length ? `<div class="tblwrap"><table class="ws res"><thead><tr>${s.table[0].map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.table.slice(1).map((r) => `<tr>${r.map((c, i) => i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
      ${s.req.map((r) => `<p class="req"><b>담당자 요청</b> ${esc(r)}</p>`).join('')}
      <section class="script ${P.hide ? 'hidden' : ''}"><h4>대본</h4>${s.script.map((x, i) => x.say ? `<blockquote>“${esc(x.say)}”<button type="button" class="copyone" data-copyline="${i}" title="이 문장 복사">복사</button></blockquote>` : `<p class="do">(${esc(x.do)})</p>`).join('')}${P.hide ? '<button type="button" class="btn sm" data-act="peekScript">눌러서 잠깐 보기</button>' : ''}</section>
      ${s.steps || s.watch ? `<section class="practice">${s.steps ? `<div><h4>진행 순서</h4><p>${esc(s.steps)}</p></div>` : ''}${s.watch ? `<div><h4>돌면서 볼 것</h4><p>${esc(s.watch)}</p></div>` : ''}</section>` : ''}
      ${s.next ? `<p class="nextline"><small>넘어가는 한마디</small> ${esc(s.next)} <button type="button" class="copyone" data-copy="next" title="넘어가는 한마디 복사">복사</button></p>` : ''}`}
      ${sh ? `<div class="row slidelinks">${sh.slide === s.no ? `<button type="button" class="btn" data-gosheet="${sh.id}">실습 ${sh.no} 활동지 열기 (${sh.min}분)</button>${IS_TEACHER() ? `<button type="button" class="btn ghost" data-timer="${sh.id}">${sh.min}분 타이머 시작</button>` : ''}<button type="button" class="btn ghost" data-goslide="${sh.ex}">예시 답안 장 (${sh.ex}장)</button>` : `<button type="button" class="btn ghost" data-gosheet="${sh.id}">실습 ${sh.no} 활동지에서 비교하기</button>`}</div>` : ''}
      ${terms.length ? `<div class="chips"><small>이 장의 용어</small>${terms.map((t) => `<button type="button" class="chip sm" data-term="${esc(t)}">${esc(t)}</button>`).join('')}</div><div id="termPop"></div>` : ''}
      ${LGAMES.filter((g) => g.at === s.no).length ? `<div class="gamecall"><b>🎮 이 장이 끝나면 게임</b>${LGAMES.filter((g) => g.at === s.no).map((g) => `<button type="button" class="btn" data-game="${g.id}">${esc(g.title)} (${GTYPE[g.type]}) →</button>`).join('')}</div>` : ''}
      <footer class="slidefoot">
        <button type="button" class="btn ghost" data-goslide="${Math.max(1, s.no - 1)}" ${s.no === 1 ? 'disabled' : ''}>← ${s.no > 1 ? s.no - 1 + '장' : ''}</button>
        <button type="button" class="btn ${P.seen.has(s.no) ? 'ghost' : ''}" data-act="seen">${P.seen.has(s.no) ? '✓ 다 봤어요' : '다 봤어요'}</button>
        <button type="button" class="btn" data-act="nextSlide" ${s.no === 56 ? 'disabled' : ''}>${s.no < 56 ? s.no + 1 + '장' : ''} →</button>
      </footer>
      <p class="muted small center">키보드 ← → 로 넘길 수 있습니다 · ${esc(s.one)}</p>
    </article></div>`;
}
function goSlide(n) { cur.slide = Math.min(56, Math.max(1, n)); store.set('cp2_slide', cur.slide); if (view !== 'slides') { view = 'slides'; store.set('cp2_view', view); } render(); window.scrollTo(0, 0); }

/* ───────────── 용어사전 ───────────── */
let card = { i: 0, flip: false };
function glossList() { const q = cur.gq.trim(); return TERMS.filter((t) => (!cur.gcat || t.cat === cur.gcat) && (!q || t.t.includes(q) || t.d.includes(q))); }
function vGlossary() {
  const list = glossList(); const known = TERMS.filter((t) => P.known.has(t.t)).length;
  const head = `<div class="pagehead"><h2>용어사전</h2><p class="muted">3-2 PPT에 나오는 마케팅 용어 ${TERMS.length}개 · 아는 용어 ${known}개 (${Math.round(known / TERMS.length * 100)}%)</p></div>
    <div class="row"><input type="search" id="gq" value="${esc(cur.gq)}" placeholder="용어나 뜻으로 찾기"><button type="button" class="btn ${cur.gmode === 'list' ? '' : 'ghost'}" data-gmode="list">목록</button><button type="button" class="btn ${cur.gmode === 'card' ? '' : 'ghost'}" data-gmode="card">카드로 외우기</button></div>
    <div class="subtabs small"><button type="button" class="${!cur.gcat ? 'on' : ''}" data-gcat="">전체</button>${GUIDE.glossary.map((c) => `<button type="button" class="${cur.gcat === c.cat ? 'on' : ''}" data-gcat="${esc(c.cat)}">${esc(c.cat)}</button>`).join('')}</div>`;
  const core = cur.gcat ? (GUIDE.glossary.find((c) => c.cat === cur.gcat) || {}).core : '';
  if (cur.gmode === 'card') {
    const deck = list.filter((t) => !P.known.has(t.t)); const pool = deck.length ? deck : list;
    if (!pool.length) return head + `<div class="card empty">찾는 용어가 없습니다.</div>`;
    const t = pool[card.i % pool.length];
    return head + `<p class="muted">${deck.length ? `남은 카드 ${deck.length}장` : '이 분류는 모두 안다고 표시했습니다 · 전체 복습 중'}</p>
      <button type="button" class="flash ${card.flip ? 'flip' : ''}" data-act="flip"><small>${esc(t.cat)}</small><b>${esc(t.t)}</b>${card.flip ? `<p>${esc(t.d)}</p>` : '<p class="muted">눌러서 뜻 보기</p>'}</button>
      <div class="row center"><button type="button" class="btn ghost" data-act="cardNext">다시 볼게요</button><button type="button" class="btn" data-know="${esc(t.t)}">알아요</button></div>`;
  }
  return head + (core ? `<p class="exline">${esc(core)}</p>` : '') + `<div class="gloss">${list.map((t) => `<article class="term ${P.known.has(t.t) ? 'known' : ''}"><header><h4>${esc(t.t)}</h4><label class="chk"><input type="checkbox" data-know="${esc(t.t)}" ${P.known.has(t.t) ? 'checked' : ''}><span>알아요</span></label></header>
    <p>${esc(t.d)}</p><small class="muted">${esc(t.cat)}${TERM_SLIDES[t.t].length ? ` · 나오는 장 ${TERM_SLIDES[t.t].slice(0, 8).map((n) => `<button type="button" class="linkbtn" data-goslide="${n}">${n}</button>`).join(' ')}` : ''}</small></article>`).join('') || '<div class="card empty">찾는 용어가 없습니다.</div>'}</div>`;
}

/* ───────────── 게임 ───────────── */
const GTITLE = { bingo: '용어 빙고', words: '용어 글자 조합', slogan: '슬로건 조립' };
const GINFO = { bingo: '강사가 용어 뜻을 한 장씩 공개하면 맞는 칸을 누릅니다. 3줄 먼저!', words: '섞인 음절을 순서대로 놓아 용어를 완성합니다.', slogan: '어절 카드로 슬로건을 조립하고, 우리 조 슬로건을 만들어 활동지 ④로 보냅니다.' };
const CLASS_GAMES = [['bingo', '실시간 · 강사 진행'], ['words', '글자 조합 A'], ['slogan', '글자 조합 B']];
const LG = (id) => LGAMES.find((g) => g.id === id);
const ALL_GAME_IDS = LGAMES.map((g) => g.id).concat(CLASS_GAMES.map((x) => x[0]));
const SCORE_IDS = LGAMES.filter((g) => g.type !== 'calc').map((g) => g.id).concat(['words', 'slogan']);
const GTYPE = { match: '짝짓기', order: '순서대로 누르기', calc: '계산기' };
const gdata = (g, t = TEAM) => ((S.games[g] || {})[t]) || {};
function bingoPoints(t) {
  const g = S.games.bingo || {}; const me = g[t] || {};
  const done = Object.entries(g).filter(([, x]) => x.doneAt).sort((a, b) => a[1].doneAt - b[1].doneAt).map(([k]) => k); const r = done.indexOf(t);
  return (me.lines || 0) * 5 + (r === 0 ? 30 : r === 1 ? 20 : r === 2 ? 10 : 0);
}
const gameScore = (t) => bingoPoints(t) + SCORE_IDS.reduce((a, g) => a + (gdata(g, t).score || 0), 0);
const totalScore = (t) => gameScore(t) + (S.scores.s[teamNo(t) - 1] || 0);
const needTeam = () => `<div class="card empty"><p>상단에서 <b>우리 조</b>를 먼저 고르십시오.</p></div>`;
const hl = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const lgRows = (g) => g.rows || GAME(g.guide).rows;
const bestPill = (id) => P.best[id] == null ? '' : `<span class="pill ok">${id === 'g6' ? '해 봄' : '최고 ' + P.best[id] + (id === 'bingo' ? '줄' : '점')}</span>`;

function vGame() {
  if (!cur.game) {
    const flow = LGAMES.slice().sort((a, b) => a.at - b.at);
    return `<div class="pagehead"><h2>게임</h2><p class="muted">강의 중 해당 장이 끝나면 바로 하는 게임입니다. 강사 말풍선 → 문제 → 한 줄 기억 → "다음 장"으로 강의가 이어집니다.</p></div>
    <h3 class="sec">강의 흐름 게임</h3>
    <div class="gamegrid">${flow.map((g) => `<button type="button" class="card gtile" data-game="${g.id}"><small>${g.at}장 뒤 · ${GTYPE[g.type]}${g.guide ? ' · 가이드 게임 ' + g.guide.slice(1) : ''}</small><b>${esc(g.title)}</b><span class="muted">${esc(g.say.replace(/\*\*/g, ''))}</span>${bestPill(g.id)}</button>`).join('')}</div>
    <h3 class="sec">수업 게임</h3>
    <div class="gamegrid">${CLASS_GAMES.map(([id, tag]) => `<button type="button" class="card gtile" data-game="${id}"><small>${tag}</small><b>${esc(GTITLE[id])}</b><span class="muted">${esc(GINFO[id])}</span>${bestPill(id)}</button>`).join('')}</div>`;
  }
  if (LG(cur.game)) return `<div class="gtop"><button type="button" class="btn sm ghost" data-game="">← 게임 목록</button></div>${lgPage(LG(cur.game))}`;
  const body = { bingo: gBingo, words: gWords, slogan: gSlogan }[cur.game]();
  return `<div class="gtop"><button type="button" class="btn sm ghost" data-game="">← 게임 목록</button></div>${body}`;
}
/* 강의 흐름 게임 (짝짓기 · 순서 · 계산기) */
let LS = null;
function lgState(g) {
  if (!LS || LS.id !== g.id) {
    let tiles = g.items ? shuffle(g.items) : null;
    if (tiles && tiles.join() === g.items.join()) tiles = tiles.reverse();
    LS = { id: g.id, picks: {}, trail: [], miss: 0, tiles, saved: false };
  }
  return LS;
}
function lgResult(g) {
  const st = lgState(g);
  if (g.type === 'match') { const rows = lgRows(g); const ok = rows.filter((r, i) => st.picks[i] === r[1]).length; return { done: Object.keys(st.picks).length === rows.length, score: ok * 10, text: `${ok} / ${rows.length} 정답 · ${ok * 10}점` }; }
  if (g.type === 'order') { const score = Math.max(5, 30 - st.miss * 5); return { done: st.trail.length === g.items.length, score, text: `실수 ${st.miss}번 · ${score}점` }; }
  return { done: true, score: 0, text: '' };
}
function lgFinish(g) {
  const st = lgState(g); const r = lgResult(g); if (!r.done || st.saved) return; st.saved = true;
  best(g.id, r.score); if (r.score > (gdata(g.id).score || 0)) saveGame(g.id, { score: r.score });
}
function lgPage(g) {
  const st = lgState(g); let body = '';
  if (g.type === 'match') {
    body = `<div class="mrows">${lgRows(g).map((r, i) => { const p = st.picks[i]; return `<div class="mrow ${p ? (p === r[1] ? 'ok' : 'bad') : ''}"><div class="mq">${esc(r[0])}${p ? `<small>${p === r[1] ? '✓ 정답' : '✗ 정답은 ' + esc(r[1])} — ${esc(r[2])}</small>` : ''}</div>
      <div class="mopts">${g.opts.map((o) => `<button type="button" class="mopt ${p ? (o === r[1] ? 'right' : o === p ? 'wrong' : '') : ''}" data-lg="${i}" data-opt="${esc(o)}" ${p ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div></div>`; }).join('')}</div>`;
  } else if (g.type === 'order') {
    body = `<div class="obtns" id="obtns">${st.tiles.map((x) => `<button type="button" class="obtn ${st.trail.includes(x) ? 'used' : ''}" data-ord="${esc(x)}" ${st.trail.includes(x) ? 'disabled' : ''}>${st.trail.includes(x) ? `<b>${st.trail.indexOf(x) + 1}</b> ` : ''}${esc(x)}</button>`).join('')}</div>
      ${st.trail.length ? `<p class="otrail">${st.trail.map(esc).join(' → ')}${st.trail.length < g.items.length ? ' → …' : ''}</p>` : ''}`;
  } else body = calcBody();
  const r = lgResult(g); const nextSay = SL(g.at).next;
  return `<article class="lgame">
    <header class="lghead"><div><p class="eyebrow">${g.at}장 뒤 · ${GTYPE[g.type]}${g.guide ? ' · 가이드 게임 ' + g.guide.slice(1) : ''}</p><h2>${esc(g.title)}</h2></div><button type="button" class="btn sm ghost" data-goslide="${g.at}">← ${g.at}장으로</button></header>
    <div class="say"><small>강사</small><p>${hl(g.say)}</p></div>
    <details class="tnotes"><summary>강사 노트</summary><ul>${g.note.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>
    <hr class="lgsep"><h3 class="ask">${esc(g.ask)}</h3>${body}
    ${r.done ? `<section class="remember"><small>한 줄 기억</small><p class="rline">${esc(g.remember)}</p>${r.text ? `<p class="rscore">${r.text}</p>` : ''}
      ${nextSay ? `<blockquote class="nextsay">넘어가는 한마디: "${esc(nextSay)}"</blockquote>` : ''}
      <div class="row"><button type="button" class="btn dark" data-goslide="${g.next}">다음: ${g.next}장 →</button>${g.type !== 'calc' ? '<button type="button" class="btn ghost" data-act="lgRetry">다시 하기</button>' : ''}</div></section>` : ''}
  </article>`;
}
/* 계산기 (가이드 게임 6) */
const CALC0 = { followers: 120000, rate: 8, ad: 50000, inf: 40000, goal: 100000, budget: 500000000, members: 5000, prev: 2300 };
const CALC = { ...CALC0 };
function calcBody() {
  const c = CALC; const organic = c.followers * c.rate / 100; const total = organic + c.ad + c.inf;
  const sl = (k, label, min, max, step, fmt) => `<label class="slider"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${c[k]}" data-calc-k="${k}"><b class="num">${fmt(c[k])}</b></label>`;
  return `<div class="row"><button type="button" class="btn sm ghost" data-act="calcReset">PPT 케이스 값으로</button></div>
    <div class="calcgame"><section class="card"><h4>도달</h4>${sl('followers', '인스타 팔로워', 0, 300000, 5000, won)}${sl('rate', '도달률', 1, 20, 1, (v) => v + '%')}${sl('ad', '광고 도달', 0, 150000, 5000, won)}${sl('inf', '인플루언서 도달', 0, 150000, 5000, won)}${sl('goal', '도달 목표', 10000, 300000, 10000, won)}</section>
      <section class="card"><h4>획득 비용</h4>${sl('budget', '총예산', 100000000, 1000000000, 50000000, man)}${sl('members', '신규 회원 목표', 1000, 10000, 100, won)}${sl('prev', '지난번 신규 회원', 500, 10000, 100, won)}</section></div>
    <div class="calc big">
      <div class="calcrow"><b>오가닉 도달 = 팔로워 × 도달률</b><span class="num">${won(organic)}명</span></div>
      <div class="calcrow"><b>총 도달 = 오가닉 + 광고 + 인플루언서</b><span class="num">${won(total)}명 ${reached(total, c.goal) ? `✓ 약 ${man(total)} · 목표 달성` : '· ' + won(c.goal - total) + '명 모자람'}</span></div>
      <div class="calcrow"><b>1인당 획득 비용 = 총예산 ÷ 신규 회원 목표</b><span class="num">${won(c.budget / c.members)}원</span></div>
      <div class="calcrow"><b>지난번 1인당 = 총예산 ÷ 지난번 신규 회원</b><span class="num">${won(c.budget / c.prev)}원 → 이번은 ${Math.round(c.prev / c.members * 100)}% 수준 ${c.members >= c.prev * 2 ? '✓ 절반 이하' : ''}</span></div></div>`;
}
/* 빙고 (강사 진행) */
const BT = () => BINGO_TERMS.map((t) => TERMS.find((x) => x.t === t)).filter(Boolean);
const bingoLabel = (t) => t.t.replace(/\s*\(.*\)$/, '');
function bingoBoard(t) { const idx = shuffle(BT().map((x, i) => i), (S.control.bingoSeed || 1) * 97 + teamNo(t) * 13).slice(0, 24); idx.splice(12, 0, -1); return idx; }
const bingoOrder = () => shuffle(BT().map((x, i) => i), (S.control.bingoSeed || 1) * 7919);
const bingoRevealed = () => bingoOrder().slice(0, (S.control.bingoIdx ?? -1) + 1);
function bingoLines(marks) {
  const m = new Set(marks); m.add(12); const L = [];
  for (let i = 0; i < 5; i++) { L.push([0, 1, 2, 3, 4].map((j) => i * 5 + j)); L.push([0, 1, 2, 3, 4].map((j) => j * 5 + i)); }
  L.push([0, 6, 12, 18, 24]); L.push([4, 8, 12, 16, 20]); return L.filter((l) => l.every((x) => m.has(x))).length;
}
const hideTerm = (t) => termKeys(t.t).reduce((d, k) => d.split(k).join('○○'), t.d);
function gBingo() {
  if (!TEAM) return needTeam();
  const board = bingoBoard(TEAM); const me = gdata('bingo'); const marks = me.marks || []; const rev = bingoRevealed(); const bt = BT();
  const last = rev.length ? bt[rev[rev.length - 1]] : null; const lines = bingoLines(marks);
  return `<div class="gamehead"><div><h2>용어 빙고</h2><p class="muted">강사가 용어 뜻을 한 장씩 공개합니다. 맞는 칸을 누르십시오. 아직 공개되지 않은 용어를 누르면 3초 잠깁니다.</p></div><div class="linecount"><b class="num">${lines}</b><span>줄</span></div></div>
    <div class="clue ${last ? '' : 'wait'}">${last ? `<small>뜻 카드 ${rev.length} / ${bt.length}</small><p>${esc(hideTerm(last))}</p>` : '<p>강사가 첫 카드를 공개하면 시작합니다.</p>'}</div>
    <div class="bingo" id="bingo">${board.map((ti, i) => ti < 0 ? `<button type="button" class="cell free on" disabled>FREE</button>` : `<button type="button" class="cell ${marks.includes(i) ? 'on' : ''}" data-cell="${i}">${esc(bingoLabel(bt[ti]))}</button>`).join('')}</div>
    ${lines >= 3 ? `<div class="card win"><b>빙고 3줄 완성!</b></div>` : ''}`;
}
let bingoLock = 0;
function bingoTap(i) {
  if (Date.now() < bingoLock) return;
  const ti = bingoBoard(TEAM)[i]; const me = gdata('bingo'); const marks = (me.marks || []).slice(); if (marks.includes(i)) return;
  if (!bingoRevealed().includes(ti)) {
    bingoLock = Date.now() + 3000; const c = $(`[data-cell="${i}"]`); c.classList.add('shake'); $('#bingo').classList.add('locked');
    setTimeout(() => { c.classList.remove('shake'); const b = $('#bingo'); if (b) b.classList.remove('locked'); }, 3000); toast('아직 공개되지 않은 용어입니다 · 3초 잠금'); return;
  }
  marks.push(i); const lines = bingoLines(marks); const data = { marks, lines }; if (lines >= 3) data.doneAt = me.doneAt || Date.now();
  saveGame('bingo', data); best('bingo', lines); render();
}
/* 글자 조합 A */
let WQ = null;
function gWords() {
  if (!WQ) return `<div class="gamehead"><div><h2>용어 글자 조합</h2><p class="muted">10문제 · 정답 10점, 뜻 힌트를 보면 7점.</p></div></div><button type="button" class="btn big" data-act="wStart">시작</button>`;
  if (WQ.i >= WQ.list.length) return `<div class="card win"><h3>끝! <span class="num">${WQ.score}</span>점</h3><button type="button" class="btn" data-act="wStart">다시 하기</button></div>`;
  const w = WQ.list[WQ.i]; const t = TERMS.find((x) => termKeys(x.t).some((k) => k.replace(/\s/g, '') === w));
  return `<div class="gamehead"><div><h2>${WQ.i + 1} / ${WQ.list.length}</h2><p class="muted">점수 <b class="num">${WQ.score}</b></p></div><div><button type="button" class="btn ghost" data-act="wHint" ${WQ.hint ? 'disabled' : ''}>뜻 힌트 (−3)</button> <button type="button" class="btn ghost" data-act="wSkip">넘기기</button></div></div>
    <div class="clue ${WQ.hint ? '' : 'wait'}"><p>${WQ.hint && t ? esc(hideTerm(t)) : w.length + '글자 용어'}</p></div>
    <div class="slots" id="wslots">${Array.from(w).map((_, n) => `<button type="button" class="slot ${WQ.placed[n] ? 'full' : ''}" data-wslot="${n}">${WQ.placed[n] ? esc(WQ.placed[n].ch) : ''}</button>`).join('')}</div>
    <div class="tiles">${WQ.tiles.map((x) => `<button type="button" class="tile" data-wtile="${x.id}" ${WQ.placed.includes(x) ? 'disabled' : ''}>${esc(x.ch)}</button>`).join('')}</div>`;
}
function wSetup() { const w = WQ.list[WQ.i]; let t = shuffle(Array.from(w)); if (t.join('') === w) t = t.reverse(); WQ.tiles = t.map((ch, id) => ({ ch, id })); WQ.placed = []; WQ.hint = false; }
function wAdvance() { WQ.i++; if (WQ.i < WQ.list.length) wSetup(); else { best('words', WQ.score); if (WQ.score > (gdata('words').score || 0)) saveGame('words', { score: WQ.score }); } render(); }
function wCheck() {
  const w = WQ.list[WQ.i]; if (WQ.placed.length < w.length) return;
  if (WQ.placed.map((x) => x.ch).join('') === w) { WQ.score += WQ.hint ? 7 : 10; toast('정답! ' + w); if (WQ.score > (gdata('words').score || 0)) saveGame('words', { score: WQ.score }); setTimeout(wAdvance, 600); }
  else { $('#wslots').classList.add('shake'); setTimeout(() => { WQ.placed = []; render(); }, 500); }
}
/* 글자 조합 B · 슬로건 */
let SQ = null;
function gSlogan() {
  if (!SQ) return `<div class="gamehead"><div><h2>슬로건 조립</h2><p class="muted">미끼 카드가 섞여 있습니다. ${SLOGANS.length}문제 × 10점. 마지막에 우리 조 슬로건을 만들어 활동지 ④의 A·B·C안으로 보낼 수 있습니다.</p></div></div>
    <button type="button" class="btn big" data-act="sStart">시작</button> <button type="button" class="btn big ghost" data-act="sFree">바로 우리 조 슬로건 만들기</button>`;
  if (SQ.free) {
    const txt = SQ.words.join(' ');
    return `<div class="gamehead"><div><h2>우리 조 슬로건 만들기</h2><p class="muted">좋은 메시지 4조건: 짧다 · 기억하기 쉽다 · 마음을 건드린다 · 브랜드와 이어진다. 소리 내어 읽어 보십시오.</p></div></div>
      <div class="phrase big">${SQ.words.length ? SQ.words.map((w, n) => `<button type="button" class="chip on" data-sfree="${n}">${esc(w)}</button>`).join('') : '<span class="muted">카드를 눌러 조립하십시오</span>'}</div>
      <div class="tiles">${SLOGAN_FREE.map((w) => `<button type="button" class="chip" data-sadd="${esc(w)}">${esc(w)}</button>`).join('')}</div>
      <div class="row"><input type="text" id="sOwn" placeholder="직접 단어 추가"><button type="button" class="btn ghost" data-act="sOwn">추가</button><button type="button" class="btn ghost" data-act="sClear">비우기</button></div>
      <div class="row">${['A', 'B', 'C'].map((x) => `<button type="button" class="btn" data-sendslogan="${x}" ${txt ? '' : 'disabled'}>④ ${x}안 슬로건으로 보내기</button>`).join('')}</div>`;
  }
  if (SQ.i >= SLOGANS.length) return `<div class="card win"><h3>슬로건 조립 끝 · <span class="num">${SQ.score}</span>점</h3><button type="button" class="btn" data-act="sFree">우리 조 슬로건 만들기</button></div>`;
  const p = SLOGANS[SQ.i];
  return `<div class="gamehead"><div><h2>슬로건 ${SQ.i + 1} / ${SLOGANS.length}</h2><p class="muted">점수 <b class="num">${SQ.score}</b> · 힌트: ${esc(p.hint)}</p></div><div><button type="button" class="btn ghost" data-act="sClearQ">비우기</button> <button type="button" class="btn" data-act="sCheck">확인</button></div></div>
    <div class="phrase" id="sphrase">${SQ.placed.length ? SQ.placed.map((x, n) => `<button type="button" class="chip on" data-splaced="${n}">${esc(x.w)}</button>`).join('') : '<span class="muted">카드를 순서대로 놓으십시오</span>'}</div>
    <div class="tiles">${SQ.tiles.map((x) => `<button type="button" class="chip" data-stile="${x.id}" ${SQ.placed.includes(x) ? 'disabled' : ''}>${esc(x.w)}</button>`).join('')}</div>`;
}
function sSetup() { const p = SLOGANS[SQ.i]; SQ.tiles = shuffle(p.answer.concat(p.decoy)).map((w, id) => ({ w, id })); SQ.placed = []; }

/* ───────────── 실습 가이드 ───────────── */
function vGuide() {
  const total = SHEETS.reduce((a, s) => a + s.min, 0);
  return `<div class="pagehead"><h2>실습 가이드</h2><p class="muted">실습 ①~⑫ · 합계 ${total}분(${Math.floor(total / 60)}시간 ${total % 60}분) · 시간 · 진행 순서 · 돌면서 볼 것</p></div>
    <div class="guidegrid">${SHEETS.map((sh) => { const s = SL(sh.slide); const steps = s.steps.split(/\s*(?=[①②③④⑤])/).filter(Boolean);
      return `<article class="card gcard"><header><span class="no">${sh.no}</span><div><h3>${esc(sh.title)}</h3><small class="muted">${sh.slide}장 · ${sh.min}분 · 예시 ${sh.ex}장</small></div>${TEAM ? `<span class="pill">${progress(TEAM, sh.id)}%</span>` : ''}</header>
        <p class="gcore">${esc(s.core)}</p>
        ${steps.length ? `<h4>진행 순서</h4><ol class="steps">${steps.map((x) => `<li>${esc(x.replace(/^[①②③④⑤]\s*/, ''))}</li>`).join('')}</ol>` : ''}
        ${s.watch ? `<h4>돌면서 볼 것</h4><p class="watch">${esc(s.watch)}</p>` : ''}
        <div class="row"><button type="button" class="btn sm" data-gosheet="${sh.id}">활동지</button><button type="button" class="btn sm ghost" data-goslide="${sh.slide}">대본</button><button type="button" class="btn sm ghost" data-goslide="${sh.ex}">예시 답안 장</button>${IS_TEACHER() ? `<button type="button" class="btn sm ghost" data-timer="${sh.id}">${sh.min}분 타이머</button>` : ''}</div></article>`; }).join('')}</div>`;
}

/* ───────────── 활동지 ───────────── */
let lastField = null; let showModel = false;
function vSheet() {
  if (!TEAM) return needTeam();
  const sh = SHEET(cur.sheet); const d = sheetOf(TEAM, sh.id); const hintN = num(d.hints); const info = S.teams[TEAM] || {}; const gs = SL(sh.slide);
  const i = SHEETS.indexOf(sh); const model = showModel && !exLocked();
  return `<div class="sheetlayout">
  <nav class="sheetnav">${SHEETS.map((s) => `<button type="button" class="${s.id === sh.id ? 'on' : ''}" data-sheet="${s.id}"><span class="no">${s.no}</span><span class="t">${esc(s.title)}</span><span class="pbar"><i style="width:${progress(TEAM, s.id)}%"></i></span></button>`).join('')}</nav>
  <article class="sheet" id="sheet">
    <header class="sheethead"><div><p class="eyebrow">실습 ${sh.no} · 워크시트 · ${sh.min}분 · <button type="button" class="linkbtn" data-goslide="${sh.slide}">${sh.slide}장 대본</button></p><h2>${esc(sh.title)}</h2><p class="lead">${esc(sh.lead)}</p></div>
      <div class="meta"><span>팀명 <b>${esc(info.name || '______')}</b></span><span>지점 <b>${esc(info.store || '______')}</b></span><span>작성자 <b>${esc(info.author || '______')}</b></span><span id="net" class="net ok">저장됨</span></div></header>
    ${sh.banner ? `<div class="banner" data-banner>④ 최종 슬로건 · <b></b></div>` : ''}
    ${sh.formula ? `<div class="formula">작성 형식 &nbsp;${esc(sh.formula)}</div>` : ''}
    ${model ? `<div class="modelwrap"><div class="modelhead">예시 팀 MOOD SHIFT · 정답이 아니라 참고 예시예요 <button type="button" class="btn sm ghost" data-act="toggleModel">우리 조 시트로</button></div>${renderParts(sh, sh.model, true).replace(/<div class="(calc|poster|readaloud)"[^>]*><\/div>/g, '')}${sh.modelNote ? `<p class="note">${esc(sh.modelNote)}</p>` : ''}</div>` : renderParts(sh, d, false)}
    ${sh.foot ? `<p class="foot">${esc(sh.foot)}</p>` : ''}
    <div class="sheetfoot">${i > 0 ? `<button type="button" class="btn ghost" data-sheet="${SHEETS[i - 1].id}">← 이전</button>` : '<span></span>'}<button type="button" class="btn ghost" data-act="printAll">①~⑫ 전체 인쇄</button>
      ${i < 11 ? `<button type="button" class="btn" data-sheet="${SHEETS[i + 1].id}">다음 →</button>` : '<button type="button" class="btn" data-view="present">발표·평가로 →</button>'}</div>
  </article>
  <aside class="side">
    <section class="card"><h3>자동 점검</h3><ul class="checks-out" data-checks></ul></section>
    <section class="card"><h3>진행 순서</h3><p class="small">${esc(gs.steps)}</p>${gs.watch ? `<p class="small muted"><b>선생님이 볼 것</b> ${esc(gs.watch)}</p>` : ''}</section>
    <section class="card"><h3>도움 받기 <small class="muted">${hintN}/3</small></h3>${sh.hints.slice(0, hintN).map((h) => `<p class="hint">${esc(h)}</p>`).join('')}
      ${hintN < 3 ? `<button type="button" class="btn sm" data-act="hint">${['질문 힌트', '방향 힌트', '예시 방향'][hintN]} 보기</button>` : ''}</section>
    <section class="card model"><h3>예시 답안과 비교</h3>${exLocked() ? `<p class="muted small">선생님이 공개하면 열립니다.</p>` : `<button type="button" class="btn sm" data-act="toggleModel">${model ? '우리 조 시트로 돌아가기' : 'MOOD SHIFT 예시 보기'}</button> <button type="button" class="btn sm ghost" data-goslide="${sh.ex}">${sh.ex}장 설명</button>`}</section>
    <section class="card"><h3>케이스 자료 <small class="muted">교육용 가상 데이터</small></h3><p class="muted small">입력칸을 한 번 누른 뒤 [가져오기]를 누르면 붙습니다.</p>${sh.caseRefs.map((id) => caseCard(CASE.find((c) => c.id === id), true)).join('')}
      ${sh.id === 'w1' ? `<details><summary>캠페인 유형 5가지 (11장)</summary>${CASE_TYPES.map((x) => `<p class="small"><b>${esc(x.t)}</b> · ${esc(x.f)} · ${esc(x.c)}<br><span class="muted">${esc(x.w)}</span></p>`).join('')}</details>` : ''}</section>
    <section class="card"><h3>우리 지점 자료 찾기</h3>${researchHTML(info.store)}</section>
  </aside></div>`;
}
function caseCard(c, pull) { return `<article class="fact"><span class="tag">${esc(c.tag)}</span><h4>${esc(c.title)}</h4><p>${esc(c.body)}</p>${pull ? `<button type="button" class="btn sm ghost" data-pull="${c.id}">가져오기</button>` : ''}</article>`; }
function researchHTML(storeName) {
  const q = encodeURIComponent((storeName || '').trim());
  return `${storeName ? `<p class="small">검색어: <b>${esc(storeName)}</b></p>` : `<p class="muted small">[홈]에서 우리가 고른 백화점·지점을 저장하면 검색어가 자동으로 들어갑니다.</p>`}
    <ul class="research">${RESEARCH.map((r) => { const url = r.url.includes('{q}') ? (q ? r.url.replace('{q}', q) : '') : r.url;
      return `<li>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(r.label)} ↗</a>` : `<span class="muted">${esc(r.label)}</span>`}<small>${esc(r.what)} → ${esc(r.ws)}</small></li>`; }).join('')}</ul>
    <p class="muted small">찾은 값과 출처는 활동지 ① '우리 지점 현황' 표에 적으십시오.</p>`;
}
function refreshSheet() {
  const sh = SHEET(cur.sheet); if (!sh || !$('#sheet')) return;
  const model = showModel && !exLocked();
  const c = $('[data-checks]'); if (c) c.innerHTML = checksFor(sh.id, TEAM) || '<li class="info">i 작성하면 점검 결과가 나타납니다</li>';
  $$('[data-calc]').forEach((el) => { el.innerHTML = calcHTML(el.dataset.calc, TEAM); });
  const b = $('[data-banner] b'); if (b) b.textContent = finalSlogan(TEAM) || '아직 정하지 않았습니다 (④에서 최종안을 고르십시오)';
  const r = $('[data-read]'); if (r) { const d = sheetOf(TEAM, 'w5'); const txt = ['p1', 'p2', 'p3', 'p4'].map((k) => (d[k] || '').trim()).filter(Boolean).join(' '); r.innerHTML = `<h4>이어 읽기 · 소리 내어 읽어 보십시오</h4><p>${esc(txt) || '<span class="muted">네 칸을 채우면 한 문단으로 이어 보여 줍니다.</span>'}</p>`; }
  if (sh.id === 'w9') { const { amt } = w9Rows(model ? sh.model : sheetOf(TEAM, 'w9')); $$('[data-auto]').forEach((el) => { const k = el.dataset.auto.replace('_amt', ''); el.textContent = amt[k] ? won(amt[k]) + '원' : '—'; }); }
  const p = $('[data-poster]'); if (p) p.innerHTML = posterHTML(TEAM);
  $$('.sheetnav button[data-sheet]').forEach((bt) => { const i = bt.querySelector('i'); if (i) i.style.width = progress(TEAM, bt.dataset.sheet) + '%'; });
}
function syncInputs() {
  if (showModel && !exLocked()) return; const d = sheetOf(TEAM, cur.sheet);
  $$('#sheet [data-k]').forEach((el) => { if (el === document.activeElement) return; const v = d[el.dataset.k] ?? '';
    if (el.type === 'checkbox') el.checked = v === 'Y'; else if (el.value !== v) { el.value = v; if (el.tagName === 'TEXTAREA') autosize(el); } });
}
function autosize(el) { el.style.height = 'auto'; el.style.height = Math.min(600, el.scrollHeight + 2) + 'px'; }
function autosizeAll() { $$('#main textarea').forEach(autosize); }
function printSheets(ids, t = TEAM) {
  const box = $('#printArea'); const info = S.teams[t] || {};
  box.innerHTML = ids.map((ws) => { const sh = SHEET(ws);
    return `<section class="psheet"><header><small>3-2 캠페인 기획 실습 · 실습 ${sh.no} · ${sh.min}분</small><h2>${esc(sh.title)}</h2><p>팀명 ${esc(info.name || '______')} · 지점 ${esc(info.store || '______')} · 작성자 ${esc(info.author || '______')}</p></header>
      ${ws === 'w11' ? posterHTML(t) : ''}${renderParts(sh, sheetOf(t, ws), true).replace(/<div class="(calc|poster|readaloud)"[^>]*><\/div>/g, (m, type) => type === 'calc' ? `<div class="calc">${calcHTML(ws, t)}</div>` : '')}</section>`; }).join('');
  $$('textarea, input[type=text], select', box).forEach((el) => { const s = document.createElement('div'); s.className = 'pval'; s.textContent = el.value; el.replaceWith(s); });
  if (ids.includes('w9')) { const { amt } = w9Rows(sheetOf(t, 'w9')); $$('[data-auto]', box).forEach((el) => { const k = el.dataset.auto.replace('_amt', ''); el.textContent = amt[k] ? won(amt[k]) + '원' : '—'; }); }
  document.body.classList.add('printing'); window.print(); setTimeout(() => document.body.classList.remove('printing'), 500);
}

/* ───────────── 프로모션 vs 캠페인 ───────────── */
function vCompare() {
  return `<div class="pagehead"><h2>프로모션 vs 캠페인</h2><p class="lead">프로모션은 오늘의 매출, 캠페인은 우리 백화점의 이름값입니다. 캠페인은 우산이고, 프로모션은 그 아래 들어가는 행사들입니다.</p></div>
    <div class="tblwrap"><table class="ws res cmp2"><thead><tr><th>구분</th><th>캠페인</th><th>프로모션</th></tr></thead><tbody>${COMPARE.map((r) => `<tr><th>${esc(r[0])}</th><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table></div>
    <section class="umbrella card"><h3>우산 구조 (3장)</h3><div class="umb"><div class="top">캠페인 · 3개월 · 하나의 메시지</div><div class="subs"><span>오픈 할인</span><span>포토존 이벤트</span><span>멤버십 적립</span><span>클리어런스</span></div></div>
      <p class="muted">캠페인은 채널마다 말이 달라 고객이 기억 못 할 때 실패하고, 프로모션은 할인은 했는데 남는 게 없을 때 실패합니다.</p></section>
    <section class="card"><h3>${esc(CASE31.title)}</h3><p>${esc(CASE31.body)}</p><p class="exline">${esc(CASE31.vs)}</p></section>
    <div class="row"><button type="button" class="btn" data-game="g1">게임 1 · 캠페인일까, 프로모션일까</button><button type="button" class="btn ghost" data-goslide="2">2장 대본</button><button type="button" class="btn ghost" data-goslide="12">12장 · 설계 프로세스</button></div>`;
}

/* ───────────── 발표 · 평가 ───────────── */
let evalTo = ''; let clock = { left: 480, run: false, phase: '발표', h: null };
const CRIT = ['트렌드·타깃 분석의 정확성', '컨셉의 창의성', '통합 마케팅의 일관성', '실행 가능성'];
function vPresent() {
  const others = teamIds().filter((t) => t !== TEAM); if (!evalTo || evalTo === TEAM) evalTo = others[0] || '';
  const mine = ((S.evals[TEAM] || {})[evalTo]) || {}; const pr = S.control.presenting;
  return `<div class="pagehead"><h2>발표와 상호 평가 · 실습 ⑫</h2><p class="muted">팀당 8분 발표(2분 × 4: 트렌드·인사이트 → 캠페인명·스토리 → 채널·운영 → 예산·KPI) + 4분 질의. 칭찬 하나와 질문 하나.</p></div>
  <div class="present"><section class="card timer"><h3>${pr ? esc(teamName(pr)) + ' 발표 중' : '발표 타이머'}</h3><div class="clock num" id="clock">${fmtClock(clock.left)}</div><p class="muted" id="clockPhase">${clock.phase} · ${partName()}</p>
      <div class="row"><button type="button" class="btn" data-act="clockToggle">${clock.run ? '일시정지' : '시작'}</button><button type="button" class="btn ghost" data-act="clockQA">질의 4분</button><button type="button" class="btn ghost" data-act="clockReset">처음으로</button></div>
      ${pr ? `<div class="mini">${posterHTML(pr)}</div>` : ''}</section>
    <section class="card"><h3>다른 팀 평가</h3>${!TEAM ? '<p>상단에서 우리 조를 먼저 고르십시오.</p>' : `
      <label class="field"><span>평가할 팀</span><select id="evalTo">${others.map((t) => `<option value="${t}" ${t === evalTo ? 'selected' : ''}>${esc(teamName(t))}</option>`).join('')}</select></label>
      ${CRIT.map((c, i) => `<label class="slider"><span>${c}</span><input type="range" min="0" max="25" value="${mine['c' + (i + 1)] ?? 0}" data-eval="c${i + 1}"><b class="num">${mine['c' + (i + 1)] ?? 0}</b></label>`).join('')}
      <label class="field"><span>한 줄 코멘트 (칭찬 하나 · 보완점 하나)</span><textarea id="evalNote" rows="2" placeholder="예: 안 사도 되는 백화점이라는 역발상이 차별적 / 저녁 인력 운영을 더 구체화할 필요">${esc(mine.note || '')}</textarea></label>
      <p>합계 <b class="num" id="evalSum">${[1, 2, 3, 4].reduce((a, i) => a + (mine['c' + i] || 0), 0)}</b> / 100</p>`}</section></div>
  ${S.control.evalOpen || IS_TEACHER() ? `<section class="card"><h3>평가 결과</h3>${evalTable()}</section>` : ''}`;
}
const partName = () => clock.phase === '질의' ? '질의응답' : ['1. 트렌드 · 인사이트', '2. 캠페인명 · 스토리', '3. 채널 · 운영', '4. 예산 · KPI'][Math.min(3, Math.floor((480 - clock.left) / 120))];
const fmtClock = (s) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
function tick() {
  clock.left--; const c = $('#clock'); if (c) { c.textContent = fmtClock(clock.left); c.classList.toggle('late', clock.left <= 30); }
  const ph = $('#clockPhase'); if (ph) ph.textContent = `${clock.phase} · ${partName()}`;
  if (clock.phase === '발표' && clock.left > 0 && clock.left % 120 === 0) toast('다음 부분으로 넘어갈 시간입니다');
  if (clock.left <= 0) { clearInterval(clock.h); clock.run = false; toast(clock.phase + ' 시간이 끝났습니다'); if (view === 'present') render(); }
}
function evalAgg() {
  const res = {};
  teamIds().forEach((to) => { const rows = teamIds().filter((f) => f !== to).map((f) => (S.evals[f] || {})[to]).filter(Boolean);
    const c = [1, 2, 3, 4].map((i) => rows.length ? rows.reduce((a, r) => a + (r['c' + i] || 0), 0) / rows.length : 0);
    res[to] = { n: rows.length, c, total: c.reduce((a, b) => a + b, 0), notes: teamIds().filter((f) => f !== to && ((S.evals[f] || {})[to] || {}).note).map((f) => `${teamNo(f)}조: ${S.evals[f][to].note}`) }; });
  return res;
}
function evalTable() {
  const a = evalAgg(); const order = teamIds().slice().sort((x, y) => a[y].total - a[x].total);
  return `<div class="tblwrap"><table class="ws res"><thead><tr><th>순위</th><th>팀</th><th>분석</th><th>창의성</th><th>일관성</th><th>실행</th><th>평균 합계</th><th>평가 수</th><th>코멘트</th></tr></thead><tbody>
    ${order.map((t, i) => `<tr><td class="num">${a[t].n ? i + 1 : '—'}</td><td><b>${esc(teamName(t))}</b></td>${a[t].c.map((x) => `<td class="num">${x.toFixed(1)}</td>`).join('')}<td class="num"><b>${a[t].total.toFixed(1)}</b></td><td class="num">${a[t].n}</td><td class="small">${a[t].notes.map(esc).join('<br>')}</td></tr>`).join('')}</tbody></table></div>`;
}
let evalTimer = null;
function saveEval() {
  const data = {}; $$('[data-eval]').forEach((el) => { data[el.dataset.eval] = Number(el.value); }); data.note = ($('#evalNote') || {}).value || '';
  ((S.evals[TEAM] = S.evals[TEAM] || {}))[evalTo] = data; const s = $('#evalSum'); if (s) s.textContent = [1, 2, 3, 4].reduce((a, i) => a + (data['c' + i] || 0), 0);
  clearTimeout(evalTimer); evalTimer = setTimeout(() => api('/api/eval', { from: TEAM, to: evalTo, data }).catch(() => toast('평가 저장 실패')), 400);
}

/* ───────────── 강사 화면 ───────────── */
let tTab = 'run'; let peek = null;
function vTeacher() {
  const tabs = [['run', '수업 진행'], ['game', '게임 진행'], ['board', '조별 모아보기'], ['ref', '예시 답안'], ['score', '점수판 · 평가'], ['admin', '설정']];
  const body = { run: tRun, game: tGame, board: tBoard, ref: tRef, score: tScore, admin: tAdmin }[tTab]();
  return `<div class="pagehead"><p class="eyebrow">강사 화면</p><h2>3-2 캠페인 기획 실습 운영</h2></div><div class="subtabs">${tabs.map(([k, l]) => `<button type="button" class="${tTab === k ? 'on' : ''}" data-ttab="${k}">${l}</button>`).join('')}</div>${body}`;
}
function tRun() {
  const sl = num(S.control.slide); const end = num(S.control.timerEnd);
  return `<section class="card"><h3>학생 화면 맞추기</h3><p class="muted">장별 대본에서 [학생 화면을 N장으로]를 누르면 학생 상단에 "선생님은 지금 N장" 버튼이 뜹니다.</p>
      <div class="row"><span>현재: <b>${sl ? sl + '장 · ' + esc(SL(sl).title) : '없음'}</b></span><button type="button" class="btn sm ghost" data-goslide="${sl || 1}">대본 열기</button>${sl ? '<button type="button" class="btn sm ghost" data-act="unsync">해제</button>' : ''}</div></section>
    <section class="card"><h3>공용 실습 타이머</h3><p class="muted">시작하면 모든 학생 화면 오른쪽 아래에 남은 시간이 보입니다.</p>
      <div class="row">${SHEETS.map((s) => `<button type="button" class="btn sm ghost" data-timer="${s.id}">${s.no} ${s.min}분</button>`).join('')}</div>
      <div class="row"><input type="number" id="tMin" min="1" max="120" value="10" style="width:90px"><button type="button" class="btn sm" data-act="timerCustom">분 타이머</button>${end ? '<button type="button" class="btn sm warn" data-act="timerStop">타이머 끄기</button>' : ''}</div></section>
    <section class="card"><h3>오늘의 흐름</h3>${flowTable()}</section>`;
}
function tGame() {
  const rev = bingoRevealed(); const idx = S.control.bingoIdx ?? -1; const bt = BT(); const c1 = rev.length ? bt[rev[rev.length - 1]] : null; const bingo = S.games.bingo || {};
  const rank = teamIds().map((t) => ({ t, l: (bingo[t] || {}).lines || 0, d: (bingo[t] || {}).doneAt || 0 })).sort((a, b) => (b.d ? 1 : 0) - (a.d ? 1 : 0) || (a.d - b.d) || b.l - a.l);
  const col = (g) => teamIds().map((t) => `<td class="num">${gdata(g, t).score ?? '—'}</td>`).join('');
  return `<section class="card"><h3>용어 빙고 진행</h3><div class="clue big">${c1 ? `<small>뜻 카드 ${rev.length} / ${bt.length} · 정답 <b>${esc(c1.t)}</b></small><p>${esc(hideTerm(c1))}</p>` : '<p>아직 공개한 카드가 없습니다.</p>'}</div>
      <div class="row"><button type="button" class="btn ghost" data-act="bingoPrev" ${idx < 0 ? 'disabled' : ''}>← 이전</button><button type="button" class="btn big" data-act="bingoNext" ${idx >= bt.length - 1 ? 'disabled' : ''}>다음 뜻 카드 공개 →</button><button type="button" class="btn ghost" data-act="bingoReset">새 판</button></div>
      <ol class="rank">${rank.map((r) => `<li><b>${esc(teamName(r.t))}</b> <span class="num">${r.l}줄</span>${r.d ? ' <span class="pill ok">3줄 완성</span>' : ''} <span class="muted">· ${bingoPoints(r.t)}점</span></li>`).join('')}</ol></section>
    <section class="card"><h3>게임 기록 (조 최고점)</h3><div class="tblwrap"><table class="ws res"><thead><tr><th>게임</th>${teamIds().map((t) => `<th>${teamNo(t)}조</th>`).join('')}<th></th></tr></thead><tbody>
      ${SCORE_IDS.map((g) => `<tr><th>${esc(LG(g) ? LG(g).title : GTITLE[g])}</th>${col(g)}<td><button type="button" class="btn sm ghost" data-greset="${g}">지우기</button></td></tr>`).join('')}</tbody></table></div></section>`;
}
function tBoard() {
  let html = `<div class="tblwrap"><table class="ws res matrix"><thead><tr><th>조</th>${SHEETS.map((s) => `<th title="${esc(s.title)}">${s.no}</th>`).join('')}<th>힌트</th></tr></thead><tbody>
    ${teamIds().map((t) => `<tr><th>${esc(teamName(t))}<small>${esc((S.teams[t] || {}).store || '')}</small></th>${SHEETS.map((s) => { const p = progress(t, s.id); return `<td><button type="button" class="pct" style="--p:${p}%" data-peek="${t}|${s.id}">${p}%</button></td>`; }).join('')}<td class="num">${SHEETS.reduce((a, s) => a + num(sheetOf(t, s.id).hints), 0)}</td></tr>`).join('')}
  </tbody></table></div><p class="muted">칸을 누르면 그 조의 시트를 읽기 전용으로 봅니다.</p>`;
  if (peek) { const sh = SHEET(peek.ws);
    html += `<section class="card peek"><header class="row"><h3>${esc(teamName(peek.team))} · ${sh.no} ${esc(sh.title)}</h3><select id="peekCmp"><option value="">비교할 조</option>${teamIds().filter((t) => t !== peek.team).map((t) => `<option value="${t}" ${peek.cmp === t ? 'selected' : ''}>${esc(teamName(t))}</option>`).join('')}<option value="__model" ${peek.cmp === '__model' ? 'selected' : ''}>예시 MOOD SHIFT</option></select>
      <button type="button" class="btn sm ghost" data-act="peekPrint">이 조 ①~⑫ 인쇄</button><button type="button" class="btn sm ghost" data-act="peekClose">닫기</button></header>
      <div class="${peek.cmp ? 'cmp' : ''}"><div>${peekSheet(peek.team, sh)}</div>${peek.cmp ? `<div><h4>${peek.cmp === '__model' ? '예시 MOOD SHIFT' : esc(teamName(peek.cmp))}</h4>${peek.cmp === '__model' ? renderParts(sh, sh.model, true).replace(/<div class="(calc|poster|readaloud)"[^>]*><\/div>/g, '') : peekSheet(peek.cmp, sh)}</div>` : ''}</div></section>`; }
  return html;
}
function peekSheet(t, sh) { return `<ul class="checks-out">${checksFor(sh.id, t)}</ul>${renderParts(sh, sheetOf(t, sh.id), true).replace(/<div class="(calc|poster|readaloud)"[^>]*><\/div>/g, (m, type) => type === 'calc' ? `<div class="calc">${calcHTML(sh.id, t)}</div>` : type === 'poster' ? posterHTML(t) : '')}`; }
function tRef() {
  const sh = SHEET(cur.ref); const ex = SL(sh.ex);
  return `<section class="card"><label class="switch"><input type="checkbox" data-ctl="lockEx" ${S.control.lockEx ? 'checked' : ''}><span>수업 중 예시 답안 잠그기 (활동지 비교 버튼 · 예시 답안 장)</span></label></section>
    <div class="subtabs small">${SHEETS.map((s) => `<button type="button" class="${s.id === sh.id ? 'on' : ''}" data-ref="${s.id}">${s.no}</button>`).join('')}</div>
    <div class="refgrid"><section class="card"><h3>${sh.no} ${esc(sh.title)} · 예시 답안</h3>${renderParts(sh, sh.model, true).replace(/<div class="(calc|poster|readaloud)"[^>]*><\/div>/g, '')}${sh.modelNote ? `<p class="note">${esc(sh.modelNote)}</p>` : ''}</section>
      <aside><section class="card casec"><h3>${sh.ex}장 · ${esc(ex.title)}</h3><p class="exnote">정답이 아니라 참고 예시예요.</p><p><b>핵심</b> ${esc(ex.core)}</p>${ex.know.map((k) => `<p class="small">${esc(k)}</p>`).join('')}<button type="button" class="btn sm ghost" data-goslide="${sh.ex}">대본 열기</button></section>
        <section class="card"><h3>돌면서 볼 것 (${sh.slide}장)</h3><p>${esc(SL(sh.slide).watch)}</p></section>
        <section class="card"><h3>교육생 힌트 3단계</h3>${sh.hints.map((h) => `<p class="hint">${esc(h)}</p>`).join('')}</section></aside></div>`;
}
function tScore() {
  return `<section class="card"><h3>점수판</h3><p class="muted">게임 점수는 자동 합산(빙고 줄당 5 + 완성 순위 30/20/10, 나머지 게임 조 최고점). 조정 칸으로 가산점을 더하십시오.</p>
    <div class="tblwrap"><table class="ws res"><thead><tr><th>조</th><th>빙고</th><th>게임</th><th>조정</th><th>합계</th></tr></thead><tbody>
    ${teamIds().map((t) => { const i = teamNo(t) - 1; return `<tr><th>${esc(teamName(t))}</th><td class="num">${bingoPoints(t)}</td><td class="num">${gameScore(t) - bingoPoints(t)}</td><td class="adj"><button type="button" class="btn sm ghost" data-adj="${i}|-5">−5</button><span class="num">${S.scores.s[i] || 0}</span><button type="button" class="btn sm ghost" data-adj="${i}|5">+5</button></td><td class="num"><b>${totalScore(t)}</b></td></tr>`; }).join('')}</tbody></table></div></section>
    <section class="card"><header class="row"><h3>상호 평가</h3><label class="switch"><input type="checkbox" data-ctl="evalOpen" ${S.control.evalOpen ? 'checked' : ''}><span>교육생에게 결과 공개</span></label></header>
      <label class="field"><span>지금 발표 중인 팀</span><select data-ctlsel="presenting"><option value="">없음</option>${teamIds().map((t) => `<option value="${t}" ${S.control.presenting === t ? 'selected' : ''}>${esc(teamName(t))}</option>`).join('')}</select></label>${evalTable()}</section>`;
}
function tAdmin() {
  return `<section class="card"><h3>수업 설정</h3><label class="field"><span>참여 조 수</span><select data-ctlsel="teamCount">${[3, 4, 5, 6].map((n) => `<option value="${n}" ${S.control.teamCount === n ? 'selected' : ''}>${n}개 조</option>`).join('')}</select></label>
    <label class="switch"><input type="checkbox" data-ctl="lockEx" ${S.control.lockEx ? 'checked' : ''}><span>예시 답안 잠그기 (끄면 자습 모드: 누구나 비교 가능)</span></label></section>
    <section class="card"><h3>결과 내보내기</h3><div class="row"><button type="button" class="btn" data-act="exportJSON">전체 기록 JSON</button><button type="button" class="btn" data-act="exportCSV">활동지 CSV (엑셀)</button></div></section>
    <section class="card danger"><h3>수업 데이터 초기화</h3><p class="muted">모든 조의 활동지·게임·평가·점수를 지웁니다(개인 진도는 각 브라우저에 남습니다).</p><button type="button" class="btn warn" data-act="reset">초기화</button></section>`;
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
async function startTimer(min, label) { await control('timerLabel', label); await control('timerEnd', Date.now() + min * 60000); toast(`${label} · ${min}분 타이머 시작`); }

/* ───────────── 이벤트 ───────────── */
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return; const ds = b.dataset;
  if (ds.view) return go(ds.view);
  if (ds.follow !== undefined) return goSlide(num(S.control.slide));
  if (ds.goslide) return goSlide(num(ds.goslide));
  if (ds.copy) {
    const s = SL(cur.slide); const g = stageOf(s.no);
    if (!canCopy(s.no)) return toast('예시 답안은 선생님이 공개하면 복사할 수 있습니다');
    const M = { all: [slideText2(s, 'all'), `${s.no}장 전체를`], script: [slideText2(s, 'script'), `${s.no}장 대본을`], core: [s.core, '핵심 한 줄을'], next: [s.next, '넘어가는 한마디를'],
      stage: [copyRange(g.from, g.to, 'all'), `${g.t} ${g.from}~${g.to}장을`], allScript: [copyRange(1, 56, 'script'), '1~56장 대본 전체를'] }[ds.copy];
    return copyText(M[0], M[1]);
  }
  if (ds.copyline != null) { const x = SL(cur.slide).script[Number(ds.copyline)]; return copyText(x.say, '문장을'); }
  if (ds.team) { TEAM = ds.team; store.set('cp2_team', TEAM); return render(); }
  if (ds.game !== undefined) { cur.game = ds.game || null; if (view !== 'game') { view = 'game'; store.set('cp2_view', view); } LS = null; WQ = null; SQ = null; if (LG(cur.game) && LG(cur.game).type === 'calc' && P.best.g6 == null) best('g6', 1); render(); return scrollTo(0, 0); }
  if (ds.sheet) { cur.sheet = ds.sheet; store.set('cp2_sheet', ds.sheet); showModel = false; lastField = null; render(); return scrollTo(0, 0); }
  if (ds.gosheet) { cur.sheet = ds.gosheet; store.set('cp2_sheet', ds.gosheet); showModel = false; return go('sheet'); }
  if (ds.term) { const t = TERMS.find((x) => x.t === ds.term); $('#termPop').innerHTML = `<div class="card termpop"><b>${esc(t.t)}</b> <small class="muted">${esc(t.cat)}</small><p>${esc(t.d)}</p><label class="chk"><input type="checkbox" data-know="${esc(t.t)}" ${P.known.has(t.t) ? 'checked' : ''}><span>알아요</span></label></div>`; return; }
  if (ds.know !== undefined) { P.known.add(ds.know); saveP(); card.flip = false; return render(); }
  if (ds.gcat !== undefined) { cur.gcat = ds.gcat; card = { i: 0, flip: false }; return render(); }
  if (ds.gmode) { cur.gmode = ds.gmode; card = { i: 0, flip: false }; return render(); }
  if (ds.lg != null) {
    const g = LG(cur.game); const st = lgState(g); const i = Number(ds.lg); if (st.picks[i]) return;
    st.picks[i] = ds.opt; lgFinish(g); const y = scrollY; render(); scrollTo(0, y); return;
  }
  if (ds.ord) {
    const g = LG(cur.game); const st = lgState(g);
    if (ds.ord === g.items[st.trail.length]) { st.trail.push(ds.ord); lgFinish(g); const y = scrollY; render(); scrollTo(0, y); }
    else { st.miss++; b.classList.add('shake'); setTimeout(() => b.classList.remove('shake'), 400); toast('순서가 달라요 · 다시 생각해 보세요'); }
    return;
  }
  if (ds.cell != null) return bingoTap(Number(ds.cell));
  if (ds.wtile != null) { const t = WQ.tiles.find((x) => x.id === Number(ds.wtile)); if (t && !WQ.placed.includes(t)) { WQ.placed.push(t); render(); wCheck(); } return; }
  if (ds.wslot != null) { WQ.placed.splice(Number(ds.wslot)); return render(); }
  if (ds.stile != null) { const t = SQ.tiles.find((x) => x.id === Number(ds.stile)); if (t && !SQ.placed.includes(t)) { SQ.placed.push(t); render(); } return; }
  if (ds.splaced != null) { SQ.placed.splice(Number(ds.splaced), 1); return render(); }
  if (ds.sadd) { SQ.words.push(ds.sadd); return render(); }
  if (ds.sfree != null) { SQ.words.splice(Number(ds.sfree), 1); return render(); }
  if (ds.sendslogan) { save('w4', ds.sendslogan + '_slogan', SQ.words.join(' ').replace(/\s+([,.])/g, '$1')); if (P.best.slogan == null) best('slogan', 0); toast(`활동지 ④ ${ds.sendslogan}안 슬로건으로 보냈습니다`); return; }
  if (ds.tag) { const [ws, k] = ds.for.split('|'); const el = $(`[data-ws="${ws}"][data-k="${k}"]`); el.value = (el.value ? el.value.trimEnd() + ' ' : '') + `[${ds.tag}] `; el.focus(); save(ws, k, el.value); autosize(el); return; }
  if (ds.pull) {
    const c = CASE.find((x) => x.id === ds.pull); const el = lastField && document.body.contains(lastField) ? lastField : $('#sheet textarea:not([disabled])'); if (!el) return toast('붙일 입력칸이 없습니다');
    el.value = (el.value ? el.value.trimEnd() + ' / ' : '') + `[${c.tag}] ${c.body}`; save(el.dataset.ws, el.dataset.k, el.value); autosize(el); refreshSheet(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return toast('케이스 자료를 붙였습니다');
  }
  if (ds.timer) { const sh = SHEET(ds.timer); return startTimer(sh.min, `실습 ${sh.no} ${sh.title}`); }
  if (ds.ttab) { tTab = ds.ttab; return render(); }
  if (ds.ref) { cur.ref = ds.ref; return render(); }
  if (ds.peek) { const [team, ws] = ds.peek.split('|'); peek = { team, ws }; return render(); }
  if (ds.adj) { const [i, d] = ds.adj.split('|').map(Number); const s = S.scores.s.slice(); s[i] = (s[i] || 0) + d; S.scores.s = s; render(); return api('/api/scores', { s }).catch(() => toast('저장 실패')); }
  if (ds.greset) { if (!confirm('이 게임의 모든 조 기록을 지울까요?')) return; await api('/api/gamereset', { g: ds.greset }); return poll(); }
  const A = {
    saveTeam: async () => { await api('/api/team', { team: TEAM, name: $('#tName').value, author: $('#tAuthor').value, store: $('#tStore').value }); toast('저장했습니다'); poll(); },
    seen: () => { if (P.seen.has(cur.slide)) P.seen.delete(cur.slide); else P.seen.add(cur.slide); saveP(); render(); },
    nextSlide: () => { P.seen.add(cur.slide); saveP(); goSlide(cur.slide + 1); },
    toggleHide: () => { P.hide = !P.hide; saveP(); render(); },
    peekScript: () => { $('.script').classList.remove('hidden'); b.remove(); },
    toggleBig: () => { P.big = !P.big; render(); },
    syncSlide: () => { control('slide', cur.slide); toast(`학생 화면을 ${cur.slide}장으로 맞췄습니다`); },
    unsync: () => control('slide', 0),
    flip: () => { card.flip = !card.flip; render(); }, cardNext: () => { card.i++; card.flip = false; render(); },
    lgRetry: () => { LS = null; render(); },
    calcReset: () => { Object.assign(CALC, CALC0); render(); },
    wStart: () => { WQ = { list: shuffle(WORDS).slice(0, 10), i: 0, score: 0 }; wSetup(); render(); }, wHint: () => { WQ.hint = true; render(); }, wSkip: wAdvance,
    sStart: () => { SQ = { i: 0, score: 0, placed: [], tiles: [], words: [], free: false }; sSetup(); render(); },
    sFree: () => { if (!SQ) SQ = { i: 0, score: 0, placed: [], tiles: [], words: [] }; SQ.free = true; render(); },
    sClearQ: () => { SQ.placed = []; render(); }, sClear: () => { SQ.words = []; render(); }, sOwn: () => { const v = $('#sOwn').value.trim(); if (v) { SQ.words.push(v); render(); } },
    sCheck: () => { const p = SLOGANS[SQ.i]; if (SQ.placed.map((x) => x.w).join(' ') === p.answer.join(' ')) { SQ.score += 10; toast('정답! ' + p.answer.join(' ')); SQ.i++; if (SQ.i < SLOGANS.length) sSetup(); best('slogan', SQ.score); if (SQ.score > (gdata('slogan').score || 0)) saveGame('slogan', { score: SQ.score }); render(); }
      else { $('#sphrase').classList.add('shake'); toast('순서나 카드가 다릅니다'); setTimeout(() => { const s = $('#sphrase'); if (s) s.classList.remove('shake'); }, 500); } },
    hint: () => { save(cur.sheet, 'hints', String(Math.min(3, num(sheetOf(TEAM, cur.sheet).hints) + 1))); render(); },
    toggleModel: () => { showModel = !showModel; render(); },
    pullInsight: () => { const w3 = sheetOf(TEAM, 'w3'); const v = w3.pick ? w3['i' + w3.pick + '_text'] : ''; if (!v) return toast('③에서 가장 강한 인사이트 번호를 먼저 고르십시오'); save('w4', 's1', v); render(); },
    pull11: () => pull11(false), pull11all: () => { if (confirm('⑪ 여덟 칸을 ①~⑩ 내용으로 다시 채울까요? 직접 고친 내용은 덮어씁니다.')) pull11(true); },
    print11: () => printSheets(['w11']), printAll: () => printSheets(SHEETS.map((s) => s.id)),
    clockToggle: () => { clock.run = !clock.run; clearInterval(clock.h); if (clock.run) clock.h = setInterval(tick, 1000); render(); },
    clockQA: () => { clearInterval(clock.h); clock = { left: 240, run: false, phase: '질의', h: null }; render(); },
    clockReset: () => { clearInterval(clock.h); clock = { left: 480, run: false, phase: '발표', h: null }; render(); },
    bingoNext: () => control('bingoIdx', (S.control.bingoIdx ?? -1) + 1), bingoPrev: () => control('bingoIdx', Math.max(-1, (S.control.bingoIdx ?? -1) - 1)),
    bingoReset: async () => { if (!confirm('새 판을 시작할까요? 모든 조의 빙고 기록이 지워집니다.')) return; await api('/api/gamereset', { g: 'bingo' }); poll(); },
    timerCustom: () => startTimer(Math.max(1, num($('#tMin').value)), '실습'), timerStop: () => control('timerEnd', 0),
    peekClose: () => { peek = null; render(); }, peekPrint: () => printSheets(SHEETS.map((s) => s.id), peek.team),
    exportJSON: () => download(`campaign-class-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S, null, 2), 'application/json'),
    exportCSV: () => { const rows = [['조', '팀명', '지점', '작성자', '시트', '항목', '내용']];
      for (const t of teamIds()) for (const sh of SHEETS) { const d = sheetOf(t, sh.id); const ti = S.teams[t] || {}; for (const k of sheetKeys(sh)) if (d[k]) rows.push([teamNo(t) + '조', ti.name || '', ti.store || '', ti.author || '', sh.no + ' ' + sh.title, k, d[k]]); }
      download('campaign-sheets.csv', '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n'), 'text/csv'); },
    reset: async () => { if (!confirm('정말 모든 기록을 지울까요?') || !confirm('되돌릴 수 없습니다. 초기화합니다.')) return; await api('/api/reset', {}); V = 0; poll(); toast('초기화했습니다'); },
  };
  if (ds.act && A[ds.act]) A[ds.act]();
});
function pull11(all) {
  const g = gen11(TEAM); const d = sheetOf(TEAM, 'w11'); let n = 0;
  for (const [k, v] of Object.entries(g)) if (v && (all || !String(d[k + '_txt'] || '').trim())) { save('w11', k + '_txt', v); n++; }
  render(); toast(n ? `${n}칸을 채웠습니다 · 위에서 아래로 이어 읽어 보십시오` : '채울 빈 칸이 없거나 앞 시트가 비어 있습니다');
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.k && el.dataset.ws && !el.disabled) { save(el.dataset.ws, el.dataset.k, el.type === 'checkbox' ? (el.checked ? 'Y' : '') : el.value); if (el.tagName === 'TEXTAREA') autosize(el); refreshSheet(); return; }
  if (el.dataset.eval) { el.nextElementSibling.textContent = el.value; saveEval(); return; }
  if (el.id === 'evalNote') { saveEval(); return; }
  if (el.dataset.calcK) { CALC[el.dataset.calcK] = Number(el.value); if (P.best.g6 == null) best('g6', 1); const k = el.dataset.calcK; const y = scrollY; render(); scrollTo(0, y); const again = $(`[data-calc-k="${k}"]`); if (again) again.focus(); return; }
  if (el.id === 'gq') { cur.gq = el.value; const pos = el.selectionStart; render(); const q = $('#gq'); q.focus(); q.setSelectionRange(pos, pos); }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'teamSel') { TEAM = el.value; store.set('cp2_team', TEAM); return render(); }
  if (el.dataset.know !== undefined && el.type === 'checkbox') { if (el.checked) P.known.add(el.dataset.know); else P.known.delete(el.dataset.know); saveP(); if (view === 'glossary') { const y = scrollY; render(); scrollTo(0, y); } return; }
  if (el.dataset.ctl) return control(el.dataset.ctl, el.checked);
  if (el.dataset.ctlsel) return control(el.dataset.ctlsel, el.dataset.ctlsel === 'teamCount' ? Number(el.value) : el.value);
  if (el.id === 'evalTo') { evalTo = el.value; return render(); }
  if (el.id === 'peekCmp') { peek.cmp = el.value; return render(); }
});
document.addEventListener('focusin', (e) => { if (e.target.matches('#sheet textarea[data-k]:not([disabled])')) lastField = e.target; });
document.addEventListener('keydown', (e) => {
  if (view !== 'slides' || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) return;
  if (e.key === 'ArrowRight') { P.seen.add(cur.slide); saveP(); goSlide(cur.slide + 1); }
  if (e.key === 'ArrowLeft') goSlide(cur.slide - 1);
  if (e.key === 'Escape' && P.big) { P.big = false; render(); }
});
window.addEventListener('hashchange', render);

render();
poll().then(render);
setInterval(poll, 2000);
