import xlrd, re, json, sys
from vni import fix
b=xlrd.open_workbook('real.xls')
def num(v):
    return v if isinstance(v,(int,float)) and v!='' else None
res={}
for s in b.sheets():
    if s.visibility: continue
    # find header rows with 'Khối lượng'/'Số lượng'
    blocks=[]
    for r in range(s.nrows):
        vals=[fix(str(v)) for v in s.row_values(r)]
        t=' '.join(vals)
        if re.search(r'Khối lượng|Số lượng|Khối lượng',t) and re.search(r'Đơn giá|ĐƠN GIÁ',t):
            blocks.append(r)
    if not blocks: continue
    items=[]; cats=[]; totals=[]
    for bi,h in enumerate(blocks):
        end = blocks[bi+1] if bi+1<len(blocks) else s.nrows
        H=[fix(str(v)) for v in s.row_values(h)]
        H2=[fix(str(v)) for v in s.row_values(h+1)]
        col={}
        for c,v in enumerate(H):
            if re.match(r'(?i)stt',v): col['stt']=c
            elif re.search(r'Công việc|Diễn giải|Tên công việc',v) and 'name' not in col: col['name']=c
            elif re.search(r'ĐVT|Đơn vị',v): col['unit']=c
            elif re.search(r'Khối lượng|Số lượng',v): col['qty']=c
            elif re.search(r'(?i)đơn giá',v): col['price']=c
            elif re.search(r'(?i)thành tiền',v): col['tt']=c
        # price subcols from H2
        pc=col.get('price'); sub={}
        for c in range(pc, col.get('tt',pc+3)):
            v=H2[c]
            if re.search(r'Vật liệu|Vật tư',v): sub['vl']=c
            elif re.search(r'Nhân công|人工',v): sub['nc']=c
            elif re.search(r'Tổng|综合|合计',v): sub['th']=c
        cur=None
        for r in range(h+2,end):
            row=s.row_values(r)
            name=fix(str(row[col['name']])).strip()
            stt=str(row[col['stt']]).strip() if 'stt' in col else ''
            unit=fix(str(row[col['unit']])).strip() if 'unit' in col else ''
            q=num(row[col['qty']]); tt=num(row[col['tt']]) if 'tt' in col else None
            g=lambda k: num(row[sub[k]]) if k in sub else None
            if not name and q is None and tt is None: continue
            if re.match(r'(?i)^(tổng|cộng|coäng|toång)',name) or stt=='***':
                totals.append({'row':r+1,'name':name,'tt':tt}); cur=None; continue
            if unit and (q is not None or tt is not None):
                cur={'row':r+1,'stt':stt,'name':name,'unit':unit,'qty':q,'vl':g('vl'),'nc':g('nc'),'th':g('th'),'tt':tt,'detail':[]}
                items.append(cur); continue
            if stt and not unit and q is None:
                cats.append({'row':r+1,'stt':stt,'name':name}); cur=None; continue
            if cur is not None and not stt:
                cur['detail'].append({'row':r+1,'text':name,'qty':q}); continue
            cats.append({'row':r+1,'stt':stt,'name':name,'note':'unclassified','tt':tt})
    sumtt=sum(i['tt'] or 0 for i in items)
    res[s.name]={'blocks':[h+1 for h in blocks],'items':len(items),'cats':len(cats),'sum_tt':round(sumtt),'totals':[(t['row'],t['name'][:25],round(t['tt'] or 0)) for t in totals],'_items':items,'_cats':cats}
    print(repr(s.name),'blocks',res[s.name]['blocks'],'items',len(items),'cats',len(cats),'sum',round(sumtt),'totals',res[s.name]['totals'][:6])
json.dump(res,open('ref.json','w'),ensure_ascii=False,indent=1)
