// Hardware-free regression tests for settings, in-page confirmation and persistence.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function setup(savedState){
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',hidden:true,handlers:{},
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
let app=setup();assert.equal(app.run('state.circumference'),2.2);assert.equal(app.run('state.poles'),14);
app=setup({circumference:2.149,poles:14,trip:123,odometer:456});
assert.equal(app.run('state.circumference'),2.149);assert.equal(app.node('circumference').value,'2,149');
assert.equal(app.node('trip').textContent,'0,12');assert.equal(app.node('odometer').textContent,'0,46');
for(const input of ['1234.5','1234,5']){
 app=setup();app.run('state.trip=321;state.odometer=42;');app.submit(input);
 assert.equal(app.run('state.odometer'),42);assert.equal(app.node('distance-confirmation').hidden,false);
 app.apply();assert.equal(app.run('state.odometer'),1234500);assert.equal(app.run('state.trip'),321);
 assert.equal(app.node('odometer').textContent,'1234,50');assert.equal(app.stored().odometer,1234500);
 assert.equal(app.node('distance-confirmation').hidden,true);
 const reloaded=setup(app.stored());assert.equal(reloaded.node('odometer').textContent,'1234,50');
}
app=setup();app.run('state.trip=987.65;state.odometer=1234567.89;renderDistance();');
app.node('reset').handlers.click();assert.equal(app.run('state.trip'),987.65);
app.apply();assert.equal(app.run('state.trip'),0);assert.equal(app.node('trip').textContent,'0,00');
assert.equal(app.run('state.odometer'),1234567.89);assert.equal(app.stored().odometer,1234567.89);assert.equal(app.stored().trip,0);
// Repeated confirmation cannot reset newly accumulated distance.
app.run('state.trip=12;');app.apply();assert.equal(app.run('state.trip'),12);
// Cancellation, edits after asking, and invalid inputs do not apply stale actions.
for(const input of ['', ' ', '-1','NaN','Infinity','abc','1.234,5','1,2,3','0x10','1e4','9'.repeat(400)]){
 app=setup({odometer:55,trip:10});app.submit(input);app.apply();assert.equal(app.run('state.odometer'),55);
 assert.equal(app.node('distance-confirmation').hidden,true);
}
app=setup({odometer:55,trip:10});app.submit('5');app.node('distance-cancel').handlers.click();app.apply();assert.equal(app.run('state.odometer'),55);
app.submit('6');app.node('odometer-start').handlers.input();app.apply();assert.equal(app.run('state.odometer'),55);
app.submit('0');app.apply();assert.equal(app.run('state.odometer'),0);assert.equal(app.node('odometer').textContent,'0,00');
// Stored calibration survives an odometer update and a reload.
app=setup({circumference:2.149,poles:14});app.submit('1');app.apply();assert.equal(app.stored().circumference,2.149);
assert.equal(setup(app.stored()).run('state.circumference'),2.149);
assert(html.includes('type="submit" class="secondary">Gesamtkilometer übernehmen'));
assert(html.includes('id="distance-apply" type="button"'));
assert(html.includes('id="distance-cancel" type="button"'));
console.log('PASS: comma/point, meter persistence/reload, immediate German display, preventDefault, trip-only reset, cancel/edit/double-tap, invalid/negative input, zero, default 2.200/14, stored 2.149 preserved; native confirm unavailable.');
