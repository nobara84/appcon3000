// Recovery integration tests drive actual connect/disconnect/notification handlers.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function target(){return {handlers:{},dataset:{},textContent:'',value:'',hidden:false,disabled:false,
 addEventListener(e,f){this.handlers[e]=f;},removeEventListener(e,f){if(this.handlers[e]===f)delete this.handlers[e];},
 emit(e){this.handlers[e]?.();},replaceChildren(){},append(){}};}
let now=0,selectedId='appcon-a',failSetup=false;
const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,target());return nodes.get(id);};
let disconnects=0,requests=0,cleanupCalls=0,fail=false;
const csc={...target(),async startNotifications(){}};
const battery={async readValue(){return new DataView(new ArrayBuffer(16));}};
const charger={async readValue(){return new DataView(new ArrayBuffer(18));}};
let device={...target(),id:'appcon-a',gatt:{connected:false,
 async connect(){if(failSetup)throw Error('setup failure');this.connected=true;return {async getPrimaryService(){return {async getCharacteristic(uuid){return uuid.startsWith('02ff6850')?csc:uuid.startsWith('4d18361d')?battery:charger;}};}};},
 disconnect(){disconnects++;this.connected=false;device.emit('gattserverdisconnected');}}};
const context=vm.createContext({DataView,Uint8Array,console:{debug(){},error:console.error},
 document:{...target(),hidden:false,getElementById:node,createElement:()=>target()},window:target(),
 navigator:{bluetooth:{async requestDevice(){requests++;if(fail)throw Error('test failure');if(device.id!==selectedId)device={...device,id:selectedId};return device;}}},
 localStorage:{getItem:()=>null,setItem(){}},performance:{now:()=>now},setInterval(){},setTimeout(){return 1;},clearTimeout(){},
 confirm(){throw Error('Native dialogs must not be used');},recordCleanup(){cleanupCalls++;}});
const run=s=>vm.runInContext(s,context);
run(html.match(/<script>([\s\S]*?)<\/script>/)[1]);

function disconnected(){assert.equal(node('connect').hidden,false);assert.equal(node('connected-status').hidden,true);assert.equal(node('disconnect-confirmation').hidden,true);}
function connected(){assert.equal(node('connect').hidden,true);assert.equal(node('connected-status').hidden,false);assert.equal(node('status').hidden,true);}
const near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const meters=n=>n*2.232/12.775;
function packet(counter,ticks,time){
 now=time;const view=new DataView(new ArrayBuffer(20));view.setUint32(0,counter,true);
 const q=BigInt(ticks)<<17n;view.setBigUint64(4,q,true);
 csc.handlers.characteristicvaluechanged({target:{value:view}});
}
function drop(time){now=time;device.gatt.connected=false;device.emit('gattserverdisconnected');}
async function fresh(counter=100000,ticks=100*32768){
 if(run('session!==null'))run('cleanup(session)');
 run('pendingRecovery=null;resetMotion();state.trip=0;state.odometer=0;state.movingTime=0;state.averageDistance=0;');
 selectedId='appcon-a';fail=false;failSetup=false;now=0;await node('connect').handlers.click();packet(counter,ticks,0);
}
(async()=>{
 // A: normal distance, average and live speed match the v0.3.6 formula.
 await fresh();packet(100014,101*32768,1000);
 near(run('state.trip'),meters(14));near(run('state.averageDistance'),meters(14));
 near(run('speed'),meters(14)/32768*32786*3.6);
 // B/C/F: recovery exactly once, frozen device timestamp accepted for forward count.
 await fresh();drop(1000);assert.equal(run('pendingRecovery.disconnectedAt'),1000);
 now=10000;await node('connect').handlers.click();packet(100250,100*32768,10000);
 near(run('state.trip'),meters(250));near(run('state.odometer'),meters(250));
 assert.equal(node('reconnect-distance').textContent,'43,68 m');
 assert.equal(run('speed'),0);assert.equal(run('state.movingTime'),0);assert.equal(run('state.averageDistance'),0);
 assert.equal(run('pendingRecovery'),null);
 packet(100250,100*32768,10001);near(run('state.trip'),meters(250));
 packet(100264,101*32768,11000);near(run('state.trip'),meters(264));
 near(run('state.averageDistance'),meters(14));assert.equal(run('state.movingTime'),1);
 // Recreated BluetoothDevice object with the same id; pre-gap average stays intact.
 await fresh();packet(100014,101*32768,1000);drop(1100);device={...device};
 now=10000;await node('connect').handlers.click();packet(100264,110*32768,10000);
 near(run('state.trip'),meters(264));near(run('state.averageDistance'),meters(14));
 assert.equal(run('state.movingTime'),1);assert.equal(run('speed'),0);
 // D: uint32 and full device-time rollover with plausible continuity.
 await fresh(0xfffffffe,2**47-16384);drop(100);now=1000;await node('connect').handlers.click();packet(2,16384,1000);
 near(run('state.trip'),meters(4));assert.equal(run('speed'),0);
 // E: reset and implausible forward jump rejected; next normal packet resumes.
 for(const next of [100,10000000]){
  await fresh(250000);drop(100);now=1000;await node('connect').handlers.click();packet(next,101*32768,1000);
  assert.equal(run('state.trip'),0);packet(next+14,102*32768,2000);near(run('state.trip'),meters(14));
 }
 // Reset to a forward counter but backwards device time is also rejected on reconnect.
 await fresh();drop(100);now=1000;await node('connect').handlers.click();packet(100014,10*32768,1000);
 assert.equal(run('state.trip'),0);
 // Frozen time cannot establish an ambiguous wrapped counter's continuity.
 await fresh(0xfffffffe);drop(100);now=1000;await node('connect').handlers.click();packet(2,100*32768,1000);
 assert.equal(run('state.trip'),0);
 // G: invalid/frozen speed intervals retain plausible distance, without average time.
 for(const ticks of [100*32768,100*32768+1,99*32768]){
  await fresh();packet(100014,ticks,1000);near(run('state.trip'),meters(14));
  assert.equal(run('speed'),0);assert.equal(run('state.averageDistance'),0);assert.equal(run('state.movingTime'),0);
 }
 // Huge connected jumps cannot use the arrival-time fallback.
 await fresh();packet(10000000,100*32768+1,1000);assert.equal(run('state.trip'),0);
 drop(1100);assert.equal(run('pendingRecovery'),null);
 // H: reset before disconnect, during disconnection and after reconnect before first packet.
 for(const phase of ['before','during','reconnected']){
  await fresh();packet(100014,101*32768,1000);
  const reset=()=>{node('reset').emit('click');node('distance-apply').emit('click');};
  if(phase==='before')reset();drop(1100);
  if(phase==='during')reset();now=10000;await node('connect').handlers.click();
  if(phase==='reconnected')reset();packet(100264,110*32768,10000);
  assert.equal(run('state.trip'),0);near(run('state.odometer'),meters(14));
  packet(100278,111*32768,11000);near(run('state.trip'),meters(14));
 }
 // I: explicit disconnect ends continuity.
 await fresh();node('connected-status').emit('click');node('disconnect-apply').emit('click');
 assert.equal(run('pendingRecovery'),null);now=10000;await node('connect').handlers.click();packet(100250,110*32768,10000);
 assert.equal(run('state.trip'),0);
 // Expired last sample (even with a recent disconnect), different device, clock anomaly.
 for(const mode of ['expired','stale','device','negative','device-time']){
  await fresh();drop(mode==='stale'?120000:100);
  if(mode==='device')selectedId='appcon-b';
  now=mode==='expired'||mode==='stale'?121000:1000;
  await node('connect').handlers.click();packet(100250,mode==='device-time'?1000*32768:101*32768,mode==='negative'?-1:now);
  assert.equal(run('state.trip'),0);
 }
 // Failed connect attempt preserves the original short-lived recovery without renewing it.
 await fresh();drop(100);failSetup=true;now=1000;await node('connect').handlers.click();
 assert.equal(run('pendingRecovery.disconnectedAt'),100);failSetup=false;now=10000;
 await node('connect').handlers.click();packet(100250,110*32768,10000);near(run('state.trip'),meters(250));
 // Malformed and stale-session notifications cannot consume recovery.
 await fresh();const stale=csc.handlers.characteristicvaluechanged;drop(100);now=10000;await node('connect').handlers.click();
 csc.handlers.characteristicvaluechanged({target:{value:new DataView(new ArrayBuffer(3))}});
 stale({target:{value:new DataView(new ArrayBuffer(20))}});assert(run('pendingRecovery!==null'));
 packet(100250,110*32768,10000);near(run('state.trip'),meters(250));
 // Settings change and pagehide explicitly invalidate pending recovery.
 for(const mode of ['settings','pagehide']){
  await fresh();drop(100);
  if(mode==='settings'){node('circumference').value='2,232';node('poles').value='12,775';node('wheel-form').handlers.submit({preventDefault(){}});}
  else context.window.emit('pagehide');
  assert.equal(run('pendingRecovery'),null);
 }
 // Visibility still resets active baselines; it does not invent background speed.
 await fresh();packet(100014,101*32768,1000);context.document.emit('visibilitychange');
 packet(100028,102*32768,2000);near(run('state.trip'),meters(14));assert.equal(run('speed'),0);
 console.log('PASS: continuous calibration, exactly-once reconnect distance, no gap speed/average, rollover/reset guards, speed-independent distance, trip reset, manual disconnect, expiry/device identity, failed setup, stale/malformed notifications, settings/pagehide/visibility.');
})().catch(error=>{console.error(error);process.exitCode=1;});
