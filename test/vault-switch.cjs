'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {createRequire} = require('node:module');

function desktop(t) {
  const project = path.resolve(process.env.GRAPHITE_TEST_APP || path.join(__dirname,'..'));
  const main = path.join(project,'electron','main.js'), load = createRequire(main);
  const home = fs.mkdtempSync(path.join(os.tmpdir(),'graphite-switch-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const old = path.join(home,'first'), next = path.join(home,'second');
  fs.mkdirSync(old); fs.mkdirSync(next);
  const config = path.join(home,'config.json');
  fs.writeFileSync(config,JSON.stringify({vault:old}));
  const state = {disabled:false,destroyed:false,flush:async()=>({ok:true}),failStorage:false,failLaunch:false,relaunches:0,exits:0,dialogs:[],warningAnswer:1,vaultChoice:0};
  class Window extends EventEmitter {
    constructor() {
      super(); this.webContents=Object.assign(new EventEmitter(), {setWindowOpenHandler(){}, executeJavaScript:async code=>{
        if (code.includes('__moFlush')) return state.flush();
        if (state.failStorage) throw Error('settings unavailable');
        return '{}';
      }});
    }
    isEnabled(){return !state.disabled;} setEnabled(value){state.disabled=!value;}
    isDestroyed(){return state.destroyed;} destroy(){state.destroyed=true;}
    isMaximized(){return false;} isFullScreen(){return false;} getBounds(){return {width:1000,height:600};} loadURL(){}
  }
  const app={isPackaged:false,getPath:()=>home,getLocale:()=>'en',getVersion:()=>'1.1.45',requestSingleInstanceLock:()=>false,quit(){},
    relaunch(){if(state.failLaunch)throw Error('launch failed');state.relaunches++;},exit(){state.exits++;}};
  const dialog={showOpenDialog:async()=>({filePaths:[next]}),showSaveDialog:async()=>({filePath:next}),showMessageBox:async(_win,opts)=>{
    if (opts.type==='question') return {response:state.vaultChoice};
    state.dialogs.push(opts);return {response:state.warningAnswer};
  }};
  const ctx=vm.createContext({require:id=>id==='electron'?{app,BrowserWindow:Window,dialog}:load(id),
    __dirname:path.dirname(main),process:{argv:['Graphite','--user-data-dir='+home],pid:process.pid,platform:process.platform},
    URL,setTimeout,clearTimeout,console:{...console,warn(){}},old});
  const source=fs.readFileSync(main,'utf8');
  const api=vm.runInContext(source+'\nloadConfig(); VAULT=old; createWindow("http://127.0.0.1:9988"); ({chooseVault,close:()=>win.emit("close",{preventDefault(){}}),isClosing:()=>closing})',ctx);
  return {state,api,old,next,config,saved:()=>JSON.parse(fs.readFileSync(config,'utf8')).vault};
}

test('creating a vault seeds a genuinely empty directory but preserves one containing only hidden settings',async t=>{
  const fresh=desktop(t);
  fresh.state.vaultChoice=1;
  assert.equal(await fresh.api.chooseVault(),true);
  assert.ok(fs.existsSync(path.join(fresh.next,'Welcome.md')));

  const existing=desktop(t);
  const settings=path.join(existing.next,'.obsidian','community-plugins.json');
  fs.mkdirSync(path.dirname(settings),{recursive:true});
  const custom='["my-existing-plugin"]\n';
  fs.writeFileSync(settings,custom);
  existing.state.vaultChoice=1;
  assert.equal(await existing.api.chooseVault(),true);
  assert.equal(fs.readFileSync(settings,'utf8'),custom);
  assert.deepEqual(fs.readdirSync(existing.next),['.obsidian']);
});

test('a vault switch keeps the old window and selected vault on any save failure, then succeeds on retry',async t=>{
  const {state,api,old,next,saved}=desktop(t);
  state.flush=async()=>({ok:false,unsaved:[{path:'lecture.md',text:'draft'}]});
  assert.equal(await api.chooseVault(),false); assert.equal(saved(),old);
  state.flush=async()=>({ok:true});state.failStorage=true;
  assert.equal(await api.chooseVault(),false);assert.equal(saved(),old);
  state.failStorage=false;state.failLaunch=true;
  assert.equal(await api.chooseVault(),false);assert.equal(saved(),old);
  assert.deepEqual([state.disabled,state.relaunches,state.exits],[false,0,0]);
  state.failLaunch=false;
  let finish;state.flush=()=>new Promise(r=>{finish=r;});
  const changing=api.chooseVault();
  await new Promise(setImmediate);
  assert.equal(state.disabled,true);assert.equal(await api.chooseVault(),false);
  api.close();assert.equal(state.destroyed,false);assert.equal(saved(),old);
  finish({ok:true});assert.equal(await changing,true);
  assert.equal(saved(),next);assert.deepEqual([state.relaunches,state.exits],[1,1]);
});

test('failed review persistence keeps the window open until the review can be written',async t=>{
  const {state,api}=desktop(t);
  const close=async()=>{api.close();while(api.isClosing())await new Promise(setImmediate);};
  state.flush=async()=>({ok:false,reviewUnsaved:true,unsaved:[]});
  await close();assert.equal(state.destroyed,false);assert.equal(state.dialogs.at(-1).buttons.length,2);
  state.flush=async()=>({ok:true,unsaved:[]});await close();assert.equal(state.destroyed,true);
});

test('project drafts survive an unavailable browser store or a failed desktop settings write',async t=>{
  const {state,api}=desktop(t);
  async function close(){api.close();while(api.isClosing())await new Promise(setImmediate);}
  state.flush=async()=>({ok:false,projectUnsaved:true,projectMessage:'Keep editing',unsaved:[]});
  await close();assert.equal(state.destroyed,false);assert.equal(state.dialogs.at(-1).message,'Keep editing');
  state.flush=async()=>({ok:true,hasProjectDrafts:true,unsaved:[]});
  state.failStorage=true;await close();assert.equal(state.destroyed,false);
  state.failStorage=false;await close();assert.equal(state.destroyed,true);
});
