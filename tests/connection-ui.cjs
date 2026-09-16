// Connection UI regression tests with mocked Web Bluetooth; no hardware required.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function target(){return {handlers:{},textContent:'',value:'',hidden:false,disabled:false,
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
(async()=>{
 disconnected();await node('connect').handlers.click();connected();assert.equal(requests,1);
 assert(html.includes('class="connection-dot" aria-hidden="true">●</span>Verbunden'));
 assert(html.includes('.connection-dot{color:#83df9b'));
 assert(html.includes('#connect[hidden],#connected-status[hidden],#disconnect-confirmation[hidden]{display:none}'));
 node('connected-status').emit('click');assert.equal(node('disconnect-confirmation').hidden,false);assert.equal(disconnects,0);
 assert(html.includes('Verbindung zum APPCON3000 trennen?'));
 node('disconnect-cancel').emit('click');connected();assert.equal(node('disconnect-confirmation').hidden,true);assert.equal(disconnects,0);
 node('connected-status').emit('click');node('disconnect-apply').emit('click');disconnected();assert.equal(disconnects,1);assert.equal(cleanupCalls,1);
 node('disconnect-apply').emit('click');assert.equal(cleanupCalls,1); // double tap ignored
 await node('connect').handlers.click();connected();node('connected-status').emit('click');
 device.gatt.connected=false;device.emit('gattserverdisconnected');disconnected();assert.equal(cleanupCalls,2);
 await node('connect').handlers.click();connected();
 node('disconnect-apply').emit('click');connected();assert.equal(cleanupCalls,2); // stale prompt cannot disconnect new session
 run('cleanup(session)');disconnected();
 fail=true;await node('connect').handlers.click();disconnected();assert.equal(node('connect').disabled,false);
 console.log('PASS: initial/disconnected, connected hidden button and green status, HTML confirm/cancel, existing cleanup reused, unexpected disconnect, reconnect/stale confirmation, failed connect.');
})().catch(error=>{console.error(error);process.exitCode=1;});
