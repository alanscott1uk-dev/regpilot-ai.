export type RegulatorySource={id:string;agency:string;title:string;path:string;topic:string};
export const REGULATORY_SOURCES:readonly RegulatorySource[];
export function normaliseContent(source:RegulatorySource,raw:unknown):{id:string;agency:string;topic:string;title:string;url:string;updatedAt:string|null;firstPublishedAt:string|null;description:string;status:string};
