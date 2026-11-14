export type SuggestedPublication={id:string;title:string;agency:string;matchedActivities:string[];territoryUnclassified:boolean;reason:string};
export declare function recommendSourcePortfolio(catalogue:readonly any[],profile:any):{suggested:SuggestedPublication[];differentTerritory:string[];uncategorised:string[];caveat:string};
