import {findRegulatorServices} from "../../lib/regulator-services";
import type {ReactNode} from "react";
import type {SupplierRegisterLink} from "../../lib/supplier-register-links";

export function OfficialLink({href,children}:{href:string;children:ReactNode}) {
  return <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a>;
}

export function SupplierRegisterLinks({links}:{links:readonly SupplierRegisterLink[]}) {
  if(!links.length)return null;
  return <ul aria-label="Supplier public register links">{links.map(link=><li key={link.href}>
    <OfficialLink href={link.href}>{link.label}</OfficialLink> · {link.note}
  </li>)}</ul>;
}

export function RegulatorAccountSuggestions({question,nation}:{question:string;nation:string}) {
  const services=findRegulatorServices(question,nation);
  if(!services.length)return null;
  return <section aria-label="Official regulator services">
    <h3>Official regulator services</h3>
    <ul>{services.map(s=><li key={s.id}><OfficialLink href={s.href}>{s.action}</OfficialLink> · {s.territory}</li>)}</ul>
  </section>;
}
