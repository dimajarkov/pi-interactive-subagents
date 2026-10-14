import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startOwner} from '../scripts/qa/chrome-owner.mjs';

test('invalid owner admission cannot allocate or launch a browser', async () => {
  let effects=0;
  const deps={platform:'darwin',env:{HERDR_ENV:'1',HERDR_SESSION:'handovers'},cwd:'/repo',sourceRoot:'/repo',preflight(){effects++;}};
  for (const argv of [[],['--task','bad;command'],['--task','proof','--url','https://example.org'],['--task','proof','--receipt','old']]) {
    await assert.rejects(startOwner(argv,deps),/task|option/i);
  }
  await assert.rejects(startOwner(['--task','proof'],{...deps,platform:'linux'}),/macOS/);
  await assert.rejects(startOwner(['--task','proof'],{...deps,cwd:'/other'}),/physical/);
  await assert.rejects(startOwner(['--task','proof'],{...deps,env:{HERDR_ENV:'1',HERDR_SESSION:'handovers',CHROME_BIN:'/foreign'}}),/override/);
  assert.equal(effects,0);
});

function fixtureDeps(report:any={version:1,ownership:'verified',targets:{status:'ready',reason:'ready',counts:{permitted_page:1,permitted_worker:0,internal_page:0,internal_non_page:0,foreign_target:0,unsupported_type:0,malformed_target:0}}}) {
  const calls:any[]=[];
  const deps:any={platform:'darwin',env:{HERDR_ENV:'1',HERDR_SESSION:'handovers'},cwd:'/repo',sourceRoot:'/repo',now:()=>1000,
    preflight(){calls.push(['preflight']);return {session:'handovers',workspace:'w1',pane:'w1:p1'};},
    createState(){return {directory:'/private/state',token:'UNIQUE_TOKEN'};},
    async startFixture(){calls.push(['fixture']);return {port:41001,close(){calls.push(['closeFixture']);}};},
    async reservePort(){return 41002;},
    guard(args:any){calls.push(['guard',args]);return args.includes('prepare-profile')?JSON.stringify({receipt:'/registry/new/receipt.json',profile:'/registry/new/profile',expires:new Date(7201000).toISOString()}):JSON.stringify(report);},
    validateAllocation(){calls.push(['validateAllocation']);},
    launchChrome(args:any){calls.push(['launch',args]);return {pid:12345};},save(s:any){calls.push(['save',s.phase]);},sleep:async()=>{},timeoutMs:1,
  };return {deps,calls};
}

test('owned launch uses only fresh preparation and the exact vendor isolation argv',async()=>{
 const {deps,calls}=fixtureDeps();const owner=await startOwner(['--task','proof'],deps);
 assert.equal(owner.state.phase,'ready');
 assert.deepEqual(calls.find(x=>x[0]==='guard')[1],['--repo-qa','proof','prepare-profile','--target','http://127.0.0.1:41001']);
 assert.deepEqual(calls.find(x=>x[0]==='launch')[1],['--user-data-dir=/registry/new/profile','--remote-debugging-port=41002','--remote-debugging-address=127.0.0.1','--disable-sync','--disable-extensions','--use-mock-keychain','--password-store=basic','--no-first-run','--no-default-browser-check','about:blank']);
 assert.deepEqual(calls.filter(x=>x[0]==='guard')[1][1],['--repo-qa','proof','attach','/registry/new/receipt.json','--pid','12345','--port','41002','diagnose']);
});

test('malformed preparation or failed caller identity cannot launch Chrome',async()=>{
 const {deps,calls}=fixtureDeps();deps.guard=()=>JSON.stringify({receipt:'/old',profile:'/old'});
 await assert.rejects(startOwner(['--task','proof'],deps),/preparation/);
 assert.equal(calls.some(x=>x[0]==='launch'),false);
 const second=fixtureDeps();second.deps.preflight=()=>{throw new Error('foreign foreground caller');};
 await assert.rejects(startOwner(['--task','proof'],second.deps),/foreign/);
 assert.equal(second.calls.some(x=>x[0]==='fixture'),false);
});

test('diagnose exit success is never mistaken for proof readiness',async()=>{
 for(const report of [
  {version:1,ownership:'verified',targets:{status:'blocked',reason:'scope_refused',counts:{permitted_page:1,unsupported_type:2}}},
  {version:1,ownership:'unknown',targets:{status:'ready',reason:'ready',counts:{permitted_page:1}}},
  {version:1,ownership:'verified',targets:{status:'ready',reason:'ready',counts:{permitted_page:1,foreign_target:1}}},
  {version:1,ownership:'verified'},
 ]) {
  const {deps,calls}=fixtureDeps(report);await assert.rejects(startOwner(['--task','proof'],deps),/blocked|scope/);
  assert.equal(calls.some(x=>x[0]==='save'&&x[1]==='ready'),false);
  assert.equal(calls.filter(x=>x[0]==='closeFixture').length,1);
 }
});

test('guard startup timeout retains exact Chrome state and never kills or deletes',async()=>{
 const {deps,calls}=fixtureDeps();let time=1000;deps.now=()=>time;deps.sleep=async()=>{time+=5;};
 const original=deps.guard;deps.guard=(args:any)=>{if(args.includes('diagnose'))throw Object.assign(new Error('owned endpoint unavailable'),{retryable:true});return original(args);};
 let state:any;
 await assert.rejects(startOwner(['--task','proof'],deps),(error:any)=>{state=error.state;return /timeout/.test(error.message);});
 assert.equal(state.pid,12345);assert.equal(state.phase,'blocked');assert.equal(state.receipt,'/registry/new/receipt.json');
 assert.equal(calls.filter(x=>x[0]==='closeFixture').length,1);
 assert.equal(calls.some(x=>x[0]==='kill'||x[0]==='delete'),false);
});

test('owner interruption closes only its own synthetic fixture',async()=>{
 const {deps,calls}=fixtureDeps();const owner=await startOwner(['--task','proof'],deps);await owner.closeFixture();
 assert.equal(calls.filter(x=>x[0]==='closeFixture').length,1);
 assert.equal(calls.some(x=>x[0]==='kill'||x[0]==='delete'),false);
 assert.equal(owner.state.phase,'retained');
});

test('synthetic HTTP fixture cannot serve local files or nonlocal routes',async()=>{
 const {startFixture}=await import('../scripts/qa/chrome-owner.mjs');
 const fixture=await startFixture('TEST_TOKEN_123');
 try {
  assert.equal(fixture.host,'127.0.0.1');
  const root=await fetch(`http://127.0.0.1:${fixture.port}/`);const body=await root.text();
  assert.equal(root.status,200);assert.match(body,/TEST_TOKEN_123/);assert.match(body,/Fabricated QA account/);
  assert.match(root.headers.get('content-security-policy')!,/connect-src 'none'/);
  assert.equal((await fetch(`http://127.0.0.1:${fixture.port}/etc/passwd`)).status,404);
  assert.equal((await fetch(`http://127.0.0.1:${fixture.port}/`,{method:'POST'})).status,405);
 } finally {await fixture.close();}
});

test('owned Chrome exit before admission cannot become ready',async()=>{
 const {deps,calls}=fixtureDeps();deps.launchChrome=(_args:any,state:any)=>{state.chromeExited=true;return {pid:12345};};
 await assert.rejects(startOwner(['--task','proof'],deps),/exited/);
 assert.equal(calls.some(x=>x[0]==='save'&&x[1]==='ready'),false);
});

test('caller identity rejects borrowed pane IDs and coding-agent owner panes',async()=>{
 const {verifyHerdrCaller}=await import('../scripts/qa/chrome-owner.mjs');
 const env={HERDR_SESSION:'handovers',HERDR_WORKSPACE_ID:'w1',HERDR_TAB_ID:'w1:t1',HERDR_PANE_ID:'w1:p1'};
 const pane={pane_id:'w1:p1',workspace_id:'w1',tab_id:'w1:t1',cwd:'/repo',foreground_cwd:'/repo'};
 const info={pane_id:'w1:p1',shell_pid:10,foreground_processes:[{pid:20}]};
 assert.equal(verifyHerdrCaller(pane,info,env,'/repo',20).owner,20);
 for(const changed of [{...pane,pane_id:'w2:p1'},{...pane,cwd:'/foreign'},{...pane,agent:'pi'}])assert.throws(()=>verifyHerdrCaller(changed,info,env,'/repo',20),/unverified/);
 assert.throws(()=>verifyHerdrCaller(pane,{...info,foreground_processes:[{pid:99}]},env,'/repo',20),/unverified/);
});

test('fixed Chrome spawn isolates signals without unreferencing its owned handle',async()=>{
 const {launchOwnedChrome}=await import('../scripts/qa/chrome-owner.mjs');
 const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'pi-owner-spawn-test-'));let invocation:any;let unreferenced=false;
 const handle={pid:23456,once(){return this;},unref(){unreferenced=true;}};
 const result=launchOwnedChrome(['about:blank'],{cwd:'/repo',env:{},log:join(dir,'chrome.log')},(file:any,args:any,options:any)=>{invocation={file,args,options};return handle;});
 assert.equal(result,handle);assert.equal(invocation.file,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
 assert.equal(invocation.options.detached,true);assert.equal(unreferenced,false);
});

test('preparation requires a bounded string expiry before any launch',async()=>{
 for(const expires of [[new Date(7201000).toISOString()],new Date(9999999999999).toISOString()]) {
  const {deps,calls}=fixtureDeps();deps.guard=()=>JSON.stringify({receipt:'/registry/new/receipt.json',profile:'/registry/new/profile',expires});
  await assert.rejects(startOwner(['--task','proof'],deps),/preparation/);
  assert.equal(calls.some(x=>x[0]==='launch'),false);
 }
});
