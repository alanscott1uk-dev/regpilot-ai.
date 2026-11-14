"""Invoke the fixed staging worker using a short-lived GitHub OIDC token.
No credentials, tenant records, or provider responses are logged or retained.
"""
import json, os, sys, urllib.request, urllib.parse, urllib.error

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

def main():
    url = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or not parsed.hostname.endswith('.actions.githubusercontent.com') or parsed.username or parsed.password:
        raise ValueError('unexpected issuer endpoint')
    url += ('&' if parsed.query else '?') + urllib.parse.urlencode({'audience': AUDIENCE})
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    token = read(request, 15)['value']
    if not isinstance(token, str) or len(token) > 16000:
        raise ValueError('invalid token')
    request = urllib.request.Request(ORIGIN + '/api/internal/worker', data=b'', method='POST', headers={'Authorization': 'Bearer ' + token})
    result = read(request, 125)
    if result.get('ok') is not True or result.get('state') != 'completed':
        raise ValueError('worker did not complete')
    print('Private worker completed; reused:', result.get('reused') is True)
    # Counts and states only; never print arbitrary returned data.
    for name in ['sources', 'connectors', 'controlReviews']:
        module = result.get('modules', {}).get(name, {})
        state = module.get('state')
        count = module.get('processed')
        if state in ['completed','disabled','backlog','attention','failed'] and isinstance(count, int):
            print(name, state, 'processed:', count)

if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as error:
        print('Private worker invocation failed; HTTP status:', error.code)
        sys.exit(1)
    except Exception:
        print('Private worker invocation failed; inspect server run health. Credentials omitted.')
        sys.exit(1)
