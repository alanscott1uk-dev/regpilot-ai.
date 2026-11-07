export type RegulatorySource={id:string;agency:string;title:string;path:string;topic:string;provider?:"OFFICIAL_WEB";url?:string;heading?:string;activities?:string[];jurisdictions?:string[];kind?:string;scopeNote?:string};
export const REGULATORY_SOURCES:readonly RegulatorySource[];
export function normaliseContent(source:RegulatorySource,raw:unknown):{id:string;agency:string;topic:string;title:string;url:string;updatedAt:string|null;revisionAt:string|null;firstPublishedAt:string|null;description:string;status:string};

export function officialSourceUrl(source:RegulatorySource):string;
