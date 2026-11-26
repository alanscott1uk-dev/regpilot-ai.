"""Index the published SCF workbook for display. Preserve the publisher's cell text."""
import argparse
import gzip
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook

RELEASE = '2026.3'
SHA256 = '5a89bf2d3c106a9a87d4b6e3d62dd3e147d0e960d4c07473045a10aa8a7df697'
SOURCE = 'https://github.com/securecontrolsframework/securecontrolsframework/releases/download/2026.3/secure-controls-framework-scf-2026-3.xlsx'
OUT = Path(__file__).resolve().parents[2] / 'public/audit-catalogue'
# These are display families. Each edition, overlay and assessment profile keeps its own mapping.
FAMILIES = {
    'general-cis-csc-8-1': 'cis-controls', 'general-govramp': 'govramp',
    'general-iec-62443-': 'iec-62443', 'general-ul-2900-': 'ul-2900',
    'general-nist-800-53': 'nist-800-53', 'general-nist-800-82-': 'nist-800-82',
    'general-nist-800-161-': 'nist-800-161', 'general-nist-800-171-': 'nist-800-171',
    'general-nist-800-171a': 'nist-800-171', 'general-nist-800-172': 'nist-800-172',
    'general-pci-dss-': 'pci-dss', 'usa-federal-dow-cmmc-': 'cmmc',
    'usa-federal-gsa-fedramp-': 'fedramp', 'usa-state-tx-txramp-': 'txramp',
    'emea-gbr-def-stan-05-138': 'def-stan-05-138', 'apac-nzl-hisf-': 'nz-hisf',
    'emea-eu-cyber-resilience-act-': 'eu-cra', 'emea-eu-dora-': 'dora',
    'emea-eu-nis2-': 'nis2', 'usa-federal-law-hipaa-': 'hipaa',
    'usa-federal-far-52-': 'us-far', 'usa-federal-dow-brilliant-basics-': 'us-brilliant-basics',
    'general-nist-100-1-ai-rmf': 'nist-ai-rmf', 'general-nist-600-1-gen-ai-profile': 'nist-ai-rmf',
    'general-nist-csf-2-0':'nist-csf', 'general-nist-cswp-39':'nist-csf',
    'usa-state-nv-privacy-law-':'nv-online-privacy', 'usa-state-nv-sb220-':'nv-online-privacy',
}

def family(identifier):
    return next((name for prefix, name in FAMILIES.items() if identifier.startswith(prefix)), identifier)

def document_bytes(data):
    return (json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n').encode()

def write_json(path, data, compress=False):
    content = document_bytes(data)
    if compress:
        content = gzip.compress(content, compresslevel=9, mtime=0)
    path.write_bytes(content)

def build(workbook, output):
    if hashlib.sha256(workbook.read_bytes()).hexdigest() != SHA256:
        raise ValueError('Workbook differs from the publisher release')
    book = load_workbook(workbook, read_only=True, data_only=True)
    focal = list(book['Focal Documents (FD)'].values)[1:]
    rows = iter(book['SCF ' + RELEASE].values)
    headers = next(rows)
    normalize = lambda value: ' '.join(value.split()).casefold()
    positions = {normalize(header): i for i, header in enumerate(headers)}
    profiles = {}
    columns = []
    for geography, header, identifier, publisher, name, source, mapping_url in focal:
        if identifier in profiles or not source.startswith(('https://', 'http://')):
            raise ValueError('Invalid focal document ' + identifier)
        profiles[identifier] = {'id': identifier, 'family': family(identifier), 'label': header, 'name': name,
                                'publisher': publisher, 'region': geography, 'url': source, 'mappingUrl': mapping_url}
        columns.append((positions[normalize(header)], identifier))
    controls = {}
    mappings = defaultdict(dict)
    for row in rows:
        domain, name, identifier, description = row[:4]
        if not identifier or identifier in controls:
            raise ValueError('Missing or duplicate control')
        controls[identifier] = {'id': identifier, 'domain': domain, 'name': name, 'description': description,
                                'evidence': row[6], 'objectives': []}
        for position, profile in columns:
            value = row[position]
            if value is not None and value.strip():
                mappings[profile][identifier] = value
    evidence = {r[1]: {'id':r[1], 'name':r[3], 'description':r[4]} for r in list(book['Evidence Request List ' + RELEASE].values)[1:]}
    for r in list(book['Assessment Objectives ' + RELEASE].values)[1:]:
        if r[0] not in controls:
            raise ValueError('Objective references an unknown control ' + str(r[0]))
        controls[r[0]]['objectives'].append({'id':r[1], 'text':r[2]})
    output.mkdir(parents=True, exist_ok=True)
    counts = []
    for profile in profiles.values():
        count = len(mappings[profile['id']])
        if count:
            counts.append({**profile, 'count':count})
    source = {'edition':RELEASE,'url':SOURCE,'sha256':SHA256,'copyright':'© Secure Controls Framework Council, LLC',
              'license':'https://creativecommons.org/licenses/by-nd/4.0/legalcode.en','terms':'https://securecontrolsframework.com/terms-and-conditions'}
    write_json(output / 'scf-index.json', {'source':source, 'profiles':counts})
    write_json(output / 'scf-content.json.gz', {'source':source,'controls':controls,'evidence':evidence,'mappings':dict(mappings)}, compress=True)
    print(f'{len(counts)} mapped profiles, {len({p["family"] for p in counts})} distinct families, {len(controls)} controls, {sum(len(x) for x in mappings.values())} mappings')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('workbook', type=Path)
    parser.add_argument('--output', type=Path, default=OUT)
    args = parser.parse_args()
    build(args.workbook, args.output)
