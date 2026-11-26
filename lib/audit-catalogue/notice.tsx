import {scfAttribution} from './catalogue';
export function CatalogueNotice({source}:{source?:string}){
  if(source==='uk')return <p>UK legislation contains public sector information licensed under the <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">Open Government Licence v3.0</a>. RegPilot wrote the evidence samples.</p>;
  if(source==='eu')return <p>Legislative sources are from the Official Journal of the European Union on <a href="https://eur-lex.europa.eu/">EUR-Lex</a>. RegPilot wrote the evidence samples.</p>;
  return <p>RegPilot includes Secure Controls Framework® (SCF) {scfAttribution.edition}, © {scfAttribution.publisher}. Published controls, mappings, objectives and evidence requests are reproduced unchanged and grouped for display. <a href={scfAttribution.license}>CC BY-ND 4.0</a> · <a href={scfAttribution.url}>Publisher workbook</a></p>;
}
