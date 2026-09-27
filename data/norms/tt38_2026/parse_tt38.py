"""TT 38/2026 norm table parser v2 (PyMuPDF find_tables + word geometry)."""
import re, sys, csv, json, collections, unicodedata
import pymupdf

CODE_RE = re.compile(r'^[A-Z]{2}\.\d{2,5}[a-z]?$')
NUM_RE = re.compile(r'^-?(\d+(,\d+)?|\d{1,3}(\.\d{3})+(,\d+)?)$')
SYM = {'': '≤', '': '≥', '': '×', '': '±', '': 'Ø', '': 'Φ'}
CATS = ('vật liệu', 'máy thi công', 'máy', 'vật liệu:', 'máy thi công:', 'thiết bị', 'máy và thiết bị thi công')


def fix(s):
    if s is None:
        return ''
    for k, v in SYM.items():
        s = s.replace(k, v)
    return tone_fix(s).strip()


VOW = set('aăâeêioôơuưyAĂÂEÊIOÔƠUƯY')
MARKS = {'\u0300', '\u0301', '\u0303', '\u0309', '\u0323'}


def tone_fix(s):
    d = list(unicodedata.normalize('NFD', s))
    out = []
    for ch in d:
        if ch in MARKS and out:
            # find base char this mark should attach to: nearest vowel going back over consonants/spaces (max 2)
            j = len(out) - 1
            base = lambda c: unicodedata.normalize('NFD', c)[0]
            k = j
            steps = 0
            while k >= 0 and steps < 3 and not (base(out[k]) in VOW or out[k] in MARKS or unicodedata.combining(out[k])):
                k -= 1; steps += 1
            if k >= 0 and k != j and (base(out[k]) in VOW or unicodedata.combining(out[k])):
                # insert after vowel (and after its modifier marks)
                ins = k + 1
                while ins < len(out) and unicodedata.combining(out[ins]):
                    ins += 1
                out.insert(ins, ch)
                continue
        out.append(ch)
    t = unicodedata.normalize('NFC', ''.join(out))
    return re.sub(r'(\w) (?=[^\s\w])', r'\1', t) if False else t


def num(t):
    t = t.strip()
    if not NUM_RE.match(t):
        return None
    return float(t.replace('.', '').replace(',', '.'))


def words_in(page_words, bbox):
    x0, y0, x1, y1 = bbox
    out = [w for w in page_words if w[0] >= x0 - 1 and w[2] <= x1 + 1 and w[1] >= y0 - 1 and w[3] <= y1 + 1]
    return sorted(out, key=lambda w: ((w[1] + w[3]) / 2, w[0]))


def group_lines(ws, tol=3.5):
    lines = []
    for w in sorted(ws, key=lambda w: ((w[1] + w[3]) / 2, w[0])):
        yc = (w[1] + w[3]) / 2
        if lines and abs(lines[-1]['y'] - yc) < tol:
            lines[-1]['w'].append(w)
        else:
            lines.append({'y': yc, 'w': [w]})
    for L in lines:
        L['w'].sort(key=lambda w: w[0])
        L['t'] = fix(' '.join(w[4] for w in L['w']))
    return lines


def parse(path, book):
    doc = pymupdf.open(path)
    norms, res, warns = [], [], []
    last_sect = ('', '')
    unit_cur = ''
    labor_cur = [None, '']
    for pi in range(doc.page_count):
        page = doc[pi]
        pw = page.get_text('words')
        # headings & unit lines outside tables, in reading order with table positions
        try:
            tabs = page.find_tables().tables
        except Exception as e:
            warns.append((pi + 1, 'find_tables error ' + str(e)))
            tabs = []
        events = []
        for L in group_lines([w for w in pw if w[1] > 40]):
            events.append((L['y'], 'line', L))
        for t in tabs:
            events.append((t.bbox[1], 'table', t))
        events.sort(key=lambda e: e[0])
        tab_boxes = [t.bbox for t in tabs]
        for y, kind, obj in events:
            if kind == 'line':
                if any(b[1] - 1 <= y <= b[3] + 1 for b in tab_boxes):
                    continue
                t = obj['t']
                m = re.match(r'^([A-Z]{2}\.\d{4,5})\s+(.+)$', t)
                if m and obj['w'][0][0] < 120:
                    last_sect = (m.group(1), m.group(2).strip())
                mu = re.search(r'Đơn vị tính\s*:\s*(.+)$', t)
                if mu:
                    unit_cur = mu.group(1).strip()
                ml = re.match(r'^(Nhân công nhóm \d+)\s*$', t)
                if ml:
                    labor_cur[0] = ml.group(1)
                    labor_cur[1] = last_sect[0].rstrip('0') if last_sect[0] else ''
                if m and obj['w'][0][0] < 120 and labor_cur[0] and not m.group(1).startswith(labor_cur[1] or '#'):
                    labor_cur[0] = None
            else:
                try:
                    parse_table(obj, pw, last_sect, unit_cur, pi + 1, book, norms, res, warns, labor_cur[0])
                except Exception as e:
                    warns.append((pi + 1, 'table error ' + repr(e)))
    return norms, res, warns


def parse_table(t, pw, sect, unit, page, book, norms, res, warns, labor=None):
    rows = t.rows
    data = t.extract()
    if not data or len(data[0]) < 3:
        return
    ncol = len(data[0])
    # find data rows (col0 has a code) and suffix rows
    code_rows = [i for i, r in enumerate(data) if r[0] and any(CODE_RE.match(fix(x)) for x in fix(r[0]).split())]
    if not code_rows:
        return
    first_data = code_rows[0]
    # value columns start at index 4 typically (Mã, Công tác, Thành phần, Đơn vị)
    hdr = data[:first_data]
    unit_idx = None
    res_idx = 2
    for c in range(1, min(5, ncol)):
        col_txt = ' '.join(fix(r[c]) for r in hdr if r[c]).lower()
        if col_txt.startswith('đơn vị') or col_txt == 'đơn vị' or col_txt.startswith('đơn'):
            unit_idx = c; break
        if 'thành' in col_txt and 'phần' in col_txt:
            res_idx = c
    has_res = any('thành' in ' '.join(fix(r[c]) for r in hdr if r[c]).lower() for c in range(1, min(5, ncol)))
    if not unit_idx and not has_res:
        return parse_matrix(t, data, pw, code_rows, sect, unit, page, book, norms, res, warns, labor)
    vstart = (unit_idx + 1) if unit_idx else res_idx + 1
    # variant labels with horizontal span inheritance
    var = []
    for c in range(vstart, ncol):
        parts = []
        for r in hdr:
            cc = c
            while cc >= vstart and r[cc] is None:
                cc -= 1
            txt = fix(r[cc]) if cc >= vstart and r[cc] else ''
            txt = ' '.join(txt.split())
            if txt and (not parts or parts[-1] != txt):
                parts.append(txt)
        var.append(' – '.join(parts))
    for ri in code_rows:
        # suffix row = next row whose value cells are all 1-3 digit ints
        suf = None
        for rj in range(ri + 1, len(data)):
            vals = [fix(x) for x in data[rj][vstart:]]
            if vals and all(re.match(r'^\d{1,3}$', v) for v in vals if v) and any(vals) and not (data[rj][0] and CODE_RE.match(fix(data[rj][0]).split()[0] if fix(data[rj][0]) else '')):
                suf = vals
                break
        if not suf:
            warns.append((page, 'no suffix row'))
            continue
        prefixes = list(dict.fromkeys(p for p in fix(data[ri][0]).split() if CODE_RE.match(p)))
        # map columns -> prefix via restart rule
        colpref = []
        pidx = 0
        prev = None
        for s in suf:
            if not s:
                colpref.append(None); continue
            if prev is not None and int(s) <= prev and pidx < len(prefixes) - 1:
                pidx += 1
            colpref.append(prefixes[pidx])
            prev = int(s)
        cells = rows[ri].cells
        def cw(ci):
            b = cells[ci]
            return words_in(pw, b) if b else []
        rowblock = len(prefixes) > 1 and pidx != len(prefixes) - 1
        pref_y = []
        if rowblock:
            # each prefix owns the resource lines from its y down to the next prefix
            for L in group_lines(cw(0)):
                for tok in L['t'].split():
                    if CODE_RE.match(tok) and tok not in [p for _, p in pref_y]:
                        pref_y.append((L['y'], tok))
            if len(pref_y) != len(prefixes):
                warns.append((page, f'rowblock prefix geometry mismatch {prefixes}'))
        work = ' '.join(fix(data[ri][1] or '').split())
        work_lines = group_lines(cw(1)) if len(cells) > 1 and cells[1] else []
        name_lines = group_lines(cw(res_idx))
        unit_lines = group_lines(cw(unit_idx)) if unit_idx else []
        # resource anchors = unit lines
        anchors = [{'y': L['y'], 'unit': L['t'], 'name': [], 'cat': None} for L in unit_lines]
        if not unit_idx:
            anchors = [{'y': L['y'], 'unit': 'công' if L['t'].lower().startswith('nhân công') else '', 'name': [], 'cat': None}
                       for L in name_lines if L['t'].lower().strip() not in CATS]
        cat = 'VL'
        cat_marks = []
        for L in name_lines:
            low = L['t'].lower().strip()
            if low in CATS or low.startswith('máy thi công') and len(low) < 16:
                cat_marks.append((L['y'], 'M' if 'máy' in low else 'VL'))
                continue
            if not anchors:
                continue
            # attach to anchor: nearest by y, prefer anchor at or below line start
            a = min(anchors, key=lambda a: abs(a['y'] - L['y']))
            a['name'].append((L['y'], L['t']))
        for a in anchors:
            cm = [c for y, c in cat_marks if y < a['y']]
            a['cat'] = cm[-1] if cm else 'VL'
            a['name'].sort()
            a['nm'] = ' '.join(t for _, t in a['name'])
        # values per column, merging wrapped fragments
        for ci in range(vstart, ncol):
            if ci >= len(cells) or cells[ci] is None:
                continue
            vl = group_lines(cw(ci))
            vals = {}
            for L in vl:
                txt = L['t'].replace(' ', '')
                a = min(anchors, key=lambda a: abs(a['y'] - L['y'])) if anchors else None
                if a is None:
                    continue
                key = id(a)
                vals[key] = (a, vals.get(key, (a, ''))[1] + txt)
            ci_v = ci - vstart
            sfx = suf[ci_v] if ci_v < len(suf) else ''
            if rowblock and pref_y:
                groups = []
                for k, (py, pp) in enumerate(pref_y):
                    ny = pref_y[k + 1][0] if k + 1 < len(pref_y) else 1e9
                    items = [(a, raw) for a, raw in vals.values() if py - 6 <= a['y'] < ny - 6]
                    wl = [x['t'] for x in work_lines if py - 6 <= x['y'] < ny - 6]
                    groups.append((pp, items, ' '.join(wl) or work))
            else:
                pref = colpref[ci_v] if ci_v < len(colpref) else None
                groups = [(pref, list(vals.values()), work)]
            for pref, items, gwork in groups:
                if not pref or not sfx:
                    continue
                emit(pref, sfx, items, gwork, var[ci_v] if ci_v < len(var) else '', sect, unit, page, book, norms, res, warns)


def emit(pref, sfx, items, work, variant, sect, unit, page, book, norms, res, warns):
    if True:
        if True:
            code = pref + sfx
            rl = []
            for a, raw in items:
                v = num(raw)
                if v is None:
                    if raw not in ('', '-'):
                        warns.append((page, f'bad number {code} {a["nm"]} {raw!r}'))
                    continue
                nm = a['nm']
                typ = 'NC' if nm.lower().startswith('nhân công') or a['unit'].lower() == 'công' else ('M' if a['cat'] == 'M' or a['unit'].lower() in ('ca', 'giờ máy') or nm.lower().startswith('máy khác') else 'VL')
                rl.append({'code': code, 'type': typ, 'resource': nm, 'unit': a['unit'], 'qty': v, 'raw': raw, 'page': page})
            if not rl:
                return
            norms.append({'book': book, 'code': code, 'prefix': pref, 'work': work, 'variant': variant,
                          'section': (sect[0] + ' ' + sect[1]).strip(), 'unit': unit, 'page': page})
            res.extend(rl)


def parse_matrix(t, data, pw, code_rows, sect, unit, page, book, norms, res, warns, labor):
    """Labor-only matrix tables: each row line = one prefix, columns = variants."""
    ncol = len(data[0])
    # suffix row: last row with only small ints in right columns
    suf_row = None
    for rj in range(len(data) - 1, -1, -1):
        cells = [fix(x) for x in data[rj]]
        nz = [c for c in cells if c]
        if nz and all(re.match(r'^\d{1,3}$', c) for c in nz):
            suf_row = rj; break
    if suf_row is None:
        warns.append((page, 'matrix: no suffix row')); return
    sufcells = [fix(x) for x in data[suf_row]]
    vcols = [c for c in range(ncol) if re.match(r'^\d{1,3}$', sufcells[c] or '')]
    if not vcols:
        return
    hdr = data[:code_rows[0]]
    var = {}
    for c in vcols:
        parts = []
        for r in hdr:
            cc = c
            while cc >= vcols[0] and r[cc] is None:
                cc -= 1
            txt = ' '.join(fix(r[cc]).split()) if cc >= vcols[0] and r[cc] else ''
            if txt and (not parts or parts[-1] != txt):
                parts.append(txt)
        var[c] = ' – '.join(parts)
    rows = t.rows
    nunit = re.sub(r'^công\s*/\s*', '', unit or '').strip()
    labor_name = labor or 'Nhân công'
    for ri in code_rows:
        cells = rows[ri].cells
        if not cells[0]:
            continue
        pl = [L for L in group_lines(words_in(pw, cells[0])) if CODE_RE.match(L['t'].split()[0])]
        work_cells = [c for c in range(1, vcols[0]) if cells[c]]
        for L in pl:
            pref = L['t'].split()[0]
            y = L['y']
            wparts = []
            for c in work_cells:
                wl = group_lines(words_in(pw, cells[c]))
                near = [x for x in wl if abs(x['y'] - y) < 6]
                if near:
                    wparts.append(near[0]['t'])
            if not wparts:
                w1 = ' '.join(fix(data[ri][1] or '').split())
                if w1:
                    wparts.append(w1)
            for c in vcols:
                if not cells[c]:
                    continue
                vl = group_lines(words_in(pw, cells[c]))
                near = [x for x in vl if abs(x['y'] - y) < 6]
                if not near:
                    continue
                raw = near[0]['t'].replace(' ', '')
                v = num(raw)
                if v is None:
                    continue
                code = pref + sufcells[c]
                norms.append({'book': book, 'code': code, 'prefix': pref, 'work': ' – '.join(wparts), 'variant': var.get(c, ''),
                              'section': (sect[0] + ' ' + sect[1]).strip(), 'unit': nunit, 'page': page})
                res.append({'code': code, 'type': 'NC', 'resource': labor_name, 'unit': 'công', 'qty': v, 'raw': raw, 'page': page})
                if not labor:
                    warns.append((page, f'matrix labor group unknown {code}'))


if __name__ == '__main__':
    path, book, outp = sys.argv[1], sys.argv[2], sys.argv[3]
    n, r, w = parse(path, book)
    with open(outp + '_norms.csv', 'w', newline='', encoding='utf-8') as f:
        wr = csv.DictWriter(f, fieldnames=list(n[0].keys())); wr.writeheader(); wr.writerows(n)
    with open(outp + '_resources.csv', 'w', newline='', encoding='utf-8') as f:
        wr = csv.DictWriter(f, fieldnames=list(r[0].keys())); wr.writeheader(); wr.writerows(r)
    with open(outp + '_warnings.json', 'w', encoding='utf-8') as f:
        json.dump(w, f, ensure_ascii=False, indent=0)
    c = collections.Counter(x['code'] for x in n)
    print(book, 'norms', len(n), 'unique', len(c), 'dups', sum(1 for v in c.values() if v > 1), 'res', len(r), 'warns', len(w))

