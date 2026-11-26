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
def uk_headings(key, refs):
    root = etree.fromstring(download(f'https://www.legislation.gov.uk/{key}/contents/data.xml'))
    all_refs = {}
    for item in root.xpath('//*[@DocumentURI or @ContentRef]'):
        title = item.xpath('./*[local-name()="ContentsTitle"]')
        if not title: continue
        uri = item.get('DocumentURI','').split('?')[0].rstrip('/')
        ref = item.get('ContentRef','')
        if uri: all_refs[uri.rsplit(key + '/', 1)[-1]] = words(title[0])
        if ref: all_refs[ref.replace('-', '/')] = words(title[0])
    return {ref: all_refs[ref] for ref in refs}
def eu_headings(key, refs):
    kind, year, num = key.split('/')
    celex = f'3{year}'+{'reg':'R','dir':'L'}[kind]+num.zfill(4)
    urls = [f'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:{celex}',
            f'https://eur-lex.europa.eu/eli/{key}/oj/eng',
            f'https://publications.europa.eu/resource/celex/{celex}']
    found = {}
    for url in urls:
        try:
            tree = html.fromstring(download(url,'application/xhtml+xml,text/html;q=0.9'))
            for item in tree.xpath("//*[contains(@class,'ti-art') or contains(@class,'title-article-norm') or contains(@class,'stitle-article-norm')]"):
                match = re.fullmatch(r'Article\s+(\d+[a-z]?)', words(item), re.I)
                if not match: continue
                following = item.getnext()
                if following is not None:
                    title = words(following)
                    if title: found.setdefault(match[1], title[:280])
            for ref in refs:
                if ref in found: continue
                nodes = tree.xpath('//*[@id=$target]',target='art_'+ref)
                if nodes:
                    children = [words(e) for e in nodes[0].xpath('./*') if words(e)]
                    if len(children)>=2: found[ref]=children[1][:280]
            if all(ref in found for ref in refs): return {r:found[r] for r in refs}
        except Exception:
            continue
    raise ValueError(f'could not resolve articles {", ".join(r for r in refs if r not in found)}')
def capture(row):
    region, key, refs = row
    for attempt in range(2):
        try:
            headings = (uk_headings if region=='uk' else eu_headings)(key, refs)
            if any(not h.strip() for h in headings.values()): raise ValueError('Missing heading')
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
