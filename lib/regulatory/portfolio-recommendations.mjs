// Only curated activity and territory discovery tags; never infer legal applicability.
const legacyTags={
 "home-office-domestic":["controlled-drugs"],"home-office-application":["controlled-drugs"],
 "mhra-organisation":["medicines"],"mhra-safety":["medicines"],
 "employer-registration":["employing-staff"],"workplace-pensions":["employing-staff"],
 "vat-records":["vat-registered"],"company-records":["limited-company"],
 "distance-selling":["consumer-sales"],"food-registration":["food-business"],"food-safety":["food-business"],
 "commercial-waste":["commercial-waste"],"uk-data-protection":["personal-data"],
 "workplace-fire-safety":["premises","employing-staff"]
};
const list=v=>Array.isArray(v)?v.filter(x=>typeof x==="string"):[];
export function recommendSourcePortfolio(catalogue,profile){
 const activities=new Set(list(profile?.activities)),nations=new Set(list(profile?.jurisdictions));
 const sources=Array.isArray(catalogue)?catalogue:[];
 const suggested=[],uncategorised=[],differentTerritory=[];
 const seen=new Set();
 for(const source of sources){
  if(!source||typeof source.id!=="string"||seen.has(source.id))continue;seen.add(source.id);
  const tags=list(source.activities).length?list(source.activities):legacyTags[source.id]||[];
  const nationTags=list(source.jurisdictions);
  const matches=tags.filter(t=>activities.has(t));
  const territoryMatches=!nationTags.length||!nations.size||nationTags.some(t=>nations.has(t));
  if(!tags.length){uncategorised.push(source.id);continue;}
  if(!matches.length)continue;
  if(!territoryMatches){differentTerritory.push(source.id);continue;}
  suggested.push({id:source.id,title:source.title,agency:source.agency,
   matchedActivities:matches,territoryUnclassified:!nationTags.length,
   reason:"Curated discovery tags match "+matches.join(", ")+
     (!nationTags.length?"; exact territorial scope is unclassified.":" and overlap declared UK nations.")+
     " Confirm duties and exemptions in the original."});
 }
 suggested.sort((a,b)=>b.matchedActivities.length-a.matchedActivities.length||a.title.localeCompare(b.title));
 return {suggested:suggested.slice(0,100),differentTerritory,uncategorised,
  caveat:"Starting points for human review, not a legally validated applicability list. Unclassified or nonmatching sources may still apply."};
}
