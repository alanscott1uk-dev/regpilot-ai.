"use client";
import {useState,type FormEvent} from "react";
import type {vendorDetail,vendorWorkspace} from "../../../lib/server/vendor-service";
import {annexCodes,annexLabels,distributionActivities,savedLicence,licenceScope} from "../../../lib/supplier-licence";
import type {Serial} from "../audits/audit-session";
import {day} from "../workflow-ui";
import {OfficialLink} from "../../components/regulator-account-links";
import ui from "../operations/operations.module.css";

type Detail=Serial<Awaited<ReturnType<typeof vendorDetail>>>;
type Data=Serial<Awaited<ReturnType<typeof vendorWorkspace>>>;
function AnnexFields({name,legend,selected=[]}:{name:string;legend:string;selected?:readonly string[]}){
  return <fieldset><legend>{legend}</legend>{annexCodes.map(code=><label key={code}><input type="checkbox" name={name} value={code} defaultChecked={selected.includes(code)}/>{code} · {annexLabels[code]}</label>)}</fieldset>;
}
export function LicencePanel({detail:d,data,busy,save}:{detail:Detail;data:Data;busy:boolean;save:(value:Record<string,unknown>)=>void}){
  const [state,setState]=useState("LISTED"),scope=d.licence?.scope;
  function submit(e:FormEvent<HTMLFormElement>,action:string){
    e.preventDefault();const fields=new FormData(e.currentTarget),values=Object.fromEntries(fields);
    for(const key of ["annexEntries","requiredAnnexEntries"])delete values[key];
    const requirements=fields.getAll("requiredAnnexEntries"),observed=fields.getAll("annexEntries");
    const payload=action==="SET_LICENCE_SCOPE"?{scope:{...values,...(requirements.length?{requiredAnnexEntries:requirements}:{})}}:
      {record:state==="UNAVAILABLE"?{...values,state}:{...values,state,activities:fields.getAll("activities"),...(observed.length?{annexEntries:observed}:{})}};
    save({action,version:d.vendor.version,...payload});
  }
  return <section className={ui.review}><h3>MHRA wholesale authorisation</h3>
    {d.licence&&<><p><strong>{scope?.premises}</strong> · {scope?.activity} · UK WDA(H) {scope?.number}</p>
      {scope?.requiredAnnexEntries?.length?<p>Required annex entries · {scope.requiredAnnexEntries.map(c=>c+" "+annexLabels[c]).join(", ")}</p>:null}
      {d.licence.reasons.length?<ul>{d.licence.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>:<p>The imported holder, premises and activity match the expected scope. The nominated quality reviewer assesses restrictions and records the decision.</p>}
      {d.licence.saved&&<p><OfficialLink href={d.licence.saved.record.source}>Source used for this check</OfficialLink> · {d.licence.saved.record.state.toLowerCase()} on {d.licence.saved.record.checkedOn}
        {d.licence.saved.record.state!=="UNAVAILABLE"&&<> · review by {d.licence.saved.record.reviewBy} · {d.licence.saved.record.conditions}{d.licence.saved.record.annexEntries?.length?" · Recorded entries "+d.licence.saved.record.annexEntries.join(", "):""}</>}</p>}</>}
    {d.vendor.active&&<details><summary>{scope?"Change expected premises or reviewer":"Set expected premises and activity"}</summary>
      <form onSubmit={e=>submit(e,"SET_LICENCE_SCOPE")}><fieldset disabled={busy} className={ui.formGrid}>
        <label>Expected UK company number<input name="companyNumber" defaultValue={scope?.companyNumber||d.signal?.companyNumber} required maxLength={8}/></label>
        <label>Expected WDA(H) number<input name="number" required pattern="[0-9]{1,8}" defaultValue={scope?.number}/></label>
        <label>Expected site address, including unit and postcode<input name="premises" required minLength={10} maxLength={450} defaultValue={scope?.premises}/></label>
        <label>Required site activity<select name="activity" defaultValue={scope?.activity||""} required><option value="">Select activity</option>{distributionActivities.map(a=><option key={a}>{a}</option>)}</select></label>
        <AnnexFields name="requiredAnnexEntries" legend="Additional annex entries required for this work" selected={scope?.requiredAnnexEntries}/>
        <label>Responsible Person or nominated quality reviewer<select name="reviewerId" required defaultValue={scope?.reviewerId||""}><option value="">Select an authorised reviewer</option>{data.members.filter(m=>["OWNER","ADMIN"].includes(m.role)).map(m=><option key={m.user.id} value={m.user.id}>{m.user.email}</option>)}</select></label>
        <button>Save expected scope</button>
      </fieldset></form></details>}
    {scope&&d.vendor.active&&<details><summary>Import a register check</summary>
      <p>Open the MHRA-GMDP register and use the annex for this site. Record the premises address without the holder name in both address fields.</p>
      <form onSubmit={e=>submit(e,"IMPORT_LICENCE")}><fieldset disabled={busy} className={ui.formGrid}>
        <label>Register result<select value={state} onChange={e=>setState(e.target.value)}><option value="LISTED">Authorisation listed</option><option value="SUSPENDED">Suspended</option><option value="WITHDRAWN">Withdrawn</option><option value="UNAVAILABLE">Unavailable or missing</option></select></label>
        <label>MHRA record URL<input type="url" key={state==="UNAVAILABLE"?"missing":"listed"} name="source" required defaultValue={state==="UNAVAILABLE"?"https://cms.mhra.gov.uk/mhra":""} placeholder="https://cms.mhra.gov.uk/mhra/wda/uk-wdah-…"/></label>
        <label>Date checked<input name="checkedOn" type="date" required defaultValue={day()} max={day()}/></label>
        {state==="UNAVAILABLE"?<label>Reason the record could not be verified<textarea name="reason" required minLength={12} maxLength={1000}/></label>:<>
          <label>Number on the authorisation<input name="number" required pattern="[0-9]{1,8}"/></label>
          <label>Legal name of holder<input name="holder" required minLength={2} maxLength={250}/></label>
          <label>Site address on the annex<input name="premises" required minLength={10} maxLength={450}/></label>
          <fieldset><legend>Activities listed for this site</legend>{distributionActivities.map(a=><label key={a}><input name="activities" type="checkbox" value={a}/>{a}</label>)}</fieldset>
          <AnnexFields name="annexEntries" legend="Additional entries shown for these exact premises"/>
          <label>Product scope, restrictions and conditions<textarea name="conditions" minLength={4} maxLength={1000} required/></label>
          <label>Next register review<input name="reviewBy" type="date" required/></label>
          <label>Reviewed register copy<select name="evidenceId" required defaultValue=""><option value="">Choose an independently approved file</option>{data.evidence.map(f=><option key={f.id} value={f.id}>{f.filename}</option>)}</select></label>
        </>}
        <button>Record source check</button>
      </fieldset></form></details>}
    {d.licenceHistory.length>0&&<details><summary>Site and register history</summary><ol>{d.licenceHistory.map(event=>{
      const details=event.details as Record<string,unknown>,saved=savedLicence.safeParse(details.record),expected=licenceScope.safeParse(details.scope);
      return <li key={event.id}>{new Date(event.createdAt).toLocaleString("en-GB")} · {event.actor.email}
        {saved.success?<> · {saved.data.record.state} · <OfficialLink href={saved.data.record.source}>Source checked {saved.data.record.checkedOn}</OfficialLink>{saved.data.record.state!=="UNAVAILABLE"&&<> · {saved.data.record.holder}, {saved.data.record.premises} · {saved.data.record.activities.join(", ")} · {saved.data.record.conditions}{saved.data.record.annexEntries?.length?" · Annex "+saved.data.record.annexEntries.join(", "):""}</>}</>:expected.success?<> · Expected {expected.data.activity} at {expected.data.premises}</>:null}</li>;
    })}</ol></details>}
  </section>;
}
