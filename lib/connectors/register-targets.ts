export const publicRegisters=['NHSBSA_MAPPING','CLINICALTRIALS_GOV','OPENFDA_RECALL','DAILYMED_LABEL','EUROPE_PMC','MHRA_GUIDANCE'] as const;
export type PublicRegister=typeof publicRegisters[number];
export type RegisterTarget={scope:string;record:string;reference?:string};
export const referenceRegisters:ReadonlyArray<{provider:PublicRegister;target:RegisterTarget}>= [
 {provider:'NHSBSA_MAPPING',target:{scope:'bnf-snomed-mapping',record:'638b7dc9-1eac-4495-9fc5-423fc52483e2'}},
 {provider:'CLINICALTRIALS_GOV',target:{scope:'NCT02091375',record:'COMPLETED'}},
 {provider:'OPENFDA_RECALL',target:{scope:'72241',record:'D-321-2016',reference:'II'}},
 {provider:'DAILYMED_LABEL',target:{scope:'8bf27097-4870-43fb-94f0-f3d0871d1eec',record:'35'}},
 {provider:'EUROPE_PMC',target:{scope:'28538134',record:'2022-04-09',reference:'10.1056/nejmoa1611618'}},
 {provider:'MHRA_GUIDANCE',target:{scope:'good-manufacturing-practice-and-good-distribution-practice',record:'5f158c44-7631-11e4-a3cb-005056011aef',reference:'2024-05-13T14:41:54Z'}}
];
