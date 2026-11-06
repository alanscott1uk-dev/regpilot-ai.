/** Fictional onboarding scenario. Never write this fixture into a user's saved records. */
export const TRACEABILITY_EXAMPLE={
 actions:[
  {id:"sample-qa-01",title:"Confirm supplier qualification records",owner:"Operations lead",regulator:"Internal quality",due:"2026-11-04",status:"In progress",notes:"Fictional example; assess requirements with a qualified person.",sourceUrl:"",sourceCheckedAt:""},
  {id:"sample-qa-02",title:"Complete annual staff training review",owner:"People manager",regulator:"Internal training",due:"2026-11-26",status:"Open",notes:"Fictional demonstration of a shared control.",sourceUrl:"",sourceCheckedAt:""},
  {id:"sample-qa-03",title:"Check a sample policy review",owner:"Quality lead",regulator:"Internal",due:"2026-12-10",status:"Complete",notes:"Fictional completion exception example",completionRationale:"The completion must be checked with a reviewer."}
 ],
 controls:[
  {id:"sample-control-01",title:"Annual documentation review",purpose:"A fictional routine quality check.",owner:"Quality lead",status:"In operation",frequency:"Annual",reviewDate:"2027-01-31",actionIds:["sample-qa-01","sample-qa-02"],documentIds:["sample-doc-01"]},
  {id:"sample-control-02",title:"Training sign-off",purpose:"Demonstration of a control still being designed.",owner:"People manager",status:"Designed",frequency:"Annual",reviewDate:"2027-01-31",actionIds:["sample-qa-02"],documentIds:["sample-doc-02"]}
 ],
 documents:[
  {id:"sample-doc-01",title:"Example quality review register",category:"Quality & batch records",department:"Quality",owner:"Quality lead",version:"1.0",reviewDate:"2027-03-01",status:"Approved",hasAttachment:true},
  {id:"sample-doc-02",title:"Draft training record",category:"Training records",department:"HR",owner:"People manager",version:"0.2",reviewDate:"2026-10-01",status:"Draft",hasAttachment:false}
 ],
 sources:[],reviews:[]
};
