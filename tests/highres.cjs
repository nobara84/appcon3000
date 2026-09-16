// Run with node tests/highres.cjs. No dependencies, BLE hardware or browser needed.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const packets = [
'c0bd0000 0000304e 5b1d0100 00f0d8ff 01800005',
'c4bd0000 0000e894 5b1d0100 00f0d8ff 01800005',
'cebd0000 00009c63 5c1d0100 00f0d8ff 01800005',
'd2bd0000 00000ad2 5c1d0100 00f0d8ff 01800005',
'd7bd0000 00007c79 5d1d0100 00f0d8ff 01800005',
'ddbd0000 0000f0f9 5d1d0100 00f0d8ff 01800005',
'e0bd0000 00009c36 5e1d0100 00f0d8ff 01800005',
'eabd0000 0000f80e 5f1d0100 00f0d8ff 01800005',
'eebd0000 0000c691 5f1d0100 00f0d8ff 01800005',
'efbd0000 00006025 711d0100 00f0d8ff 0180ffff',
'f7bd0000 0000eca7 711d0100 00f0d8ff 0180ffff',
'fcbd0000 0000e8f7 711d0100 00f0d8ff 0180ffff',
'07be0000 000004ba 721d0100 00f0d8ff 0180ffff',
'0abe0000 000024ef 721d0100 00f0d8ff 0180ffff',
'13be0000 000050d6 731d0100 00f0d8ff 0180ffff',
'17be0000 00007275 741d0100 00f0d8ff 0180ffff'
];
const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, {textContent:'', value:'', handlers:{},
    addEventListener(event, callback){this.handlers[event]=callback;}, append(){}, replaceChildren(){}});
  return nodes.get(id);
}
let watchdog, now=0, saved;
const context = vm.createContext({DataView, Uint8Array, console:{debug(){}, error:console.error},
  document:{getElementById:node, createElement:()=>node(Symbol()), addEventListener(){}},
  window:{addEventListener(){}}, navigator:{}, confirm:()=>true,
  localStorage:{getItem:()=>null,setItem:(_,value)=>saved=value}, performance:{now:()=>now},
  setInterval:callback=>{watchdog=callback;},setTimeout(){},clearTimeout(){}});
const run = source => vm.runInContext(source,context);
run(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
const near = (actual,expected) => assert(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
function decode(hex) {
  const buffer=Buffer.from(hex.replaceAll(' ',''),'hex');
  // Nonzero offset ensures DataView slices are decoded correctly.
  const padded=new Uint8Array(buffer.length+6);padded.set(buffer,3);
  context.view=new DataView(padded.buffer,3,buffer.length);
  return run('decodeHighRes(view)');
}
const samples=packets.map(decode);
// Independent integer interpretation of Q32.32 -> Q32.15 for the real fixtures.
packets.forEach((hex,i)=>{
  const buffer=Buffer.from(hex.replaceAll(' ',''),'hex');
  assert.equal(samples[i].counter,buffer.readUInt32LE(0));
  assert.equal(samples[i].poleTime,Number(buffer.readBigUInt64LE(4)>>17n));
});
assert.equal(samples[0].counter,48576);
assert.equal(samples.at(-1).counter,48663);
function feed(sample,time) {context.sample=sample;context.received=time;run('processPulses(sample,received)');}
function reset(){run('resetMotion();state.trip=0;state.odometer=0;');}
reset();
const speeds=[];
samples.forEach((sample,i)=>{
  feed(sample,i*1000);
  // Independently select the original lookback window in device ticks.
  let j=i-1;
  while(j>0 && sample.poleTime-samples[j].poleTime<16393)j--;
  const expected=i===0?0:(sample.counter-samples[j].counter)/(sample.poleTime-samples[j].poleTime)*2.149/14*32786*3.6;
  near(run('speed'),expected);speeds.push(run('speed'));
});
near(run('state.trip'),87*2.149/14);near(JSON.parse(saved).odometer,87*2.149/14);
// Notification bunching/jitter must not affect any device-time speed.
reset();samples.forEach((sample,i)=>{feed(sample,i*0.01);near(run('speed'),speeds[i]);});
// No duplicated distance or watchdog refresh from repeated packets.
const distance=run('state.trip'),lastPulse=run('lastPulseAt');
feed(samples.at(-1),100);near(run('state.trip'),distance);assert.equal(run('lastPulseAt'),lastPulse);
now=5000;watchdog();assert.equal(run('speed'),0);
for(let length=0;length<18;length++) {context.view=new DataView(new ArrayBuffer(length));assert.throws(()=>run('decodeHighRes(view)'));}
run('decoderSelfTest()'); // Battery and charger regression.
// Pulse counter rollover + full seconds-word rollover.
reset();feed({counter:0xfffffffe,poleTime:2**47-8192},0);feed({counter:2,poleTime:8192},500);
near(run('state.trip'),4*2.149/14);near(run('speed'),4*2.149/14/16384*32786*3.6);
// A second boundary is naturally handled by the Q32.32 decoder.
const before=decode('00000000 000000c0 01000000 00000000 0000');
const after=decode('01000000 00000040 02000000 00000000 0000');
assert.equal(after.poleTime-before.poleTime,16384);
// Reject reverse counter, reverse time, frozen time and excessive speed; rebase.
for(const next of [{counter:99,poleTime:110000},{counter:101,poleTime:90000},
 {counter:101,poleTime:100000},{counter:10000,poleTime:100001}]) {
 reset();feed({counter:100,poleTime:100000},0);feed(next,1000);
 assert.equal(run('state.trip'),0);assert.equal(run('speed'),0);
 feed({counter:next.counter+1,poleTime:next.poleTime+32768},2000);
 near(run('state.trip'),2.149/14);
}
// Smoothing spans multiple close samples; distance never counts the window twice.
reset();for(let i=0;i<300;i++)feed({counter:i,poleTime:i*2000},i);
assert.equal(run('motionHistory.length'),256);near(run('state.trip'),299*2.149/14);
near(run('speed'),2.149/14/2000*32786*3.6);
// Changed wheel settings still determine speed and distance.
reset();run('state.circumference=2;state.poles=10;');
feed({counter:0,poleTime:0},0);feed({counter:5,poleTime:32768},1000);
near(run('state.trip'),1);near(run('speed'),32786/32768*3.6);
// Trip reset preserves odometer.
const odometer=run('state.odometer');node('reset').handlers.click();assert.equal(run('state.trip'),0);assert.equal(run('state.odometer'),odometer);
console.log('PASS: 16 real packets, independent Q32.32 decode, original smoothing/formula, arrival jitter, persistence, duplicates, watchdog, short packets, counter/timestamp rollover, reset recovery, >100 km/h rejection, 256-point cap, wheel configuration, battery/charger regression.');
console.log('km/h per packet (first is baseline): '+speeds.map(n=>n.toFixed(6)).join(', '));
console.log('Total: 87 pulses = '+(87*2.149/14).toFixed(9)+' m');
