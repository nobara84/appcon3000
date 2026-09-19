// Pulse diagnostics exercised through real notification handlers with mocked BLE.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function target(){return {handlers:{},dataset:{},textContent:'',value:'',hidden:false,disabled:false,
 addEventListener(e,f){this.handlers[e]=f;},removeEventListener(e,f){if(this.handlers[e]===f)delete this.handlers[e];},
 emit(e){this.handlers[e]?.();},replaceChildren(){},append(){}};}
const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,target());return nodes.get(id);};
let disconnects=0,requests=0,cleanupCalls=0,fail=false;
const csc={...target(),async startNotifications(){}};
const battery={async readValue(){return new DataView(new ArrayBuffer(16));}};
const charger={async readValue(){return new DataView(new ArrayBuffer(18));}};
const device={...target(),gatt:{connected:false,
 async connect(){this.connected=true;return {async getPrimaryService(){return {async getCharacteristic(uuid){return uuid.startsWith('02ff6850')?csc:uuid.startsWith('4d18361d')?battery:charger;}};}};},
 disconnect(){disconnects++;this.connected=false;device.emit('gattserverdisconnected');}}};
const context=vm.createContext({DataView,Uint8Array,console:{debug(){},error:console.error},
 document:{getElementById:node,createElement:()=>target(),addEventListener(){}},window:{addEventListener(){}},
 navigator:{bluetooth:{async requestDevice(){requests++;if(fail)throw Error('test failure');return device;}}},
 localStorage:{getItem:()=>null,setItem(){}},performance:{now:()=>0},setInterval(){},setTimeout(){return 1;},clearTimeout(){},
 confirm(){throw Error('Native dialogs must not be used');},recordCleanup(){cleanupCalls++;}});
const run=s=>vm.runInContext(s,context);
run(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
run('const originalCleanup=cleanup;cleanup=s=>{recordCleanup();originalCleanup(s);};');
function disconnected(){assert.equal(node('connect').hidden,false);assert.equal(node('connected-status').hidden,true);assert.equal(node('disconnect-confirmation').hidden,true);}
function connected(){assert.equal(node('connect').hidden,true);assert.equal(node('connected-status').hidden,false);assert.equal(node('status').hidden,true);}
function notification(counter){
 const view=new DataView(new ArrayBuffer(20));view.setUint32(0,counter,true);
 // Frozen device timestamp deliberately exercises values rejected by motion logic.
 csc.handlers.characteristicvaluechanged({target:{value:view}});
}
(async()=>{
 assert(html.includes('id="pulse-raw">—'));
 assert(html.includes('id="pulse-since-connection">—'));
 await node('connect').handlers.click();
 assert.equal(node('pulse-raw').textContent,'—');
 notification(1000);assert.equal(node('pulse-raw').textContent,'1000');assert.equal(node('pulse-since-connection').textContent,'0');
 notification(1014);assert.equal(node('pulse-since-connection').textContent,'14');
 notification(1140);assert.equal(node('pulse-since-connection').textContent,'140');
 assert.equal(run('state.trip'),0); // Diagnostic updates even when motion rejects the time delta.
 run('resetMotion()');notification(1154);assert.equal(node('pulse-since-connection').textContent,'154');
 csc.handlers.characteristicvaluechanged({target:{value:new DataView(new ArrayBuffer(3))}});
 assert.equal(node('pulse-raw').textContent,'1154');
 const stale=csc.handlers.characteristicvaluechanged;
 device.gatt.connected=false;device.emit('gattserverdisconnected');
 assert.equal(node('pulse-raw').textContent,'—');assert.equal(node('pulse-since-connection').textContent,'—');
 stale({target:{value:new DataView(new ArrayBuffer(20))}});assert.equal(node('pulse-raw').textContent,'—');
 await node('connect').handlers.click();notification(0xfffffff8);
 assert.equal(node('pulse-since-connection').textContent,'0');notification(6);
 assert.equal(node('pulse-raw').textContent,'6');assert.equal(node('pulse-since-connection').textContent,'14');
 notification(132);assert.equal(node('pulse-since-connection').textContent,'140');
 node('connected-status').emit('click');node('disconnect-apply').emit('click');
 assert.equal(node('pulse-raw').textContent,'—');assert.equal(node('pulse-since-connection').textContent,'—');
 console.log('PASS: notification counter, baseline zero, +14/+140, uint32 rollover, malformed/stale packets, motion-independent baseline, disconnect/reconnect clearing.');
})().catch(error=>{console.error(error);process.exitCode=1;});
