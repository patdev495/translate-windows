import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, unlink, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { build } from 'vite';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dist=resolve(root,'dist');
const driver=resolve(dist,'smoke-driver.mjs');
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
const server=createServer(async(request,response)=> {
  try {
    const pathname=decodeURIComponent(new URL(request.url || '/','http://127.0.0.1').pathname);
    const file=resolve(dist,pathname==='/' ? 'index.html' : pathname.slice(1));
    if(!file.startsWith(dist+sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type',types[extname(file)] || 'application/octet-stream');
    createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end(); }
});
try {
  const npmScript=process.env.npm_execpath || resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  if(!process.env.UI_SKIP_BUILD) await run(process.execPath,[npmScript,'run','build']);
  await build({root,configFile:false,publicDir:false,logLevel:'warn',build:{emptyOutDir:false,outDir:dist,lib:{entry:resolve(root,'tests/runtime/extension-ui-smoke.ts'),formats:['es'],fileName:()=> 'smoke-driver.mjs'}}});
  await new Promise((ready,reject)=> { server.once('error',reject); server.listen(1438,'127.0.0.1',ready); });
  const reportPath=resolve(root,'.scratch/extension-parity/ui-smoke-results.json');
  await writeFile(reportPath,'{}');
  await run('cargo',['run','--manifest-path','src-tauri/Cargo.toml','--example','extension_ui_smoke','-j','1'],600_000);
  const reports=JSON.parse(await readFile(reportPath,'utf8'));
  for (const label of ['main','settings','pdf','tooltip','hanzi-breakdown']) {
    if(!reports[label] || reports[label].error) throw new Error(`UI smoke ${label}: ${reports[label]?.error || 'missing report'}`);
  }
} finally {
  server.closeAllConnections();
  if(server.listening) await new Promise(done=>server.close(done));
  await unlink(driver).catch(()=>{});
}
