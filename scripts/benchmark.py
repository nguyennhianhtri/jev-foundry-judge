"""Benchmark: all sample rows + generated defect cases, Jev + Foundry LLM judge, via the LIVE app."""
import json,os,sys,time,urllib.request
B=sys.argv[1]; OUT=sys.argv[2]; K=os.environ['JEV_API_KEY']
def P(p,b,k=False):
    h={'Content-Type':'application/json'}
    if k:h['X-Jev-Key']=K
    return json.load(urllib.request.urlopen(urllib.request.Request(B+p,json.dumps(b).encode(),h),timeout=900))
rows=[r for s in json.load(urllib.request.urlopen(B+'/api/samples')) for r in s['rows']]
gen=P('/api/generate',{'rows':[r for r in rows if r['note'].startswith('good')]})['rows']
rows+=gen
res=[]; t=time.time()
for i in range(0,len(rows),5):
    res+=P('/api/judge',{'rows':rows[i:i+5],'baseline':True},True)['results']; print(len(res),flush=True)
wall=time.time()-t
sm=P('/api/summary',{'results':res}); sm['wall_s']=round(wall,1); sm['app']=B
sm['version']=json.load(urllib.request.urlopen(B+'/healthz'))['version']; sm['at']=time.strftime('%Y-%m-%dT%H:%M:%S%z')
open(f'{OUT}/dataset.jsonl','w').write(''.join(json.dumps(r)+'\n' for r in rows))
open(f'{OUT}/results.jsonl','w').write(''.join(json.dumps(r)+'\n' for r in res))
json.dump(sm,open(f'{OUT}/summary.json','w'),indent=1)
print(json.dumps({k:sm[k] for k in ['rows','jev','llm','overall','wall_s','version']},indent=1))
for m,v in sm['metrics'].items(): print(m, v['jev_vs_human'], v['llm_vs_human'])
