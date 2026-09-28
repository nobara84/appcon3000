// Measured calibration and backward-compatible decimal settings; no hardware required.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function setup(savedState){
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',dataset:{},textContent:'',hidden:true,handlers:{},
  addEventListener(name,handler){this.handlers[name]=handler;},replaceChildren(){},append(){}});return nodes.get(id);};
 const storage=new Map(savedState?[['appcon3000.v1',JSON.stringify(savedState)]]:[]);
 const context=vm.createContext({DataView,Uint8Array,console:{debug(){},error:console.error},
 document:{getElementById:node,createElement:()=>node(Symbol()),addEventListener(){}},window:{addEventListener(){}},
 navigator:{},performance:{now:()=>0},setInterval(){},setTimeout(){},clearTimeout(){},
 confirm(){throw Error('Native dialogs unavailable');},
 localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}});
 const run=s=>vm.runInContext(s,context);
 run(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
 return {node,run,writeSnapshot:()=>JSON.stringify([...storage]),
 wheel(circumference,poles){node('circumference').value=circumference;node('poles').value=poles;
  let prevented=false;node('wheel-form').handlers.submit({preventDefault(){prevented=true;}});assert(prevented);},
 stored:()=>JSON.parse(storage.get('appcon3000.v1')),
 submit(value){node('odometer-start').value=value;let prevented=false;
  node('odometer-form').handlers.submit({preventDefault(){prevented=true;}});assert(prevented);},
 apply(){node('distance-apply').handlers.click();}};
}
const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
let app=setup();
assert.equal(app.run('state.circumference'),2.232);
assert.equal(app.run('state.poles'),12.775);
assert.equal(app.node('poles').value,'12,775');
assert.equal(app.node('circumference').value,'2,232');
// A/B/C: real counter endpoints, with synthetic valid device times.
for(const [start,end,expected] of [[254516,254772,256*2.232/12.775],
 [255105,255360,255*2.232/12.775],[0,511,89.28]]){
 app=setup();
 app.run(`processPulses({counter:${start},poleTime:0},0);processPulses({counter:${end},poleTime:10*32768},10000)`);
 near(app.run('state.trip'),expected);near(app.run('state.odometer'),expected);
 near(app.stored().trip,expected);
 near(app.run('speed'),expected/(10*32768)*32786*3.6);
}
near(511/12.775,40);near(511*2.232/12.775,40*2.232);
// Average uses calibrated distance with unchanged timebase and two-decimal display.
app=setup();app.run('processPulses({counter:0,poleTime:0},0);processPulses({counter:14,poleTime:32768},1000)');
near(app.run('state.averageDistance'),14*2.232/12.775);
assert.equal(app.run('state.movingTime'),1);
assert.equal(app.node('average-speed').textContent,(14*2.232/12.775*3.6).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2}));
// D/E: decimal separator, full precision, persistence and reload.
for(const input of ['12.775','12,775','12.775123456789']){
 app=setup({circumference:2.2,poles:14,trip:123,odometer:456});
 app.wheel('2,232',input);
 const expected=Number(input.replace(',','.'));
 assert.equal(app.run('state.poles'),expected);assert.equal(app.stored().poles,expected);
 assert.equal(app.stored().circumference,2.232);
 assert.equal(app.stored().trip,123);assert.equal(app.stored().odometer,456);
 const restored=setup(app.stored());
 assert.equal(restored.run('state.poles'),expected);assert.equal(restored.run('state.circumference'),2.232);
}
// F: invalid input must not change either calibration or saved data.
for(const input of ['0','-1','-0.1','NaN','Infinity','-Infinity','abc','',' ','12,7,75']){
 app=setup({circumference:2.2,poles:14,trip:123,odometer:456});
 const before=app.writeSnapshot();app.wheel('2.232',input);
 assert.equal(app.run('state.poles'),14);assert.equal(app.run('state.circumference'),2.2);
 assert.equal(app.writeSnapshot(),before);assert(app.node('message').textContent.length>0);
}
// G: no migration or write at load, including all stored riding data.
const legacy={circumference:2.2,poles:14,trip:123,odometer:456,movingTime:10,averageDistance:100};
app=setup(legacy);assert.deepEqual(app.stored(),legacy);
assert.equal(app.run('state.poles'),14);assert.equal(app.run('state.circumference'),2.2);
assert.equal(app.writeSnapshot(),JSON.stringify([['appcon3000.v1',JSON.stringify(legacy)]]));
// H/I: independent fallback, preserving the other stored parameter.
assert.equal(setup({circumference:2.2}).run('state.poles'),12.775);
assert.equal(setup({poles:14}).run('state.circumference'),2.232);
for(const poles of [0,-1,'12.775',null])assert.equal(setup({poles}).run('state.poles'),12.775);
console.log('PASS: measured 256/255/511 steps, 511 steps = 89.28 m, calibrated live/average speed, decimal dot/comma and precision, invalid inputs, persistence/reload, legacy values unchanged, new defaults.');
