"""Combine verified primary-source provision indexes with RegPilot's audit samples."""
import argparse
import hashlib
import json
from pathlib import Path
from build_scf import OUT, write_json

ROOT = Path(__file__).resolve().parent
def build(headings, output):
    published = json.loads(headings.read_text())
    profiles, content = [], {}
    for region in ('uk', 'eu'):
        for line in (ROOT / (region + '.psv')).read_text().splitlines():
            if not line or line.startswith('#'): continue
            key, name, a, act, evidence, b, act2, evidence2 = line.split('|')
            instrument = published[key]
            provisions = instrument['provisions']
            if a == b or a not in provisions or b not in provisions:
                raise ValueError(f'Unverified audit sample for {name}')
            identifier = region + '-' + key.replace('/', '-')
            url = ('https://www.legislation.gov.uk/' + key if region == 'uk' else
                   'https://eur-lex.europa.eu/eli/' + key + '/oj/eng')
            if key=='reg/2006/1907': url='https://eur-lex.europa.eu/eli/reg/2006/1907/2026-06-22/eng'
            if identifier in content: raise ValueError('Duplicate instrument')
            if not set(instrument['passages']) <= provisions.keys() or not set(instrument['anchors']) <= provisions.keys():
                raise ValueError(f'Passage or anchor outside the published instrument: {name}')
            content[identifier] = {**instrument, 'samples':{a:[act,evidence], b:[act2,evidence2]}}
            digest = hashlib.sha256(json.dumps(content[identifier],ensure_ascii=False,sort_keys=True).encode()).hexdigest()
            profiles.append({'id':identifier, 'family':identifier, 'name':name,
                             'label':key, 'publisher':'UK legislation' if region=='uk' else 'European Union',
                             'region':'United Kingdom' if region=='uk' else 'European Union', 'url':url,
                             'count':len(provisions), 'sampleCount':2, 'passageCount':len(instrument['passages']),
                             'digest':digest, 'source':region})
    if set(published) != {p['label'] for p in profiles}:
        raise ValueError('Source inventory and selected instruments differ')
    output.mkdir(parents=True,exist_ok=True)
    write_json(output/'regulatory-index.json',profiles)
    write_json(output/'regulatory-content.json.gz',content,compress=True)
    print(f'{len(profiles)} instruments, {sum(p["count"] for p in profiles)} indexed provisions, {len(profiles)*2} evidence samples')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('headings',type=Path);parser.add_argument('--output',type=Path,default=OUT)
    args=parser.parse_args(); build(args.headings,args.output)
