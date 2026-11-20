export type ServiceTerritory = "United Kingdom" | "Great Britain" | "Northern Ireland";
export type RegulatorService = {
  id: string;
  authority: string;
  title: string;
  description: string;
  action: string;
  territory: ServiceTerritory;
  kind: "account" | "forms";
  href: string;
  guidance?: string;
};

export const regulatorServices: readonly RegulatorService[] = [
  {
    id: "mhra-process", authority: "MHRA", title: "Wholesale distribution licensing",
    description: "Apply for a WDA(H) or submit a variation through the MHRA Process Licensing Portal.",
    action: "Sign in to MHRA Process Licensing", territory: "United Kingdom", kind: "account",
    href: "https://pclportal.mhra.gov.uk/login/", guidance: "https://pclportal.mhra.gov.uk/"
  },
  {
    id: "mhra-tracking", authority: "MHRA", title: "Application and authorisation tracking",
    description: "Use RegulatoryConnect to see the applications and granted authorisations available to your organisation.",
    action: "Open MHRA RegulatoryConnect", territory: "United Kingdom", kind: "account",
    href: "https://regulatoryconnect.mhra.gov.uk/", guidance: "https://www.gov.uk/guidance/regulatoryconnect"
  },
  {
    id: "home-domestic", authority: "Home Office", title: "Domestic controlled-drug licensing",
    description: "Open the domestic licensing service for sites in England, Scotland and Wales.",
    action: "Open Home Office domestic licensing", territory: "Great Britain", kind: "account",
    href: "https://www.licensing-for-controlled-substances.homeoffice.gov.uk/",
    guidance: "https://www.gov.uk/guidance/controlled-drugs-domestic-licences"
  },
  {
    id: "home-trade", authority: "Home Office", title: "Controlled-drug imports and exports",
    description: "Use the National Drugs Control System (NDS) for import and export licence applications.",
    action: "Open the National Drugs Control System", territory: "United Kingdom", kind: "account",
    href: "https://dflu.homeoffice.gov.uk/",
    guidance: "https://www.gov.uk/government/publications/national-drugs-control-system-user-guide/national-drugs-control-system-guide-for-users"
  },
  {
    id: "companies-house", authority: "Companies House", title: "Company filing account",
    description: "Access the companies you are authorised to manage in Find and update company information.",
    action: "Sign in to Companies House", territory: "United Kingdom", kind: "account",
    href: "https://find-and-update.company-information.service.gov.uk/signin",
    guidance: "https://find-and-update.company-information.service.gov.uk/"
  },
  {
    id: "hmrc-business", authority: "HM Revenue & Customs", title: "Business tax account",
    description: "Open your business tax account to view and manage the taxes registered to your company.",
    action: "Open your HMRC business tax account", territory: "United Kingdom", kind: "account",
    href: "https://www.tax.service.gov.uk/business-account",
    guidance: "https://www.gov.uk/guidance/sign-in-to-your-hmrc-business-tax-account"
  },
  {
    id: "ni-domestic", authority: "Department of Health Northern Ireland", title: "Domestic controlled-drug licensing in Northern Ireland",
    description: "Find the Northern Ireland domestic application form and instructions.",
    action: "Open Northern Ireland licensing forms", territory: "Northern Ireland", kind: "forms",
    href: "https://www.health-ni.gov.uk/articles/controlled-drugs"
  },
  {
    id: "mhra-manufacturing", authority: "MHRA", title: "New manufacturing and specials licences",
    description: "Get the MHRA application forms for a new manufacturer’s licence, including a specials licence.",
    action: "Open MHRA manufacturer licence forms", territory: "United Kingdom", kind: "forms",
    href: "https://www.gov.uk/government/publications/medicines-application-forms-for-a-manufacturer-licence"
  }
];

export function servicesForNation(nation: string) {
  const gb = ["England", "Scotland", "Wales", "Great Britain"].includes(nation);
  return regulatorServices.filter(s => !(gb && s.territory === "Northern Ireland") &&
    !(nation === "Northern Ireland" && s.territory === "Great Britain"));
}

/** Return official navigation for an access task, independently of the research or evidence services. */
export function findRegulatorServices(question: string, nation = "") {
  const q = question.toLowerCase().replace(/[-’']/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(suppliers?|vendors?|third part(?:y|ies)|their accounts?|another company|public registers?|public records?)\b/.test(q)) return [];
  const trade = /\b(imports?|exports?|nds|national drugs control system)\b/.test(q);
  const domestic = /\bdomestic\b/.test(q);
  const drugs = /\b(controlled (drugs?|substances?)|cd (licence|license)|dflu|nds|national drugs control system)\b/.test(q);
  const home = /\bhome office\b/.test(q);
  const mhra = /\b(mhra|regulatory\s?connect|wda|process licensing)\b/.test(q);
  const manufacturing = /\b(manufactur\w*|specials|mia)\b/.test(q);
  const wholesale = /\b(wholesale|wda|process licensing)\b/.test(q);
  const tracking = /\b(track\w*|status|regulatory\s?connect|granted authorisations?)\b/.test(q);
  const companies = /\bcompanies house\b/.test(q);
  const generic = /\b(regulator|regulatory|licensing|government) (accounts?|portals?|services?)\b/.test(q);
  const access = /\b(accounts?|portals?|log\s?in|sign\s?(in|on)|access|open|apply|application[s]?|renew\w*|variations?|submit|track\w*|status|forms?|file|filing)\b/.test(q);
  if (!generic && !access && !/^(mhra|home office|regulatory\s?connect|companies house|hmrc|nds)$/.test(q)) return [];
  const ids = new Set<string>();
  if (mhra || wholesale || (manufacturing && !home && !drugs)) {
    if ((wholesale && !tracking) || (!manufacturing && !tracking)) ids.add("mhra-process");
    if (tracking || (!manufacturing && !wholesale)) ids.add("mhra-tracking");
    if (manufacturing) ids.add("mhra-manufacturing");
  }
  if (home || drugs || (domestic && /\blicen[cs]/.test(q))) {
    if (domestic || !trade) { ids.add("home-domestic"); ids.add("ni-domestic"); }
    if (trade || !domestic) ids.add("home-trade");
  }
  if (companies) ids.add("companies-house");
  if (/\b(hmrc|business tax account)\b/.test(q)) ids.add("hmrc-business");
  const region = nation || (/\bnorthern ireland\b/.test(q) ? "Northern Ireland" : /\b(england|scotland|wales|great britain)\b/.test(q) ? "Great Britain" : "");
  return servicesForNation(region).filter(s => ids.has(s.id) || (generic && ids.size === 0 && s.kind === "account"));
}
