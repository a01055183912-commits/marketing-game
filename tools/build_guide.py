"""강의 가이드 원고(docs/source/Campaign_Planning_Lecture_Guide.txt) → public/guide.js
원고 텍스트는 docx에서 '[스타일] 문단' / '  | 표 | 행' 형식으로 뽑은 것입니다.
실행: python3 tools/build_guide.py
"""
import json, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
lines = (ROOT / 'docs/source/Campaign_Planning_Lecture_Guide.txt').read_text(encoding='utf-8').splitlines()

def parse(line):
    if line.startswith('  | '):
        return 'row', [c.strip() for c in line[4:].split(' | ')]
    m = re.match(r'\[([^\]]*)\] (.*)', line)
    return (m.group(1), m.group(2)) if m else ('', line)

# 부(Heading 1) 단위로 자르기
parts, cur = {}, None
for ln in lines:
    kind, body = parse(ln)
    if kind == 'Heading 1':
        cur = body; parts[cur] = []
    elif cur:
        parts[cur].append((kind, body))
key = lambda s: next(k for k in parts if k.startswith(s))

# ── 2부: 장별 설명 ──
slides, s = [], None
for kind, body in parts[key('2부')]:
    if kind == 'Heading 2':
        m = re.match(r'(\d+)장 · (.*)', body)
        s = {'no': int(m.group(1)), 'title': m.group(2), 'know': [], 'bullets': [], 'core': '', 'script': [], 'steps': '', 'watch': '', 'next': '', 'req': [], 'table': []}
        slides.append(s); continue
    if kind == 'row': s['table'].append(body); continue
    if kind == 'List Paragraph': s['bullets'].append(body); continue
    t = body
    if t.startswith('선생님이 먼저 알아 둘 것:'): v = t.split(':', 1)[1].strip(); v and s['know'].append(v)
    elif t.startswith('핵심'): s['core'] = t[2:].strip()
    elif t.startswith('넘어가는 한마디'): s['next'] = t[len('넘어가는 한마디'):].strip()
    elif t.startswith('진행 순서:'): s['steps'] = t.split(':', 1)[1].strip()
    elif t.startswith('돌면서 볼 것:'): s['watch'] = t.split(':', 1)[1].strip()
    elif t.startswith('담당자 요청:'): s['req'].append(t.split(':', 1)[1].strip())
    elif t.startswith('“'): s['script'].append({'say': t.strip('“”')})
    elif t.startswith('('): s['script'].append({'do': t.strip('()')})
    else: s['know'].append(t)
assert len(slides) == 56, len(slides)

# ── 3부: 한 줄 요약 ──
summary = {int(r[0]): r[1] for k, r in parts[key('3부')] if k == 'row' and r[0].isdigit()}
for sl in slides: sl['one'] = summary.get(sl['no'], '')

# ── 4부: 용어사전 ──
glossary, cat = [], None
for kind, body in parts[key('4부')]:
    if kind == 'Heading 2':
        cat = {'cat': re.sub(r'^\d+\.\s*', '', body), 'terms': [], 'core': ''}; glossary.append(cat); continue
    if not cat: continue
    if kind == 'row':
        if body[0] in ('용어', '유형'): continue
        if len(body) == 4:   # 캠페인 유형 표
            cat['terms'].append({'t': body[0], 'd': f'{body[3]}. 설계 공식: {body[1]} · 대표 사례: {body[2]}'})
        else:
            cat['terms'].append({'t': body[0], 'd': body[1]})
    elif body.startswith('핵심'): cat['core'] = body[2:].strip()

# ── 5부: 게임 ──
games, g = [], None
for kind, body in parts[key('5부')]:
    if kind == 'Heading 2':
        m = re.match(r'게임 (\d) · (.*?) \((.*)\)', body)
        g = {'id': 'g' + m.group(1), 'title': m.group(2), 'review': m.group(3), 'how': '', 'rows': []}; games.append(g); continue
    if not g: continue
    if kind == 'row':
        if body[0] in ('문제', '카드 A', '문제(신호)', '지표', '문장', '계산'): continue
        g['rows'].append(body)
    elif body.startswith('방식:'): g['how'] = body.split(':', 1)[1].strip()

out = {'slides': slides, 'glossary': glossary, 'games': games}
js = '/* 자동 생성: python3 tools/build_guide.py — 원본 docs/source/Campaign_Planning_Lecture_Guide.txt */\nconst GUIDE = ' + json.dumps(out, ensure_ascii=False, indent=0) + ';\n'
(ROOT / 'public/guide.js').write_text(js, encoding='utf-8')
print('slides', len(slides), 'terms', sum(len(c['terms']) for c in glossary), 'cats', len(glossary), 'games', [(x['id'], len(x['rows'])) for x in games])
