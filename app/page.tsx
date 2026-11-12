import {redirect} from "next/navigation";
import {homeDestination} from '../lib/auth-flow.mjs';
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){redirect(homeDestination(await searchParams));}
