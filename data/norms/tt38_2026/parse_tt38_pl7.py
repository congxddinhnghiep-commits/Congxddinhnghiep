"""Parse TT38/2026 PL VII (material usage / mix designs): row-per-code matrix tables."""
import re, csv, json, sys, collections
import pymupdf
sys.path.insert(0, '.')
from parse2 import fix, words_in, group_lines, num

MIX_RE = re.compile(r'^\d{2}\.\d{5}$')


def parse(path):
    doc = pymupdf.open(path)
    out, warns = [], []
    sect = ''
    for pi in range(doc.page_count):
        page = doc[pi]
        pw = page.get_text('words')
        for L in group_lines([w for w in pw if w[1] > 40]):
            m = re.match(r'^(\d{2}\.\d{5})\s+(.+)$', L['t'])
            if m and m.group(1).endswith('00'):
                sect = L['t']
        try:
            tabs = page.find_tables().tables
        except Exception:
            continue
        for t in tabs:
            data = t.extract()
            if not data:
                continue
            code_rows = [i for i, r in enumerate(data) if r[0] and any(MIX_RE.match(x) for x in fix(r[0]).split())]
            if not code_rows:
                continue
            ncol = len(data[0])
            hdr = data[:code_rows[0]]
            labels = []
            for c in range(ncol):
                parts = []
                for r in hdr:
                    if c < len(r) and r[c]:
                        tx = ' '.join(fix(r[c]).split())
                        if tx and tx not in parts:
                            parts.append(tx)
                labels.append(' | '.join(parts))
            for ri in code_rows:
                cells = t.rows[ri].cells
                codes = [(L['y'], L['t'].split()[0]) for L in group_lines(words_in(pw, cells[0])) if MIX_RE.match(L['t'].split()[0])]
                spec = ' '.join(fix(data[ri][1] or '').split()) if ncol > 1 else ''
                for y, code in codes:
                    rec = {'code': code, 'section': sect, 'spec': spec, 'page': pi + 1, 'values': {}}
                    for c in range(2, ncol):
                        if c >= len(cells) or not cells[c]:
                            continue
                        near = [L for L in group_lines(words_in(pw, cells[c])) if abs(L['y'] - y) < 4.5]
                        if near:
                            rec['values'][labels[c] or f'col{c}'] = near[0]['t']
                    out.append(rec)
    return out, warns


if __name__ == '__main__':
    recs, w = parse(sys.argv[1])
    json.dump(recs, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    c = collections.Counter(r['code'] for r in recs)
    print('records', len(recs), 'unique', len(c), 'dups', [k for k, v in c.items() if v > 1][:10])
