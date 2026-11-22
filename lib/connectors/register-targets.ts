export const publicRegisters=['NHSBSA_MAPPING','CLINICALTRIALS_GOV','OPENFDA_RECALL'] as const;
export type PublicRegister=typeof publicRegisters[number];
export type RegisterTarget={scope:string;record:string;reference?:string};
export const referenceRegisters:ReadonlyArray<{provider:PublicRegister;target:RegisterTarget}>= [
 {provider:'NHSBSA_MAPPING',target:{scope:'bnf-snomed-mapping',record:'638b7dc9-1eac-4495-9fc5-423fc52483e2'}},
 {provider:'CLINICALTRIALS_GOV',target:{scope:'NCT02091375',record:'COMPLETED'}},
 {provider:'OPENFDA_RECALL',target:{scope:'72241',record:'D-321-2016',reference:'II'}}
];
