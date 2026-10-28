"""Recover published immutable products if the runner cache was evicted. No original full scenes."""
import argparse, hashlib, json, pathlib, urllib.request, urllib.parse, shutil
from concurrent.futures import ThreadPoolExecutor
from pipeline import atomic

def restore(url, root):
    if url!='https://agustin21089.github.io/pulso-publico/territory/':raise ValueError('Unreviewed snapshot origin')
    req=urllib.request.urlopen(url+'manifest.json',timeout=30)
    body=req.read(15_000_000);m=json.loads(body)
    if m.get('version')!=1:raise ValueError('Unsupported manifest')
    current=root/'manifest.json'
    if current.exists() and json.loads(current.read_text())['generatedAt']>=m['generatedAt']:return
    files={}
    for o in m['observations']:
        for p in o['layers'].values():files[p]=None
        files[o['rasterLocation']]=o['classificationSha256']
    for c in m['changes']:files[c['layer']]=None
    def download(entry):
        relative,checksum=entry
        import re
        if not re.fullmatch(r'(observations|changes)/[a-f0-9_]+/[a-z]+\.(webp|png|tif)',relative):raise ValueError('Unsafe product path')
        target=root/relative
        if target.exists() and (not checksum or hashlib.sha256(target.read_bytes()).hexdigest()==checksum):return
        with urllib.request.urlopen(url+relative,timeout=45) as r:b=r.read(50_000_001)
        if len(b)>50_000_000:raise ValueError('Product exceeds transfer budget')
        if checksum and hashlib.sha256(b).hexdigest()!=checksum:raise ValueError('Remote classification checksum mismatch')
        target.parent.mkdir(parents=True,exist_ok=True);tmp=target.with_suffix('.download');tmp.write_bytes(b);tmp.replace(target)
    with ThreadPoolExecutor(max_workers=4) as ex:list(ex.map(download,files.items()))
    for o in m['observations']:atomic(root/'observations'/o['id']/'observation.json',o)
    for c in m['changes']:atomic(root/'changes'/c['id']/'change.json',c)
    atomic(current,m)
    print(json.dumps({'restoredObservations':len(m['observations']),'restoredChanges':len(m['changes'])}))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',default='data/territory');p.add_argument('--seed',default='site/territory');a=p.parse_args()
    root=pathlib.Path(a.root);seed=pathlib.Path(a.seed)
    if (seed/'manifest.json').exists():
        seeded=json.loads((seed/'manifest.json').read_text())
        existing=json.loads((root/'manifest.json').read_text()) if (root/'manifest.json').exists() else None
        if existing is None or seeded['generatedAt']>existing['generatedAt']:
            shutil.copytree(seed,root,dirs_exist_ok=True)
            for o in seeded['observations']:atomic(root/'observations'/o['id']/'observation.json',o)
            for c in seeded['changes']:atomic(root/'changes'/c['id']/'change.json',c)
            print(json.dumps({'seededObservations':len(seeded['observations'])}))
    try:restore('https://agustin21089.github.io/pulso-publico/territory/',pathlib.Path(a.root))
    except Exception as e:print(json.dumps({'restoreWarning':str(e)[:200],'action':'Preserve bundled snapshot; retry on next run'}))
