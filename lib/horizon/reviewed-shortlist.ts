import type {HorizonItem} from './model';
import {matchesHorizonView,type HorizonFilters,type WholesaleView} from './watchlists';

export type ReviewedPublication={url:string;title:string;revision:string|null;applies:boolean;reason:string;missing:boolean};
export type ReviewedSiteScope={id:string;scope:string;profile:WholesaleView;reviewedAt:string;rows:ReviewedPublication[]};
export function matchesReviewedScope(item:HorizonItem,filters:HorizonFilters,snapshot:string,decided:boolean,review?:ReviewedPublication){
 if(!filters.siteView||!review||review.url!==item.url||review.revision!==item.revision)
  return matchesHorizonView(item,filters,snapshot,decided);
 return review.applies&&matchesHorizonView(item,{...filters,siteView:undefined},snapshot,decided);
}
