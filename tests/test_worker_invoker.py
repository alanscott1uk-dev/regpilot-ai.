import contextlib
import importlib.util
import io
import os
from pathlib import Path
import threading
import unittest
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('worker_invoker', Path(__file__).parents[1] / 'scripts/invoke-private-worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class WorkerInvokerTests(unittest.TestCase):
    def env(self, slots='1'):
        return patch.dict(os.environ, {
            'REGPILOT_WORKER_SLOTS': slots,
            'ACTIONS_ID_TOKEN_REQUEST_URL': 'https://fixture.actions.githubusercontent.com/token?request=fixture',
            'ACTIONS_ID_TOKEN_REQUEST_TOKEN': 'issuer-secret-never-log',
        })

    def test_parallel_slots_complete_even_when_one_fails_without_logging_secrets(self):
        barrier = threading.Barrier(3)
        slots = []
        token_calls = []
        def read(request, timeout):
            if '/token?' in request.full_url:
                token_calls.append(request)
                return {'value': 'worker-secret-never-log'}
            self.assertTrue(request.full_url.startswith(worker.ORIGIN + '/api/internal/worker'))
            self.assertEqual(request.get_method(), 'POST')
            self.assertEqual(request.get_header('Authorization'), 'Bearer worker-secret-never-log')
            slot = int(request.full_url.rsplit('=', 1)[1]) if '?slot=' in request.full_url else 0
            slots.append(slot)
            barrier.wait(timeout=5)
            if slot == 1:
                raise RuntimeError('credential-and-provider-body-must-not-escape')
            return {'ok': True, 'state': 'completed', 'modules': {'automations': {'state': 'completed', 'processed': 2, 'private': 'tenant-secret'}}}
        output = io.StringIO()
        with self.env('3'), patch.object(worker, 'read', side_effect=read), contextlib.redirect_stdout(output):
            self.assertEqual(worker.main(), 1)
        self.assertEqual(sorted(slots), [0, 1, 2])
        self.assertEqual(len(token_calls), 1)
        self.assertIn('slot 2 automations completed processed: 2', output.getvalue())
        for secret in ['worker-secret', 'issuer-secret', 'credential-and-provider', 'tenant-secret']:
            self.assertNotIn(secret, output.getvalue())

    def test_default_one_slot_and_all_eight_slots_are_supported(self):
        for capacity in (1, 8):
            seen = []
            def read(request, timeout):
                if '/token?' in request.full_url:
                    return {'value': 'synthetic-token'}
                seen.append(request.full_url)
                return {'ok': True, 'state': 'completed', 'reused': True}
            with self.env(str(capacity)), patch.object(worker, 'read', side_effect=read), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(worker.main(), 0)
            self.assertEqual(len(set(seen)), capacity)
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(worker.slot_count(), 1)

    def test_invalid_capacity_never_requests_a_token(self):
        for value in ('', '0', '9', '2.5', '01', 'NaN', '1000', '-1'):
            with self.env(value), patch.object(worker, 'read') as read:
                with self.assertRaises(ValueError):
                    worker.main()
                read.assert_not_called()

    def test_untrusted_issuer_urls_are_rejected_without_network(self):
        for url in ('http://fixture.actions.githubusercontent.com/token', 'https://actions.githubusercontent.com.evil.invalid/token', 'https://user@fixture.actions.githubusercontent.com/token', 'https://fixture.actions.githubusercontent.com:444/token', 'https://fixture.actions.githubusercontent.com/token#fragment'):
            with self.env(), patch.dict(os.environ, {'ACTIONS_ID_TOKEN_REQUEST_URL': url}), patch.object(worker, 'read') as read:
                with self.assertRaises(ValueError):
                    worker.main()
                read.assert_not_called()

    def test_malformed_token_cannot_be_forwarded(self):
        for token in ('', 'a\nb', 'a' * 16001, None):
            with self.env(), patch.object(worker, 'read', return_value={'value': token}) as read:
                with self.assertRaises(ValueError):
                    worker.main()
                self.assertEqual(read.call_count, 1)

    def test_unsuccessful_http_or_summary_cannot_report_success(self):
        cases = [None, [], {'ok': False, 'state': 'completed'}, {'ok': True, 'state': 'running'}, {'ok': True, 'state': 'completed', 'modules': []}]
        for result in cases:
            with patch.object(worker, 'read', return_value=result):
                self.assertFalse(worker.invoke_slot(0, 'fixture')[1])
        error = urllib.error.HTTPError(worker.ORIGIN, 503, 'private body', {}, None)
        with patch.object(worker, 'read', side_effect=error):
            slot, ok, lines = worker.invoke_slot(2, 'fixture')
            self.assertFalse(ok)
            self.assertIn('503', lines[0])
            self.assertNotIn('private body', lines[0])

    def test_read_retains_response_limit(self):
        class Response(io.BytesIO):
            pass
        with patch.object(worker.opener, 'open', return_value=Response(b'x' * 32769)):
            with self.assertRaises(ValueError):
                worker.read(object(), 1)

if __name__ == '__main__':
    unittest.main()
