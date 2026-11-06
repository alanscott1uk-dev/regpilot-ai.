import type { Metadata } from "next";
export const metadata: Metadata = { title: "EAGNEXIS AI", description: "Intelligent regulatory compliance and governance workspace — private beta" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body style={{margin:0,fontFamily:"Arial, sans-serif",background:"#f5f7fb",color:"#152238"}}>{children}</body></html>;
}
