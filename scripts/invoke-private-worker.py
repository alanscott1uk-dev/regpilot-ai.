"""Invoke the fixed staging worker using a short-lived GitHub OIDC token.
No credentials, tenant records, or provider responses are logged or retained.
"""
import json, os, sys, urllib.request, urllib.parse, urllib.error
from concurrent.futures import ThreadPoolExecutor

ORIGIN = 'https://regpilot-ai-qnx6-git-feature-traceabil-2f0b3f-alanscott1uk-5933.vercel.app'
AUDIENCE = 'regpilot-private-worker-staging'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
opener = urllib.request.build_opener(NoRedirect)

def read(request, timeout):
    with opener.open(request, timeout=timeout) as response:
        body = response.read(32769)
        if len(body) > 32768:
            raise ValueError('response exceeds limit')
        return json.loads(body)

def slot_count():
    raw = os.environ.get('REGPILOT_WORKER_SLOTS', '1')
    if raw not in tuple(str(n) for n in range(1, 9)):
        raise ValueError('invalid worker capacity')
    return int(raw)

def invoke_slot(slot, token):
    # Slot zero keeps the original endpoint and idempotency key.
    endpoint = ORIGIN + '/api/internal/worker' + ('?slot=' + str(slot) if slot else '')
    request = urllib.request.Request(endpoint, data=b'', method='POST', headers={'Authorization': 'Bearer ' + token})
    try:
        result = read(request, 125)
        if not isinstance(result, dict) or result.get('ok') is not True or result.get('state') != 'completed':
            return slot, False, ['Worker slot ' + str(slot) + ' did not complete; inspect durable worker health.']
        lines = ['Worker slot ' + str(slot) + ' completed; reused: ' + str(result.get('reused') is True)]
        modules = result.get('modules', {})
        if not isinstance(modules, dict):
            raise ValueError('invalid worker summary')
        for name in ['sources', 'connectors', 'automations', 'controlReviews']:
            module = modules.get(name, {})
            if not isinstance(module, dict):
                raise ValueError('invalid worker summary')
            state, count = module.get('state'), module.get('processed')
            if state in ['completed', 'disabled', 'backlog', 'attention', 'failed'] and type(count) is int and 0 <= count <= 100000:
                lines.append('slot ' + str(slot) + ' ' + name + ' ' + state + ' processed: ' + str(count))
        return slot, True, lines
    except urllib.error.HTTPError as error:
        return slot, False, ['Worker slot ' + str(slot) + ' failed; HTTP status: ' + str(error.code)]
    except Exception:
        return slot, False, ['Worker slot ' + str(slot) + ' failed; inspect durable worker health. Credentials omitted.']

def main():
    capacity = slot_count()  # Reject configuration errors before requesting any token.
    url = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or not parsed.hostname.endswith('.actions.githubusercontent.com') or parsed.username or parsed.password or parsed.port or parsed.fragment:
        raise ValueError('unexpected issuer endpoint')
    url += ('&' if parsed.query else '?') + urllib.parse.urlencode({'audience': AUDIENCE})
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    token = read(request, 15)['value']
    if not isinstance(token, str) or not token or len(token) > 16000 or any(c.isspace() for c in token):
        raise ValueError('invalid token')
    # All slots get an attempt even if another slot fails. The server independently
    # fences each invocation and permits only slot zero to generate recurring reviews.
    with ThreadPoolExecutor(max_workers=capacity) as pool:
        results = list(pool.map(lambda slot: invoke_slot(slot, token), range(capacity)))
    for _, _, lines in results:
        for line in lines:
            print(line)
    return 0 if all(ok for _, ok, _ in results) else 1

if __name__ == '__main__':
    try:
        sys.exit(main())
    except urllib.error.HTTPError as error:
        print('Private worker invocation failed; HTTP status:', error.code)
        sys.exit(1)
    except Exception:
        print('Private worker invocation failed; inspect server run health. Credentials omitted.')
        sys.exit(1)
