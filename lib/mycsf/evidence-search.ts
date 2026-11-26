import {bm25Scores,searchTerms} from '../retrieval/bm25';
import type {Statement} from './api';

type EvidenceSource={id:string;filename:string;task:string;test:string;procedure:string;taskId:string};
const generic=new Set('shall must should evidence document documentation documented record records requirement requirements control controls assessment audit test tests review reviewed maintain ensure organisation organization fictional pdf docx'.split(' '));

function terms(value:string){
  return searchTerms(value).filter(term=>!generic.has(term));
}

export function suggestReviewedEvidence(rows:Statement[],files:EvidenceSource[]){
  const catalogue=files.map(file=>[file.filename,file.task,file.test,file.procedure].join(' '));
  const indexed=catalogue.map(terms);
  const vocabulary=indexed.map(words=>new Set(words));
  return rows.flatMap(row=>{
    const query=[...new Set(terms([row.reference,row.domain,row.text].join(' ')))];
    const scores=bm25Scores(query,indexed);
    // Identifiers are validated on import. Dots in a BUID are literal.
    const identifier=row.buid.replaceAll('.','\\.');
    const exactId=row.buid.length>=4?new RegExp('(?:^|[^A-Za-z0-9_-])'+identifier+'(?![A-Za-z0-9_-])','i'):null;
    return files.map((file,i)=>{
      const exact=exactId?.test(catalogue[i])??false;
      const shared=query.filter(term=>vocabulary[i].has(term));
      return {file,exact,shared,score:scores[i]};
    }).filter(hit=>hit.exact||hit.shared.length>=2)
      .sort((a,b)=>Number(b.exact)-Number(a.exact)||b.score-a.score||a.file.id.localeCompare(b.file.id))
      .slice(0,3).map(({file,exact,shared})=>({buid:row.buid,id:file.id,filename:file.filename,task:file.task,taskId:file.taskId,
        test:file.test,matched:shared.slice(0,8),exact}));
  });
}
