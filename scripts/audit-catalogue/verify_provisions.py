"""Retrieve official provision headings for the selected regulatory audit samples."""
import argparse
import concurrent.futures
import json
import re
import time
import urllib.request
from pathlib import Path
from lxml import etree, html

ROOT = Path(__file__).resolve().parent
UA = 'RegPilot-Framework-Verification/1.0'
def download(url, accept='*/*'):
    request = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': accept, 'Accept-Language': 'en'})
    with urllib.request.urlopen(request, timeout=24) as response:
        return response.read(24_000_000)
def words(element):
    return ' '.join(''.join(element.itertext()).split())

def passage(text):
    if len(text) <= 500: return text
    return text[:500].rsplit(' ',1)[0] + '…'

def xml_root(url):
    return etree.fromstring(download(url), etree.XMLParser(resolve_entities=False,no_network=True,huge_tree=True))

def uk_headings(key, refs):
    base=f'https://www.legislation.gov.uk/{key}'
    root = xml_root(base+'/contents/data.xml')
    result = {}
    for item in root.xpath('//*[@DocumentURI or @ContentRef]'):
        title = item.xpath('./*[local-name()="ContentsTitle"]')
        if not title: continue
        uri = item.get('DocumentURI','').split('?')[0].rstrip('/')
        ref = uri.rsplit(key + '/', 1)[-1] if key+'/' in uri else ''
        if not re.fullmatch(r'(section|regulation|article|schedule)/[A-Z]*[0-9]+[A-Z]*', ref, re.I):
            ref=item.get('ContentRef','').replace('-', '/')
        if not re.fullmatch(r'(section|regulation|article|schedule)/[A-Z]*[0-9]+[A-Z]*', ref, re.I): continue
        heading = words(title[0])
        if heading and heading.strip('. …') and ref not in result:
            result[ref] = heading
    if not set(refs) <= result.keys(): raise ValueError('Missing '+', '.join(set(refs)-result.keys()))
    passages={}
    def opening(element):
        for para in element.xpath('.//*[local-name()="Text" and not(ancestor::*[local-name()="Footnote"])]'):
            text=words(para)
            if len(text)>=24: return passage(text)
        return ''
    try:
        body=xml_root(base+'/data.xml')
    except (OSError,ValueError,etree.XMLSyntaxError):
        body=None
    if body is not None:
        for element in body.xpath('//*[@id]'):
            ref=element.get('id').replace('-','/')
            if ref not in result or ref in passages: continue
            text=opening(element)
            if text: passages[ref]=text
    for ref in refs:
        if ref not in passages:
            item=xml_root(base+'/'+ref+'/data.xml')
            specific=item.xpath('//*[@id=$ref]',ref=ref.replace('/','-'))
            text=opening(specific[0] if specific else item)
            if text: passages[ref]=text
    return {'provisions':result,'passages':passages,'anchors':{}}

def eu_headings(key, refs):
    kind, year, num = key.split('/')
    celex = f'3{year}'+{'reg':'R','dir':'L'}[kind]+num.zfill(4)
    urls = [f'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:{celex}',
            f'https://eur-lex.europa.eu/eli/{key}/oj/eng',
            f'https://publications.europa.eu/resource/celex/{celex}']
    if key=='reg/2006/1907':
        urls.insert(0,'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02006R1907-20260622')
    found, passages, anchors = {}, {}, {}
    for url in urls:
        try:
            tree = html.fromstring(download(url,'application/xhtml+xml,text/html;q=0.9'))
            for item in tree.xpath('//p | //h3 | //h4 | //b | //strong'):
                label = words(item)
                if len(label)>20: continue
                match = re.fullmatch(r'Article\s+(\d+[a-z]?)', label, re.I)
                if not match: continue
                ref = match[1]
                parent = item if item.tag not in ('strong','b') else item.getparent()
                heading = ''
                # EUR-Lex publishes both flat article headers and nested ELI title blocks.
                for following in parent.xpath('following::*[position() <= 6]'):
                    css = following.get('class','')
                    title = words(following)
                    if len(title)>350: continue
                    if re.fullmatch(r'Article\s+\d+[a-z]?',title,re.I): break
                    if ('sti-art' in css or 'stitle-article' in css or 'subtitle' in css or following.tag in ('h4','h5')
                        or (following is parent.getnext() and len(title)<155 and not re.search(r'[.:;!?]$|^\d|\b(?:shall|must)\b',title,re.I)
                            and (following.xpath('./b | ./strong') or (not css and following.tag=='p')))):
                        heading = title
                        break
                    if title and following.tag=='p' and not list(following): break
                if ref not in found or (heading and found[ref] == label):
                    found[ref] = heading or label
                if ref in passages: continue
                # Retain an opening paragraph and article target from this edition of EUR-Lex.
                for para in parent.xpath('following::*[self::p or (self::div and contains(@class,"norm") and not(.//p))][position() <= 12]'):
                    text=words(para)
                    if re.fullmatch(r'(Article\s+\d+[a-z]?|ANNEX(?:\s+[IVXLCDM]+)?)',text,re.I): break
                    if text in (heading,label) or len(text)<24: continue
                    css=para.get('class','').lower()
                    if 'norm' in css or (not css and re.search(r'[.;:]$|\b(?:shall|must)\b',text,re.I)):
                        passages[ref]=passage(text);break
                for node in [parent,*parent.iterancestors()]:
                    target=node.get('id','')
                    if target in ('art_'+ref,'art-'+ref,'art'+ref):
                        anchors[ref]=target;break
            if set(refs) <= found.keys(): return {'provisions':found,'passages':passages,'anchors':anchors}
        except Exception:
            continue
    raise ValueError('Could not resolve articles '+', '.join(r for r in refs if r not in found))

def capture(row):
    region, key, refs = row
    for attempt in range(2):
        try:
            headings = (uk_headings if region=='uk' else eu_headings)(key, refs)
            if any(not h.strip() for h in headings['provisions'].values()): raise ValueError('Missing heading')
            return key, headings, None
        except Exception as error:
            message = str(error)
            if attempt==0: time.sleep(0.35)
    return key, {}, message
def main():
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    jobs=[]
    for region in ('uk','eu'):
        for line in (ROOT/(region+'.psv')).read_text().splitlines():
            if not line or line.startswith('#'): continue
            key,_,a,_,_,b,_,_=line.split('|');jobs.append((region,key,[a,b]))
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        results=list(executor.map(capture,jobs))
    errors={k:e for k,_,e in results if e}
    args.output.write_text(json.dumps({k:v for k,v,e in results if not e},ensure_ascii=False,indent=2)+'\n')
    for k,e in errors.items(): print(k,e)
    print(f'{len(results)-len(errors)} of {len(results)} official instruments verified')
    if errors: raise SystemExit(1)
if __name__=='__main__': main()
