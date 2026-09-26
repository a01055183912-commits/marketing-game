/* 3-2 캠페인 기획 실습 웹앱 · 화면 로직 (외부 라이브러리 없음) */
'use strict';

/* ───────────── 공통 도구 ───────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
const won = (n) => Math.round(n).toLocaleString('ko-KR');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경 */ } },
};
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(arr, seed) { const r = seed == null ? Math.random : rng(seed); const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('save failed');
  return r.json();
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ───────────── 상태 ───────────── */
let S = { v: 0, teams: {}, sheets: {}, games: {}, evals: {}, control: { teamCount: 4, bingoSeed: 1, bingoIdx: -1 }, scores: { s: [0, 0, 0, 0, 0, 0] } };
let V = 0;
let TEAM = store.get('cp_team') || '';
const IS_TEACHER = () => location.hash === '#teacher';
let view = store.get('cp_view') || 'home';
let cur = { sheet: store.get('cp_sheet') || 'w1', game: 'bingo', ref: 'w1', learn: 0 };
const pending = {};           // "team|ws|k" -> value (서버 저장 전 입력)
const timers = {};
let online = true;

const teamNo = (t) => Number(String(t).replace('team', ''));
const teamIds = () => Array.from({ length: S.control.teamCount || 4 }, (_, i) => 'team' + (i + 1));
const teamName = (t) => (S.teams[t] && S.teams[t].name) ? `${teamNo(t)}조 · ${S.teams[t].name}` : `${teamNo(t)}조`;
const sheetOf = (t, ws) => ((S.sheets[t] || {})[ws]) || {};
const SHEET = (ws) => SHEETS.find((s) => s.id === ws);

function applyPending() {
  for (const [key, v] of Object.entries(pending)) {
    const [t, ws, k] = key.split('|');
    const tt = (S.sheets[t] = S.sheets[t] || {}); const w = (tt[ws] = tt[ws] || {}); w[k] = v;
  }
}
function save(ws, k, v, t = TEAM) {
  if (!t) { toast('먼저 우리 조를 고르십시오.'); return; }
  const key = `${t}|${ws}|${k}`;
  pending[key] = v; applyPending();
  clearTimeout(timers[key]);
  timers[key] = setTimeout(async () => {
    try { await api('/api/sheet', { team: t, ws, k, v }); if (pending[key] === v) delete pending[key]; setOnline(true); }
    catch (e) { setOnline(false); timers[key] = setTimeout(() => save(ws, k, pending[key] ?? v, t), 3000); }
  }, 500);
}
function control(key, value) { S.control[key] = value; return api('/api/control', { key, value }).then(() => poll()); }
function setOnline(ok) { online = ok; const d = $('#net'); if (d) { d.textContent = ok ? '저장됨' : '연결 끊김 · 다시 시도 중'; d.className = 'net ' + (ok ? 'ok' : 'bad'); } }

async function poll() {
  try {
    const r = await fetch('/api/state?v=' + V, { cache: 'no-store' });
    setOnline(true);
    if (r.status === 204) return;
    const s = await r.json();
    S = s; V = s.v; applyPending();
    onState();
  } catch (e) { setOnline(false); }
}

/* ───────────── 시트 스키마 도구 ───────────── */
function sheetKeys(sh) {
  const keys = [];
  for (const p of sh.parts) {
    if (p.type === 'table') p.rows.forEach((r) => p.cols.forEach((c) => { if (c.t !== 'auto') keys.push(`${r.k}_${c.k}`); }));
    else if (p.type === 'fields' || p.type === 'grid4' || p.type === 'checks') p.items.forEach((i) => keys.push(i.k));
  }
  return keys;
}
function progress(t, ws) {
  const sh = SHEET(ws); const keys = sheetKeys(sh).filter((k) => !/_(use|pri|type)$|^c[1-4]$/.test(k));
  const d = sheetOf(t, ws);
  const filled = keys.filter((k) => String(d[k] ?? '').trim() !== '').length;
  return keys.length ? Math.round((filled / keys.length) * 100) : 0;
}
function finalSlogan(t) {
  const d = sheetOf(t, 'w3'); const f = d.final;
  if (!f) return '';
  const n = (d[f + '_name'] || '').trim(), s = (d[f + '_slogan'] || '').trim();
  return [n && `'${n}'`, s].filter(Boolean).join(' — ');
}

/* ───────────── 입력 요소 렌더링 ───────────── */
function inputHTML(ws, key, col, val, ro, ph) {
  const a = `data-ws="${ws}" data-k="${key}" ${ro ? 'disabled' : ''}`;
  const v = val ?? '';
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
const TAGS = ['사실', '가정', '기획 판단'];
function tagBar(ws, key, ro) {
  if (ro) return '';
  return `<div class="tagbar">${TAGS.map((t) => `<button type="button" class="tagbtn" data-tag="${t}" data-for="${ws}|${key}">[${t}]</button>`).join('')}</div>`;
}

function renderParts(sh, d, ro) {
  const ws = sh.id;
  return sh.parts.map((p) => {
    if (p.type === 'table') {
      return `<div class="tblwrap"><table class="ws"><thead><tr><th class="rowh">${esc(p.head)}</th>${p.cols.map((c) => `<th class="${c.wide ? 'wide' : c.t === 'num' || c.t === 'sel' || c.t === 'chk' ? 'narrow' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
        ${p.rows.map((r) => `<tr><th class="rowh" scope="row">${esc(d[r.k + '_name'] && p.cols.some((c) => c.phFromRow) ? d[r.k + '_name'] : r.label)}${r.src ? `<small>${esc(r.src)}</small>` : ''}</th>
          ${p.cols.map((c) => { const key = `${r.k}_${c.k}`; const col = r.num && c.t === 'text' ? { ...c, t: 'num' } : c;
            return `<td data-label="${esc(c.label)}">${inputHTML(ws, key, col, d[key], ro, c.phFromRow ? r.label : '')}${c.tag ? tagBar(ws, key, ro) : ''}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>`;
    }
    if (p.type === 'fields') {
      return `<div class="fields">${p.items.map((i) => `<label class="field ${i.t === 'text' ? 'full' : ''}"><span>${esc(i.label)}</span>${inputHTML(ws, i.k, i, d[i.k], ro, i.ph)}
        ${i.pull === 'insight' && !ro ? `<button type="button" class="btn sm ghost" data-act="pullInsight">② 인사이트 가져오기</button>` : ''}</label>`).join('')}</div>`;
    }
    if (p.type === 'grid4') {
      return `<div class="grid4">${p.items.map((i, n) => `<label class="story s${n + 1}"><b>${esc(i.label)}</b><small>${esc(i.sub)}</small><textarea data-ws="${ws}" data-k="${i.k}" rows="6" ${ro ? 'disabled' : ''}>${esc(d[i.k] || '')}</textarea></label>`).join('')}</div>`;
    }
    if (p.type === 'checks') {
      return `<div class="checks">${p.items.map((i) => `<label class="chk big"><input type="checkbox" data-ws="${ws}" data-k="${i.k}" ${d[i.k] === 'Y' ? 'checked' : ''} ${ro ? 'disabled' : ''}><span>${esc(i.label)}</span></label>`).join('')}</div>`;
    }
    if (p.type === 'readaloud') return `<div class="readaloud" data-read="${ws}"></div>`;
    if (p.type === 'calc') return `<div class="calc" data-calc="${p.fn}"></div>`;
    if (p.type === 'pull') return ro ? '' : `<div class="pullbar"><button type="button" class="btn" data-act="pull10">①~⑨에서 가져오기 (빈 칸만)</button><button type="button" class="btn ghost" data-act="pull10all">전부 다시 가져오기</button><button type="button" class="btn ghost" data-act="print">1페이지 인쇄 · PDF</button></div>`;
    if (p.type === 'poster') return `<div class="poster" data-poster="${ws}"></div>`;
    return '';
  }).join('');
}

/* ───────────── 자동 계산 · 점검 ───────────── */
function w5Sums(d) {
  const rows = SHEET('w5').parts[0].rows; const g = { digital: 0, local: 0, crm: 0, off: 0 }; let sum = 0;
  rows.forEach((r) => { const v = num(d[r.k + '_pct']); sum += v; g[r.grp] += v; });
  return { sum, g };
}
function w8Rows(d) {
  const total = num(d.total); const rows = SHEET('w8').parts[1].rows;
  let sum = 0; const amt = {};
  rows.forEach((r) => { const p = num(d[r.k + '_pct']); sum += p; amt[r.k] = total * p / 100; });
  return { total, sum, amt };
}
function badge(ok, msg) { const cls = ok === true ? 'ok' : ok === false ? 'warn' : 'info'; return `<li class="${cls}">${ok === true ? '✓' : ok === false ? '!' : 'i'} ${msg}</li>`; }

function checksFor(ws, t) {
  const d = sheetOf(t, ws); const out = [];
  const w1 = sheetOf(t, 'w1'); const main = num(w1.mainNum);
  const filled = (k) => String(d[k] ?? '').trim() !== '';
  if (ws === 'w1') {
    const pr = ['g1', 'g2', 'g3', 'g4'].map((g) => d[g + '_pri']);
    const nMain = pr.filter((x) => x === '주').length, nSub = pr.filter((x) => x === '부').length;
    out.push(badge(nMain === 1, `주 목표 ${nMain}개 (1개여야 합니다)`));
    out.push(badge(nSub === 1, `부 목표 ${nSub}개 (1개여야 합니다)`));
    out.push(badge(main > 0, main > 0 ? `주 목표 수치 ${won(main)} — ⑧·⑨로 이어집니다` : `주 목표 수치를 숫자로 적으십시오`));
    const mk = ['g1', 'g2', 'g3', 'g4'].find((g) => d[g + '_pri'] === '주');
    if (mk) out.push(badge(/\d/.test(d[mk + '_sent'] || ''), `주 목표 문장에 숫자가 ${/\d/.test(d[mk + '_sent'] || '') ? '있습니다' : '없습니다'}`));
  } else if (ws === 'w2') {
    ['i1', 'i2', 'i3'].forEach((i, n) => {
      const s = d[i + '_text'] || '';
      if (s.trim()) out.push(badge(/때|는데|는 데|해서|어서|아서/.test(s) ? true : 'info', `${n + 1}번 — ${/때|는데|는 데|해서|어서|아서/.test(s) ? '상황이 보이는 문장입니다' : '"~일 때 ~하는데" 형식인지 다시 읽어 보십시오'}`));
      if (s.trim() && !filled(i + '_basis')) out.push(badge(false, `${n + 1}번 근거 칸이 비어 있습니다`));
    });
    out.push(badge(filled('pick'), filled('pick') ? `${d.pick}번 인사이트가 ③으로 넘어갑니다` : `가장 강한 인사이트 번호를 고르십시오`));
  } else if (ws === 'w3') {
    const f = d.final;
    out.push(badge(!!f, f ? `최종안 ${f} — ${esc(finalSlogan(t)) || '캠페인명·슬로건을 채우십시오'}` : `최종 선택안을 고르십시오`));
    const nc = ['c1', 'c2', 'c3', 'c4'].filter((k) => d[k] === 'Y').length;
    out.push(badge(nc === 4 ? true : 'info', `점검 ${nc}/4 충족`));
  } else if (ws === 'w4') {
    const n = ['p1', 'p2', 'p3', 'p4'].filter(filled).length;
    out.push(badge(n === 4, `네 칸 중 ${n}칸 작성`));
  } else if (ws === 'w5') {
    const { sum } = w5Sums(d);
    out.push(badge(sum === 100, `예산 비중 합계 ${sum}%`));
    SHEET('w5').parts[0].rows.forEach((r) => {
      const use = d[r.k + '_use'] === 'Y', p = num(d[r.k + '_pct']); const nm = d[r.k + '_name'] || r.label;
      if (!use && p > 0) out.push(badge(false, `${esc(nm)} — 미사용인데 ${p}%`));
      if (use && !filled(r.k + '_role')) out.push(badge(false, `${esc(nm)} — 역할을 하나 정하십시오`));
    });
  } else if (ws === 'w6') {
    const n = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].filter((s) => filled(s + '_msg')).length;
    out.push(badge(n === 7, `메시지 ${n}/7 단계 작성`));
    const toks = finalSlogan(t).replace(/[—'",.·]/g, ' ').split(/\s+/).filter((w) => w.length >= 2);
    if (toks.length) {
      const hit = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].filter((s) => toks.some((w) => (d[s + '_msg'] || '').includes(w))).length;
      out.push(badge(hit >= 5 ? true : 'info', `슬로건 단어가 들어간 메시지 ${hit}/7`));
    } else out.push(badge('info', `③ 최종 슬로건을 정하면 일관성을 점검합니다`));
    out.push(badge(filled('repeat'), `반복 메시지 ${filled('repeat') ? '작성' : '미작성'}`));
  } else if (ws === 'w7') {
    const v = ['p1', 'p2', 'p3'].map((p) => num(d['vis_' + p])); const tot = v.reduce((a, b) => a + b, 0);
    out.push(badge(tot > 0 ? true : 'info', `예상 방문객 합계 ${won(tot)}명`));
    if (tot && main) out.push(badge('info', `① 주 목표 ${won(main)} ÷ 방문 ${won(tot)} = ${Math.round(main / tot * 100)}%가 목표 행동을 해야 합니다`));
  } else if (ws === 'w8') {
    const { total, sum } = w8Rows(d);
    out.push(badge(total > 0, total > 0 ? `총예산 ${won(total)}원` : `총예산을 숫자로 적으십시오`));
    out.push(badge(sum === 100, `비중 합계 ${sum}%`));
    const w5 = sheetOf(t, 'w5'); const s5 = w5Sums(w5);
    if (s5.sum > 0) {
      const dg = num(d.digital_pct), lc = num(d.local_pct);
      out.push(badge(dg === s5.g.digital ? true : false, `디지털 — ⑤ ${s5.g.digital}% vs ⑧ ${dg}%`));
      out.push(badge(lc === s5.g.local ? true : 'info', `인플루언서·지역 매체 — ⑤ ${s5.g.local}% vs ⑧ ${lc}%`));
    }
    if (!main) out.push(badge('info', `① 주 목표 수치를 적으면 1인당 획득 비용을 계산합니다`));
  } else if (ws === 'w9') {
    const pr = ['aw', 'in', 'ac', 'cv', 'lo'].filter((r) => d[r + '_pri'] === '주');
    out.push(badge(pr.length === 1, `주 KPI ${pr.length}개 (1개여야 합니다)`));
    if (pr.length === 1 && main) {
      const g = (d[pr[0] + '_goal'] || '').replace(/,/g, '');
      out.push(badge(g.includes(String(main)) ? true : 'info', g.includes(String(main)) ? `주 KPI 목표값이 ① 주 목표(${won(main)})와 같습니다` : `주 KPI 목표값이 ① 주 목표(${won(main)})와 같은지 확인하십시오`));
    }
    out.push(badge(filled('denom'), `분모 ${filled('denom') ? '명시' : '미작성'}`));
  } else if (ws === 'w10') {
    const n = ['bg', 'tg', 'nm', 'st', 'ch', 'op', 'bu', 'kp'].filter((r) => filled(r + '_txt')).length;
    out.push(badge(n === 8, `여덟 칸 중 ${n}칸`));
    const w3 = sheetOf(t, 'w3'); const nm = w3.final ? (w3[w3.final + '_name'] || '').trim() : '';
    if (nm) { const hit = ['bg', 'tg', 'nm', 'st', 'ch', 'op', 'bu', 'kp'].filter((r) => (d[r + '_txt'] || '').includes(nm)).length; out.push(badge(hit >= 2 ? true : 'info', `캠페인명 '${esc(nm)}'이 나오는 칸 ${hit}개`)); }
  } else if (ws === 'w11') {
    const sc = ['e1', 'e2', 'e3', 'e4'].map((e) => num(d[e + '_score']));
    out.push(badge(sc.every((x) => x <= 25), `자체 평가 합계 ${sc.reduce((a, b) => a + b, 0)} / 100`));
  }
  return out.join('');
}

function calcHTML(fn, t) {
  const d = sheetOf(t, fn);
  if (fn === 'w5') {
    const { sum, g } = w5Sums(d);
    const seg = [['digital', '디지털', 'c1'], ['local', '인플루언서·지역', 'c2'], ['crm', '카톡·앱·문자', 'c3'], ['off', '오프라인', 'c4']];
    return `<div class="calcrow"><b>채널 비중</b><span class="num">${sum}%</span></div>
      <div class="stack">${seg.map(([k, l, c]) => g[k] ? `<span class="${c}" style="width:${Math.min(100, g[k])}%">${l} ${g[k]}%</span>` : '').join('')}</div>`;
  }
  if (fn === 'w7') {
    const v = ['p1', 'p2', 'p3'].map((p) => num(d['vis_' + p])); const tot = v.reduce((a, b) => a + b, 0);
    return `<div class="calcrow"><b>예상 방문객 합계</b><span class="num">${won(tot)}명</span></div>` +
      (tot ? `<div class="calcrow"><b>시기별 비중</b><span class="num">도입 ${Math.round(v[0] / tot * 100)}% · 집중 ${Math.round(v[1] / tot * 100)}% · 마무리 ${Math.round(v[2] / tot * 100)}%</span></div>` : '');
  }
  if (fn === 'w8') {
    const { total, sum, amt } = w8Rows(d); const main = num(sheetOf(t, 'w1').mainNum);
    const direct = (amt.digital || 0) + (amt.local || 0) + (amt.gift || 0);
    const pd = num(d.digital_pct) + num(d.local_pct) + num(d.gift_pct);
    return `<div class="calcrow"><b>비중 합계</b><span class="num">${sum}% · ${won(total * sum / 100)}원</span></div>
      <div class="calcrow"><b>1인당 획득 비용 (총예산 ÷ ① 주 목표)</b><span class="num">${main && total ? won(total / main) + '원' : '—'}</span></div>
      <div class="calcrow"><b>직접 획득 예산 (디지털 + 인플루언서·지역 + 사은품 = ${pd}%)</b><span class="num">${won(direct)}원${main ? ' · 1인당 ' + won(direct / main) + '원' : ''}</span></div>
      <div class="calcrow"><b>20% 삭감 시 줄일 금액 → 남는 예산</b><span class="num">${total ? won(total * 0.2) + '원 → ' + won(total * 0.8) + '원' : '—'}</span></div>`;
  }
  if (fn === 'w9') {
    const main = num(sheetOf(t, 'w1').mainNum); const w8 = sheetOf(t, 'w8'); const total = num(w8.total);
    return `<div class="calcrow"><b>① 주 목표 수치</b><span class="num">${main ? won(main) : '—'}</span></div>
      <div class="calcrow"><b>⑧ 1인당 획득 비용</b><span class="num">${main && total ? won(total / main) + '원' : '—'}</span></div>
      <div class="calcrow"><b>참고 · 손익분기 증분 매출 (총예산 ÷ GP 30% · 교재 조건)</b><span class="num">${total ? won(total / 0.3) + '원' : '—'}</span></div>`;
  }
  if (fn === 'w11') {
    const sc = ['e1', 'e2', 'e3', 'e4'].map((e) => num(d[e + '_score']));
    return `<div class="calcrow"><b>자체 평가 합계</b><span class="num">${sc.reduce((a, b) => a + b, 0)} / 100</span></div>`;
  }
  return '';
}

/* ⑩ 자동 채움 */
function gen10(t) {
  const w = (ws) => sheetOf(t, ws);
  const w1 = w('w1'), w2 = w('w2'), w3 = w('w3'), w4 = w('w4'), w5 = w('w5'), w6 = w('w6'), w7 = w('w7'), w8 = w('w8'), w9 = w('w9');
  const mk = ['g1', 'g2', 'g3', 'g4'].find((g) => w1[g + '_pri'] === '주'); const sk = ['g1', 'g2', 'g3', 'g4'].find((g) => w1[g + '_pri'] === '부');
  const join = (...a) => a.filter((x) => x && String(x).trim()).join(' ');
  const ch = SHEET('w5').parts[0].rows.filter((r) => w5[r.k + '_use'] === 'Y').map((r) => `${w5[r.k + '_name'] || r.label} ${num(w5[r.k + '_pct'])}%`).join(' · ');
  const b = w8Rows(w8); const main = num(w1.mainNum);
  const top = SHEET('w8').parts[1].rows.map((r) => [r.label, num(w8[r.k + '_pct'])]).sort((a, c) => c[1] - a[1])[0];
  const kp = ['aw', 'in', 'ac', 'cv', 'lo'].find((r) => w9[r + '_pri'] === '주');
  return {
    bg: join(mk && `주 목표: ${w1[mk + '_sent'] || w1[mk + '_target'] || ''}`, sk && `/ 부 목표: ${w1[sk + '_target'] || ''}`),
    tg: join(w1.age_A && `타깃(1순위): ${w1.age_A}.`, w2.pick && w2['i' + w2.pick + '_text'] && `핵심 인사이트: ${w2['i' + w2.pick + '_text']}`),
    nm: join(finalSlogan(t), w3.reason && `— ${w3.reason}`),
    st: [w4.p1, w4.p2, w4.p3, w4.p4].some(Boolean) ? `문제(${(w4.p1 || '').slice(0, 60)}) → 해결(${(w4.p2 || '').slice(0, 60)}) → 변화(${(w4.p3 || '').slice(0, 60)}) → 가치(${(w4.p4 || '').slice(0, 60)})` : '',
    ch: join(ch, w6.repeat && `/ IMC 반복 메시지: ${w6.repeat}`),
    op: join(w7.period_content, w7.place_content && `· ${w7.place_content}`, w7.staff_content && `· ${w7.staff_content}`),
    bu: join(b.total && `총 ${won(b.total)}원${w8.totalTag ? '(' + w8.totalTag + ')' : ''}.`, top && top[1] && `최대 항목 ${top[0]} ${top[1]}%.`, main && b.total && `1인당 획득 비용 ${won(b.total / main)}원.`),
    kp: join(kp && `주 KPI: ${w9[kp + '_kpi'] || ''} ${w9[kp + '_goal'] || ''}.`, w9.q2 && `미달 시 근거: ${w9.q2}`),
  };
}
function posterHTML(t) {
  const d = sheetOf(t, 'w10'); const w1 = sheetOf(t, 'w1'); const w3 = sheetOf(t, 'w3'); const w8 = sheetOf(t, 'w8'); const w7 = sheetOf(t, 'w7'); const w5 = sheetOf(t, 'w5');
  const f = w3.final; const name = f ? (w3[f + '_name'] || '') : ''; const slogan = f ? (w3[f + '_slogan'] || '') : '';
  const total = num(w8.total); const main = num(w1.mainNum);
  const vis = ['p1', 'p2', 'p3'].map((p) => num(w7['vis_' + p])).reduce((a, b) => a + b, 0);
  const ch = SHEET('w5').parts[0].rows.filter((r) => w5[r.k + '_use'] === 'Y').sort((a, b) => num(w5[b.k + '_pct']) - num(w5[a.k + '_pct']))[0];
  const box = (h, k) => `<div class="pbox"><h4>${h}</h4><p>${esc(d[k + '_txt'] || '—')}</p></div>`;
  return `<div class="pposter">
    <div class="phead"><small>${esc(teamName(t))} · 캠페인 기획안 · ${esc((S.teams[t] || {}).author || '')}</small><h3>${esc(name || '캠페인명')}</h3><p class="pslogan">${esc(slogan || '슬로건')}</p></div>
    <div class="pnums">
      <div><b class="num">${main ? won(main) : '—'}</b><span>주 목표</span></div>
      <div><b class="num">${total ? (total >= 1e8 ? (total / 1e8).toFixed(1).replace(/\.0$/, '') + '억' : won(total)) : '—'}</b><span>총예산</span></div>
      <div><b class="num">${main && total ? won(total / main) : '—'}</b><span>1인당 비용(원)</span></div>
      <div><b class="num">${vis ? won(vis) : '—'}</b><span>예상 방문</span></div>
      <div><b>${ch ? esc(w5[ch.k + '_name'] || ch.label) : '—'}</b><span>최대 채널 ${ch ? num(w5[ch.k + '_pct']) + '%' : ''}</span></div>
    </div>
    <div class="pgrid">${box('배경과 목표', 'bg')}${box('타깃과 인사이트', 'tg')}${box('브랜드 스토리', 'st')}${box('채널 · IMC', 'ch')}${box('운영계획', 'op')}${box('예산', 'bu')}${box('KPI와 기대효과', 'kp')}${box('캠페인명과 슬로건', 'nm')}</div>
  </div>`;
}

/* ───────────── 화면: 공통 틀 ───────────── */
const NAV = [
  ['home', '시작'], ['game', '게임'], ['learn', '개념 학습'], ['case', '케이스 C'], ['sheet', '캠페인 실습'], ['present', '발표·평가'],
];
function renderTop() {
  const nav = NAV.concat(IS_TEACHER() ? [['teacher', '강사']] : []);
  $('#nav').innerHTML = nav.map(([k, l]) => `<button type="button" class="${view === k ? 'on' : ''}" data-view="${k}">${l}</button>`).join('');
  const sel = $('#teamSel');
  sel.innerHTML = `<option value="">우리 조 선택</option>` + teamIds().map((t) => `<option value="${t}" ${TEAM === t ? 'selected' : ''}>${esc(teamName(t))}</option>`).join('');
  $('#scoreStrip').innerHTML = teamIds().map((t) => `<span class="${t === TEAM ? 'me' : ''}">${teamNo(t)}조 <b class="num">${totalScore(t)}</b></span>`).join('');
}
function go(v) { view = v; store.set('cp_view', v); render(); window.scrollTo(0, 0); }

function render() {
  if (view === 'teacher' && !IS_TEACHER()) view = 'home';
  renderTop();
  const m = $('#main');
  const fn = { home: vHome, game: vGame, learn: vLearn, case: vCase, sheet: vSheet, present: vPresent, teacher: vTeacher }[view] || vHome;
  m.innerHTML = fn();
  after();
}
function after() {
  if (view === 'sheet') { refreshSheet(); autosizeAll(); }
  if (view === 'game' && cur.game === 'words') wordsMount();
}
function onState() {
  renderTop();
  const a = document.activeElement; const typing = a && $('#main').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
  if (view === 'sheet') {
    const sig = [S.control['mr_' + cur.sheet], JSON.stringify(S.teams[TEAM] || {}), num(sheetOf(TEAM, cur.sheet).hints)].join('|');
    if (sig !== onState.sig && !typing && onState.sig !== undefined) { onState.sig = sig; const y = window.scrollY; render(); window.scrollTo(0, y); return; }
    onState.sig = sig; syncInputs(); refreshSheet(); return;
  }
  if (typing) return;
  if (view === 'teacher' || view === 'home' || view === 'present' || (view === 'game' && cur.game === 'bingo') || view === 'case') {
    const y = window.scrollY; render(); window.scrollTo(0, y);
  }
}

/* ───────────── 시작 ───────────── */
function vHome() {
  const t = TEAM; const info = S.teams[t] || {};
  return `<section class="hero">
    <div><p class="eyebrow">롯데 LIFT · 3-2 캠페인 기획 실습</p>
      <h2>게임으로 풀고,<br><em>11장의 시트</em>로 캠페인을 짓습니다</h2>
      <p class="lead">용어 빙고와 글자 조합으로 몸을 풀고, 개념 카드로 확인한 뒤, 케이스 C 자료를 근거로 캠페인 기획 ①~⑪을 조별로 작성합니다. 계산은 앱이 하고, 판단은 조가 합니다.</p></div>
    <div class="card teamcard">
      <h3>우리 조</h3>
      <div class="teamgrid">${teamIds().map((x) => `<button type="button" class="tpick ${x === t ? 'on' : ''}" data-team="${x}">${teamNo(x)}조${S.teams[x] && S.teams[x].name ? `<small>${esc(S.teams[x].name)}</small>` : ''}</button>`).join('')}</div>
      ${t ? `<label class="field"><span>팀명</span><input type="text" id="tName" value="${esc(info.name || '')}" placeholder="예: 다시출근조"></label>
      <label class="field"><span>작성자</span><input type="text" id="tAuthor" value="${esc(info.author || '')}" placeholder="조원 이름"></label>
      <button type="button" class="btn" data-act="saveTeam">저장</button>` : `<p class="muted">조를 먼저 고르십시오. 같은 조원은 같은 번호를 고르면 기록이 함께 보입니다.</p>`}
    </div>
  </section>
  <section class="flow">
    ${[['game', '1', '게임으로 몸풀기', '용어 빙고 · 글자 조합 · 사실/판단 가르기'], ['learn', '2', '개념 학습', '시트 11장의 목적·공식·흔한 실수 + 확인 퀴즈'], ['case', '3', '케이스 C 자료실', '부산본점 · 50~64세 여성 · 가을 스타일링 페어'], ['sheet', '4', '캠페인 실습', '활동시트 ①~⑪ · 자동 계산과 점검'], ['present', '5', '발표·상호평가', '8분 발표 · 4분 질의 · 4항목 × 25점']]
      .map(([v, n, h, d]) => `<button type="button" class="step" data-view="${v}"><span class="n num">${n}</span><b>${h}</b><small>${d}</small>${v === 'sheet' && t ? `<span class="bar"><i style="width:${Math.round(SHEETS.reduce((a, s) => a + progress(t, s.id), 0) / 11)}%"></i></span>` : ''}</button>`).join('')}
  </section>`;
}

/* ───────────── 게임 ───────────── */
function gdata(g, t = TEAM) { return ((S.games[g] || {})[t]) || {}; }
function bingoPoints(t) {
  const g = S.games.bingo || {}; const me = g[t] || {};
  const done = Object.entries(g).filter(([, x]) => x.doneAt).sort((a, b) => a[1].doneAt - b[1].doneAt).map(([k]) => k);
  const rank = done.indexOf(t); return (me.lines || 0) * 5 + (rank === 0 ? 30 : rank === 1 ? 20 : rank === 2 ? 10 : 0);
}
function quizPoints(t) { const q = gdata('quiz', t); return Object.values(q).filter((x) => x === 1).length * 5; }
function gameScore(t) { return bingoPoints(t) + (gdata('words', t).score || 0) + (gdata('slogan', t).score || 0) + (gdata('fact', t).score || 0) + quizPoints(t); }
function totalScore(t) { return gameScore(t) + (S.scores.s[teamNo(t) - 1] || 0); }

function vGame() {
  const tabs = [['bingo', '용어 빙고'], ['words', '글자 조합 A · 용어'], ['slogan', '글자 조합 B · 슬로건'], ['fact', '사실일까 판단일까']];
  const body = { bingo: gBingo, words: gWords, slogan: gSlogan, fact: gFact }[cur.game]();
  return `<div class="subtabs">${tabs.map(([k, l]) => `<button type="button" class="${cur.game === k ? 'on' : ''}" data-game="${k}">${l}</button>`).join('')}</div>${TEAM ? body : needTeam()}`;
}
const needTeam = () => `<div class="card empty"><p>상단에서 <b>우리 조</b>를 먼저 고르십시오.</p></div>`;

/* 빙고 */
function bingoBoard(t) {
  const seed = (S.control.bingoSeed || 1) * 97 + teamNo(t) * 13;
  const terms = shuffle(GAMES.bingo.map((x, i) => i), seed).slice(0, 24);
  terms.splice(12, 0, -1); return terms;           // -1 = FREE
}
function bingoOrder() { return shuffle(GAMES.bingo.map((x, i) => i), (S.control.bingoSeed || 1) * 7919); }
function bingoRevealed() { const idx = S.control.bingoIdx ?? -1; return bingoOrder().slice(0, idx + 1); }
function bingoLines(marks) {
  const m = new Set(marks); m.add(12); const L = [];
  for (let i = 0; i < 5; i++) { L.push([0, 1, 2, 3, 4].map((j) => i * 5 + j)); L.push([0, 1, 2, 3, 4].map((j) => j * 5 + i)); }
  L.push([0, 6, 12, 18, 24]); L.push([4, 8, 12, 16, 20]);
  return L.filter((l) => l.every((x) => m.has(x))).length;
}
function gBingo() {
  const board = bingoBoard(TEAM); const me = gdata('bingo'); const marks = me.marks || []; const rev = bingoRevealed();
  const last = rev.length ? GAMES.bingo[rev[rev.length - 1]] : null; const lines = bingoLines(marks);
  return `<div class="gamehead"><div><h2>용어 빙고</h2><p class="muted">강사가 설명 카드를 한 장씩 공개합니다. 설명에 맞는 용어 칸을 누르십시오. 공개되지 않은 용어를 누르면 3초 동안 잠깁니다. 먼저 <b>3줄</b>을 완성한 조가 이깁니다.</p></div>
    <div class="linecount"><b class="num">${lines}</b><span>줄</span></div></div>
    <div class="clue ${last ? '' : 'wait'}">${last ? `<small>설명 카드 ${rev.length} / ${GAMES.bingo.length}</small><p>${esc(last.c)}</p>` : '<p>강사가 첫 설명 카드를 공개하면 시작합니다.</p>'}</div>
    <div class="bingo" id="bingo">${board.map((ti, i) => ti < 0 ? `<button type="button" class="cell free on" disabled>FREE</button>`
      : `<button type="button" class="cell ${marks.includes(i) ? 'on' : ''}" data-cell="${i}">${esc(GAMES.bingo[ti].t)}</button>`).join('')}</div>
    ${rev.length > 1 ? `<details class="card"><summary>지난 설명 카드 ${rev.length - 1}장</summary><ol class="past">${rev.slice(0, -1).reverse().map((i) => `<li>${esc(GAMES.bingo[i].c)}</li>`).join('')}</ol></details>` : ''}
    ${lines >= 3 ? `<div class="card win"><b>빙고 3줄 완성!</b> 방금 나온 용어가 쓰이는 시트로 가 보십시오 → ${linkSheetsForTerms(rev.slice(-3))}</div>` : ''}`;
}
const TERM_WS = { '인사이트': 'w2', '잠재 니즈': 'w2', '표현 니즈': 'w2', '페르소나': 'w1', '세그먼트': 'w1', '주 목표': 'w1', '슬로건': 'w3', '캠페인명': 'w3', '우산 슬로건': 'w3', '스토리텔링': 'w4', '브랜드 가치': 'w4', '채널 믹스': 'w5', 'IMC': 'w6', '고객 여정': 'w6', '도입기': 'w7', '집중기': 'w7', '예비비': 'w8', '1인당 획득 비용': 'w8', 'KPI': 'w9', '퍼널': 'w9', '분모': 'w9', 'ROI': 'w9', 'GP율': 'w9', '손익분기': 'w9', '전환율': 'w9', '재방문율': 'w9', '증분 매출': 'w9', 'SMART': 'w1' };
function linkSheetsForTerms(idx) {
  const set = [...new Set(idx.map((i) => TERM_WS[GAMES.bingo[i].t]).filter(Boolean))];
  return set.length ? set.map((ws) => `<button type="button" class="btn sm ghost" data-gosheet="${ws}">${SHEET(ws).no} ${esc(SHEET(ws).title)}</button>`).join(' ') : '캠페인 실습 탭';
}
let bingoLock = 0;
function bingoTap(i) {
  if (Date.now() < bingoLock) return;
  const board = bingoBoard(TEAM); const ti = board[i]; const me = gdata('bingo'); const marks = (me.marks || []).slice();
  if (marks.includes(i)) return;
  const cell = $(`[data-cell="${i}"]`);
  if (!bingoRevealed().includes(ti)) {
    bingoLock = Date.now() + 3000; cell.classList.add('shake'); $('#bingo').classList.add('locked');
    setTimeout(() => { cell.classList.remove('shake'); const b = $('#bingo'); if (b) b.classList.remove('locked'); }, 3000);
    toast('아직 공개되지 않은 용어입니다 · 3초 잠금'); return;
  }
  marks.push(i); const lines = bingoLines(marks);
  const data = { marks, lines }; if (lines >= 3) data.doneAt = me.doneAt || Date.now();
  (S.games.bingo = S.games.bingo || {})[TEAM] = data; render();
  api('/api/game', { team: TEAM, g: 'bingo', data }).catch(() => toast('저장 실패 · 다시 눌러 주십시오'));
}

/* 글자 조합 A */
let W = null;   // { list, i, placed:[], tiles:[], hint, score, solved }
function wordsNew() {
  const list = shuffle(GAMES.words).slice(0, 10);
  W = { list, i: 0, score: 0, solved: 0, hint: false, placed: [], tiles: [] }; wordsSetup();
}
function wordsSetup() {
  const w = W.list[W.i].w; let tiles = shuffle(Array.from(w));
  if (tiles.join('') === w && w.length > 1) tiles = tiles.reverse();
  W.tiles = tiles.map((ch, id) => ({ ch, id })); W.placed = []; W.hint = false;
}
function gWords() {
  const me = gdata('words');
  if (!W) return `<div class="gamehead"><div><h2>글자 조합 A · 용어 맞히기</h2><p class="muted">섞인 음절 블록을 눌러 순서대로 놓으면 용어가 완성됩니다. 10문제, 정답 10점 · 힌트를 보면 7점.</p></div></div>
    ${me.done ? `<div class="card">지난 기록 <b class="num">${me.score}</b>점 · ${me.solved}/10 정답</div>` : ''}<button type="button" class="btn big" data-act="wordsStart">시작</button>`;
  if (W.i >= W.list.length) return `<div class="card win"><h3>끝!</h3><p><b class="num">${W.score}</b>점 · ${W.solved}/10 정답</p><button type="button" class="btn" data-act="wordsStart">다시 하기</button></div>`;
  const q = W.list[W.i];
  return `<div class="gamehead"><div><h2>글자 조합 A · ${W.i + 1} / ${W.list.length}</h2><p class="muted">점수 <b class="num">${W.score}</b></p></div>
    <div><button type="button" class="btn ghost" data-act="wordsHint" ${W.hint ? 'disabled' : ''}>힌트 (−3)</button> <button type="button" class="btn ghost" data-act="wordsSkip">넘기기</button></div></div>
    ${W.hint ? `<div class="clue"><p>${esc(q.h)}</p></div>` : `<div class="clue wait"><p>${q.w.length}글자 용어</p></div>`}
    <div class="slots" id="wslots">${Array.from(q.w).map((_, n) => `<button type="button" class="slot ${W.placed[n] ? 'full' : ''}" data-wslot="${n}">${W.placed[n] ? esc(W.placed[n].ch) : ''}</button>`).join('')}</div>
    <div class="tiles">${W.tiles.map((t) => `<button type="button" class="tile" data-wtile="${t.id}" ${W.placed.includes(t) ? 'disabled' : ''}>${esc(t.ch)}</button>`).join('')}</div>`;
}
function wordsMount() { /* 렌더 후 필요 작업 없음 */ }
function wordsCheck() {
  const q = W.list[W.i];
  if (W.placed.length < q.w.length) return;
  if (W.placed.map((t) => t.ch).join('') === q.w) {
    W.score += W.hint ? 7 : 10; W.solved++; toast('정답! ' + q.w); wordsSave(false);
    setTimeout(() => { W.i++; if (W.i < W.list.length) wordsSetup(); else wordsFinish(); render(); }, 600); render();
  } else { $('#wslots').classList.add('shake'); setTimeout(() => { W.placed = []; render(); }, 500); }
}
function wordsFinish() { wordsSave(true); }
function wordsSave(done) {
  const prev = gdata('words'); if (!done && (prev.score || 0) >= W.score) return;
  const best = Math.max(W.score, prev.score || 0);
  const data = { score: best, solved: best === W.score ? W.solved : prev.solved, done: done || !!prev.done };
  (S.games.words = S.games.words || {})[TEAM] = data; api('/api/game', { team: TEAM, g: 'words', data }).catch(() => {});
}

/* 글자 조합 B · 슬로건 */
let SL = null;  // { i, placed:[], tiles:[], score, free:[] }
function sloganNew() { SL = { i: 0, score: 0, placed: [], tiles: [], free: [], freeMode: false }; sloganSetup(); }
function sloganSetup() { const p = GAMES.slogan[SL.i]; SL.tiles = shuffle(p.answer.concat(p.decoy)).map((w, id) => ({ w, id })); SL.placed = []; }
function gSlogan() {
  const me = gdata('slogan');
  if (!SL) return `<div class="gamehead"><div><h2>글자 조합 B · 슬로건 조립</h2><p class="muted">어절 카드를 순서대로 놓아 케이스 C와 동래점 사례의 슬로건을 완성하십시오. 미끼 카드가 섞여 있습니다. 5문제 × 10점. 마지막에는 <b>우리 조 슬로건</b>을 직접 조립해 시트 ③으로 보낼 수 있습니다.</p></div></div>
    ${me.score != null ? `<div class="card">지난 기록 <b class="num">${me.score}</b>점</div>` : ''}<button type="button" class="btn big" data-act="sloganStart">시작</button> <button type="button" class="btn big ghost" data-act="sloganFree">바로 우리 조 슬로건 만들기</button>`;
  if (SL.freeMode) return sloganFreeHTML();
  if (SL.i >= GAMES.slogan.length) return `<div class="card win"><h3>슬로건 조립 끝 · <span class="num">${SL.score}</span>점</h3><p>이제 우리 조 슬로건을 만들어 보십시오.</p><button type="button" class="btn" data-act="sloganFree">우리 조 슬로건 만들기</button></div>`;
  const p = GAMES.slogan[SL.i];
  return `<div class="gamehead"><div><h2>슬로건 ${SL.i + 1} / ${GAMES.slogan.length}</h2><p class="muted">점수 <b class="num">${SL.score}</b> · 힌트: ${esc(p.hint)}</p></div>
      <div><button type="button" class="btn ghost" data-act="sloganClear">비우기</button> <button type="button" class="btn" data-act="sloganCheck">확인</button></div></div>
    <div class="phrase" id="sphrase">${SL.placed.length ? SL.placed.map((t, n) => `<button type="button" class="chip on" data-splaced="${n}">${esc(t.w)}</button>`).join('') : '<span class="muted">아래 카드를 눌러 순서대로 놓으십시오</span>'}</div>
    <div class="tiles">${SL.tiles.map((t) => `<button type="button" class="chip" data-stile="${t.id}" ${SL.placed.includes(t) ? 'disabled' : ''}>${esc(t.w)}</button>`).join('')}</div>`;
}
function sloganFreeHTML() {
  const txt = SL.free.join(' ');
  return `<div class="gamehead"><div><h2>우리 조 슬로건 만들기</h2><p class="muted">카드를 누르거나 직접 단어를 추가해 조립하고, 시트 ③의 A·B·C안 중 하나로 보내십시오.</p></div></div>
    <div class="phrase big">${SL.free.length ? SL.free.map((w, n) => `<button type="button" class="chip on" data-sfree="${n}">${esc(w)}</button>`).join('') : '<span class="muted">여기에 슬로건이 만들어집니다</span>'}</div>
    <div class="tiles">${GAMES.sloganFree.map((w) => `<button type="button" class="chip" data-sadd="${esc(w)}">${esc(w)}</button>`).join('')}</div>
    <div class="row"><input type="text" id="sOwn" placeholder="직접 단어 추가"><button type="button" class="btn ghost" data-act="sOwnAdd">추가</button><button type="button" class="btn ghost" data-act="sFreeClear">비우기</button></div>
    <div class="row">${['A', 'B', 'C'].map((x) => `<button type="button" class="btn" data-sendslogan="${x}" ${txt ? '' : 'disabled'}>③ ${x}안 슬로건으로 보내기</button>`).join('')}</div>`;
}
function sloganSave() { const best = Math.max(SL.score, gdata('slogan').score || 0); const data = { score: best }; (S.games.slogan = S.games.slogan || {})[TEAM] = data; api('/api/game', { team: TEAM, g: 'slogan', data }).catch(() => {}); }

/* 사실일까 판단일까 */
let FC = null; // { order, i, score, ans:null }
function gFact() {
  const me = gdata('fact');
  if (!FC) return `<div class="gamehead"><div><h2>사실일까 판단일까</h2><p class="muted">케이스 C 문장을 여섯 가지 출처 태그 중 하나로 분류하십시오. 12문제 × 10점. 기획서에서 "확인한 사실"과 "내가 결정한 것"을 나누는 연습입니다.</p></div></div>
    ${me.score != null ? `<div class="card">지난 기록 <b class="num">${me.score}</b>점</div>` : ''}<button type="button" class="btn big" data-act="factStart">시작</button>`;
  if (FC.i >= FC.order.length) return `<div class="card win"><h3>끝 · <span class="num">${FC.score}</span>점</h3><button type="button" class="btn" data-act="factStart">다시 하기</button> <button type="button" class="btn ghost" data-view="case">케이스 C 자료실로</button></div>`;
  const q = GAMES.fact[FC.order[FC.i]];
  return `<div class="gamehead"><div><h2>${FC.i + 1} / ${FC.order.length}</h2><p class="muted">점수 <b class="num">${FC.score}</b></p></div></div>
    <div class="clue"><p>${esc(q.s)}</p></div>
    <div class="tags">${GAMES.factTags.map((t) => `<button type="button" class="tagpick ${FC.ans ? (t === q.a ? 'right' : t === FC.ans ? 'wrong' : '') : ''}" data-fact="${esc(t)}" ${FC.ans ? 'disabled' : ''}>${esc(t)}</button>`).join('')}</div>
    ${FC.ans ? `<div class="card ${FC.ans === q.a ? 'win' : 'lose'}"><b>${FC.ans === q.a ? '정답' : '정답은 ' + esc(q.a)}</b> — ${esc(GAMES.factWhy[q.a])}<br><button type="button" class="btn" data-act="factNext">다음</button></div>` : ''}`;
}

/* ───────────── 개념 학습 ───────────── */
function vLearn() {
  const q = gdata('quiz');
  return `<div class="pagehead"><h2>개념 학습</h2><p class="muted">시트마다 목적 · 작성 공식 · 흔한 실수를 확인하고 퀴즈를 푸십시오(정답 1개당 5점). 카드의 [시트 열기]로 바로 작성할 수 있습니다.</p></div>
  <div class="learn">${LEARN.map((c) => { const sh = SHEET(c.ws); const ans = q[c.ws];
    return `<article class="card lcard"><header><span class="no">${sh.no}</span><h3>${esc(sh.title)}</h3>${ans === 1 ? '<span class="pill ok">퀴즈 정답</span>' : ans === 0 ? '<span class="pill warn">다시 도전</span>' : ''}</header>
      <dl><dt>목적</dt><dd>${esc(c.purpose)}</dd><dt>공식</dt><dd>${esc(c.formula)}</dd><dt>흔한 실수</dt><dd>${esc(c.mistake)}</dd></dl>
      <div class="quiz"><p><b>Q.</b> ${esc(c.quiz.q)}</p>${c.quiz.a.map((a, i) => `<button type="button" class="qa ${ans != null && i === c.quiz.c && ans === 1 ? 'right' : ''}" data-quiz="${c.ws}" data-i="${i}" ${ans === 1 || !TEAM ? 'disabled' : ''}>${esc(a)}</button>`).join('')}</div>
      <button type="button" class="btn sm ghost" data-gosheet="${c.ws}">시트 ${sh.no} 열기 →</button></article>`; }).join('')}</div>`;
}

/* ───────────── 케이스 C ───────────── */
function vCase() {
  const open = !!S.control.caseReveal;
  return `<div class="pagehead"><p class="eyebrow">CASE C</p><h2>${esc(CASE_C.title)}</h2><p class="lead">${esc(CASE_C.sub)}</p><p class="muted">${esc(CASE_C.rule)}</p></div>
  <div class="facts">${CASE_C.facts.map(factCard).join('')}</div>
  <section class="card"><h3>케이스 C 기획 판단 (강사 풀이)</h3>${open ? CASE_C.solve.map((s) => `<p><b>${esc(s.h)}</b> — ${esc(s.b)}</p>`).join('') : `<p class="muted">강사가 공개하면 여기에 케이스 C의 시사점·컨셉·목표·예산 풀이가 나타납니다. 먼저 사실 카드만 보고 우리 조의 판단을 적어 보십시오.</p>`}</section>`;
}
function factCard(f, withPull) {
  return `<article class="fact"><span class="tag t-${esc(f.tag).replace(/\s/g, '')}">${esc(f.tag)}</span><h4>${esc(f.title)}</h4><p>${esc(f.body)}</p><p class="q">? ${esc(f.q)}</p>
    ${withPull === true ? `<button type="button" class="btn sm ghost" data-pull="${f.id}">가져오기</button>` : ''}</article>`;
}

/* ───────────── 캠페인 실습 (시트) ───────────── */
let lastField = null;   // 가져오기 대상 textarea
let showModel = false;
function vSheet() {
  if (!TEAM) return needTeam();
  const sh = SHEET(cur.sheet); const d = sheetOf(TEAM, sh.id); const hintN = num(d.hints);
  const modelOpen = !!S.control['mr_' + sh.id];
  const info = S.teams[TEAM] || {};
  return `<div class="sheetlayout">
  <nav class="sheetnav">${SHEETS.map((s) => { const p = progress(TEAM, s.id); return `<button type="button" class="${s.id === sh.id ? 'on' : ''}" data-sheet="${s.id}"><span class="no">${s.no}</span><span class="t">${esc(s.title)}</span><span class="pbar"><i style="width:${p}%"></i></span></button>`; }).join('')}</nav>
  <article class="sheet" id="sheet">
    <header class="sheethead"><div><p class="eyebrow">실습 ${sh.no} · 3-2 캠페인 기획 실습</p><h2>${esc(sh.title)}</h2><p class="lead">${esc(sh.lead)}</p></div>
      <div class="meta"><span>팀명 <b>${esc(info.name || '______')}</b></span><span>작성자 <b>${esc(info.author || '______')}</b></span><span id="net" class="net ok">저장됨</span></div></header>
    ${sh.banner ? `<div class="banner" data-banner>③ 최종 슬로건 · <b></b></div>` : ''}
    ${sh.formula ? `<div class="formula">작성 형식 &nbsp;${esc(sh.formula)}</div>` : ''}
    ${showModel && modelOpen ? `<div class="modelwrap"><div class="modelhead">동래점 「다시, 출근룩」 모범답안 · 읽기 전용</div>${renderParts(sh, sh.model, true)}${sh.modelNote ? `<p class="note">${esc(sh.modelNote)}</p>` : ''}</div>` : renderParts(sh, d, false)}
    ${sh.foot ? `<p class="foot">${esc(sh.foot)}</p>` : ''}
    <div class="sheetfoot">
      ${SHEETS.indexOf(sh) > 0 ? `<button type="button" class="btn ghost" data-sheet="${SHEETS[SHEETS.indexOf(sh) - 1].id}">← 이전 시트</button>` : '<span></span>'}
      <button type="button" class="btn ghost" data-act="printAll">①~⑪ 전체 인쇄</button>
      ${SHEETS.indexOf(sh) < 10 ? `<button type="button" class="btn" data-sheet="${SHEETS[SHEETS.indexOf(sh) + 1].id}">다음 시트 →</button>` : '<button type="button" class="btn" data-view="present">발표·평가로 →</button>'}
    </div>
  </article>
  <aside class="side">
    <section class="card"><h3>자동 점검</h3><ul class="checks-out" data-checks></ul></section>
    <section class="card"><h3>도움 받기 <small class="muted">${hintN}/3</small></h3>
      ${sh.hints.slice(0, hintN).map((h) => `<p class="hint">${esc(h)}</p>`).join('')}
      ${hintN < 3 ? `<button type="button" class="btn sm" data-act="hint">${hintN === 0 ? '질문 힌트 보기' : hintN === 1 ? '방향 힌트 보기' : '케이스 C 예시 보기'}</button>` : ''}</section>
    ${modelOpen ? `<section class="card model"><h3>모범답안 공개됨</h3><button type="button" class="btn sm" data-act="toggleModel">${showModel ? '우리 조 시트로 돌아가기' : '동래점 모범답안 보기'}</button></section>` : ''}
    <section class="card"><h3>이 시트에 쓸 케이스 C 자료</h3><p class="muted small">시트의 입력칸을 한 번 누른 뒤 [가져오기]를 누르면 출처 태그와 함께 붙습니다.</p>
      ${sh.caseRefs.map((id) => factCard(CASE_C.facts.find((f) => f.id === id), true)).join('')}</section>
  </aside></div>`;
}
function refreshSheet() {
  const sh = SHEET(cur.sheet); if (!sh || !$('#sheet')) return;
  const c = $('[data-checks]'); if (c) c.innerHTML = checksFor(sh.id, TEAM) || '<li class="info">i 작성하면 점검 결과가 나타납니다</li>';
  $$('[data-calc]').forEach((el) => { el.innerHTML = calcHTML(el.dataset.calc, TEAM); });
  const b = $('[data-banner] b'); if (b) b.textContent = finalSlogan(TEAM) || '아직 정하지 않았습니다 (③에서 최종안을 고르십시오)';
  const r = $('[data-read]'); if (r) { const d = sheetOf(TEAM, 'w4'); const txt = ['p1', 'p2', 'p3', 'p4'].map((k) => (d[k] || '').trim()).filter(Boolean).join(' '); r.innerHTML = `<h4>이어 읽기</h4><p>${esc(txt) || '<span class="muted">네 칸을 채우면 한 문단으로 이어 보여 줍니다.</span>'}</p>`; }
  if (sh.id === 'w8') { const { amt } = w8Rows(sheetOf(TEAM, 'w8')); $$('[data-auto]').forEach((el) => { const k = el.dataset.auto.replace('_amt', ''); el.textContent = amt[k] ? won(amt[k]) + '원' : '—'; }); }
  const p = $('[data-poster]'); if (p) p.innerHTML = posterHTML(TEAM);
  $$('.sheetnav button[data-sheet]').forEach((bt) => { const i = bt.querySelector('i'); if (i) i.style.width = progress(TEAM, bt.dataset.sheet) + '%'; });
}
function syncInputs() {
  if (showModel) return;
  const d = sheetOf(TEAM, cur.sheet);
  $$('#sheet [data-k]').forEach((el) => {
    if (el === document.activeElement) return;
    const v = d[el.dataset.k] ?? '';
    if (el.type === 'checkbox') el.checked = v === 'Y';
    else if (el.value !== v) { el.value = v; if (el.tagName === 'TEXTAREA') autosize(el); }
  });
}
function autosize(el) { el.style.height = 'auto'; el.style.height = Math.min(600, el.scrollHeight + 2) + 'px'; }
function autosizeAll() { $$('#main textarea').forEach(autosize); }

function printSheets(ids, t = TEAM) {
  const box = $('#printArea');
  box.innerHTML = ids.map((ws) => { const sh = SHEET(ws); const info = S.teams[t] || {};
    return `<section class="psheet"><header><small>3-2 캠페인 기획 실습 · 실습 ${sh.no}</small><h2>${esc(sh.title)}</h2><p>${esc(sh.lead)}</p><p>팀명 ${esc(info.name || '______')} &nbsp; 작성자 ${esc(info.author || '______')}</p></header>
      ${ws === 'w10' ? posterHTML(t) : ''}${renderParts(sh, sheetOf(t, ws), true).replace(/<div class="calc"[^>]*><\/div>|<div class="poster"[^>]*><\/div>|<div class="readaloud"[^>]*><\/div>/g, '')}</section>`; }).join('');
  // 인쇄본에서는 입력칸 대신 글자만 보이도록 치환
  $$('textarea, input[type=text]', box).forEach((el) => { const s = document.createElement('div'); s.className = 'pval'; s.textContent = el.value || el.textContent; el.replaceWith(s); });
  $$('select', box).forEach((el) => { const s = document.createElement('div'); s.className = 'pval'; s.textContent = el.value; el.replaceWith(s); });
  if (ids.includes('w8')) { const { amt } = w8Rows(sheetOf(t, 'w8')); $$('[data-auto]', box).forEach((el) => { const k = el.dataset.auto.replace('_amt', ''); el.textContent = amt[k] ? won(amt[k]) + '원' : '—'; }); }
  document.body.classList.add('printing'); window.print();
  setTimeout(() => document.body.classList.remove('printing'), 500);
}

/* ───────────── 발표 · 평가 ───────────── */
let evalTo = '';
let clock = { total: 480, left: 480, run: false, phase: '발표', h: null };
function vPresent() {
  const others = teamIds().filter((t) => t !== TEAM);
  if (!evalTo || evalTo === TEAM) evalTo = others[0] || '';
  const mine = ((S.evals[TEAM] || {})[evalTo]) || {};
  const crit = ['타깃 분석의 정확성', '컨셉의 창의성', '통합 마케팅의 일관성', '실행 가능성 (예산·일정·KPI)'];
  const presenting = S.control.presenting;
  return `<div class="pagehead"><h2>발표와 상호 평가</h2><p class="muted">팀당 8분 발표(파트별 2분) + 4분 질의응답 · 다른 조를 4항목 × 25점으로 평가합니다. 자기 조는 평가할 수 없습니다.</p></div>
  <div class="present">
    <section class="card timer"><h3>${presenting ? esc(teamName(presenting)) + ' 발표 중' : '발표 타이머'}</h3>
      <div class="clock num" id="clock">${fmtClock(clock.left)}</div><p class="muted" id="clockPhase">${clock.phase} · ${partName()}</p>
      <div class="row"><button type="button" class="btn" data-act="clockToggle">${clock.run ? '일시정지' : '시작'}</button><button type="button" class="btn ghost" data-act="clockQA">질의 4분</button><button type="button" class="btn ghost" data-act="clockReset">처음으로</button></div>
      ${presenting ? `<div class="mini">${posterHTML(presenting)}</div>` : ''}</section>
    <section class="card"><h3>다른 조 평가하기</h3>${!TEAM ? '<p>상단에서 우리 조를 먼저 고르십시오.</p>' : `
      <label class="field"><span>평가할 조</span><select id="evalTo">${others.map((t) => `<option value="${t}" ${t === evalTo ? 'selected' : ''}>${esc(teamName(t))}</option>`).join('')}</select></label>
      ${crit.map((c, i) => `<label class="slider"><span>${c}</span><input type="range" min="0" max="25" value="${mine['c' + (i + 1)] ?? 0}" data-eval="c${i + 1}"><b class="num">${mine['c' + (i + 1)] ?? 0}</b></label>`).join('')}
      <label class="field"><span>한 줄 코멘트</span><textarea id="evalNote" rows="2" placeholder="근거와 함께 한 줄">${esc(mine.note || '')}</textarea></label>
      <p>합계 <b class="num" id="evalSum">${[1, 2, 3, 4].reduce((a, i) => a + (mine['c' + i] || 0), 0)}</b> / 100</p>`}</section>
  </div>
  ${S.control.evalOpen ? `<section class="card"><h3>평가 결과</h3>${evalTable()}</section>` : ''}`;
}
const partName = () => clock.phase === '질의' ? '질의응답' : ['1. 타깃과 인사이트', '2. 캠페인명과 스토리', '3. 채널 전략과 운영', '4. 예산과 KPI'][Math.min(3, Math.floor((480 - clock.left) / 120))];
const fmtClock = (s) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
function tick() {
  clock.left--; const c = $('#clock'); if (c) { c.textContent = fmtClock(clock.left); c.classList.toggle('late', clock.left <= 30); }
  const ph = $('#clockPhase'); if (ph) ph.textContent = `${clock.phase} · ${partName()}`;
  if (clock.phase === '발표' && clock.left > 0 && clock.left % 120 === 0) toast('다음 파트로 넘어갈 시간입니다');
  if (clock.left <= 0) { clearInterval(clock.h); clock.run = false; toast(clock.phase + ' 시간이 끝났습니다'); if (view === 'present') render(); }
}
function evalAgg() {
  const res = {};
  teamIds().forEach((to) => {
    const rows = teamIds().filter((f) => f !== to).map((f) => (S.evals[f] || {})[to]).filter(Boolean);
    const avg = (k) => rows.length ? rows.reduce((a, r) => a + (r[k] || 0), 0) / rows.length : 0;
    const c = [1, 2, 3, 4].map((i) => avg('c' + i));
    res[to] = { n: rows.length, c, total: c.reduce((a, b) => a + b, 0), notes: teamIds().filter((f) => f !== to && (S.evals[f] || {})[to] && S.evals[f][to].note).map((f) => `${teamNo(f)}조: ${S.evals[f][to].note}`) };
  });
  return res;
}
function evalTable() {
  const a = evalAgg(); const order = teamIds().slice().sort((x, y) => a[y].total - a[x].total);
  return `<div class="tblwrap"><table class="ws res"><thead><tr><th>순위</th><th>조</th><th>타깃</th><th>컨셉</th><th>IMC</th><th>실행</th><th>평균 합계</th><th>평가 수</th><th>코멘트</th></tr></thead><tbody>
    ${order.map((t, i) => `<tr><td class="num">${a[t].n ? i + 1 : '—'}</td><td><b>${esc(teamName(t))}</b></td>${a[t].c.map((x) => `<td class="num">${x.toFixed(1)}</td>`).join('')}<td class="num"><b>${a[t].total.toFixed(1)}</b></td><td class="num">${a[t].n}</td><td class="small">${a[t].notes.map(esc).join('<br>')}</td></tr>`).join('')}
  </tbody></table></div>`;
}
let evalTimer = null;
function saveEval() {
  const data = {}; $$('[data-eval]').forEach((el) => { data[el.dataset.eval] = Number(el.value); }); data.note = ($('#evalNote') || {}).value || '';
  ((S.evals[TEAM] = S.evals[TEAM] || {}))[evalTo] = data;
  const s = $('#evalSum'); if (s) s.textContent = [1, 2, 3, 4].reduce((a, i) => a + (data['c' + i] || 0), 0);
  clearTimeout(evalTimer); evalTimer = setTimeout(() => api('/api/eval', { from: TEAM, to: evalTo, data }).catch(() => toast('평가 저장 실패')), 400);
}

/* ───────────── 강사 화면 ───────────── */
let tTab = 'flow';
let peek = null;  // { team, ws }
function vTeacher() {
  const tabs = [['flow', '진행 순서'], ['game', '게임 진행'], ['board', '조별 모아보기'], ['ref', '강사 참고'], ['score', '점수판 · 평가'], ['admin', '설정']];
  const body = { flow: tFlow, game: tGame, board: tBoard, ref: tRef, score: tScore, admin: tAdmin }[tTab]();
  return `<div class="pagehead"><p class="eyebrow">강사 화면</p><h2>3-2 캠페인 기획 실습 운영</h2></div>
    <div class="subtabs">${tabs.map(([k, l]) => `<button type="button" class="${tTab === k ? 'on' : ''}" data-ttab="${k}">${l}</button>`).join('')}</div>${body}`;
}
function tFlow() {
  const sum = FLOW.reduce((a, f) => a + f.m, 0);
  return `<div class="flowlist">${FLOW.map((f, i) => `<div class="card"><span class="n num">${i + 1}</span><div><b>${esc(f.t)}</b> <span class="pill">${f.m}분</span><p class="muted">${esc(f.d)}</p></div></div>`).join('')}</div>
    <p class="muted">합계 ${sum}분 (휴식 제외). 모범답안은 [강사 참고]에서 시트별로 교육생에게 공개할 수 있습니다.</p>
    <section class="card"><h3>${esc(MODEL_INTRO.title)} <small class="muted">동래점 모범답안 표지</small></h3><p>${esc(MODEL_INTRO.sub)}</p><p><b>남길 문장</b> ${esc(MODEL_INTRO.keep)}</p><p class="muted">${esc(MODEL_INTRO.core)}</p></section>`;
}
function tGame() {
  const rev = bingoRevealed(); const idx = S.control.bingoIdx ?? -1; const cur1 = rev.length ? GAMES.bingo[rev[rev.length - 1]] : null;
  const bingo = S.games.bingo || {};
  const rank = teamIds().map((t) => ({ t, l: (bingo[t] || {}).lines || 0, d: (bingo[t] || {}).doneAt || 0 })).sort((a, b) => (b.d ? 1 : 0) - (a.d ? 1 : 0) || (a.d - b.d) || b.l - a.l);
  const col = (g, f) => teamIds().map((t) => `<td class="num">${f((S.games[g] || {})[t] || {})}</td>`).join('');
  return `<section class="card"><h3>용어 빙고 진행</h3>
      <div class="clue big">${cur1 ? `<small>설명 카드 ${rev.length} / ${GAMES.bingo.length} · 정답 <b>${esc(cur1.t)}</b></small><p>${esc(cur1.c)}</p>` : '<p>아직 공개한 카드가 없습니다.</p>'}</div>
      <div class="row"><button type="button" class="btn ghost" data-act="bingoPrev" ${idx < 0 ? 'disabled' : ''}>← 이전 카드</button><button type="button" class="btn big" data-act="bingoNext" ${idx >= GAMES.bingo.length - 1 ? 'disabled' : ''}>다음 설명 카드 공개 →</button><button type="button" class="btn ghost" data-act="bingoReset">새 판 (판 다시 섞기)</button></div>
      <ol class="rank">${rank.map((r) => `<li><b>${esc(teamName(r.t))}</b> <span class="num">${r.l}줄</span>${r.d ? ' <span class="pill ok">3줄 완성</span>' : ''} <span class="muted">· ${bingoPoints(r.t)}점</span></li>`).join('')}</ol></section>
    <section class="card"><h3>자율 게임 기록</h3><div class="tblwrap"><table class="ws res"><thead><tr><th>게임</th>${teamIds().map((t) => `<th>${teamNo(t)}조</th>`).join('')}<th></th></tr></thead><tbody>
      <tr><th>글자 조합 A</th>${col('words', (x) => x.score != null ? `${x.score} (${x.solved}/10)` : '—')}<td><button type="button" class="btn sm ghost" data-greset="words">기록 지우기</button></td></tr>
      <tr><th>글자 조합 B</th>${col('slogan', (x) => x.score ?? '—')}<td><button type="button" class="btn sm ghost" data-greset="slogan">기록 지우기</button></td></tr>
      <tr><th>사실/판단</th>${col('fact', (x) => x.score ?? '—')}<td><button type="button" class="btn sm ghost" data-greset="fact">기록 지우기</button></td></tr>
      <tr><th>개념 퀴즈</th>${teamIds().map((t) => `<td class="num">${quizPoints(t)}</td>`).join('')}<td><button type="button" class="btn sm ghost" data-greset="quiz">기록 지우기</button></td></tr>
    </tbody></table></div></section>`;
}
function tBoard() {
  let html = `<div class="tblwrap"><table class="ws res matrix"><thead><tr><th>조</th>${SHEETS.map((s) => `<th title="${esc(s.title)}">${s.no}</th>`).join('')}<th>힌트</th></tr></thead><tbody>
    ${teamIds().map((t) => `<tr><th>${esc(teamName(t))}<small>${esc((S.teams[t] || {}).author || '')}</small></th>${SHEETS.map((s) => { const p = progress(t, s.id); return `<td><button type="button" class="pct" style="--p:${p}%" data-peek="${t}|${s.id}">${p}%</button></td>`; }).join('')}
      <td class="num">${SHEETS.reduce((a, s) => a + num(sheetOf(t, s.id).hints), 0)}</td></tr>`).join('')}
  </tbody></table></div><p class="muted">칸을 누르면 그 조의 시트를 읽기 전용으로 봅니다. 두 조를 비교하려면 아래에서 고르십시오.</p>`;
  if (peek) {
    const sh = SHEET(peek.ws);
    html += `<section class="card peek"><header class="row"><h3>${esc(teamName(peek.team))} · ${sh.no} ${esc(sh.title)}</h3>
      <select id="peekCmp"><option value="">비교할 조 선택</option>${teamIds().filter((t) => t !== peek.team).map((t) => `<option value="${t}" ${peek.cmp === t ? 'selected' : ''}>${esc(teamName(t))}</option>`).join('')}</select>
      <button type="button" class="btn sm ghost" data-act="peekPrint">이 조 ①~⑪ 인쇄</button><button type="button" class="btn sm ghost" data-act="peekClose">닫기</button></header>
      <div class="${peek.cmp ? 'cmp' : ''}"><div>${peekSheet(peek.team, sh)}</div>${peek.cmp ? `<div><h4>${esc(teamName(peek.cmp))}</h4>${peekSheet(peek.cmp, sh)}</div>` : ''}</div></section>`;
  }
  return html;
}
function peekSheet(t, sh) {
  return `<ul class="checks-out">${checksFor(sh.id, t)}</ul>${renderParts(sh, sheetOf(t, sh.id), true).replace(/<div class="(calc|poster|readaloud)" data-[a-z]+="(\w+)"><\/div>/g, (m, type, id) => type === 'calc' ? `<div class="calc">${calcHTML(id, t)}</div>` : type === 'poster' ? posterHTML(t) : '')}`;
}
function tRef() {
  const sh = SHEET(cur.ref); const open = !!S.control['mr_' + sh.id];
  return `<div class="subtabs small">${SHEETS.map((s) => `<button type="button" class="${s.id === sh.id ? 'on' : ''}" data-ref="${s.id}">${s.no}</button>`).join('')}</div>
    <div class="refgrid">
      <section class="card"><header class="row"><h3>${sh.no} ${esc(sh.title)} · 동래점 모범답안</h3>
        <label class="switch"><input type="checkbox" data-ctl="mr_${sh.id}" ${open ? 'checked' : ''}><span>교육생에게 공개</span></label></header>
        ${renderParts(sh, sh.model, true).replace(/<div class="(calc|poster|readaloud)"[^>]*><\/div>/g, '')}${sh.modelNote ? `<p class="note">${esc(sh.modelNote)}</p>` : ''}</section>
      <aside><section class="card casec"><h3>케이스 C 풀이 · 코칭 포인트</h3><p>${esc(sh.caseC)}</p></section>
        <section class="card"><h3>교육생 힌트 3단계</h3>${sh.hints.map((h) => `<p class="hint">${esc(h)}</p>`).join('')}</section>
        <section class="card"><h3>연결된 케이스 C 자료</h3>${sh.caseRefs.map((id) => factCard(CASE_C.facts.find((f) => f.id === id))).join('')}</section></aside>
    </div>`;
}
function tScore() {
  return `<section class="card"><h3>점수판</h3><p class="muted">게임 점수는 자동 합산됩니다(빙고 줄당 5 + 완성 순위 30/20/10, 글자 조합·사실/판단 최고점, 퀴즈 정답당 5). 발표 가산점 등은 조정 칸에서 더하십시오.</p>
    <div class="tblwrap"><table class="ws res"><thead><tr><th>조</th><th>빙고</th><th>글자 A</th><th>글자 B</th><th>사실/판단</th><th>퀴즈</th><th>조정</th><th>합계</th></tr></thead><tbody>
    ${teamIds().map((t) => { const i = teamNo(t) - 1; return `<tr><th>${esc(teamName(t))}</th><td class="num">${bingoPoints(t)}</td><td class="num">${gdata('words', t).score || 0}</td><td class="num">${gdata('slogan', t).score || 0}</td><td class="num">${gdata('fact', t).score || 0}</td><td class="num">${quizPoints(t)}</td>
      <td class="adj"><button type="button" class="btn sm ghost" data-adj="${i}|-5">−5</button><span class="num">${S.scores.s[i] || 0}</span><button type="button" class="btn sm ghost" data-adj="${i}|5">+5</button></td><td class="num"><b>${totalScore(t)}</b></td></tr>`; }).join('')}
    </tbody></table></div></section>
    <section class="card"><header class="row"><h3>상호 평가 결과</h3><label class="switch"><input type="checkbox" data-ctl="evalOpen" ${S.control.evalOpen ? 'checked' : ''}><span>교육생에게 결과 공개</span></label></header>
      <label class="field"><span>지금 발표 중인 조 (발표 탭에 표시)</span><select data-ctlsel="presenting"><option value="">없음</option>${teamIds().map((t) => `<option value="${t}" ${S.control.presenting === t ? 'selected' : ''}>${esc(teamName(t))}</option>`).join('')}</select></label>
      ${evalTable()}</section>`;
}
function tAdmin() {
  return `<section class="card"><h3>수업 설정</h3>
    <label class="field"><span>참여 조 수</span><select data-ctlsel="teamCount">${[3, 4, 5, 6].map((n) => `<option value="${n}" ${S.control.teamCount === n ? 'selected' : ''}>${n}개 조</option>`).join('')}</select></label>
    <label class="switch"><input type="checkbox" data-ctl="caseReveal" ${S.control.caseReveal ? 'checked' : ''}><span>케이스 C 풀이를 교육생에게 공개</span></label>
    <div class="row"><button type="button" class="btn ghost" data-act="allModel">모든 시트 모범답안 공개</button><button type="button" class="btn ghost" data-act="noModel">모든 시트 모범답안 숨기기</button></div></section>
    <section class="card"><h3>결과 내보내기</h3><div class="row"><button type="button" class="btn" data-act="exportJSON">전체 기록 JSON</button><button type="button" class="btn" data-act="exportCSV">시트 기록 CSV (엑셀)</button></div></section>
    <section class="card danger"><h3>수업 데이터 초기화</h3><p class="muted">모든 조의 시트·게임·평가·점수를 지웁니다. 다음 반 수업 전에만 누르십시오.</p><button type="button" class="btn warn" data-act="reset">초기화</button></section>`;
}
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ───────────── 이벤트 ───────────── */
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button, [data-view]'); if (!b) return;
  const ds = b.dataset;
  if (ds.view) return go(ds.view);
  if (ds.team) { TEAM = ds.team; store.set('cp_team', TEAM); W = SL = FC = null; return render(); }
  if (ds.game) { cur.game = ds.game; return render(); }
  if (ds.sheet) { cur.sheet = ds.sheet; store.set('cp_sheet', ds.sheet); showModel = false; lastField = null; render(); return window.scrollTo(0, 0); }
  if (ds.gosheet) { cur.sheet = ds.gosheet; store.set('cp_sheet', ds.gosheet); showModel = false; return go('sheet'); }
  if (ds.cell != null) return bingoTap(Number(ds.cell));
  if (ds.wtile != null) { const t = W.tiles.find((x) => x.id === Number(ds.wtile)); if (t && !W.placed.includes(t)) { W.placed.push(t); render(); wordsCheck(); } return; }
  if (ds.wslot != null) { W.placed.splice(Number(ds.wslot)); return render(); }
  if (ds.stile != null) { const t = SL.tiles.find((x) => x.id === Number(ds.stile)); if (t && !SL.placed.includes(t)) { SL.placed.push(t); render(); } return; }
  if (ds.splaced != null) { SL.placed.splice(Number(ds.splaced), 1); return render(); }
  if (ds.sadd) { SL.free.push(ds.sadd); return render(); }
  if (ds.sfree != null) { SL.free.splice(Number(ds.sfree), 1); return render(); }
  if (ds.sendslogan) { const x = ds.sendslogan; save('w3', x + '_slogan', SL.free.join(' ').replace(/\s+([,.])/g, '$1')); toast(`시트 ③ ${x}안 슬로건으로 보냈습니다`); return; }
  if (ds.fact) { const q = GAMES.fact[FC.order[FC.i]]; FC.ans = ds.fact; if (ds.fact === q.a) { FC.score += 10; if (FC.score > (gdata('fact').score || 0)) { const data = { score: FC.score }; (S.games.fact = S.games.fact || {})[TEAM] = data; api('/api/game', { team: TEAM, g: 'fact', data }).catch(() => {}); } } return render(); }
  if (ds.quiz) {
    const c = LEARN.find((x) => x.ws === ds.quiz); const ok = Number(ds.i) === c.quiz.c ? 1 : 0;
    const data = Object.assign({}, gdata('quiz'), { [ds.quiz]: ok }); (S.games.quiz = S.games.quiz || {})[TEAM] = data;
    toast(ok ? '정답입니다 +5' : '다시 생각해 보십시오'); render(); api('/api/game', { team: TEAM, g: 'quiz', data }).catch(() => {}); return;
  }
  if (ds.tag) { const [ws, k] = ds.for.split('|'); const el = $(`[data-ws="${ws}"][data-k="${k}"]`); el.value = (el.value ? el.value.trimEnd() + ' ' : '') + `[${ds.tag}] `; el.focus(); save(ws, k, el.value); autosize(el); return; }
  if (ds.pull) {
    const f = CASE_C.facts.find((x) => x.id === ds.pull);
    const el = lastField && document.body.contains(lastField) ? lastField : $('#sheet textarea:not([disabled])');
    if (!el) return toast('붙여 넣을 입력칸이 없습니다');
    el.value = (el.value ? el.value.trimEnd() + ' / ' : '') + `[${f.tag}] ${f.body}`; save(el.dataset.ws, el.dataset.k, el.value); autosize(el); refreshSheet();
    el.scrollIntoView({ block: 'center', behavior: 'smooth' }); toast('케이스 C 자료를 붙였습니다'); return;
  }
  if (ds.ttab) { tTab = ds.ttab; return render(); }
  if (ds.ref) { cur.ref = ds.ref; return render(); }
  if (ds.peek) { const [team, ws] = ds.peek.split('|'); peek = { team, ws }; return render(); }
  if (ds.adj) { const [i, d] = ds.adj.split('|').map(Number); const s = S.scores.s.slice(); s[i] = (s[i] || 0) + d; S.scores.s = s; render(); return api('/api/scores', { s }).catch(() => toast('저장 실패')); }
  if (ds.greset) { if (!confirm('이 게임의 모든 조 기록을 지울까요?')) return; await api('/api/gamereset', { g: ds.greset }); return poll(); }

  const act = ds.act; if (!act) return;
  const A = {
    saveTeam: async () => { await api('/api/team', { team: TEAM, name: $('#tName').value, author: $('#tAuthor').value }); toast('저장했습니다'); poll(); },
    wordsStart: () => { wordsNew(); render(); }, wordsHint: () => { W.hint = true; render(); },
    wordsSkip: () => { W.i++; if (W.i < W.list.length) wordsSetup(); else wordsFinish(); render(); },
    sloganStart: () => { sloganNew(); render(); }, sloganFree: () => { if (!SL) sloganNew(); SL.freeMode = true; render(); },
    sloganClear: () => { SL.placed = []; render(); },
    sloganCheck: () => {
      const p = GAMES.slogan[SL.i]; const ok = SL.placed.map((t) => t.w).join(' ') === p.answer.join(' ');
      if (ok) { SL.score += 10; toast('정답! ' + p.answer.join(' ')); SL.i++; if (SL.i < GAMES.slogan.length) sloganSetup(); sloganSave(); render(); }
      else { $('#sphrase').classList.add('shake'); toast('순서나 카드가 다릅니다'); setTimeout(() => { const s = $('#sphrase'); if (s) s.classList.remove('shake'); }, 500); }
    },
    sOwnAdd: () => { const v = $('#sOwn').value.trim(); if (v) { SL.free.push(v); render(); } },
    sFreeClear: () => { SL.free = []; render(); },
    factStart: () => { FC = { order: shuffle(GAMES.fact.map((x, i) => i)), i: 0, score: 0, ans: null }; render(); },
    factNext: () => { FC.i++; FC.ans = null; if (FC.i >= FC.order.length) { const data = { score: Math.max(FC.score, gdata('fact').score || 0) }; (S.games.fact = S.games.fact || {})[TEAM] = data; api('/api/game', { team: TEAM, g: 'fact', data }).catch(() => {}); } render(); },
    hint: () => { const d = sheetOf(TEAM, cur.sheet); save(cur.sheet, 'hints', String(Math.min(3, num(d.hints) + 1))); render(); },
    toggleModel: () => { showModel = !showModel; render(); },
    pullInsight: () => { const w2 = sheetOf(TEAM, 'w2'); const v = w2.pick ? w2['i' + w2.pick + '_text'] : ''; if (!v) return toast('②에서 가장 강한 인사이트 번호를 먼저 고르십시오'); save('w3', 's1', v); render(); },
    pull10: () => pull10(false), pull10all: () => { if (confirm('⑩의 여덟 칸을 ①~⑨ 내용으로 다시 채울까요? 직접 고친 내용은 덮어씁니다.')) pull10(true); },
    print: () => printSheets(['w10']), printAll: () => printSheets(SHEETS.map((s) => s.id)),
    clockToggle: () => { clock.run = !clock.run; clearInterval(clock.h); if (clock.run) clock.h = setInterval(tick, 1000); render(); },
    clockQA: () => { clearInterval(clock.h); clock = { total: 240, left: 240, run: false, phase: '질의', h: null }; render(); },
    clockReset: () => { clearInterval(clock.h); clock = { total: 480, left: 480, run: false, phase: '발표', h: null }; render(); },
    bingoNext: () => control('bingoIdx', (S.control.bingoIdx ?? -1) + 1),
    bingoPrev: () => control('bingoIdx', Math.max(-1, (S.control.bingoIdx ?? -1) - 1)),
    bingoReset: async () => { if (!confirm('새 판을 시작할까요? 모든 조의 빙고 기록이 지워지고 판이 다시 섞입니다.')) return; await api('/api/gamereset', { g: 'bingo' }); poll(); },
    peekClose: () => { peek = null; render(); }, peekPrint: () => printSheets(SHEETS.map((s) => s.id), peek.team),
    allModel: async () => { for (const s of SHEETS) await api('/api/control', { key: 'mr_' + s.id, value: true }); poll(); },
    noModel: async () => { for (const s of SHEETS) await api('/api/control', { key: 'mr_' + s.id, value: false }); poll(); },
    exportJSON: () => download(`campaign-class-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S, null, 2), 'application/json'),
    exportCSV: () => {
      const rows = [['조', '팀명', '작성자', '시트', '항목', '내용']];
      for (const t of teamIds()) for (const sh of SHEETS) { const d = sheetOf(t, sh.id); for (const k of sheetKeys(sh)) if (d[k]) rows.push([teamNo(t) + '조', (S.teams[t] || {}).name || '', (S.teams[t] || {}).author || '', sh.no + ' ' + sh.title, k, d[k]]); }
      download('campaign-sheets.csv', '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n'), 'text/csv');
    },
    reset: async () => { if (!confirm('정말 모든 기록을 지울까요?') || !confirm('되돌릴 수 없습니다. 초기화합니다.')) return; await api('/api/reset', {}); V = 0; poll(); toast('초기화했습니다'); },
  };
  if (A[act]) A[act]();
});
function pull10(all) {
  const g = gen10(TEAM); const d = sheetOf(TEAM, 'w10'); let n = 0;
  for (const [k, v] of Object.entries(g)) { if (v && (all || !String(d[k + '_txt'] || '').trim())) { save('w10', k + '_txt', v); n++; } }
  render(); toast(n ? `${n}칸을 채웠습니다 · 2~3문장으로 줄이십시오` : '채울 빈 칸이 없거나 앞 시트가 비어 있습니다');
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.k && el.dataset.ws && !el.disabled) {
    const v = el.type === 'checkbox' ? (el.checked ? 'Y' : '') : el.value;
    save(el.dataset.ws, el.dataset.k, v);
    if (el.tagName === 'TEXTAREA') autosize(el);
    refreshSheet();
    return;
  }
  if (el.dataset.eval) { el.nextElementSibling.textContent = el.value; saveEval(); return; }
  if (el.id === 'evalNote') saveEval();
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'teamSel') { TEAM = el.value; store.set('cp_team', TEAM); W = SL = FC = null; return render(); }
  if (el.dataset.ctl) return control(el.dataset.ctl, el.checked);
  if (el.dataset.ctlsel) { const v = el.dataset.ctlsel === 'teamCount' ? Number(el.value) : el.value; return control(el.dataset.ctlsel, v); }
  if (el.id === 'evalTo') { evalTo = el.value; return render(); }
  if (el.id === 'peekCmp') { peek.cmp = el.value; return render(); }
});
document.addEventListener('focusin', (e) => { if (e.target.matches('#sheet textarea[data-k]:not([disabled])')) lastField = e.target; });
window.addEventListener('hashchange', render);

/* ───────────── 시작 ───────────── */
render();
poll().then(render);
setInterval(poll, 2000);
