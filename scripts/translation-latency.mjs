import { cpus, totalmem, release } from 'node:os';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, unlink, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { build } from 'vite';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dist=resolve(root,'dist');
const driver=resolve(dist,'latency-driver.mjs');
const windows=process.platform==='win32';
function run(command,args,timeout=600_000) {
  return new Promise((resolveRun,reject)=> {
    const child=spawn(command,args,{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,CARGO_BUILD_JOBS:'1'}});
    const timer=setTimeout(()=> {
      if(windows) spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      else child.kill('SIGTERM');
      reject(new Error(`${command} timed out`));
    },timeout);
    child.once('error',error=> { clearTimeout(timer); reject(error); });
    child.once('close',code=> { clearTimeout(timer); code===0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)); });
  });
}
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png'};
let connections=0, requests=0, dictionaryRequests=0; const providerConnections=new Set();
const server=createServer(async(request,response)=> {
  try {
    if(request.url==='/harness/status') {response.setHeader('Content-Type','application/json');response.end(JSON.stringify({requests}));return;}
    if(request.url==='/api/translate') {
      requests++; providerConnections.add(request.socket);
      let body=''; for await(const chunk of request) body+=chunk;
      const target=JSON.parse(body).target_lang;
      await new Promise(done=>setTimeout(done,process.env.LATENCY_RESTART_TEST ? 1000 : 40));
      response.setHeader('Content-Type','application/json');
      response.end(JSON.stringify({translations:[{text:target.startsWith('zh')?'你好世界':target.startsWith('en')?'Hello world':'xin chào',detected_source_language:'en'}]})); return;
    }
    if(request.url==='/cmu-dict.json') dictionaryRequests++;
    const pathname=decodeURIComponent(new URL(request.url || '/','http://127.0.0.1').pathname);
    const file=resolve(dist,pathname==='/' ? 'index.html' : pathname.slice(1));
    if(!file.startsWith(dist+sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type',types[extname(file)] || 'application/octet-stream');
    createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end(); }
});
server.on('connection',()=>connections++);
try {
  const npmScript=process.env.npm_execpath || resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  if(!process.env.LATENCY_SKIP_BUILD) await run(process.execPath,[npmScript,'run','build']);
  await build({root,configFile:false,publicDir:false,logLevel:'warn',define:{__LATENCY_SAMPLE_COUNT__:process.env.LATENCY_SAMPLES || (process.env.LATENCY_SHARED_TEST ? '2' : process.env.LATENCY_REAL ? '6' : '21'),__LATENCY_RECOVERY__:String(!!process.env.LATENCY_RECOVERY),__LATENCY_CRASH__:String(!!process.env.LATENCY_CRASH),__LATENCY_SHARED_TEST__:String(!!process.env.LATENCY_SHARED_TEST),__LATENCY_RESTART_TEST__:String(!!process.env.LATENCY_RESTART_TEST),__LATENCY_SOURCE__:JSON.stringify(process.env.LATENCY_SOURCE || 'en'),__LATENCY_OCR__:String(!!process.env.LATENCY_OCR)},build:{emptyOutDir:false,outDir:dist,lib:{entry:resolve(root,'tests/runtime/translation-latency.ts'),formats:['es'],fileName:()=> 'latency-driver.mjs'}}});
  await new Promise((ready,reject)=> { server.once('error',reject); server.listen(1438,'127.0.0.1',ready); });
  const reportPath=resolve(root,process.env.LATENCY_REPORT || '.scratch/translation-latency/baseline.json');
  process.env.LATENCY_REPORT=reportPath;
  const runs=[];
  for(let runId=0;runId<Number(process.env.LATENCY_RUNS || 5);runId++) {
    await run('cargo',['run','--manifest-path','src-tauri/Cargo.toml','--features','latency-harness','--example','translation_latency','-j','1'],600_000);
    const result=JSON.parse(await readFile(reportPath,'utf8'));
    const events=result.samples.flatMap(sample=>sample.events);
    for(const sample of result.samples) sample.events=events.filter(event=>!event.traceId || event.traceId===sample.traceId);
    runs.push(result);
    if(result.error) break;
  }
  const report={...runs[0],runs:runs.map(({samples,...metadata})=>metadata),samples:runs.flatMap((run,runId)=>run.samples.map(sample=>({...sample,id:`${runId}-${sample.id}`})))};
  report.errors=report.samples.filter(sample=>sample.error).length;
  report.cancellations=process.env.LATENCY_RESTART_TEST ? runs.length : 0;
  report.server={connections,requests,dictionaryRequests,providerConnections:providerConnections.size};
  const {execFileSync}=await import('node:child_process');
  report.source=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  report.sourceDiffSha256=createHash('sha256').update(execFileSync('git',['diff','HEAD','--','src','src-tauri','scripts','tests/runtime'],{cwd:root})).digest('hex');
  report.instrumentedWorkingTree=true;
  report.build='native-debug/frontend-production';
  report.provider=process.env.LATENCY_PROVIDER || (process.env.LATENCY_REAL ? 'DeepL Web real' : process.env.LATENCY_RESTART_TEST ? 'controlled HTTP 1000ms (reload functional test)' : 'controlled HTTP 40ms');
  report.machine={platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem(),osRelease:release()};
  for(const temperature of ['cold','warm']) {
    const times=report.samples.filter(s=>s.temperature===temperature && !s.error).map(s=>s.events.find(e=>e.stage==='correct-paint')?.elapsedMs).filter(Number.isFinite).sort((a,b)=>a-b);
    report[temperature]={count:times.length,p50:times[Math.ceil(times.length*.5)-1],p95:times[Math.ceil(times.length*.95)-1]};
  }
  await writeFile(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify({cold:report.cold,warm:report.warm}));
  if(process.env.LATENCY_EXPECT_REUSE && runs.some(run=>run.samples.flatMap(sample=>sample.events).filter(event=>event.stage==='view-ready').length!==(process.env.LATENCY_RECOVERY ? 2 : 1))) throw new Error('Expected one tooltip WebView per process, plus explicit recovery');
  if(process.env.LATENCY_EXPECT_REUSE && runs.some(run=> {
    const events=run.samples[0].events;
    return !(events.find(event=>event.stage==='host-start')?.elapsedMs < events.find(event=>event.stage==='view-ready')?.elapsedMs);
  })) throw new Error('Translation must start before cold WebView ready');
  if(process.env.LATENCY_EXPECT_REUSE && runs.some(run=> {
    const resources=run.samples.map(sample=>sample.events.find(event=>event.stage==='resources'));
    return resources.some(value=>!value || value.listeners<=0 || value.listeners!==resources[0]?.listeners || value.pendingRpc!==0 || (!process.env.LATENCY_OCR && value.ocrJobs!==0) || value.tooltipMailbox>1);
  })) throw new Error('Tooltip listeners or jobs grew across presentations');
  if(!process.env.LATENCY_REAL && !process.env.LATENCY_SHARED_TEST && requests!==report.samples.length*2) throw new Error('Provider request count changed');
  if(process.env.LATENCY_EXPECT_SHARED_IPA && (dictionaryRequests!==runs.length*(process.env.LATENCY_RESTART_TEST ? 2 : 1) || report.samples.flatMap(sample=>sample.events).filter(event=>event.stage==='dictionary-parse').length!==runs.length*(process.env.LATENCY_RESTART_TEST ? 2 : 1))) throw new Error(`Expected one dictionary load per host, observed ${dictionaryRequests} for ${runs.length} hosts`);
  if(process.env.LATENCY_RESTART_TEST && requests!==runs.length*10) throw new Error(`Reload issued ${requests} provider requests; expected ${runs.length*10}`);
  if(report.error || report.samples.some(s=>s.error)) throw new Error('Latency samples failed');
} finally {
  server.closeAllConnections();
  if(server.listening) await new Promise(done=>server.close(done));
  await unlink(driver).catch(()=>{});
}
