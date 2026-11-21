import type { Metadata } from "next";
import SignInReturn from './components/sign-in-return';
export const metadata: Metadata = { title: "RegPilot AI", description: "Compliance operations workspace prototype",referrer:'no-referrer' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body style={{margin:0,fontFamily:"Arial, sans-serif",background:"#f5f7fb",color:"#152238"}}><SignInReturn/>{children}</body></html>;
}
