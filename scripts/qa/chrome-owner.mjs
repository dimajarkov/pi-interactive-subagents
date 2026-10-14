import {execFileSync,spawn} from 'node:child_process';
import {accessSync,chmodSync,closeSync,constants,lstatSync,mkdtempSync,openSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {createServer as createNetServer} from 'node:net';
import {homedir,tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function startOwner(argv, deps) {
  if (argv.length !== 2 || argv[0] !== '--task' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(argv[1] || '')) throw new Error('Only --task <fresh bounded task> is supported');
  if (deps.platform !== 'darwin') throw new Error('Chrome QA owner requires macOS');
  if (deps.cwd !== deps.sourceRoot) throw new Error('Use this checkout physical Git root');
  if (Object.keys(deps.env).some(k => /^(CHROME_DEVTOOLS_|DOTFILES_BROWSER_POLICY_|PUPPETEER_|PLAYWRIGHT_|npm_config_)/i.test(k) || ['NODE_OPTIONS','NODE_PATH','BROWSER','CHROME_BIN','CHROMIUM_BIN','GOOGLE_CHROME_SHIM','CHROME_PATH','CHROME_EXECUTABLE','DEBUG','NODE_DEBUG'].includes(k))) throw new Error('Browser/runtime override must be cleared');
  if (deps.env.HERDR_ENV !== '1' || !/^[A-Za-z0-9_.-]{1,64}$/.test(deps.env.HERDR_SESSION || '')) throw new Error('Live named Herdr caller required');
  const task=argv[1];
  const caller=deps.preflight();
  const state={...deps.createState(),task,repo:deps.cwd,caller,phase:'preparing'};
  let fixture;
  try {
    fixture=await deps.startFixture(state.token);
    state.origin=`http://127.0.0.1:${fixture.port}`;
    state.port=await deps.reservePort();
    const preparation=JSON.parse(deps.guard(['--repo-qa',task,'prepare-profile','--target',state.origin]));
    if (!preparation || Object.keys(preparation).sort().join(',') !== 'expires,profile,receipt' || typeof preparation.receipt !== 'string' || typeof preparation.profile !== 'string' || typeof preparation.expires !== 'string' || Date.parse(preparation.expires)>deps.now()+7200000 || !Number.isFinite(Date.parse(preparation.expires)) || Date.parse(preparation.expires)<=deps.now()) throw new Error('Invalid guard preparation output');
    deps.validateAllocation(preparation);
    Object.assign(state,preparation);
    state.phase='allocated';deps.save(state);
    const chrome=deps.launchChrome([`--user-data-dir=${state.profile}`,`--remote-debugging-port=${state.port}`,'--remote-debugging-address=127.0.0.1','--disable-sync','--disable-extensions','--use-mock-keychain','--password-store=basic','--no-first-run','--no-default-browser-check','about:blank'],state);
    if(!Number.isSafeInteger(chrome.pid)||chrome.pid<1) throw new Error('Owned Chrome process failed to start');
    state.pid=chrome.pid;state.phase='launched';deps.save(state);
    const attach=['--repo-qa',task,'attach',state.receipt,'--pid',String(state.pid),'--port',String(state.port)];
    const deadline=deps.now()+(deps.timeoutMs ?? 15000);
    let report;
    while(true) {
      if(state.chromeExited) throw new Error('Owned Chrome exited before proof readiness');
      try { report=JSON.parse(deps.guard([...attach,'diagnose']));break; }
      catch(error) {
        if(!error.retryable) throw error;
        if(deps.now()>=deadline) throw new Error('Owned Chrome guard startup timeout');
        await deps.sleep(500);
      }
    }
    if(state.chromeExited) throw new Error('Owned Chrome exited before proof readiness');
    state.report=report;
    const counts=report?.targets?.counts;
    const keys=['permitted_page','permitted_worker','internal_page','internal_non_page','foreign_target','unsupported_type','malformed_target'];
    if(report?.version!==1 || report.ownership!=='verified' || report.targets?.status!=='ready' || report.targets?.reason!=='ready' || !counts || Object.keys(counts).sort().join(',')!==keys.sort().join(',') || keys.some(k=>!Number.isSafeInteger(counts[k])||counts[k]<0) || counts.permitted_page<1 || keys.filter(k=>!k.startsWith('permitted_')).some(k=>counts[k]!==0)) throw new Error('Guard ownership or target scope blocked');
    state.phase='ready';deps.save(state);
    let closed=false;
    return {state,closeFixture:async()=>{if(closed)return;closed=true;await fixture.close();state.phase='retained';deps.save(state);}};
  } catch(error) {
    state.phase='blocked';state.reason=error.message;deps.save(state);
    await fixture?.close();
    throw Object.assign(new Error(`Proof blocked; resources retained at ${state.directory}: ${error.message}`),{state});
  }
}

export async function startFixture(token) {
  if(!/^[A-Za-z0-9_]{1,64}$/.test(token)) throw new Error('Invalid synthetic fixture token');
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>Pi QA ${token}</title><style>body{font:20px system-ui;margin:40px}h1{color:#165ad4}strong{color:#078b44}button,input{font:inherit;margin:12px}</style></head><body><h1>Pi Browser Visual Proof 41</h1><strong>${token}</strong><p>Fabricated QA account: qa@example.invalid</p><button id="increment">Increment</button><output id="count">0</output><label>Draft <input id="draft"></label><p id="echo"></p><script nonce="${token}">document.getElementById('increment').onclick=()=>{const c=document.getElementById('count');c.textContent=String(Number(c.textContent)+1)};document.getElementById('draft').oninput=e=>{document.getElementById('echo').textContent=e.target.value};</script></body></html>`;
  const server=createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${token}'; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`);
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    if(req.url!=='/'){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.method==='HEAD'?'':html);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {host:'127.0.0.1',port:server.address().port,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections();})};
}

export function verifyHerdrCaller(pane,info,env,cwd,pid) {
  if(!/^w[A-Za-z0-9]+$/.test(env.HERDR_WORKSPACE_ID||'') || !env.HERDR_TAB_ID?.startsWith(`${env.HERDR_WORKSPACE_ID}:t`) || !env.HERDR_PANE_ID?.startsWith(`${env.HERDR_WORKSPACE_ID}:p`) || pane?.pane_id!==env.HERDR_PANE_ID || pane.workspace_id!==env.HERDR_WORKSPACE_ID || pane.tab_id!==env.HERDR_TAB_ID || pane.cwd!==cwd || (pane.foreground_cwd&&pane.foreground_cwd!==cwd) || pane.agent || pane.agent_session || info?.pane_id!==pane.pane_id || !Number.isInteger(info.shell_pid) || !info.foreground_processes?.some(p=>p.pid===pid)) throw new Error('Current ordinary Herdr foreground caller is unverified');
  return {session:env.HERDR_SESSION,workspace:pane.workspace_id,tab:pane.tab_id,pane:pane.pane_id,shell:info.shell_pid,owner:pid};
}

/** Test injection is import-only; CLI uses fixed spawn and executable. */
export function launchOwnedChrome(args,options,spawnImpl=spawn) {
  const log=openSync(options.log,'wx',0o600);
  try {
    // Separate signal group prevents owner Ctrl+C reaching Chrome. Keep handle referenced.
    return spawnImpl(CHROME,args,{cwd:options.cwd,env:options.env,stdio:['ignore',log,log],detached:true});
  } finally {closeSync(log);}
}

function productionDependencies() {
  const cwd=realpathSync(process.cwd());
  const sourceRoot=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'../..'));
  const home=homedir();
  const guard=join(home,'.local/bin/chrome-devtools-axi');
  const herdr='/opt/homebrew/bin/herdr';
  let directory;
  const execute=(file,args)=>execFileSync(file,args,{cwd,env:process.env,encoding:'utf8',timeout:5000,maxBuffer:256000});
  function privateObject(path,isDirectory) {
    const st=lstatSync(path);
    if(st.isSymbolicLink() || st.uid!==process.getuid() || (st.mode&0o077)!==0 || (isDirectory?!st.isDirectory():!st.isFile())) throw new Error('Guard allocation lacks private owned regular resources');
  }
  return {
    platform:process.platform,env:process.env,cwd,sourceRoot,now:Date.now,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
    preflight(){
      if(execute('/usr/bin/git',['rev-parse','--show-toplevel']).trim()!==cwd) throw new Error('Use physical Git root');
      accessSync(guard,constants.X_OK);accessSync(CHROME,constants.X_OK);
      execute('/usr/bin/codesign',['--verify','-R','=anchor apple generic and identifier "com.google.Chrome" and certificate leaf[subject.OU] = "EQHXZ8M8AV"','/Applications/Google Chrome.app']);
      const args=['--session',process.env.HERDR_SESSION];
      const pane=JSON.parse(execute(herdr,[...args,'pane','current','--current'])).result?.pane;
      const info=JSON.parse(execute(herdr,[...args,'pane','process-info','--current'])).result?.process_info;
      return {...verifyHerdrCaller(pane,info,process.env,cwd,process.pid),sourceHead:execute('/usr/bin/git',['rev-parse','HEAD']).trim()};
    },
    createState(){directory=mkdtempSync(join(realpathSync(tmpdir()),'pi-chrome-owner-'));chmodSync(directory,0o700);return {directory,token:`PI41_${randomBytes(8).toString('hex').toUpperCase()}`};},
    startFixture,
    async reservePort(){const s=createNetServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;},
    guard(args){
      try {return execute(guard,args);}
      catch(error){
        const stderr=String(error.stderr||'');
        const allowed=/owned loopback endpoint failed a bounded metadata probe|loopback listener does not belong exclusively to the verified process/.test(stderr);
        throw Object.assign(new Error('Public guard diagnosis/preparation refused'),{retryable:allowed});
      }
    },
    validateAllocation(p){
      const parent=dirname(p.receipt);const token=basename(parent);
      if(!/^[a-f0-9]{32}$/.test(token)||parent!==join(home,'.chrome-devtools-axi/qa-allocations',token)||p.receipt!==join(parent,'receipt.json')||p.profile!==join(parent,'profile')) throw new Error('Guard preparation path outside fresh allocation registry');
      privateObject(parent,true);privateObject(p.receipt,false);privateObject(p.profile,true);
    },
    launchChrome(args,state){
      const child=launchOwnedChrome(args,{cwd,env:process.env,log:join(directory,'chrome.log')});
      child.once('error',()=>{});
      child.once('exit',()=>{state.chromeExited=true;});
      return child;
    },
    save(state){const temp=join(directory,'state.next');writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600,flag:'wx'});renameSync(temp,join(directory,'state.json'));},
  };
}

async function main() {
  let owner;
  try {
    owner=await startOwner(process.argv.slice(2),productionDependencies());
    console.log(`Guard ready. Private task state: ${join(owner.state.directory,'state.json')}`);
    console.log('Keep this owner foreground. Start public attach bridge synchronously in another ordinary shell in this same workspace. Root must verify its exact task window before native Computer Use.');
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;await owner.closeFixture();console.log(`Fixture closed; external Chrome/profile retained: ${owner.state.directory}`);process.exit(0);};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  } catch(error){console.error(error.message);process.exitCode=1;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
