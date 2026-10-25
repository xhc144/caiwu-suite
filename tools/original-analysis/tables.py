# -*- coding: utf-8 -*-
"""表结构：python tables.py <pbwork> <dw-analysis-dir> <out-dir>（需先运行 render.py 生成 json/windows.json）"""
import json, os, sys, re, collections

W, DWDIR, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
schemas = json.load(open(os.path.join(DWDIR, 'template-schemas.json'), encoding='utf-8'))
dws = json.load(open(os.path.join(DWDIR, 'datawindows-compact.json'), encoding='utf-8'))['datawindows']
wins = json.load(open(os.path.join(OUT, 'json', 'windows.json'), encoding='utf-8'))

# 模板名称
aclist = {}
for prod, setup in (('qingsong', 'qingsong-kuaiji-setup'), ('minfeiqi', 'minfeiqi-setup'), ('chengben', 'chengben-kuaiji-setup')):
    for line in open(os.path.join(W, 'named', setup, 'aclist.txt'), encoding='gbk', errors='replace'):
        line = line.strip()
        m = re.match(r'(\d{2})(\d{2})-(.+)', line)
        if m:
            aclist.setdefault('a' + m.group(2), (int(m.group(1)), m.group(3)))

tdefs = {t['id']: t for t in schemas['table_definitions']}
schema_tables = {s['id']: s['table_definition_ids'] for s in schemas['schemas']}
tmpl_schema = collections.defaultdict(dict)
for t in schemas['templates']:
    tmpl_schema[t['product']][t['template']] = t['schema_id']

# 每张表：定义变体 -> 使用的模板
table_variants = collections.defaultdict(lambda: collections.defaultdict(set))
for prod, tm in tmpl_schema.items():
    for tmpl, sid in tm.items():
        for tid in schema_tables[sid]:
            table_variants[tdefs[tid]['name'].lower()][tid].add(tmpl)

# 中文标题与 DataWindow 使用
titles = collections.defaultdict(collections.Counter)
dw_use = collections.defaultdict(set)
for d in dws:
    q = d.get('query') or {}
    for t in q.get('tables') or []:
        dw_use[t.lower()].add(d['name'][:-4])
    for c in d.get('columns') or []:
        dbn = (c.get('database_name') or '').lower()
        if '.' in dbn:
            tb, col = dbn.split('.', 1)
            for tc in c.get('title_candidates') or []:
                txt = tc['text'].strip()
                if txt and not re.fullmatch(r'[\w\s]+', txt, re.A):
                    titles[(tb, col)][txt] += 1

# 窗口使用（DataWindow + 嵌入 SQL）
win_use = collections.defaultdict(set)
def walk(unit, nm, w):
    def ev(evs):
        for e in evs.values():
            for t in e.get('tables', []):
                win_use[t.lower()].add((unit, nm))
            for dwn in e.get('dataobjects', []):
                for t in dwtables.get(dwn, []):
                    win_use[t].add((unit, nm))
    ev(w.get('events', {}))
    def cw(cs):
        for c in cs:
            dwn = c['props'].get('dataobject')
            if dwn:
                for t in dwtables.get(dwn, []):
                    win_use[t].add((unit, nm))
            ev(c.get('events', {}))
            cw(c.get('children', []))
    cw(w.get('controls', []))
dwtables = collections.defaultdict(set)
for d in dws:
    for t in (d.get('query') or {}).get('tables') or []:
        dwtables[d['name'][:-4]].add(t.lower())
for unit, ws in wins.items():
    for nm, w in ws.items():
        walk(unit, nm, w)

# 输出
out_tables = {}
L = ['# 数据库表结构（来自账套模板 DDL）', '',
     '来源：每套安装包的 60 个账套模板（`aNN.acd`，纯静态解压）中的 `rhsj/data_stru.txt`（CREATE TABLE / CREATE INDEX）。三套产品的模板 DDL 一致。',
     '中文名取自 DataWindow 列标题（同一字段在不同报表里的标题可能不同，列出最常见的几个）；“使用窗口”= 通过 DataWindow 或嵌入式 SQL 读写该表的窗口。',
     '不同账套模板的同名表可能有多个定义变体；下表展示覆盖模板最多的变体，并注明变体数。数据库为 Sybase SQL Anywhere 8/9（`asa8`）。', '',
     '## 账套模板（新建账套时选择的会计制度）', '',
     '| 模板文件 | 显示顺序 | 名称 |', '|---|---|---|']
for k, (order, name) in sorted(aclist.items(), key=lambda x: x[1][0]):
    L.append('| %s.acd | %02d | %s |' % (k, order, name))
L += ['', '未出现在 aclist.txt 中的模板文件（a36–a41、a55–a60 等）字节相同或为备用，新建账套界面不显示。', '', '## 表目录', '']
names = sorted(table_variants)
L.append('| 表名 | 中文推断 | 列数 | 定义变体 | 使用窗口数 |')
L.append('|---|---|---|---|---|')
detail = []
for tn in names:
    variants = table_variants[tn]
    tid = max(variants, key=lambda v: len(variants[v]))
    td = tdefs[tid]
    cols = td['columns']
    cn = []
    for c in cols:
        t = titles.get((tn, c['name'].lower()))
        cn.append('、'.join(x for x, _ in t.most_common(3)) if t else '')
    used = sorted(win_use.get(tn, set()))
    guess = ''
    # 表的中文推断：取最常见列标题无法得出，留空由使用窗口标题代表
    titles_w = collections.Counter()
    for unit, nm in used:
        tt = wins[unit][nm].get('title', '')
        if tt: titles_w[re.sub(r'（.*?）', '', tt)] += 1
    guess = '、'.join(x for x, _ in titles_w.most_common(2))
    L.append('| [%s](#%s) | %s | %d | %d | %d |' % (tn, tn, guess, len(cols), len(variants), len(used)))
    detail += ['### %s' % tn, '']
    if guess: detail.append('- 主要相关窗口：' + guess)
    detail.append('- 定义变体 %d 个；展示的变体出现在 %d 个模板中。' % (len(variants), len(variants[tid])))
    if used:
        detail.append('- 使用窗口：' + '、'.join('`%s`（%s）' % (nm, unit) for unit, nm in used[:20]) + ('……共 %d 个' % len(used) if len(used) > 20 else ''))
    dwl = sorted(dw_use.get(tn, set()))
    if dwl:
        detail.append('- 数据窗口：' + '、'.join('`%s`' % x for x in dwl[:20]) + ('……共 %d 个' % len(dwl) if len(dwl) > 20 else ''))
    detail += ['', '| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |', '|---|---|---|---|---|---|---|']
    for c, z in zip(cols, cn):
        detail.append('| %d | %s | %s | %s | %s | %s | %s |' % (c['ordinal'], c['name'], c['data_type_declaration'], '是' if c['nullable_declaration'] else '否',
                      (c.get('default_declaration') or '').replace('|', '\\|'), c['primary_key_position'] or '', z.replace('|', '\\|')))
    detail.append('')
    out_tables[tn] = {'columns': [dict(c, chinese_titles=[x for x, _ in titles.get((tn, c['name'].lower()), collections.Counter()).most_common(5)]) for c in cols],
                      'variant_count': len(variants), 'templates': sorted(variants[tid]),
                      'datawindows': dwl, 'windows': ['%s:%s' % u for u in used]}
L += ['', '## 表明细', ''] + detail
os.makedirs(os.path.join(OUT, 'data'), exist_ok=True)
open(os.path.join(OUT, 'data', 'tables.md'), 'w', encoding='utf-8').write('\n'.join(L))
json.dump({'templates': {k: {'order': o, 'name': n} for k, (o, n) in aclist.items()}, 'tables': out_tables},
          open(os.path.join(OUT, 'json', 'tables.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# DataWindow 精简目录
dout = {}
for d in dws:
    q = d.get('query') or {}
    dout['%s/%s' % (d['product'], d['name'][:-4])] = {
        'library': d['library'], 'tables': q.get('tables') or [], 'query_kind': q.get('representation'),
        'query': (q.get('text') or '')[:4000], 'arguments': q.get('arguments') or [],
        'columns': [{'name': c['name'], 'db': c.get('database_name'), 'title': (c.get('title_candidates') or [{}])[0].get('text', '').strip()} for c in d.get('columns') or []],
        'texts': [t if isinstance(t, str) else t.get('text', '') for t in (d.get('visual_texts') or [])][:80]}
json.dump(dout, open(os.path.join(OUT, 'json', 'datawindows.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('tables', len(out_tables), 'templates', len(aclist), 'dw', len(dout))
