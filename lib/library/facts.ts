export const factDefinitions={
 employeeCount:{label:"Number of employees",type:"number"},annualTurnoverGBP:{label:"Annual turnover (GBP)",type:"number"},
 sellsToConsumers:{label:"Sells to consumers",type:"boolean"},distanceSelling:{label:"Sells online or at a distance",type:"boolean"},
 processesPersonalData:{label:"Processes personal information",type:"boolean"},specialCategoryData:{label:"Handles special-category personal data",type:"boolean"},
 foodBusiness:{label:"Operates a food business",type:"boolean"},vatRegistered:{label:"VAT registered",type:"boolean"},limitedCompany:{label:"Operates as a limited company",type:"boolean"},
 hasPremises:{label:"Occupies business premises",type:"boolean"}
} as const;
export type FactKey=keyof typeof factDefinitions;
export type Rule={kind:"all"|"any";rules:Rule[]}|{kind:"not";rule:Rule}|{kind:"fact";field:FactKey|"jurisdictions";operator:"eq"|"gte"|"lte"|"includes";value:boolean|number|string};
