/**
 * Standalone black-box browser acceptance against an actual Next.js production build.
 * Fictional demo data only; no account secrets, customer uploads or billable services.
 * This is independent-of-component automated acceptance, not a recruited human study.
 */
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {setTimeout as delay} from "node:timers/promises";
import {mkdir,writeFile} from "node:fs/promises";
import assert from "node:assert/strict";
import {chromium} from "playwright";
import {setupJourney} from "./setup-browser-journey.mjs";

const port=await new Promise((resolve,reject)=>{
 const server=createServer().once("error",reject).listen(0,"127.0.0.1",()=>{
  const address=server.address();server.close(()=>resolve(address.port));
 });
});
const base="http://127.0.0.1:"+port,startedAt=new Date().toISOString(),observations=[];
const host=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",String(port)],{
 env:{...process.env,NODE_ENV:"production",REGPILOT_PAID_SERVICES_ENABLED:"false",REGPILOT_WORKSPACE_ENABLED:"false",
 REGPILOT_AUTOMATION_ENABLED:"false",REGPILOT_CRON_ENABLED:"false",REGPILOT_AI_ENABLED:"false",
 REGPILOT_CONNECTORS_ENABLED:"false",REGPILOT_MONITORING_ENABLED:"false",NEXT_TELEMETRY_DISABLED:"1"},
 stdio:["ignore","pipe","pipe"]
});
let log="";
for(const stream of [host.stdout,host.stderr])stream?.on("data",b=>{log=(log+String(b)).slice(-2000)});
async function ready(){
 for(let n=0;n<80;n++){
  if(host.exitCode!==null)throw Error("Next.js exited before browser acceptance");
  try{if((await fetch(base+"/api/health",{signal:AbortSignal.timeout(1500)})).status<500)return}catch{}
  await delay(300);
 }throw Error("Production server did not start: "+log);
}
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
async function testJourney(name,viewport){
 const errors=[],start=Date.now(),ctx=await browser.newContext({viewport,locale:"en-GB",acceptDownloads:true});
 const page=await ctx.newPage();page.on("pageerror",e=>errors.push(e.message.slice(0,200)));
 try{
  const nav=await page.goto(base+"/",{waitUntil:"domcontentloaded"});
  assert.equal(new URL(page.url()).pathname,"/team/operations","main entry must open authenticated workspace");
  assert.equal(nav?.status(),200);
  assert.ok(await page.getByRole("heading",{name:/A clearer day/i}).isVisible(),"signed-out secure workspace has a heading");
  await page.goto(base+"/workbench",{waitUntil:"domcontentloaded"});
  await page.getByRole("heading",{name:/Compliance, without the chaos/i}).waitFor();
  await page.getByRole("button",{name:/Try a demo task/}).click();
  const form=page.getByRole("region",{name:"Create action"});
  const title="Fictional reviewer walkthrough "+name;
  await form.getByLabel(/What needs to happen/).fill(title);
  await form.getByLabel(/Responsible owner/).fill("Independent test operator");
  const due=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  await form.getByLabel(/Due date/).fill(due);
  await form.getByRole("button",{name:"Create action",exact:true}).click();
  await page.getByRole("status").last().waitFor({timeout:12000}).catch(()=>{});
  const action=page.locator('section[aria-label="Prioritised work"] button').filter({hasText:title}).first();
  await action.waitFor({timeout:10000});await action.click();
  await page.getByRole("combobox",{name:"Progress"}).selectOption("In progress");
  await page.getByRole("button",{name:"Save changes"}).click();
  const persisted=await page.evaluate(t=>{
   const records=JSON.parse(localStorage.getItem("regpilot-demo-obligations-v1")||"[]");
   return records.find(r=>r.title===t);
  },title);
  assert.equal(persisted?.status,"In progress");
  await page.reload({waitUntil:"domcontentloaded"});
  await page.locator('section[aria-label="Prioritised work"] button').filter({hasText:title}).first().waitFor();
  await page.keyboard.press("Tab");
  const focus=await page.evaluate(()=>document.activeElement?.tagName);
  assert.notEqual(focus,"BODY","keyboard focus must reach a control");
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));
  assert.ok(overflow<=3,"horizontal page overflow "+overflow+"px at "+viewport.width);
  await page.goto(base+"/team/sources",{waitUntil:"domcontentloaded"});
  assert.ok(await page.getByRole("heading",{name:/Know what changed/i}).isVisible());
  for(const [route,heading] of [["/team/setup",/Make your workspace work/i],["/team/coverage",/See what's covered/i],["/team/briefing",/What's changed/i],["/team/recognition",/Build the evidence/i],["/recognition",/Claims you can check/i]]){
   const view=await page.goto(base+route,{waitUntil:"domcontentloaded"});
   assert.equal(view?.status(),200,"secure module should render");
   assert.ok(await page.getByRole("heading",{name:heading}).isVisible(),"module heading is visible");
   const over=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));
   assert.ok(over<=3,"secure module "+route+" has horizontal overflow of "+over+"px");
  }
  await page.goto(base+"/recognition",{waitUntil:"domcontentloaded"});
  assert.ok(await page.getByText(/No current independently verified award/).first().isVisible(),"no invented certification is shown");
  await page.goto(base+"/team/operations",{waitUntil:"domcontentloaded"});
  assert.ok(await page.getByRole("heading",{name:/A clearer day/i}).isVisible(),"secure workspace heading must remain visible on return to mobile");
  assert.deepEqual(errors,[],"no client runtime exceptions");
  await page.goto(base+"/workbench",{waitUntil:"domcontentloaded"});
  await mkdir("artifacts/usability",{recursive:true});
  await page.screenshot({path:"artifacts/usability/"+name+".png",fullPage:true});
  observations.push({scenario:name,passed:true,durationMs:Date.now()-start,overflowPx:overflow,keyboardFocus:focus,steps:12});
 }catch(e){
  observations.push({scenario:name,passed:false,durationMs:Date.now()-start,error:e instanceof Error?e.message.slice(0,500):"Failed"});
 }finally{await ctx.close();}
}
try{
 await ready();
 await testJourney("desktop",{width:1365,height:880});
 await testJourney("mobile",{width:390,height:844});
 for(const [name,viewport] of [["desktop",{width:1365,height:880}],["mobile",{width:390,height:844}]]){
  try{observations.push(await setupJourney(browser,base,viewport,name));}catch(e){observations.push({scenario:"setup-"+name,passed:false,error:e.message});}
 }
}finally{await browser.close();host.kill("SIGTERM");await Promise.race([new Promise(r=>host.once("exit",r)),delay(1500)]);if(host.exitCode===null)host.kill("SIGKILL");}
const report={format:"regpilot-browser-acceptance-v1",startedAt,finishedAt:new Date().toISOString(),
 testType:"black-box automated browser acceptance; no independent human participants",
 scenarios:observations,passed:observations.every(x=>x.passed),limitations:[
 "Live multi-organisation Supabase authentication and external provider journeys require staged test credentials and separate acceptance.",
 "A browser script is not an independent human usability study or a measure of user comprehension."
]};
await mkdir("artifacts/usability",{recursive:true});
await writeFile("artifacts/usability/results.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
