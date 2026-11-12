"""Publish public discovery metadata to one fixed data branch. No app or default-branch writes."""
import datetime, json, os, pathlib, re, sys, urllib.request, urllib.error, base64
REPOSITORY='alanscott1uk-dev/regpilot-ai.'
BRANCH='regpilot-public-feed'
PUBLISHERS={'mhra','home-office','hmrc','companies-house','business-trade','cma','environment-agency','defra','dwp','product-safety','dsit','dhsc'}
def validate(data, expected_commit=None):
    assert set(data)=={'format','generatedAt','windowStart','codeCommit','runId','previousAvailable','feeds','items','limitations'}
    assert data['format']=='regpilot-horizon-v1'
    now=datetime.datetime.now(datetime.timezone.utc)
    def date(v):
        assert isinstance(v,str) and len(v)<=30
        d=datetime.datetime.fromisoformat(v.replace('Z','+00:00'))
        assert d.tzinfo and d<=now+datetime.timedelta(minutes=5)
        return d
    generated=date(data['generatedAt']);assert now-generated<datetime.timedelta(hours=2)
    assert date(data['windowStart'])<=generated
    assert isinstance(data['previousAvailable'],bool)
    assert data['codeCommit'] is None or re.fullmatch('[a-f0-9]{40}',data['codeCommit'])
    if expected_commit: assert data['codeCommit']==expected_commit
    assert data['runId'] is None or re.fullmatch('[0-9]{1,30}',data['runId'])
    assert isinstance(data['limitations'],list) and len(data['limitations'])<=8 and all(isinstance(v,str) and len(v)<=400 for v in data['limitations'])
    feeds=data['feeds'];assert len(feeds)==12 and {f['id'] for f in feeds}==PUBLISHERS
    for f in feeds:
        assert set(f)=={'id','state','checkedAt','total','retrieved','reason'}
        assert f['state'] in ('available','limited','unavailable') and date(f['checkedAt'])<=generated
        assert isinstance(f['retrieved'],int) and 0<=f['retrieved']<=100
        assert f['total'] is None or isinstance(f['total'],int) and f['total']>=0
        assert f['reason'] is None or isinstance(f['reason'],str) and len(f['reason'])<=100
    assert isinstance(data['items'],list) and len(data['items'])<=1500
    ids=set()
    for item in data['items']:
        assert set(item)=={'id','revision','path','url','title','summary','documentType','kind','publisherIds','updatedAt','firstSeenAt','observedAt','discovery'}
        assert re.fullmatch('[a-f0-9]{32}',item['id']) and item['id'] not in ids;ids.add(item['id'])
        assert re.fullmatch('[a-f0-9]{32}',item['revision'])
        path=item['path'];assert isinstance(path,str) and len(path)<=450 and re.fullmatch('/[a-z0-9][a-z0-9/-]*',path) and '//' not in path and not path.endswith('/') and not path.startswith('/api/')
        assert item['url']=='https://www.gov.uk'+path
        for key,limit in [('title',240),('summary',360),('documentType',100)]:assert isinstance(item[key],str) and len(item[key])<=limit
        assert item['title'] and item['kind'] in ('Safety alert','Consultation','Regulation or decision','Guidance','Policy','News','Other publication')
        assert isinstance(item['publisherIds'],list) and 1<=len(item['publisherIds'])<=12 and set(item['publisherIds'])<=PUBLISHERS
        assert date(item['firstSeenAt'])<=date(item['observedAt'])<=generated;date(item['updatedAt'])
        assert item['discovery'] in ('BASELINE','FIRST_SEEN','METADATA_UPDATED','UNCHANGED')
    return data

def main():
    path=pathlib.Path('artifacts/horizon.json');assert path.stat().st_size<=2_000_000
    data=validate(json.loads(path.read_text()),os.environ.get('REGPILOT_VERIFIED_CODE_SHA'))
    if '--validate-only' in sys.argv:print('Public horizon payload validated');return
    assert os.environ.get('GITHUB_REPOSITORY')==REPOSITORY
    token=os.environ.get('GITHUB_TOKEN');assert token
    endpoint='https://api.github.com/repos/'+REPOSITORY+'/contents/horizon.json'
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):return None
    opener=urllib.request.build_opener(NoRedirect)
    def request(url,method='GET',body=None):
        r=urllib.request.Request(url,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','Content-Type':'application/json'})
        with opener.open(r,timeout=20) as response:
            result=response.read(3_000_001);assert len(result)<=3_000_000
            return json.loads(result)
    sha=None
    try:sha=request(endpoint+'?ref='+BRANCH)['sha']
    except urllib.error.HTTPError as e:
        if e.code!=404:raise RuntimeError('Could not read the public data branch') from None
    payload={'message':'Refresh public regulatory horizon metadata','branch':BRANCH,'content':base64.b64encode((json.dumps(data,separators=(',',':'))+'\n').encode()).decode()}
    if sha:payload['sha']=sha
    try:result=request(endpoint,'PUT',payload)
    except urllib.error.HTTPError as e:raise RuntimeError('Public data update rejected: '+str(e.code)) from None
    print('Published validated public horizon data; commit '+result['commit']['sha'])
if __name__=='__main__':main()
