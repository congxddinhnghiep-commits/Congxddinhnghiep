import re, unicodedata
# VNI-Windows: base vowel + mark char(s)
BASE = {'a':'a','e':'e','i':'i','o':'o','u':'u','y':'y','A':'A','E':'E','I':'I','O':'O','U':'U','Y':'Y'}
# modifier chars in VNI (lowercase marks after vowel)
TONE = {'ø':'̀','ù':'́','û':'̉','õ':'̃','ï':'̣',
        'Ø':'̀','Ù':'́','Û':'̉','Õ':'̃','Ï':'̣'}
# circumflex+tone: â=^, à=^`, á=^´, å=^?, ã=^~, ä=^.
CIRC = {'â':'','à':'̀','á':'́','å':'̉','ã':'̃','ä':'̣',
        'Â':'','À':'̀','Á':'́','Å':'̉','Ã':'̃','Ä':'̣'}
# breve+tone: ê=˘, è=˘`, é=˘´, ú=˘?, ü=˘~, ë=˘.
BREVE = {'ê':'','è':'̀','é':'́','ú':'̉','ü':'̃','ë':'̣',
         'Ê':'','È':'̀','É':'́','Ú':'̉','Ü':'̃','Ë':'̣'}
SINGLE = {'ñ':'đ','Ñ':'Đ','ô':'ơ','Ô':'Ơ','ö':'ư','Ö':'Ư',
          'í':'í','ì':'ì','æ':'ỉ','ó':'ĩ','ò':'ị','Í':'Í','Ì':'Ì','Æ':'Ỉ','Ó':'Ĩ','Ò':'Ị','î':'ỵ','Î':'Ỵ'}
MARKERS = re.compile(r'[øùûõïåäëüÑñöÖ]|[aeoAEO][âàáåãä]|[aA][êèéúüë]|[ôö][øùûõï]')
def is_vni(s):
    return bool(MARKERS.search(s)) and not re.search(r'[一-鿿]', s[:0])
def vni2uni(s):
    out=[]; i=0
    while i < len(s):
        c=s[i]; n=s[i+1] if i+1<len(s) else ''
        if c in 'aeoAEO' and n in CIRC and not (c in 'aA' and False):
            if c in 'aAeEoO':
                out.append(unicodedata.normalize('NFC', c+'̂'+CIRC[n])); i+=2; continue
        if c in 'aA' and n in BREVE:
            out.append(unicodedata.normalize('NFC', c+'̆'+BREVE[n])); i+=2; continue
        if c in SINGLE and c in 'ôÔöÖ':
            b=SINGLE[c]
            if n in TONE: out.append(unicodedata.normalize('NFC', b+TONE[n])); i+=2; continue
            out.append(b); i+=1; continue
        if c in 'aeouyAEOUY' and n in TONE:
            out.append(unicodedata.normalize('NFC', c+TONE[n])); i+=2; continue
        if c in SINGLE and c not in 'ôÔöÖ':
            out.append(SINGLE[c]); i+=1; continue
        out.append(c); i+=1
    return ''.join(out)
def fix(s):
    return vni2uni(s) if is_vni(s) else s

UNI_ONLY = re.compile('[Ạ-ỹơưđăƠƯĐĂ]')
def fix(s):
    if not isinstance(s,str) or not MARKERS.search(s): return s
    if not UNI_ONLY.search(s): return vni2uni(s)
    return ' '.join(vni2uni(t) if MARKERS.search(t) else t for t in s.split(' '))
