// 캠페인 기획 연습장 (3-2 캠페인 기획 실습) · Railway 서버 (외부 패키지 없이 Node 기본 기능만 사용)
const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC = path.join(__dirname, 'public');
const TEAM = /^team[1-6]$/;

const empty = () => ({
  v: 1,
  teams: {},            // team1: { name, author }
  sheets: {},           // team1: { w1: { key: value } }
  games: {},            // bingo|words|slogan|fact : { team1: {...} }
  evals: {},            // fromTeam: { toTeam: { c1..c4, note } }
  control: { teamCount: 4, bingoSeed: 1, bingoIdx: -1 },
  scores: { s: [0, 0, 0, 0, 0, 0] },
});
let state = empty();
try { state = Object.assign(empty(), JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { /* first run */ }

let timer = null;
function persist() {
  state.v++;
  clearTimeout(timer);
  timer = setTimeout(() => fs.writeFile(FILE, JSON.stringify(state), () => {}), 300);
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve(null); } });
  });
}
const str = (v, n) => String(v ?? '').slice(0, n);
// 게임 기록은 작은 평면 객체만 허용 (숫자·짧은 문자열·숫자 배열)
function cleanFlat(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const [k, v] of Object.entries(o).slice(0, 40)) {
    if (!/^[a-z0-9_]{1,24}$/i.test(k)) continue;
    if (typeof v === 'number' && isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 300);
    else if (Array.isArray(v)) out[k] = v.slice(0, 60).map((x) => (typeof x === 'number' ? x : str(x, 60)));
  }
  return out;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'GET' && p === '/api/state') {
    if (url.searchParams.get('v') === String(state.v)) { res.writeHead(204); return res.end(); }
    return send(res, 200, state);
  }
  if (req.method === 'POST' && p.startsWith('/api/')) {
    const b = (await readBody(req)) || {};
    const bad = () => send(res, 400, { error: 'bad request' });

    if (p === '/api/sheet') {
      if (!TEAM.test(b.team) || !/^w([1-9]|1[0-2])$/.test(b.ws || '') || !/^[a-z0-9_]{1,30}$/i.test(b.k || '')) return bad();
      const t = (state.sheets[b.team] = state.sheets[b.team] || {});
      const w = (t[b.ws] = t[b.ws] || {});
      w[b.k] = str(b.v, 4000);
    } else if (p === '/api/team') {
      if (!TEAM.test(b.team)) return bad();
      state.teams[b.team] = { name: str(b.name, 40), author: str(b.author, 80), store: str(b.store, 60) };
    } else if (p === '/api/game') {
      if (!TEAM.test(b.team) || !/^(bingo|words|slogan|g[1-6])$/.test(b.g || '')) return bad();
      const g = (state.games[b.g] = state.games[b.g] || {});
      g[b.team] = cleanFlat(b.data);
    } else if (p === '/api/eval') {
      if (!TEAM.test(b.from) || !TEAM.test(b.to) || b.from === b.to) return bad();
      const f = (state.evals[b.from] = state.evals[b.from] || {});
      const d = b.data || {};
      const sc = (x) => Math.max(0, Math.min(25, Math.round(Number(x) || 0)));
      f[b.to] = { c1: sc(d.c1), c2: sc(d.c2), c3: sc(d.c3), c4: sc(d.c4), note: str(d.note, 300) };
    } else if (p === '/api/control') {
      if (!/^[a-z0-9_]{1,30}$/i.test(b.key || '')) return bad();
      const v = b.value;
      if (!(typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')) return bad();
      state.control[b.key] = typeof v === 'string' ? v.slice(0, 200) : v;
    } else if (p === '/api/scores') {
      if (!Array.isArray(b.s)) return bad();
      state.scores = { s: b.s.slice(0, 6).map((n) => Math.round(Number(n) || 0)) };
      while (state.scores.s.length < 6) state.scores.s.push(0);
    } else if (p === '/api/gamereset') {
      if (!/^(bingo|words|slogan|g[1-6])$/.test(b.g || '')) return bad();
      state.games[b.g] = {};
      if (b.g === 'bingo') { state.control.bingoIdx = -1; state.control.bingoSeed = (state.control.bingoSeed || 1) + 1; }
    } else if (p === '/api/reset') {
      const v = state.v; state = empty(); state.v = v;
    } else {
      return send(res, 404, { error: 'not found' });
    }
    persist();
    return send(res, 200, { ok: true, v: state.v });
  }
  if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true });
  if (req.method === 'GET') {
    const rel = p === '/' ? 'index.html' : p.slice(1);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep) || !TYPES[path.extname(file)]) return send(res, 404, { error: 'not found' });
    return fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
  }
  send(res, 404, { error: 'not found' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('campaign practice app on port ' + PORT));
