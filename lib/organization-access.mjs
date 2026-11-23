// Server-side authorization helpers. These must be called with a session verified
// by the configured identity provider, never with a user ID from request JSON.
export function membershipForUser(memberships, userId, organizationId) {
 if(typeof userId!=="string"||!userId||typeof organizationId!=="string"||!organizationId)return null;
 return memberships.find(m=>m.userId===userId&&m.organizationId===organizationId)??null;
}
export function authorizeModuleOperation(memberships,userId,organizationId,operation) {
 const membership=membershipForUser(memberships,userId,organizationId);
 if(!membership)return {allowed:false,reason:"No organisation membership"};
 const role=membership.role;
 const permissions={
  read:["OWNER","ADMIN","EDITOR","VIEWER"],
  create:["OWNER","ADMIN","EDITOR"],
  update:["OWNER","ADMIN","EDITOR"],
  delete:["OWNER","ADMIN"]
 };
 if(!Object.prototype.hasOwnProperty.call(permissions,operation))return {allowed:false,reason:"Unknown operation"};
 return permissions[operation].includes(role)?{allowed:true,reason:null}:{allowed:false,reason:"Insufficient permissions"};
}
