# -*- coding: utf-8 -*-
"""渲染：python render.py <pbwork> <dw-analysis-dir> <out-dir>"""
import os, sys
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gen.py'), encoding='utf-8').read())


MENU_TITLE = {}


def wtitle(w):
    own = w.get('own_title')
    if own and own not in ('none', 'Untitled') and own != w.get('anc_title'):
        return own
    for k, txt in w['events'].items():
        m = re.search(r'\bthis\.title\s*=\s*"([^"]+)"', txt)
        if m:
            return m.group(1) + '（运行时设置）'
    if w['name'] in MENU_TITLE:
        return MENU_TITLE[w['name']] + '（取自菜单文字）'
    t = w['props'].get('title', '')
    if t and t not in ('none', 'Untitled'):
        return t + '（继承自祖先）'
    return ''


SMALL = set()


def module_of(w):
    parts = w['name'].split('_')
    m = parts[1] if len(parts) > 1 else 'other'
    return 'misc' if m in SMALL else m


MODULE_TITLE = dict(MODULE_LABEL)
MODULE_TITLE.update({'misc': '其他系统窗口（登录、备份恢复、打印、杂项）', 'tzjl': '套账管理', 'bf': '数据备份', 'hf': '数据恢复', 'pzedit': '凭证编辑', 'zh': '综合检查', 'wb': '云报表/移动端', 'main1': '工作台', 'gzgl': '工资管理', 'zjjs': '折旧计算', 'ck': '仓库/出入库', 'cg': '采购', 'cn': '出纳', 'fp': '发票', 'g': '进销存', 'login': '登录', 'preview': '打印预览', 'print': '打印设置', 'xs': '销售', 'sp': '商品', 'kh': '客户', 'gys': '供应商', 'bak': '备份', 'yh': '银行', 'xj': '现金', 'zp': '支票', 'pj': '票据', 'dz': '对账', 'rj': '日记账', 'sz': '设置', 'ye': '余额'})


def resolve_targets(P, code):
    funcs = P['funcs']; known = set(P['windows']) | set(P['udos'])
    out = []
    for o in code['opens']:
        if o['target'] in known and o['target'] not in out:
            out.append(o['target'])
    for d in code['dyn']:
        if d in known and d not in out:
            out.append(d)
    for f in code['funcs']:
        if f in funcs:
            for o in funcs[f]['code']['opens']:
                if o['target'] in known and o['target'] not in out:
                    out.append(o['target'])
    return out


def collect_edges(P):
    edges = collections.defaultdict(list)
    wins, udos, menus = P['windows'], P['udos'], P['menus']

    def add(src, code, how):
        for t in resolve_targets(P, code):
            edges[src].append((t, how))
    for mn, m in menus.items():
        for path, it in all_menu_items(m['items']):
            add('menu:%s/%s' % (mn, it['name']), it['code'], '菜单')
    for nm, w in list(wins.items()) + list(udos.items()):
        mn = w['props'].get('menuname')
        if mn in menus:
            for path, it in all_menu_items(menus[mn]['items']):
                edges[nm].append(('menu:%s/%s' % (mn, it['name']), '菜单栏'))
        for src, a in win_actions(w).items():
            add(nm, a, src)
        def walk(cs):
            for c in cs:
                if c['type'] in udos:
                    edges[nm].append((c['type'], '内嵌用户对象'))
                walk(c.get('children', []))
        walk(w['controls'])
    return edges


def wref(P, name):
    w = P['windows'].get(name) or P['udos'].get(name)
    if not w:
        return '`%s`' % name
    t = wtitle(w)
    return '`%s`%s' % (name, '「%s」' % t if t else '')


def render_menu_tree(P, items, lines, depth=0, only_changed=False):
    for it in items:
        if only_changed and not (it.get('added_in_descendant') or it.get('overridden_clicked')):
            sub = []
            render_menu_tree(P, it.get('children', []), sub, depth + 1, True)
            if sub:
                lines.append('%s- %s' % ('  ' * depth, clean_label(it.get('text')) or it['name']))
                lines.extend(sub)
            continue
        txt = clean_label(it.get('text'))
        if txt == '-':
            lines.append('%s- ———（分隔线）' % ('  ' * depth))
            continue
        bits = ['**%s**' % md_escape(txt or it['name'])]
        if it.get('shortcut'): bits.append('快捷键 `%s`' % it['shortcut'])
        if it.get('toolbar_visible') and it.get('toolbar_text'): bits.append('工具栏「%s」' % md_escape(it['toolbar_text']))
        if not it.get('visible', True): bits.append('〔默认隐藏〕')
        if not it.get('enabled', True): bits.append('〔默认禁用〕')
        if it.get('overridden_clicked'): bits.append('〔本菜单改写动作〕')
        tg = resolve_targets(P, it['code'])
        if tg:
            bits.append('→ ' + '、'.join(wref(P, t) for t in tg))
        elif it['code']['run']:
            bits.append('→ 运行 ' + '、'.join('`%s`' % md_escape(r) for r in it['code']['run']))
        elif it.get('clicked_code') and not it.get('children'):
            first = [l.strip() for l in it['clicked_code'].splitlines() if l.strip() and not l.strip().startswith('//') and l.strip() != 'return']
            if first:
                bits.append('→ 脚本：`%s`' % md_escape(first[0]).replace('`', "'")[:80])
        bits.append('<sub>%s</sub>' % it['name'])
        lines.append('%s- %s' % ('  ' * depth, ' '.join(bits)))
        render_menu_tree(P, it.get('children', []), lines, depth + 1, False)


def count_items(items, pred=lambda i: True):
    return sum(1 for _, it in all_menu_items(items) if clean_label(it.get('text')) not in ('-', '') and pred(it))


def dw_index(dwdata, pid):
    idx = {}
    for d in dwdata['datawindows']:
        if d['product'] == pid:
            idx.setdefault(d['name'][:-4], d)
    return idx


def dw_brief(dw):
    if not dw:
        return '', []
    q = dw.get('query') or {}
    cols = []
    for c in dw.get('columns') or []:
        tc = c.get('title_candidates') or []
        cols.append('%s%s' % (c['name'], '（%s）' % tc[0]['text'].strip() if tc else ''))
    return '、'.join(q.get('tables') or []), cols


def render_window(P, w, dwi, lines, reverse):
    t = wtitle(w)
    lines.append('### %s%s' % (w['name'], ' — %s' % md_escape(t) if t else ''))
    lines.append('')
    p = w['props']
    meta = ['类型：%s' % (WINTYPE.get(p.get('windowtype', ''), p.get('windowtype', '')) or ('用户对象' if w['kind'] == 'udo' else '主窗口（默认）'))]
    if p.get('width'): meta.append('尺寸：%s×%s PBU' % (p.get('width'), p.get('height')))
    if w.get('inherit') and w['inherit'] not in ('window', 'userobject'): meta.append('继承：`%s`' % w['inherit'])
    if p.get('menuname'): meta.append('菜单：`%s`' % p['menuname'])
    meta.append('库：%s（%s）' % (w['library'], PROGRAM_LABEL.get(w['program'], w['program'])))
    lines.append('- ' + '；'.join(meta))
    src = summarize_sources(reverse.get(w['name'], []))
    if src:
        lines.append('- 打开入口：' + '；'.join(src[:12]) + ('……（共 %d 处）' % len(src) if len(src) > 12 else ''))
    rows = []
    def walk(cs, prefix=''):
        for c in cs:
            typ = c['type']
            label = CTRL_LABEL.get(typ, typ)
            text = ctrl_text(c)
            extra = []
            if c['props'].get('dataobject'):
                dwn = c['props']['dataobject']
                tables, cols = dw_brief(dwi.get(dwn))
                extra.append('数据窗口 `%s`%s' % (dwn, '（表 %s）' % tables if tables else ''))
                if cols: extra.append('列：' + '、'.join(cols[:30]) + ('……' if len(cols) > 30 else ''))
            for ev, code in c['code'].items():
                if ev in ('create', 'destroy'): continue
                tg = resolve_targets(P, code)
                if tg: extra.append('%s → %s' % (ev, '、'.join(wref(P, x) for x in tg)))
                if code['dwo']: extra.append('%s 切换数据窗口 %s' % (ev, '、'.join('`%s`' % d for d in sorted(set(code['dwo']))[:6])))
                if code['sql_tables']: extra.append('%s 读写表 %s' % (ev, '、'.join(sorted(code['sql_tables']))))
            if typ in ('line', 'rectangle', 'oval', 'roundrectangle') and not extra:
                continue
            if typ == 'statictext' and not text and not extra:
                continue
            pos = '%s,%s %s×%s' % (c['props'].get('x', ''), c['props'].get('y', ''), c['props'].get('width', ''), c['props'].get('height', ''))
            rows.append('| %s%s | %s | %s | %s | %s |' % (prefix, c['name'], label, md_escape(text)[:40], pos, md_escape('；'.join(extra))[:700]))
            walk(c.get('children', []), prefix + c['name'] + '/')
    walk(w['controls'])
    if rows:
        lines += ['', '| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |', '|---|---|---|---|---|'] + rows
    evl = []
    for k, code in w['code'].items():
        ev = k.split(':', 1)[1]
        if ev in ('create', 'destroy'): continue
        bits = []
        tg = resolve_targets(P, code)
        if tg: bits.append('打开 ' + '、'.join(wref(P, x) for x in tg))
        if code['dwo']: bits.append('数据窗口 ' + '、'.join('`%s`' % d for d in sorted(set(code['dwo']))[:8]))
        if code['sql_tables']: bits.append('读写表 ' + '、'.join(sorted(code['sql_tables'])))
        if code['run']: bits.append('运行 ' + '、'.join('`%s`' % md_escape(r) for r in code['run']))
        if bits:
            evl.append('  - `%s`：%s' % (ev, '；'.join(bits)))
    if evl:
        lines += ['', '- 窗口事件/函数：'] + evl
    msgs, seen = [], set()
    for src, a in win_actions(w).items():
        for m in a['msgs']:
            if m['text'] in seen: continue
            seen.add(m['text'])
            msgs.append('  - [%s]「%s」%s' % (md_escape(src), md_escape(m['text'])[:160], '（条件：`%s`）' % md_escape(m['cond']).replace('`', "'")[:120] if m['cond'] else ''))
    if msgs:
        lines += ['', '- 提示与校验（%d 条）：' % len(msgs)] + msgs[:40]
        if len(msgs) > 40: lines.append('  - ……另有 %d 条，见 rules.md' % (len(msgs) - 40))
    lines.append('')


def summarize_sources(src):
    menus = collections.OrderedDict(); others = []
    for x in src:
        if isinstance(x, tuple):
            menus.setdefault(x[1], set()).add(x[0])
        elif x not in others:
            others.append(x)
    out = []
    for path, ms in menus.items():
        out.append('菜单「%s」%s' % (path, '（%d 个菜单中）' % len(ms) if len(ms) > 1 else '（`%s`）' % next(iter(ms))))
    return out + sorted(others)


def reverse_index(P):
    rev = collections.defaultdict(list)
    for mn, m in P['menus'].items():
        for path, it in all_menu_items(m['items']):
            for t in resolve_targets(P, it['code']):
                rev[t].append((mn, ' › '.join(md_escape(clean_label(x)) for x in path)))
                if t not in MENU_TITLE and clean_label(path[-1]) not in ('', '-'):
                    MENU_TITLE[t] = clean_label(path[-1])
    for nm, w in list(P['windows'].items()) + list(P['udos'].items()):
        for src, a in win_actions(w).items():
            for t in resolve_targets(P, a):
                if t != nm:
                    rev[t].append('`%s` 的 %s' % (nm, md_escape(src.replace('窗口事件 ', '事件 '))))
    return rev


def reachable(edges, starts):
    seen, stack = set(), list(starts)
    while stack:
        n = stack.pop()
        if n in seen: continue
        seen.add(n)
        stack.extend(d for d, _ in edges.get(n, []))
    return seen


def jmenu(P, items):
    return [{'name': i['name'], 'text': clean_label(i.get('text')), 'shortcut': i.get('shortcut', ''), 'visible': i.get('visible', True),
             'enabled': i.get('enabled', True), 'toolbar_text': i.get('toolbar_text', ''), 'added_in_descendant': bool(i.get('added_in_descendant')),
             'opens': resolve_targets(P, i['code']), 'runs': i['code']['run'], 'children': jmenu(P, i.get('children', []))} for i in items]


def jevents(P, codes):
    evs = {}
    for e, code in codes.items():
        e = e.split(':', 1)[-1]
        if e in ('create', 'destroy'): continue
        t = resolve_targets(P, code)
        if t or code['msgs'] or code['sql_tables'] or code['dwo'] or code['run']:
            evs[e] = {'opens': t, 'dataobjects': sorted(set(code['dwo'])), 'tables': sorted(code['sql_tables']),
                      'runs': code['run'], 'messages': [m['text'] for m in code['msgs']]}
    return evs


def jctrl(P, cs):
    keepk = ('x', 'y', 'width', 'height', 'text', 'dataobject', 'picturename', 'visible', 'enabled', 'taborder', 'limit', 'mask', 'tag', 'checked', 'displayonly')
    return [{'name': c['name'], 'type': c['type'], 'props': {k: v for k, v in c['props'].items() if k in keepk},
             'events': jevents(P, c['code']), 'children': jctrl(P, c.get('children', []))} for c in cs]


SUBSYS = {'m_frame_zw': '账务', 'm_frame_cb': '成本/进销存', 'm_frame_gz': '工资', 'm_frame_zc': '固定资产',
          'm_frame_cn': '出纳', 'm_frame_fp': '发票', 'm_frame_mf': '民非', 'm_frame_ck': '仓库'}


def render_unit(pid, uname, setup, unit, prog, P, own, libs, dwdata, summary, all_json):
    dwi = dw_index(dwdata, pid)
    pdir = os.path.join(OUT, 'products', pid, unit)
    DOC = {n: w for n, w in P['windows'].items() if w['library'] in own}
    wdir = os.path.join(pdir, 'windows')
    os.makedirs(wdir, exist_ok=True)
    rev = reverse_index(P)
    edges = collect_edges(P)
    fr = [n for n, w in DOC.items() if w['props'].get('windowtype') in ('mdi!', 'mdihelp!')] or [n for n in ('w_frame',) if n in P['windows']]
    frame = P['windows'].get(fr[0]) if fr else None
    starts = fr + [n for n in P['windows'] if n.startswith('w_login')]
    reach = reachable(edges, starts)
    frame_menu = frame['props'].get('menuname') if frame else None
    mainmenu = P['menus'].get(frame_menu, {}).get('items', [])
    frame_menus = ([frame_menu] if frame_menu in P['menus'] else []) + sorted(m for m in P['menus'] if m.startswith('m_frame') and m != frame_menu and P['menus'][m]['library'] in own and not m.endswith('_bak'))
    bench = [n for n in sorted(DOC) if (n == 'w_main' or n.startswith('w_main1')) and 'bak' not in n]
    # menus.md
    L = ['# %s — 菜单结构' % uname, '',
         '菜单文字、快捷键、显示状态取自菜单对象 create 事件的属性赋值；“→”为 clicked 事件中静态打开的窗口（含经全局函数打开的）。'
         '“〔默认隐藏〕”的项可能在运行时按版本、权限或 OEM 由脚本显示。PB 规则：后代菜单继承祖先全部菜单项，祖先中 ShiftToRight 的项排在后代新增项之后。', '']
    for fm in frame_menus:
        L += ['## 主菜单栏：%s（`%s`）%s' % (SUBSYS.get(fm, fm) if unit == 'main' or fm != 'm_frame_zw' else '本程序主菜单（同名覆盖）', fm, '——主框架默认菜单' if fm == frame_menu else '——切换到该子系统时主框架换用此菜单'), '']
        render_menu_tree(P, P['menus'][fm]['items'], L)
        L.append('')
    users_of = collections.defaultdict(list)
    for n, w in P['windows'].items():
        if w['props'].get('menuname'):
            users_of[w['props']['menuname']].append(n)
    L += ['## 各功能窗口自带的菜单栏', '',
          'MDI 程序中，打开某个功能窗口（sheet）时，菜单栏换成该窗口的菜单。下列菜单多继承主菜单，只列出新增或改写的部分。', '']
    popups = []
    for mn in sorted(P['menus']):
        m = P['menus'][mn]
        if mn in frame_menus: continue
        users = users_of.get(mn, [])
        if not users and m['inherit'] in ('menu', None):
            popups.append(mn); continue
        L.append('### `%s`%s' % (mn, '（继承 `%s`）' % m['inherit'] if m['inherit'] not in ('menu', None) else ''))
        if users: L.append('使用窗口：' + '、'.join(wref(P, u) for u in sorted(users)))
        L.append('')
        render_menu_tree(P, m['items'], L, 0, only_changed=m['inherit'] in P['menus'])
        L.append('')
    L += ['## 右键/弹出菜单', '']
    for mn in popups:
        L += ['### `%s`' % mn, '']
        render_menu_tree(P, P['menus'][mn]['items'], L)
        L.append('')
    open(os.path.join(pdir, 'menus.md'), 'w', encoding='utf-8').write('\n'.join(L))
    # windows
    groups = collections.defaultdict(list)
    for nm, w in sorted(DOC.items()):
        groups[module_of(w)].append(w)
    mod_rows = []
    for mod, ws in sorted(groups.items(), key=lambda x: -len(x[1])):
        L = ['# %s — 窗口目录：%s（前缀 `%s`）' % (uname, MODULE_TITLE.get(mod, mod), mod), '',
             '尺寸单位为 PowerBuilder Unit（PBU）。96 DPI、系统字体下约为：宽度像素 ≈ PBU × 0.25～0.3，高度像素 ≈ PBU × 0.25～0.28。',
             '“打开入口”只列静态可见的调用方，运行时拼出来的窗口名可能遗漏。名字含 `_bak`、`_old`、`test` 的通常是历史残留。', '']
        for w in ws:
            render_window(P, w, dwi, L, rev)
        open(os.path.join(wdir, '%s.md' % mod), 'w', encoding='utf-8').write('\n'.join(L))
        mod_rows.append((mod, len(ws), sum(1 for w in ws if w['name'] in reach), sum(1 for w in ws if w['props'].get('windowtype') == 'response!')))
    L = ['# %s — 用户对象（可复用面板/控件）' % uname, '']
    for nm, w in sorted(P['udos'].items()):
        render_window(P, w, dwi, L, rev)
    open(os.path.join(wdir, '_userobjects.md'), 'w', encoding='utf-8').write('\n'.join(L))
    # navigation.md
    L = ['# %s — 启动流程、工作台与可达性' % uname, '',
         '从主框架 `w_frame` 与登录窗口出发，沿“菜单项 → 窗口”“按钮/事件 → 窗口”“全局函数 → 窗口”“内嵌用户对象”静态边计算可达性。', '',
         '## 启动流程', '']
    apl = [k for k in P['objs'] if k.endswith('.apl')]
    L.append('- 应用对象 %s 的 open 事件：读取 `rhzw8.ini`，检查加密狗/注册（`f_check_usbid`、`w_login_ts`），再打开主框架 `w_frame`（MDI）。' % '、'.join('`%s`' % a for a in apl))
    L.append('- `w_frame` 的 open 事件把标题设为软件名，打开登录窗口 `w_login`（OEM 版为 `w_login_oem`）。')
    if 'w_login' in P['windows']:
        for c in P['windows']['w_login']['controls']:
            tg = []
            for ev, code in c['code'].items():
                tg += resolve_targets(P, code)
            if tg:
                L.append('- 登录窗口按钮「%s」→ %s' % (md_escape(clean_label(ctrl_text(c))) or c['name'], '、'.join(wref(P, x) for x in dict.fromkeys(tg))))
    L.append('')
    for bn in bench:
        L += ['## 工作台 %s' % wref(P, bn), '',
              '图标式导航首页（sheet）。图标是图片（文字画在图里），下面按控件列出点击后打开的窗口：', '']
        def walkb(cs, d=0):
            for c in cs:
                tg = []
                for ev, code in c['code'].items():
                    if ev in ('clicked', 'doubleclicked'):
                        tg += resolve_targets(P, code)
                label = md_escape(clean_label(ctrl_text(c)))
                if c['name'].startswith('tabpage') or c['type'] == 'tab':
                    L.append('%s- %s `%s`' % ('  ' * d, '标签页' if c['name'].startswith('tabpage') else '标签控件', c['name']))
                elif tg:
                    L.append('%s- %s `%s` → %s' % ('  ' * d, '图标（%s）' % label if c['type'] == 'picture' else '文字「%s」' % label, c['name'], '、'.join(wref(P, x) for x in dict.fromkeys(tg))))
                walkb(c.get('children', []), d + 1)
        walkb(P['windows'][bn]['controls'])
        L.append('')
    unreachable = sorted(n for n in DOC if n not in reach)
    inh_used = {w['inherit'] for w in list(P['windows'].values()) + list(P['udos'].values())}
    L += ['## 统计', '', '- 本程序独有窗口 %d 个，静态可达 %d 个，未发现静态入口 %d 个。' % (len(DOC), len(DOC) - len(unreachable), len(unreachable)), '',
          '## 未发现静态入口的窗口', '', '可能原因：字符串拼接后动态打开、由其他 EXE 打开、作为祖先被继承、或历史残留。', '']
    for n in unreachable:
        L.append('- %s%s' % (wref(P, n), '（被继承的祖先窗口）' if n in inh_used else ''))
    open(os.path.join(pdir, 'navigation.md'), 'w', encoding='utf-8').write('\n'.join(L))
    # rules.md
    L = ['# %s — 业务规则与提示语（按窗口）' % uname, '',
         '从 MessageBox 调用提取。“条件”取提示语之前最近的 if 条件，是静态近似；嵌套分支需对照源码复核。这类提示通常表示操作被阻止或需要用户确认。', '']
    rule_count = 0
    for mod, ws in sorted(groups.items()):
        block = []
        for w in ws:
            msgs, seen = [], set()
            for src, a in win_actions(w).items():
                for m in a['msgs']:
                    k = (m['text'], m['cond'])
                    if k in seen: continue
                    seen.add(k)
                    msgs.append('- 「%s」%s <sub>%s</sub>' % (md_escape(m['text'])[:200], '　条件：`%s`' % md_escape(m['cond']).replace('`', "'")[:160] if m['cond'] else '', md_escape(src)))
            if msgs:
                rule_count += len(msgs)
                block += ['### %s' % wref(P, w['name']), ''] + msgs + ['']
        if block:
            L += ['## %s' % MODULE_TITLE.get(mod, mod), ''] + block
    fblock = []
    for fn, f in sorted(P['funcs'].items()):
        if f['code']['msgs']:
            fblock += ['### 全局函数 `%s`' % fn, '']
            for m in f['code']['msgs']:
                fblock.append('- 「%s」%s' % (md_escape(m['text'])[:200], '　条件：`%s`' % md_escape(m['cond']).replace('`', "'")[:160] if m['cond'] else ''))
                rule_count += 1
            fblock.append('')
    if fblock:
        L += ['## 全局函数中的提示', ''] + fblock
    open(os.path.join(pdir, 'rules.md'), 'w', encoding='utf-8').write('\n'.join(L))
    # README
    L = ['# %s（原版静态分析）' % uname, '',
         '- 安装包：`%s`；程序：`%s.exe`（%s）；库加载顺序：%s' % (setup, prog, PROGRAM_LABEL.get(prog, prog), '、'.join(libs)),
         '- 本程序加载对象：窗口 %d（本文档收录本程序独有 %d）、用户对象 %d、菜单对象 %d、全局函数 %d' % (len(P['windows']), len(DOC), len(P['udos']), len(P['menus']), len(P['funcs'])),
         '- 主菜单有效菜单项（不含分隔线）%d 个，其中默认隐藏 %d 个。' % (count_items(mainmenu), count_items(mainmenu, lambda i: not i.get('visible', True))),
         '', '## 文档', '',
         '- [menus.md](menus.md)：菜单结构（主菜单、各窗口菜单、右键菜单）',
         '- [navigation.md](navigation.md)：启动流程、工作台、可达性',
         '- [rules.md](rules.md)：业务规则与提示语（%d 条）' % rule_count,
         '- 窗口目录（按模块）：', '']
    for mod, n, rn, resp in sorted(mod_rows, key=lambda x: -x[1]):
        L.append('  - [%s](windows/%s.md)：%d 个窗口（静态可达 %d，对话框 %d）' % (MODULE_TITLE.get(mod, mod), mod, n, rn, resp))
    L += ['  - [用户对象](windows/_userobjects.md)', '']
    for fm in frame_menus:
        L += ['## 主菜单概览：%s（`%s`，默认可见项）' % (SUBSYS.get(fm, fm) if unit == 'main' or fm != 'm_frame_zw' else '本程序主菜单（同名覆盖）', fm), '']
        for it in P['menus'][fm]['items']:
            if not it.get('visible', True): continue
            subs = [md_escape(clean_label(c.get('text'))) for c in it.get('children', []) if clean_label(c.get('text')) not in ('-', '') and c.get('visible', True)]
            L.append('- **%s**：%s' % (md_escape(clean_label(it.get('text'))), '、'.join(subs)))
        L.append('')
    open(os.path.join(pdir, 'README.md'), 'w', encoding='utf-8').write('\n'.join(L))
    # JSON
    all_json['menus'][pid + '/' + unit] = {mn: {'inherit': m['inherit'], 'library': m['library'], 'program': m['program'],
                                   'used_by_windows': sorted(users_of.get(mn, [])), 'items': jmenu(P, m['items'])}
                              for mn, m in sorted(P['menus'].items())}
    jw = {}
    for nm, w in sorted(list(DOC.items()) + ([] if unit != 'main' else list(P['udos'].items()))):
        jw[nm] = {'kind': w['kind'], 'title': wtitle(w), 'module': module_of(w) if w['kind'] == 'win' else 'userobject',
                  'inherit': w['inherit'], 'library': w['library'], 'program': w['program'], 'reachable': nm in reach,
                  'opened_from': summarize_sources(rev.get(nm, [])),
                  'props': {k: v for k, v in w['props'].items() if k in ('title', 'width', 'height', 'windowtype', 'menuname', 'x', 'y', 'resizable', 'center')},
                  'events': jevents(P, w['code']), 'controls': jctrl(P, w['controls'])}
    all_json['windows'][pid + '/' + unit] = jw
    summary[pid + '/' + unit] = {'name': uname, 'program': prog, 'windows': len(DOC), 'userobjects': len(P['udos']), 'menus': len(P['menus']),
                    'functions': len(P['funcs']), 'datawindows': len(dwi), 'main_menu_items': count_items(mainmenu),
                    'main_menu_hidden': count_items(mainmenu, lambda i: not i.get('visible', True)),
                    'reachable_windows': len(DOC) - len(unreachable), 'rules': rule_count,
                    'modules': {m: n for m, n, _, _ in mod_rows}}
    print(pid, unit, json.dumps(summary[pid + '/' + unit], ensure_ascii=False))


def main():
    os.makedirs(OUT, exist_ok=True)
    dwdata = json.load(open(os.path.join(DWDIR, 'datawindows-compact.json'), encoding='utf-8'))
    summary, all_json = {}, {'menus': {}, 'windows': {}}
    for pid, pname, setup, programs in PRODUCTS:
        main_libs = None
        for prog in programs:
            P = build(pid, prog)
            libs = [f['name'] for f in json.load(open(os.path.join(EX, pid, prog, 'project.json'), encoding='utf-8'))['files']]
            if main_libs is None:
                main_libs = set(libs); own = set(libs); unit = 'main'
            else:
                own = set(libs) - main_libs; unit = 'cn' if 'cn' in prog else 'fp'
                if unit == 'cn' and pid != 'qingsong':
                    continue  # 三套产品的出纳模块二进制完全相同，只在 qingsong/cn 输出一次
            SMALL.clear()
            cnt = collections.Counter(w['name'].split('_')[1] if '_' in w['name'] else 'other' for w in P['windows'].values() if w['library'] in own)
            SMALL.update(k for k, v in cnt.items() if v <= 2)
            MENU_TITLE.clear()
            render_unit(pid, '%s · %s' % (pname, PROGRAM_LABEL.get(prog, prog)), setup, unit, prog, P, own, libs, dwdata, summary, all_json)
    jdir = os.path.join(OUT, 'json')
    os.makedirs(jdir, exist_ok=True)
    for k, v in all_json.items():
        json.dump(v, open(os.path.join(jdir, k + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    json.dump(summary, open(os.path.join(jdir, 'summary.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


main()
