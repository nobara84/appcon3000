// Hardware-free regression tests for settings, in-page confirmation and persistence.
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
 return {node,run,stored:()=>JSON.parse(storage.get('appcon3000.v1')),
 submit(value){node('odometer-start').value=value;let prevented=false;
  node('odometer-form').handlers.submit({preventDefault(){prevented=true;}});assert(prevented);},
 apply(){node('distance-apply').handlers.click();}};
}
let app=setup();
assert.equal(app.node('average-speed').textContent,'—');
app.run('processPulses({counter:0,poleTime:0},0);processPulses({counter:14,poleTime:32768},1000)');
assert.equal(app.run('state.movingTime'),1);
assert.equal(app.run('state.averageDistance'),app.run('state.trip'));
assert.equal(app.node('average-speed').textContent,'7,9');
app.run('processPulses({counter:14,poleTime:65536},2000)');
assert.equal(app.run('state.movingTime'),1);
app.run('processPulses({counter:28,poleTime:20*32768},20000)');
assert.equal(app.run('state.movingTime'),1); // gap time and its distance excluded together
assert.equal(app.node('average-speed').textContent,'7,9');
app.run('processPulses({counter:42,poleTime:21*32768},21000)');
assert.equal(app.run('state.movingTime'),2);
assert.equal(app.stored().movingTime,2);
const restored=setup(app.stored());assert.equal(restored.run('state.trip'),app.run('state.trip'));
assert.equal(restored.run('state.movingTime'),2);assert.equal(restored.node('average-speed').textContent,'7,9');
restored.run('processPulses({counter:100,poleTime:100*32768},100000)');assert.equal(restored.run('state.movingTime'),2);
restored.run('processPulses({counter:114,poleTime:101*32768},101000)');assert.equal(restored.run('state.movingTime'),3);
const odo=app.run('state.odometer');app.node('reset').handlers.click();app.apply();
assert.equal(app.run('state.trip'),0);assert.equal(app.run('state.movingTime'),0);
assert.equal(app.run('state.averageDistance'),0);assert.equal(app.node('average-speed').textContent,'—');
assert.equal(app.run('state.odometer'),odo);assert.equal(app.stored().movingTime,0);
for(const [value,band] of [[17.9,'red'],[18,'yellow'],[22.9,'yellow'],[23,'green']]){
 app.run(`state.averageDistance=${value}/3.6;state.movingTime=1;renderAverage()`);
 assert.equal(app.node('average-speed').dataset.band,band);
}
app=setup({trip:10000,odometer:50000});assert.equal(app.run('state.trip'),10000);assert.equal(app.node('average-speed').textContent,'—');
app.run('processPulses({counter:0,poleTime:0},0);processPulses({counter:14,poleTime:32768},10000)');
assert.equal(app.run('state.movingTime'),0); // reception gap even with short device interval
app.run('resetMotion();processPulses({counter:28,poleTime:65536},11000)');assert.equal(app.run('state.movingTime'),0);
app.run('document.hidden=true;processPulses({counter:42,poleTime:98304},12000)');assert.equal(app.run('state.movingTime'),0);
console.log('PASS: moving/standing time, device-time quotient, gap exclusion, persistence/reload, reset with unchanged odometer, legacy trip, color thresholds.');
