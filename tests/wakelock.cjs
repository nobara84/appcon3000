// Hardware-free tests for the separate wake-lock controller.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const code=html.match(/<script id="wake-lock-script">([\s\S]*?)<\/script>/)[1];
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function target(){return {handlers:{},textContent:'',checked:false,hidden:false,disabled:false,
 addEventListener(name,handler){(this.handlers[name]??=[]).push(handler);},
 emit(name){for(const handler of this.handlers[name]||[])handler();}};}
function lock(){return {...target(),released:false,releases:0,
 async release(){this.releases++;this.released=true;this.emit('release');}};}
function setup({saved=false,supported=true,request,brokenStorage=false}={}){
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,target());return nodes.get(id);};
 const document={...target(),visibilityState:'visible',getElementById:get};const window=target();
 const storage=new Map(saved?[['appcon3000.wakeLockPreferred','true']]:[]);
 const calls=[];const locks=[];
 const navigator=supported?{wakeLock:{request(type){calls.push(type);if(request)return request();const result=lock();locks.push(result);return Promise.resolve(result);}}}:{};
 const context=vm.createContext({document,window,navigator,session:null,connecting:false,console:{debug(){}},localStorage:{
 getItem:k=>{if(brokenStorage)throw Error('blocked');return storage.get(k)??null;},
 setItem:(k,v)=>{if(brokenStorage)throw Error('blocked');storage.set(k,v);}}});
 vm.runInContext(code,context);
 return {get,document,window,storage,calls,locks,context,
 async toggle(value){get('wake-enabled').checked=value;get('wake-enabled').emit('change');await settle();},
 async visibility(value){document.visibilityState=value;document.emit('visibilitychange');await settle();}};
}
(async()=>{
 let app=setup({saved:true});
 assert(app.get('wake-enabled').checked);assert.equal(app.calls.length,0);
 await app.visibility('hidden');await app.visibility('visible');assert.equal(app.calls.length,0);
 app.get('connect').emit('click');await settle();assert.deepEqual(app.calls,['screen']);
 assert.equal(app.get('wake-status').textContent,'Bildschirm bleibt eingeschaltet');
 await app.locks[0].release();await settle();assert.equal(app.calls.length,1); // no release retry loop
 await app.visibility('hidden');await app.visibility('visible');assert.equal(app.calls.length,2);
 await app.toggle(false);assert.equal(app.locks[1].releases,1);assert.equal(app.storage.get('appcon3000.wakeLockPreferred'),'false');
 await app.visibility('hidden');await app.visibility('visible');assert.equal(app.calls.length,2);
 assert.deepEqual([...app.storage.keys()],['appcon3000.wakeLockPreferred']);
 app=setup();app.get('connect').emit('click');await settle();assert.equal(app.calls.length,0);
 await app.toggle(true);assert.equal(app.calls.length,1);
 await app.visibility('hidden');assert.equal(app.locks[0].releases,1);
 await app.visibility('visible');assert.equal(app.calls.length,2);
 app.window.emit('pagehide');await settle();assert.equal(app.locks[1].releases,1);
 await app.visibility('visible');assert.equal(app.calls.length,2);
 app=setup({supported:false});await app.toggle(true);
 assert(app.get('wake-status').textContent.includes('Automatische Sperre'));assert.equal(app.calls.length,0);
 app=setup({request:()=>Promise.reject(Error('denied'))});await app.toggle(true);
 assert.equal(app.calls.length,1);assert(app.get('wake-status').textContent.includes('abgelehnt'));
 await settle();assert.equal(app.calls.length,1);await app.visibility('hidden');await app.visibility('visible');
 assert.equal(app.calls.length,2);await settle();assert.equal(app.calls.length,2);
 // A pending request is serialized, and its late result is released after disabling.
 let resolve;app=setup({request:()=>new Promise(r=>resolve=r)});
 await app.toggle(true);app.get('wake-retry').emit('click');await app.visibility('visible');assert.equal(app.calls.length,1);
 await app.toggle(false);const late=lock();resolve(late);await settle();assert.equal(late.releases,1);
 assert.equal(app.calls.length,1);assert.equal(app.get('wake-status').textContent,'Bildschirm-Wake-Lock nicht aktiv');
 // A hidden page cannot retain a late lock.
 app=setup({request:()=>new Promise(r=>resolve=r)});await app.toggle(true);await app.visibility('hidden');
 const hidden=lock();resolve(hidden);await settle();assert.equal(hidden.releases,1);
 // Release failures are reported without repeated retries or unhandled rejections.
 const failing=lock();failing.release=async()=>{throw Error('release denied');};
 app=setup({request:()=>Promise.resolve(failing)});await app.toggle(true);await app.toggle(false);
 assert(app.get('wake-status').textContent.includes('nicht freigegeben'));assert.equal(app.calls.length,1);
 app=setup({brokenStorage:true});await app.toggle(true);assert.equal(app.calls.length,1);
 assert(app.get('wake-storage').textContent.includes('nicht gespeichert'));
 // Connecting/disconnecting must not implicitly enable a disabled preference or retry mid-setup.
 app=setup({saved:true});app.context.session={};app.get('connect').emit('click');await settle();assert.equal(app.calls.length,0);
 app.context.session=null;app.context.connecting=true;app.get('connect').emit('click');await settle();assert.equal(app.calls.length,0);
 console.log('PASS: explicit activation, saved preference without auto-request, connect gesture, release, visibility reacquisition, disable, unsupported API, denial without loops, serialized requests, late responses, pagehide, release/storage errors.');
})().catch(error=>{console.error(error);process.exitCode=1;});
