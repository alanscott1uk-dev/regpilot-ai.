"""Independent read-only watchdog. No dependency install, credentials or write operations."""
import importlib.util,json,pathlib,sys,urllib.request
spec=importlib.util.spec_from_file_location('publisher',pathlib.Path(__file__).with_name('publish-horizon.py'))
publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
URL='https://raw.githubusercontent.com/alanscott1uk-dev/regpilot-ai./regpilot-public-feed/horizon.json'
def inspect(data):
    publisher.validate(data,max_age_hours=3)
    unavailable=sum(f['state']=='unavailable' for f in data['feeds'])
    result={'state':'degraded' if unavailable else 'limited' if any(f['state']=='limited' for f in data['feeds']) or data.get('pipeline',{}).get('retentionLimited') else 'current','generatedAt':data['generatedAt'],'publications':len(data['items']),'unavailable':unavailable}
    return result
if __name__=='__main__':
    try:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs):return None
        with urllib.request.build_opener(NoRedirect).open(URL,timeout=20) as response:
            raw=response.read(4_000_001);assert len(raw)<=4_000_000
        result=inspect(json.loads(raw));print(json.dumps(result));sys.exit(1 if result['state']=='degraded' else 0)
    except Exception:
        print('Public horizon watchdog: unavailable, invalid or older than three hours');sys.exit(1)
