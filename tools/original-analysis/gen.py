# -*- coding: utf-8 -*-
"""从 PbdViewer 导出的 libraries/*.json 生成原版结构说明（菜单、窗口、导航、规则、数据）。"""
import json, os, re, sys, collections

W = sys.argv[1]            # pbwork 根目录
DWDIR = sys.argv[2]        # GPT datawindow-analysis 目录
OUT = sys.argv[3]          # 输出 docs/original-analysis
EX = os.path.join(W, 'ex')

PRODUCTS = [
    ('qingsong', '轻松会计', 'qingsong-kuaiji-setup', ['run_zw8', 'rhzw9_cn0', 'rhzw9_fp0']),
    ('minfeiqi', '民非企', 'minfeiqi-setup', ['rhzw8_mfq', 'rhzw9_cn0']),
    ('chengben', '成本会计', 'chengben-kuaiji-setup', ['rhzw8_cb', 'rhzw9_cn0', 'rhzw9_fp0']),
]
PROGRAM_LABEL = {
    'run_zw8': '账务主程序', 'rhzw8_mfq': '账务主程序（民非专版）', 'rhzw8_cb': '账务+成本主程序',
    'rhzw9_cn0': '出纳模块', 'rhzw9_fp0': '发票/进销存模块',
}

CTRL_LABEL = {
    'commandbutton': '按钮', 'picturebutton': '图片按钮', 'datawindow': '数据窗口', 'singlelineedit': '单行输入',
    'editmask': '格式输入', 'multilineedit': '多行输入', 'dropdownlistbox': '下拉列表', 'dropdownpicturelistbox': '图片下拉',
    'statictext': '静态文本', 'checkbox': '复选框', 'radiobutton': '单选按钮', 'groupbox': '分组框', 'treeview': '树',
    'listview': '列表视图', 'listbox': '列表框', 'tab': '标签页容器', 'userobject': '用户对象', 'picture': '图片',
    'hscrollbar': '横向滚动条', 'vscrollbar': '纵向滚动条', 'line': '线', 'rectangle': '矩形', 'oval': '椭圆',
    'roundrectangle': '圆角矩形', 'mdiclient': 'MDI 客户区', 'olecontrol': 'OLE 控件', 'statichyperlink': '超链接',
    'picturehyperlink': '图片超链接', 'datepicker': '日期选择', 'monthcalendar': '月历', 'hprogressbar': '进度条',
    'vprogressbar': '进度条', 'htrackbar': '滑块', 'vtrackbar': '滑块', 'richtextedit': '富文本', 'graph': '图表',
    'tabpage': '标签页', 'dropdownmenu': '下拉菜单',
}
WINTYPE = {'main!': '主窗口', 'response!': '模态对话框', 'child!': '子窗口', 'popup!': '弹出窗口',
           'mdi!': 'MDI 框架', 'mdihelp!': 'MDI 框架(带状态栏)'}

# 模块前缀（按对象命名的第二段归类，中文名由窗口标题人工归纳）
MODULE_LABEL = {
    'xt': '系统设置与初始化', 'pz': '凭证', 'zw': '账务与账簿查询', 'zc': '账册打印/输出', 'bb': '报表',
    'fx': '财务分析', 'ht': '辅助核算/往来', 'cn': '出纳', 'fp': '发票', 'gz': '工资', 'zcgl': '固定资产',
    'zjgl': '固定资产折旧', 'cb': '成本', 'jxc': '进销存', 'kc': '库存', 'login': '登录', 'main': '主界面',
    'frame': '主框架', 'preview': '打印预览', 'print': '打印', 'get': '数据取数/导入', 'sj': '数据维护',
}

VK = {8: 'Backspace', 9: 'Tab', 13: 'Enter', 27: 'Esc', 32: 'Space', 33: 'PgUp', 34: 'PgDn', 35: 'End', 36: 'Home',
      37: '←', 38: '↑', 39: '→', 40: '↓', 45: 'Insert', 46: 'Delete'}


def shortcut_text(v):
    try:
        v = int(v)
    except Exception:
        return ''
    if v <= 0:
        return ''
    key = v & 0xFF
    mods = []
    if v & 0x100: mods.append('Ctrl')
    if v & 0x400: mods.append('Shift')
    if v & 0x200: mods.append('Alt')
    if 112 <= key <= 135: k = 'F%d' % (key - 111)
    elif 48 <= key <= 57 or 65 <= key <= 90: k = chr(key)
    else: k = VK.get(key, 'VK%d' % key)
    return '+'.join(mods + [k])


PROP_RE = re.compile(r'^\s*(?:\w+\s+)?(\w+)\s+(\w+)\s*=\s*(.*?)\s*$')
ASSIGN_RE = re.compile(r'^\s*this\.(\w+)\s*=\s*(.*?)\s*$')


def unq(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
        return v[1:-1].replace('~"', '"').replace('~r~n', '\n').replace('~n', '\n').replace('~t', '\t')
    return v


def parse_props(text):
    props = collections.OrderedDict()
    for line in (text or '').splitlines():
        m = PROP_RE.match(line)
        if m:
            props[m.group(2)] = unq(m.group(3))
    return props


def child(node, name):
    for c in node.get('children', []):
        if c['name'] == name:
            return c
    return None


def events_of(node):
    ev = collections.OrderedDict()
    for dname in ('events', 'functions'):
        d = child(node, dname)
        if d:
            for c in d['children']:
                ev[(dname, c['name'])] = c.get('text') or ''
    return ev


# ---------- 代码动作抽取 ----------
OPEN_RE = re.compile(r'\b(open|opensheet|openwithparm|opensheetwithparm|openuserobject|openuserobjectwithparm)\s*\(\s*([A-Za-z_]\w*)\s*(?:,\s*("([^"]*)"|[^,)]*))?', re.I)
STRWIN_RE = re.compile(r'"((?:w|uo|n)_[A-Za-z0-9_]+)"')
RUN_RE = re.compile(r'\brun\s*\(\s*(?:"([^"]+)"|([^,)]+))', re.I)
DWO_RE = re.compile(r'\.dataobject\s*=\s*"([^"]+)"', re.I)
MSG_RE = re.compile(r'messagebox\s*\(\s*("(?:[^"~]|~.)*"|[^,]+)\s*,\s*((?:"(?:[^"~]|~.)*"\s*\+?\s*|[\w.()]+\s*\+?\s*)+)', re.I)
FUNC_RE = re.compile(r'\b(f_\w+)\s*\(', re.I)
SQL_START = re.compile(r'^\s*(select|insert\s+into|update|delete|declare\s+\S+\s+cursor|execute\s+immediate|commit|rollback)\b', re.I)
TABLE_RE = re.compile(r'\b(?:from|join|into|update|delete\s+from|delete)\s+([A-Za-z_][\w]*)', re.I)
IF_RE = re.compile(r'^\s*(?:else\s*)?if\b(.*)\bthen\b', re.I)


def literal_concat(s):
    parts = re.findall(r'"((?:[^"~]|~.)*)"', s)
    return ''.join(unq('"' + p + '"') for p in parts)


def analyse_code(text):
    r = {'opens': [], 'dyn': [], 'run': [], 'dwo': [], 'msgs': [], 'funcs': [], 'sql_tables': set(), 'sql': []}
    if not text:
        return r
    lines = text.splitlines()
    for i, line in enumerate(lines):
        for m in OPEN_RE.finditer(line):
            tgt = m.group(2)
            parm = m.group(4)
            r['opens'].append({'kind': m.group(1).lower(), 'target': tgt, 'parm': parm})
        for m in STRWIN_RE.finditer(line):
            r['dyn'].append(m.group(1))
        for m in RUN_RE.finditer(line):
            r['run'].append((m.group(1) or m.group(2) or '').strip())
        for m in DWO_RE.finditer(line):
            r['dwo'].append(m.group(1))
        for m in MSG_RE.finditer(line):
            title = literal_concat(m.group(1)) or m.group(1).strip()
            body = literal_concat(m.group(2))
            if not body:
                continue
            cond = ''
            for j in range(i - 1, max(-1, i - 8), -1):
                mm = IF_RE.match(lines[j])
                if mm:
                    cond = mm.group(1).strip()
                    break
            r['msgs'].append({'title': title, 'text': body, 'cond': cond})
        for m in FUNC_RE.finditer(line):
            r['funcs'].append(m.group(1).lower())
        if SQL_START.match(line):
            stmt = [line.strip()]
            j = i + 1
            while j < len(lines) and ';' not in stmt[-1] and j < i + 30:
                stmt.append(lines[j].strip()); j += 1
            s = ' '.join(stmt)
            r['sql'].append(s[:400])
            for t in TABLE_RE.findall(s):
                if t.lower() not in ('sqlca', 'dual', 'this', 'parent', 'and', 'or', 'where', 'set', 'select', 'values', ':'):
                    r['sql_tables'].add(t.lower())
    return r


# ---------- 读取导出 ----------
def load_program(pid, prog):
    """按 project.json 中的库顺序加载（PB 按库列表顺序解析同名对象，先到先得）。"""
    objs = {}
    base = os.path.join(EX, pid, prog)
    proj = json.load(open(os.path.join(base, 'project.json'), encoding='utf-8'))
    for f in proj['files']:
        d = json.load(open(os.path.join(base, f['json_path']), encoding='utf-8'))
        lib = f['name']
        for e in d['entries']:
            if e['status'] != 'exported':
                continue
            key = e['name']
            if key in objs:
                objs[key].setdefault('shadowed', []).append(lib)
                continue
            types = {o['name']: o for o in e.get('objects') or []}
            objs[key] = {'entry': key, 'suffix': e['suffix'], 'library': lib, 'program': prog, 'programs': {prog},
                         'node': e.get('node'), 'types': types, 'entry_object': e.get('entry_object')}
    return objs


def inherit_of(rec):
    eo = rec['types'].get(rec['entry_object'] or '')
    if not eo:
        return None
    return eo.get('inherit_type')


# ---------- 菜单 ----------
def menu_items(node, types, path=''):
    """返回 [(name, item)]，按 create 中 item[] 赋值顺序。"""
    ctrls = child(node, 'controls')
    evs = events_of(node)
    create = evs.get(('events', 'create'), '')
    order = re.findall(r'this\.item\[[^\]]*\]\s*=\s*this\.(\w+)', create)
    found = {}
    if ctrls:
        for c in ctrls['children']:
            nm = c['name'].split('(')[0]
            found[nm] = c
    names = order + [n for n in found if n not in order]
    items = []
    for nm in names:
        c = found.get(nm)
        if c is None:
            items.append({'name': nm, 'declared_in_ancestor': True, 'children': []})
            continue
        ev = events_of(c)
        props = {}
        for line in ev.get(('events', 'create'), '').splitlines():
            m = ASSIGN_RE.match(line)
            if m:
                props[m.group(1)] = unq(m.group(2))
        clicked = ev.get(('events', 'clicked'), '').strip()
        item = {'name': nm, 'props': props, 'clicked_code': clicked, 'children': menu_items(c, types)}
        items.append(item)
    return items


def merge_menu(base, over):
    """把后代菜单项覆盖到祖先菜单项上（按名称）；只覆盖后代显式设置的属性。"""
    res = []
    idx = {i['name']: i for i in over}
    used = set()
    for b in base:
        o = idx.get(b['name'])
        if o:
            used.add(b['name'])
            m = dict(b)
            if not o.get('declared_in_ancestor'):
                p = dict(b.get('props', {})); p.update(o.get('props', {})); m['props'] = p
                if o.get('clicked_code'):
                    m['clicked_code'] = o['clicked_code']
                    m['overridden_clicked'] = True
            m['children'] = merge_menu(b.get('children', []), o.get('children', []))
            res.append(m)
        else:
            res.append(b)
    new = [dict(o, added_in_descendant=bool(base)) for o in over if o['name'] not in used and not o.get('declared_in_ancestor')]
    # PB：祖先中 shifttoright 的项排在后代新增项之后
    if new and base:
        k = next((i for i, b in enumerate(res) if b.get('props', {}).get('shifttoright') == 'true'), len(res))
        res = res[:k] + new + res[k:]
    elif new:
        res = res + new
    return res


def clear_flags(items):
    return [dict(i, added_in_descendant=False, overridden_clicked=False, children=clear_flags(i.get('children', []))) for i in items]


def finalize_menu(items):
    for it in items:
        p = it.get('props', {})
        it['text'] = p.get('text', '')
        it['tag'] = p.get('tag', '')
        it['shortcut'] = shortcut_text(p.get('shortcut', '0'))
        it['visible'] = p.get('visible', 'true') != 'false'
        it['enabled'] = p.get('enabled', 'true') != 'false'
        it['toolbar_text'] = p.get('toolbaritemtext', '')
        it['toolbar_image'] = p.get('toolbaritemname', '')
        it['toolbar_visible'] = bool(p.get('toolbaritemname')) and p.get('toolbaritemvisible', 'true') != 'false'
        it['microhelp'] = p.get('microhelp', '')
        it['code'] = analyse_code(it.get('clicked_code', ''))
        finalize_menu(it.get('children', []))
    return items


# ---------- 窗口/用户对象 ----------
def controls_of(node, types, depth=0):
    ctrls = child(node, 'controls')
    out = []
    if not ctrls:
        return out
    for c in ctrls['children']:
        nm = c['name'].split('(')[0]
        t = types.get(nm, {})
        props = parse_props((child(c, 'properties') or {}).get('text'))
        ev = events_of(c)
        evc = {k[1]: analyse_code(v) for k, v in ev.items()}
        out.append({'name': nm, 'type': t.get('inherit_type') or '', 'props': props,
                    'events': {k[1]: v.strip() for k, v in ev.items() if k[1] not in ('create', 'destroy')},
                    'code': evc, 'children': controls_of(c, types, depth + 1)})
    return out


def merge_controls(base, over):
    if not base:
        return over
    idx = {c['name']: c for c in over}
    res = []
    for b in base:
        o = idx.pop(b['name'], None)
        if o:
            m = dict(b)
            p = dict(b['props']); p.update(o['props']); m['props'] = p
            ev = dict(b['events']); ev.update(o['events']); m['events'] = ev
            cd = dict(b['code']); cd.update(o['code']); m['code'] = cd
            if o['type'] and '`' not in o['type']: m['type'] = o['type']
            m['children'] = merge_controls(b.get('children', []), o.get('children', []))
            res.append(m)
        else:
            res.append(b)
    res.extend(idx.values())
    return res


def build(pid, prog):
    objs = load_program(pid, prog)
    windows, menus, udos, funcs = {}, {}, {}, {}
    for key, rec in objs.items():
        nm = key.rsplit('.', 1)[0]
        node = rec['node']
        if node is None:
            continue
        inh = inherit_of(rec)
        if rec['suffix'] in ('win', 'udo'):
            props = parse_props((child(node, 'properties') or {}).get('text'))
            ev = events_of(node)
            w = {'name': nm, 'kind': rec['suffix'], 'library': rec['library'], 'program': rec['program'],
                 'programs': sorted(rec['programs']), 'inherit': inh, 'props': props, 'own_title': props.get('title', ''),
                 'controls': controls_of(node, rec['types']),
                 'events': {'%s:%s' % k: v.strip() for k, v in ev.items() if k[1] not in ('create', 'destroy')},
                 'code': {'%s:%s' % k: analyse_code(v) for k, v in ev.items()}}
            (windows if rec['suffix'] == 'win' else udos)[nm] = w
        elif rec['suffix'] == 'men':
            menus[nm] = {'name': nm, 'library': rec['library'], 'program': rec['program'],
                         'programs': sorted(rec['programs']), 'inherit': inh,
                         'own_items': menu_items(node, rec['types'])}
        elif rec['suffix'] == 'fun':
            ev = events_of(node)
            txt = '\n'.join(ev.values())
            funcs[nm] = {'name': nm, 'library': rec['library'], 'code': analyse_code(txt)}
    # 继承合并
    def resolve_menu(nm, seen=()):
        m = menus[nm]
        if 'items' in m:
            return m['items']
        base = []
        if m['inherit'] in menus and m['inherit'] not in seen:
            base = clear_flags(resolve_menu(m['inherit'], seen + (nm,)))
        m['items'] = finalize_menu(merge_menu(base, m['own_items']))
        return m['items']
    for nm in menus:
        resolve_menu(nm)

    pool = dict(windows); pool.update(udos)
    def resolve_win(nm, seen=()):
        w = pool[nm]
        if w.get('_resolved'):
            return w
        if w['inherit'] in pool and w['inherit'] not in seen:
            b = resolve_win(w['inherit'], seen + (nm,))
            w['anc_title'] = b['props'].get('title', '')
            p = dict(b['props']); p.update(w['props']); w['props'] = p
            w['controls'] = merge_controls(b['controls'], w['controls'])
            ev = dict(b['events']); ev.update(w['events']); w['events'] = ev
            cd = dict(b['code']); cd.update(w['code']); w['code'] = cd
        w['_resolved'] = True
        return w
    for nm in pool:
        resolve_win(nm)
    return {'windows': windows, 'menus': menus, 'udos': udos, 'funcs': funcs, 'objs': objs}


# ---------- 汇总一个窗口的动作 ----------
def win_actions(w):
    acts = collections.OrderedDict()
    def add(src, code):
        if not code: return
        a = acts.setdefault(src, {'opens': [], 'run': [], 'dwo': [], 'msgs': [], 'funcs': [], 'sql_tables': set(), 'dyn': []})
        for o in code['opens']: a['opens'].append(o)
        a['run'] += code['run']; a['dwo'] += code['dwo']; a['msgs'] += code['msgs']; a['funcs'] += code['funcs']
        a['sql_tables'] |= set(code['sql_tables']); a['dyn'] += code['dyn']
    for k, c in w['code'].items():
        add('窗口事件 ' + k.split(':', 1)[1], c)
    def walk(ctrls, prefix=''):
        for c in ctrls:
            for ev, code in c['code'].items():
                if ev in ('create', 'destroy'): continue
                add('%s%s.%s' % (prefix, c['name'], ev), code)
            walk(c.get('children', []), prefix + c['name'] + '/')
    walk(w['controls'])
    return acts


def ctrl_text(c):
    p = c['props']
    for k in ('text', 'title', 'picturename', 'tag'):
        if p.get(k):
            return p[k] if k != 'tag' else ''
    return ''


def all_menu_items(items, path=()):
    for it in items:
        label = it.get('text') or it['name']
        yield path + (label,), it
        yield from all_menu_items(it.get('children', []), path + (label,))


def clean_label(s):
    return (s or '').replace('&', '').replace('\t', ' ').strip()


def md_escape(s):
    return (s or '').replace('|', '\\|').replace('\n', ' ').strip()
