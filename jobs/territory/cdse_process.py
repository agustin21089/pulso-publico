"""Optional CDSE Process adapter. Requires an explicit invocation and OAuth credentials.
Not invoked by the free COG updater. This returns reflectance bands, never fabricated water metrics.
"""
import json, os, urllib.request, urllib.parse
TOKEN_URL='https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
PROCESS_URL='https://sh.dataspace.copernicus.eu/process/v1'
EVALSCRIPT='''//VERSION=3
function setup() { return { input: [{ bands: ["B02","B03","B04","B08","B11","SCL","dataMask"], units: ["REFLECTANCE","REFLECTANCE","REFLECTANCE","REFLECTANCE","REFLECTANCE","DN","DN"] }], output: { bands: 7, sampleType: "FLOAT32" }, mosaicking: "SIMPLE" }; }
function evaluatePixel(s) { return [s.B02,s.B03,s.B04,s.B08,s.B11,s.SCL,s.dataMask]; }
'''
def process_single_acquisition(bbox, start, end, width, height):
    # Caller must supply a short interval isolating the catalogued acquisition, never a monthly mosaic.
    import datetime as dt
    a=dt.datetime.fromisoformat(start.replace('Z','+00:00'));b=dt.datetime.fromisoformat(end.replace('Z','+00:00'))
    if a.tzinfo is None or b.tzinfo is None or not 0<(b-a).total_seconds()<=120:raise ValueError('Isolate one acquisition within 120 seconds')
    if not (1<=width<=2500 and 1<=height<=2500):raise ValueError('Bound Process dimensions to service limits')
    client=os.environ.get('CDSE_CLIENT_ID');secret=os.environ.get('CDSE_CLIENT_SECRET')
    if not client or not secret:raise RuntimeError('Configure CDSE_CLIENT_ID and CDSE_CLIENT_SECRET on server only')
    data=urllib.parse.urlencode({'grant_type':'client_credentials','client_id':client,'client_secret':secret}).encode()
    with urllib.request.urlopen(urllib.request.Request(TOKEN_URL,data=data),timeout=30) as r:token=json.load(r)['access_token']
    payload={'input':{'bounds':{'bbox':bbox,'properties':{'crs':'http://www.opengis.net/def/crs/EPSG/0/4326'}},'data':[{'type':'sentinel-2-l2a','dataFilter':{'timeRange':{'from':start,'to':end}}}]},'output':{'width':width,'height':height,'responses':[{'identifier':'default','format':{'type':'image/tiff'}}]},'evalscript':EVALSCRIPT}
    req=urllib.request.Request(PROCESS_URL,data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'image/tiff'})
    with urllib.request.urlopen(req,timeout=90) as r:return r.read()
