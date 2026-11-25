import datetime
import runpy
import unittest
from pathlib import Path

publisher = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts' / 'publish-horizon.py'))


class HorizonPublication(unittest.TestCase):
    def test_publisher_generations_and_ema_source_identity(self):
        stamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
        def report(ids, items):
            return {'format': 'regpilot-horizon-v1', 'generatedAt': stamp, 'windowStart': stamp,
                    'codeCommit': None, 'runId': None, 'previousAvailable': False, 'limitations': [],
                    'feeds': [dict(id=key, state='available', checkedAt=stamp, total=0, retrieved=0, reason=None) for key in ids],
                    'items': items}
        for generation in publisher['PUBLISHER_GENERATIONS']:
            publisher['validate'](report(generation, []))
        notice = dict(id='a'*32, revision='b'*32, path='/eu-ema/shortages/example',
                      url='https://www.ema.europa.eu/en/medicines/human/shortages/example',
                      title='Example', summary='', documentType='medicine_shortage_notice', kind='Medicine shortage',
                      publisherIds=['eu-ema'], discovery='BASELINE', updatedAt=stamp, firstSeenAt=stamp, observedAt=stamp)
        ids = publisher['ALL_PUBLISHERS']
        publisher['validate'](report(ids, [notice]))
        for changes in [dict(url='https://www.gov.uk/eu-ema/shortages/example'),
                        dict(publisherIds=['eu-ema','mhra']), dict(kind='Safety alert'),
                        dict(publisherIds=['mhra']), dict(documentType='statutory_instrument')]:
            with self.subTest(changes=changes), self.assertRaises(AssertionError):
                publisher['validate'](report(ids, [{**notice, **changes}]))
        with self.assertRaises(AssertionError):
            publisher['validate'](report(ids - {'mhra'}, [notice]))
