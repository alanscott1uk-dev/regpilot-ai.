require("tsx/cjs");
const {researchPublications}=require("../../lib/regulatory/research.ts");
const {REGULATORY_SOURCES,officialSourceUrl}=require("../../lib/regulatory-sources.mjs");
const bodies=require("./corpus.cjs");

class ResearchProvider {
  id(){return "regpilot:publication-research";}
  async callApi(prompt,context){
    const {nation,outage,unavailable}=context.vars;
    // Exercise the full production catalogue, including plausible competing titles.
    const result=await researchPublications({question:prompt,nation:nation||undefined},async source=>{
      if (outage || unavailable?.includes(source.id)) throw new Error("Simulated publisher outage");
      const text=bodies[source.id] || "This synthetic publication contains a neutral introductory paragraph. Additional details are available separately.";
      return {id:source.id,title:source.title,url:officialSourceUrl(source),text,
        checkedAt:"2026-11-20T00:00:00.000Z",revisionAt:null,updatedAt:null};
    },REGULATORY_SOURCES);
    return {output:JSON.stringify(result)};
  }
}
module.exports=ResearchProvider;
