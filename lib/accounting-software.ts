export const accountingIds=["xero","quickbooks","sage","freeagent"] as const;
export type AccountingId=typeof accountingIds[number];
export const businessRefLabel:Record<AccountingId,string>={
  xero:"Xero organisation (tenant) ID",quickbooks:"QuickBooks company ID (realm ID)",
  sage:"Sage business ID",freeagent:"FreeAgent business subdomain"
};
export const accountingSoftware:Record<AccountingId,{name:string;login:string;help:string}>={
  xero:{name:"Xero",login:"https://login.xero.com/",help:"https://www.xero.com/uk/login/"},
  quickbooks:{name:"QuickBooks Online",login:"https://quickbooks.intuit.com/uk/login/",
    help:"https://quickbooks.intuit.com/learn-support/en-uk/help-article/login-password/sign-quickbooks-online-account/L33MPBke4_GB_en_GB"},
  sage:{name:"Sage Accounting",login:"https://app.sbc.sage.com/?productCode=sbc_accounting",
    help:"https://www.sage.com/en-gb/products/login/"},
  freeagent:{name:"FreeAgent",login:"https://login.freeagent.com/login",
    help:"https://support.freeagent.com/hc/en-gb/articles/360015741739-Logging-in-to-your-FreeAgent-account"}
};
