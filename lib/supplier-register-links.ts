import {mhraRecordNumber,sameLicenceText,type LicenceRecord,type LicenceScope} from "./supplier-licence";

type RegisterFinding = {
  scope: Pick<LicenceScope,"companyNumber"|"number"|"premises">;
  registeredName: string | null;
  saved: {record: LicenceRecord} | null;
  identities: ReadonlyArray<{provider: string; sourceUrl: string; capturedAt: string}>;
};
type RegisterSignal = {
  current: boolean;
  companyNumber: string;
  snapshot: {capturedAt: string; observation: {sourceUrl: string}} | null;
};
export type SupplierRegisterLink = {kind: "record" | "search"; label: string; href: string; note: string};

export function supplierRegisterLinks(finding: RegisterFinding | null, signal: RegisterSignal | null) {
  const links: SupplierRegisterLink[] = [];
  const scope=finding?.scope, record=finding?.saved?.record;
  if (scope) {
    if (record && record.state !== "UNAVAILABLE" && record.number === scope.number &&
        mhraRecordNumber(record.source) === scope.number && finding?.registeredName &&
        sameLicenceText(record.holder,finding.registeredName) && sameLicenceText(record.premises,scope.premises)) {
      links.push({kind:"record",label:"MHRA WDA(H) "+scope.number,href:record.source,
        note:"Recorded as "+record.state.toLowerCase()+" on "+record.checkedOn+" · review by "+record.reviewBy});
    } else {
      links.push({kind:"search",label:"Search the MHRA wholesale register",href:"https://cms.mhra.gov.uk/mhra/wda",
        note:"Look up UK WDA(H) "+scope.number+" and check the holder and site."});
    }
  }
  const company=scope?.companyNumber || (signal?.current ? signal.companyNumber : "");
  if (!/^(?:\d{8}|[A-Z]{2}\d{6})$/.test(company)) return links;
  const observation=signal?.current && signal.companyNumber===company ? signal.snapshot : null;
  const companyUrl="https://find-and-update.company-information.service.gov.uk/company/"+company;
  const retrieved=finding?.identities.find(r=>r.provider==="COMPANIES_HOUSE" && r.sourceUrl===companyUrl)?.capturedAt ||
    (observation?.observation.sourceUrl===companyUrl ? observation.capturedAt : null);
  links.push({kind:"record",label:"Companies House · "+company,href:companyUrl,
    note:retrieved ? "Collected "+retrieved.slice(0,10) : "Company number recorded for this supplier."});
  const gleif=finding?.identities.find(r=>r.provider==="GLEIF");
  const url=gleif?.sourceUrl || observation?.observation.sourceUrl || "";
  const lei=/^https:\/\/search\.gleif\.org\/#\/record\/([A-Z0-9]{18}\d{2})$/.exec(url)?.[1];
  const captured=gleif?.capturedAt || observation?.capturedAt;
  if (lei && captured) links.push({kind:"record",label:"GLEIF · "+lei,href:url,note:"Collected "+captured.slice(0,10)});
  return links;
}
