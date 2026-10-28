"""Resumable bounded STAC ingestion + COG window processing. Run from repository root."""
import argparse, datetime as dt, hashlib, json, math, os, pathlib, sys, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import rasterio
from rasterio.warp import reproject, transform_bounds, Resampling
from rasterio.vrt import WarpedVRT
from rasterio.transform import from_origin, from_bounds
from rasterio.features import geometry_mask
from shapely.geometry import shape, mapping
from shapely.ops import transform as shape_transform
from pyproj import Transformer
from PIL import Image
from core import classify, areas, changes

NOW = lambda: dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z')
def digest(data): return hashlib.sha256(data).hexdigest()
def atomic(path, obj):
    path = pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(obj,ensure_ascii=False,allow_nan=False));tmp.replace(path)
def request(url, raw, body=None):
    # URLs from verified STAC links only; no credentials. Immutable originals retained by SHA256.
    for attempt in range(3):
        try:
            req=urllib.request.Request(url,data=None if body is None else json.dumps(body).encode(),headers={'Accept':'application/json','User-Agent':'PULSO-Territorio/1.0','Content-Type':'application/json'})
            with urllib.request.urlopen(req,timeout=40) as r: data=r.read(30_000_000)
            obj=json.loads(data);h=digest(data);raw.mkdir(parents=True,exist_ok=True)
            p=raw/h
            if not p.exists():p.write_bytes(data)
            return obj, {'url':url,'sha256':h,'retrievedAt':NOW()}
        except Exception:
            if attempt==2:raise
            time.sleep(attempt+1)

def catalog(root, bbox, start, end, raw, max_pages, collection="sentinel-2-l2a"):
    landing, provenance=request(root,raw)
    search=next(l['href'] for l in landing['links'] if l['rel']=='search' and l.get('method','GET')=='GET')
    url=search+'?'+urllib.parse.urlencode({'collections':collection,'bbox':','.join(map(str,bbox)),'datetime':f'{start}T00:00:00Z/{end}T23:59:59Z','limit':100})
    features={};records=[provenance];seen=set()
    for _ in range(max_pages):
        if url in seen:raise ValueError('Catalog pagination loop')
        seen.add(url);result,prov=request(url,raw);records.append(prov)
        if result.get('type')!='FeatureCollection':raise ValueError('Not a STAC FeatureCollection')
        for f in result['features']:features[f['id']]=f
        nxt=next((l for l in result.get('links',[]) if l['rel']=='next'),None)
        if not nxt:return list(features.values()),records
        url=urllib.parse.urljoin(url,nxt['href'])
        if urllib.parse.urlparse(url).netloc!=urllib.parse.urlparse(root).netloc:raise ValueError('Unexpected pagination host')
    raise ValueError('Catalog exceeds page budget; previous snapshot preserved')

def scene_record(f, aoi, cdse_products):
    p=f['properties'];acq=p['datetime'];dt.datetime.fromisoformat(acq.replace('Z','+00:00'))
    if not acq.endswith('Z'):raise ValueError('Acquisition timezone missing')
    product=p.get('s2:product_uri',f['id']).removesuffix('.SAFE')
    link=next(l['href'] for l in f['links'] if l['rel']=='self')
    return {'id':f['id'],'provider':'Earth Search / Copernicus Sentinel', 'satellite':p['platform'],
        'productId':product,'acquisitionDatetime':acq,'geometry':f['geometry'],
        'cloudCoverage':p.get('eo:cloud_cover'),'validCoverage':None,'resolution':{'B02':10,'B03':10,'B04':10,'B08':10,'B11':20,'SCL':20},
        'processingLevel':'L2A','sourceUrl':link,'copernicusUrl':cdse_products.get(product),
        'spatialCoverage':shape(f['geometry']).intersection(aoi).area/aoi.area,
        'processingStatus':'pending','metadata':{'catalogUpdated':p.get('updated'),'reflectanceOffsetApplied':p.get('earthsearch:boa_offset_applied'), 'licenseUrl':next((l['href'] for l in f['links'] if l['rel']=='license'),None)},
        'assets':{k:f['assets'][k] for k in ['blue','green','red','nir','swir16','scl']}}

def grid(aoi, settings):
    tr=Transformer.from_crs('EPSG:4326',settings['crs'],always_xy=True)
    metric=shape_transform(tr.transform,aoi);b=metric.bounds;r=settings['resolution']
    left=math.floor(b[0]/r)*r;top=math.ceil(b[3]/r)*r
    width=math.ceil((b[2]-left)/r);height=math.ceil((top-b[1])/r)
    if width*height>15_000_000:raise ValueError('AOI exceeds processing budget')
    affine=from_origin(left,top,r,r)
    inside=geometry_mask([mapping(metric)],(height,width),affine,invert=True)
    return affine,width,height,inside,metric.area/1e6

def band(asset, transform, width, height, crs, categorical=False):
    href=asset['href'];u=urllib.parse.urlparse(href)
    if u.scheme!='https' or u.hostname!='e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com':raise ValueError('Unreviewed COG origin')
    with rasterio.open(href) as src:
        with WarpedVRT(src,crs=crs,transform=transform,width=width,height=height,
                resampling=Resampling.nearest if categorical else Resampling.average,
                dtype='float32',nodata=float('nan')) as vrt:
            arr=vrt.read(1)
    if categorical:return np.nan_to_num(arr,nan=0).astype('uint8')
    meta=asset['raster:bands'][0]
    # Use the explicit asset scale and offset, never infer them from processing baseline.
    if 'scale' not in meta or 'offset' not in meta:raise ValueError('Missing reflectance scale/offset')
    return arr*meta['scale']+meta['offset']

def preview_grid(aoi, maximum):
    b=transform_bounds('EPSG:4326','EPSG:3857',*aoi.bounds)
    ratio=(b[2]-b[0])/(b[3]-b[1]);w=min(maximum,round(maximum*ratio));h=min(maximum,round(maximum/ratio))
    return from_bounds(*b,w,h),w,h

def preview(arr, affine, crs, target, categorical=True):
    tf,w,h=target;out=np.zeros((h,w),dtype=arr.dtype)
    reproject(arr,out,src_transform=affine,src_crs=crs,dst_transform=tf,dst_crs='EPSG:3857',resampling=Resampling.nearest if categorical else Resampling.bilinear)
    return out

def png_mask(arr,path,palette):
    rgba=np.zeros((*arr.shape,4),dtype='uint8')
    for val,color in palette.items():rgba[arr==val]=color
    Image.fromarray(rgba).save(path,optimize=True)

def process(scene, settings, aoi, g, target, root, fingerprint):
    affine,w,h,inside,area=g;crs=settings['crs']
    arrays={}
    for key in ['scl','green','nir','swir16','red','blue']:
        arrays[key]=band(scene['assets'][key],affine,w,h,crs,key=='scl')
    mask,ndwi,mndwi=classify(arrays['green'],arrays['nir'],arrays['swir16'],arrays['red'],arrays['scl'],inside,settings)
    stats=areas(mask,settings['resolution']**2)
    ident=digest((scene['id']+fingerprint+json.dumps(scene['assets'],sort_keys=True)).encode())[:20]
    folder=root/'observations'/ident;folder.mkdir(parents=True,exist_ok=True)
    # Analytical COG and exact mask are server-side products, never used as browser thumbnails.
    with rasterio.open(folder/'classification.tif','w',driver='COG',height=h,width=w,count=1,dtype='uint8',crs=crs,transform=affine,nodata=255,compress='DEFLATE',overview_resampling='NEAREST') as dst:dst.write(mask,1)
    # Exact class raster is sufficient to resume; avoid publishing duplicate analytical arrays.
    low=preview(mask,affine,crs,target)
    Image.fromarray(low).save(folder/'classes.png',optimize=True)
    png_mask(low,folder/'water.png',{2:(58,194,240,200)})
    png_mask(low,folder/'quality.png',{0:(164,143,186,175)})
    rgb=[]
    for key in ['red','green','blue']:
        channel=np.clip(np.nan_to_num(arrays[key],nan=0)/0.3,0,1)**(1/1.4)
        rgb.append(preview((channel*255).astype('uint8'),affine,crs,target,False))
    # RGB displays source observations only within valid analysis pixels; unknown areas get quality overlay.
    alpha=np.where(np.isin(low,[1,2]),255,0).astype('uint8')
    Image.fromarray(np.stack([*rgb,alpha],axis=-1)).save(folder/'rgb.webp',lossless=True)
    tf,pw,ph=target
    west,south,east,north=aoi.bounds
    bounds=[[west,north],[east,north],[east,south],[west,south]]
    obs={'id':ident,'sceneId':scene['id'],'aoiId':'rosario-islas','observationDatetime':scene['acquisitionDatetime'],
         'algorithm':'NDWI AND MNDWI with NDVI exclusion + SCL','algorithmVersion':settings['algorithmVersion'],
         'threshold':settings['thresholds'],'analysisResolution':settings['resolution'],'gridFingerprint':fingerprint,
         **stats,'qualityStatus':'satellite_estimate_unvalidated', 'usable':stats['validCoverage']>=settings['minValidCoverage'],
         'rasterLocation':f'observations/{ident}/classification.tif','geometryLocation':None,'createdAt':NOW(),
         'layers':{key:f'observations/{ident}/{name}' for key,name in [('rgb','rgb.webp'),('water','water.png'),('quality','quality.png'),('classification','classes.png')]},
         'coordinates':bounds,'previewResolution':{'width':pw,'height':ph,'crs':'EPSG:3857'},
         'classificationSha256':digest((folder/'classification.tif').read_bytes())}
    atomic(folder/'observation.json',obs)
    return obs

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--end',default=dt.datetime.now(dt.timezone.utc).date().isoformat());parser.add_argument('--max-scenes',type=int);parser.add_argument('--catalog-only',action='store_true');parser.add_argument('--offline',action='store_true');parser.add_argument('--output',default='data/territory');parser.add_argument('--config',default='config/territory');args=parser.parse_args()
    config=pathlib.Path(args.config);settings=json.loads((config/'settings.json').read_text());feature=json.loads((config/settings['aoiFile']).read_text());aoi=shape(feature['geometry'])
    if not aoi.is_valid or aoi.is_empty:raise ValueError('Invalid AOI')
    dt.date.fromisoformat(args.end)
    if args.end<settings['start'] or args.end>dt.datetime.now(dt.timezone.utc).date().isoformat():raise ValueError('Invalid/future end date')
    root=pathlib.Path(args.output);root.mkdir(parents=True,exist_ok=True);raw=root/'raw';lock=root/'.lock'
    try:lock.mkdir()
    except FileExistsError:raise SystemExit('Another territory process owns the lock; inspect before removing')
    try:run(args,settings,feature,aoi,root,raw)
    finally:lock.rmdir()

def run(args,settings,feature,aoi,root,raw):
    runs=[];errors=[];catalog_file=root/'catalog.json'
    previous=json.loads((root/'manifest.json').read_text()) if (root/'manifest.json').exists() else None
    if args.offline:
        saved=json.loads(catalog_file.read_text());scenes=saved['scenes'];runs=saved['acquisitions']
    else:
        cdse_products={}
        try:
            cdse,prov=catalog(settings['catalogs']['copernicus'],aoi.bounds,settings['start'],args.end,raw,settings['maxPages']);runs.extend(prov)
            cdse_products={f['id']:next(l['href'] for l in f['links'] if l['rel']=='self') for f in cdse}
        except Exception as e:errors.append({'source':'copernicus','error':str(e)[:200]})
        features,prov=catalog(settings['catalogs']['earthsearch'],aoi.bounds,settings['start'],args.end,raw,settings['maxPages'],settings['earthsearchCollection']);runs.extend(prov)
        scenes=[scene_record(f,aoi,cdse_products) for f in features if shape(f['geometry']).intersects(aoi)]
        scenes=[s for s in scenes if settings['start']<=s['acquisitionDatetime'][:10]<=args.end and dt.datetime.fromisoformat(s['acquisitionDatetime'].replace('Z','+00:00'))<=dt.datetime.now(dt.timezone.utc)]
        if previous:
            seen={s['id'] for s in scenes}
            scenes.extend(s for s in previous['scenes'] if s['id'] not in seen and s['acquisitionDatetime'][:10]<=args.end and 'e84-earth-search-sentinel-data.' in s.get('assets',{}).get('green',{}).get('href',''))
        scenes.sort(key=lambda s:(s['acquisitionDatetime'],s['id']))
        atomic(catalog_file,{'scenes':scenes,'acquisitions':runs})
    fingerprint=digest(json.dumps({'settings':settings,'geometry':feature['geometry']},sort_keys=True).encode())[:20]
    g=grid(aoi,settings);target=preview_grid(aoi,settings['previewMaxSize']);observations=[]
    for file in (root/'observations').glob('*/observation.json'):
        obs=json.loads(file.read_text())
        expected=next((s for s in scenes if s['id']==obs['sceneId']),None)
        expected_id=digest((expected['id']+fingerprint+json.dumps(expected['assets'],sort_keys=True)).encode())[:20] if expected else None
        if obs['gridFingerprint']==fingerprint and obs['id']==expected_id and obs['observationDatetime'][:10]<=args.end:
            raster=root/obs['rasterLocation']
            if digest(raster.read_bytes())!=obs['classificationSha256']:raise ValueError('Analytical raster integrity failed')
            if not obs['layers'].get('classification'):
                with rasterio.open(raster) as r:mask=r.read(1)
                Image.fromarray(preview(mask,g[0],settings['crs'],target)).save(file.parent/'classes.png',optimize=True)
                obs['layers']['classification']=f"observations/{obs['id']}/classes.png"
                atomic(file,obs)
            observations.append(obs)
    done={o['sceneId']:o for o in observations};candidates=[]
    for s in scenes:
        if s['id'] in done:s['processingStatus']='processed';s['validCoverage']=done[s['id']]['validCoverage']
        elif s['spatialCoverage']<settings['minSceneOverlap']:s['processingStatus']='partial_scene_not_processed'
        elif s['cloudCoverage'] is None or s['cloudCoverage']>settings['maxSceneCloud']:s['processingStatus']='cloud_screened'
        else:s['processingStatus']='pending';candidates.append(s)
    # Fair backfill: one best remaining candidate per month per round, then newest month first.
    months={m:sorted([s for s in candidates if s['acquisitionDatetime'][:7]==m],key=lambda s:s['cloudCoverage']) for m in sorted({s['acquisitionDatetime'][:7] for s in candidates},reverse=True)}
    queue=[]
    while any(months.values()):
        for values in months.values():
            if values:queue.append(values.pop(0))
    budget=args.max_scenes if args.max_scenes is not None else settings['maxScenesPerRun']
    if not 0<=budget<=200:raise ValueError('Scene budget must be 0..200')
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',GDAL_HTTP_TIMEOUT='40',GDAL_HTTP_MAX_RETRY='2',GDAL_HTTP_RETRY_DELAY='1',GDAL_CACHEMAX=128):
        for s in ([] if args.catalog_only else queue[:budget]):
            print(json.dumps({'processing':s['id'],'cloudCoverage':s['cloudCoverage']}),flush=True)
            try:
                obs=process(s,settings,aoi,g,target,root,fingerprint);observations.append(obs);s['processingStatus']='processed';s['validCoverage']=obs['validCoverage']
                print(json.dumps({'completed':s['id'],'waterKm2':obs['waterAreaKm2'],'validCoverage':obs['validCoverage']}),flush=True)
            except Exception as e:
                s['processingStatus']='failed';errors.append({'sceneId':s['id'],'error':str(e)[:300]});print(json.dumps(errors[-1]),flush=True)
    observations.sort(key=lambda o:(o['observationDatetime'],o['id']))
    usable=[o for o in observations if o['usable']];change_rows=[];new_pairs=0
    # All available pairs allow arbitrary A/B dates; bounded by catalog budgets. Exact full-resolution intersection.
    for i,b in enumerate(usable):
        for a in usable[:i]:
            if a['observationDatetime'][:10]==b['observationDatetime'][:10]:continue
            ident=a['id']+'_'+b['id'];folder=root/'changes'/ident;meta=folder/'change.json'
            if meta.exists():change_rows.append(json.loads(meta.read_text()));continue
            if new_pairs>=settings['maxChangePairsPerRun']:continue
            new_pairs+=1
            with rasterio.open(root/a['rasterLocation']) as r:mask_a=r.read(1)
            with rasterio.open(root/b['rasterLocation']) as r:mask_b=r.read(1)
            values,layer=changes(mask_a,mask_b,settings['resolution']**2);folder.mkdir(parents=True,exist_ok=True)
            png_mask(preview(layer,g[0],settings['crs'],target),folder/'change.png',{1:(44,176,232,190),2:(68,235,166,220),3:(249,165,99,220),4:(164,143,186,140)})
            row={'id':ident,'observationAId':a['id'],'observationBId':b['id'],**values,'layer':f'changes/{ident}/change.png','coordinates':b['coordinates']};atomic(meta,row);change_rows.append(row)
    missing=[];date=dt.date.fromisoformat(settings['start']);last=dt.date.fromisoformat(args.end);valid_days={o['observationDatetime'][:10] for o in usable}
    while date<=last:
        day=date.isoformat()
        if day not in valid_days:
            found=[s for s in scenes if s['acquisitionDatetime'][:10]==day]
            reason='no_scene' if not found else 'pending_processing' if any(s['processingStatus']=='pending' for s in found) else 'no_usable_processed_observation'
            missing.append({'date':day,'reason':reason})
        date+=dt.timedelta(days=1)
    manifest={'version':1,'generatedAt':NOW(),'start':settings['start'],'end':args.end,'aoi':{'id':feature['id'],'name':feature['properties']['name'],'geometry':feature['geometry'],'areaKm2':g[4],'enabled':True,'official':False},
        'settings':settings,'scenes':scenes,'observations':observations,'changes':change_rows,'missingDates':missing,'acquisitions':runs,'errors':errors,
        'status':'ready' if usable else 'no_usable_observations','limitations':['Estimación satelital no validada. Detecta agua abierta; puede omitir agua bajo vegetación y confundir sombras o suelos húmedos.','No es un mapa oficial de inundación. AOI exploratoria.','Sentinel-1, Landsat, PlanetScope y escenarios físicos aún no habilitados.']}
    atomic(root/'manifest.json',manifest);atomic(root/'runs'/((NOW().replace(':','-'))+'.json'),{'generatedAt':manifest['generatedAt'],'scenes':len(scenes),'observations':len(observations),'usable':len(usable),'errors':errors,'pending':sum(s['processingStatus']=='pending' for s in scenes)})
    print(json.dumps({'scenes':len(scenes),'observations':len(observations),'usable':len(usable),'changes':len(change_rows),'errors':len(errors)}),flush=True)
if __name__=='__main__':main()
