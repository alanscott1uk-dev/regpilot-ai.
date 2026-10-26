// Synthetic demonstration data inspired by UK regulated medical distribution workflows.
// NOT real Star Medical records, legal determinations, or an authoritative checklist.
export const pilot = Object.freeze({
  organization: "Star Medical — synthetic pilot",
  sector: "UK regulated medical distribution",
  generatedFor: "RegPilot AI demo testing",
  disclaimer: "All records are illustrative; dates, owners, and completion statuses are fictional.",
  actions: [
    {id:"star-demo-01",title:"Review wholesale distribution authorisation application checklist",owner:"Quality lead",due:"2026-11-03",done:false,category:"MHRA WDA(H)"},
    {id:"star-demo-02",title:"Check controlled-drug licence application evidence list",owner:"Regulatory lead",due:"2026-11-05",done:false,category:"Home Office"},
    {id:"star-demo-03",title:"Review goods-in and quarantine workflow",owner:"Warehouse lead",due:"2026-11-07",done:true,category:"GDP"},
    {id:"star-demo-04",title:"Test temperature excursion escalation procedure",owner:"Quality lead",due:"2026-11-10",done:false,category:"Temperature control"},
    {id:"star-demo-05",title:"Review access-control incident response procedure",owner:"Security lead",due:"2026-11-12",done:false,category:"Site security"},
    {id:"star-demo-06",title:"Check supplier qualification evidence and approval records",owner:"Responsible Person",due:"2026-11-16",done:false,category:"Supplier qualification"},
    {id:"star-demo-07",title:"Perform mock internal GDP inspection",owner:"Quality lead",due:"2026-11-20",done:false,category:"Audit readiness"},
    {id:"star-demo-08",title:"Review outbound dispatch and traceability procedure",owner:"Warehouse lead",due:"2026-11-24",done:false,category:"GDP"}
  ]
});
export function toPrototypeActions(source=pilot) {
  return source.actions.map(({id,title,owner,due,done})=>({id,title,owner,due,done}));
}
