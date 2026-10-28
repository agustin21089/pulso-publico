"""Independent reference-point evaluation; no example metrics when reference labels are absent.
CSV: observation_id,longitude,latitude,water (0/1),reference_source
Reference must be acquired/verified for that exact scene date. Do not label from our own mask.
"""
import argparse, csv, json, pathlib, sys
import rasterio
from pyproj import Transformer

def metrics(predicted, reference):
    if not predicted:return {'samples':0,'precision':None,'recall':None,'f1':None,'accuracy':None}
    tp=sum(p==1 and r==1 for p,r in zip(predicted,reference));tn=sum(p==0 and r==0 for p,r in zip(predicted,reference))
    fp=sum(p==1 and r==0 for p,r in zip(predicted,reference));fn=sum(p==0 and r==1 for p,r in zip(predicted,reference))
    return {'samples':len(predicted),'tp':tp,'tn':tn,'fp':fp,'fn':fn,'precision':tp/(tp+fp) if tp+fp else None,'recall':tp/(tp+fn) if tp+fn else None,'f1':2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else None,'accuracy':(tp+tn)/len(predicted)}
def main():
    p=argparse.ArgumentParser();p.add_argument('references');p.add_argument('--root',default='data/territory');a=p.parse_args();root=pathlib.Path(a.root)
    m=json.loads((root/'manifest.json').read_text());observations={o['id']:o for o in m['observations']};predicted=[];reference=[];excluded=0;sources=set();seen=set()
    with open(a.references,newline='') as f:
        for row in csv.DictReader(f):
            oid=row['observation_id'];lon=float(row['longitude']);lat=float(row['latitude']);truth=int(row['water']);source=row['reference_source'].strip()
            if oid not in observations or truth not in (0,1) or not source or not (-180<=lon<=180 and -90<=lat<=90):raise ValueError('Invalid reference')
            with rasterio.open(root/observations[oid]['rasterLocation']) as raster:
                x,y=Transformer.from_crs('EPSG:4326',raster.crs,always_xy=True).transform(lon,lat);pixel=raster.index(x,y);key=(oid,*pixel)
                if key in seen:raise ValueError('Repeated reference pixel would inflate sample size')
                seen.add(key);value=int(next(raster.sample([(x,y)]))[0]);sources.add(source)
            if value not in (1,2):excluded+=1;continue
            predicted.append(int(value==2));reference.append(truth)
    print(json.dumps({**metrics(predicted,reference),'excludedInvalid':excluded,'referenceSources':sorted(sources),'warning':'Point-sample evaluation only; does not automatically validate area estimates. Check independence and sampling design.'},indent=2))
if __name__=='__main__':main()
