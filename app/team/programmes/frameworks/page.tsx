import FrameworkWorkspace from './workspace';
export const metadata={title:'Framework audits · RegPilot'};
export default async function Page({searchParams}:{searchParams:Promise<{framework?:string}>}){
  return <FrameworkWorkspace framework={String((await searchParams).framework??'').slice(0,140)}/>;
}
