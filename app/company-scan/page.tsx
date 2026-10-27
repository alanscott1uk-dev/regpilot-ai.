"use client";

import { useState } from "react";
import Link from "next/link";

type Company = {
  companyNumber: string; companyName: string; status: string; type: string;
  sicCodes: string[]; incorporatedOn: string | null;
  accountsDue: string | null; accountsOverdue: boolean;
  confirmationDue: string | null; confirmationOverdue: boolean; source: string;
};
type Filing = { label: string; due: string | null; overdue: boolean };

const dateLabel = (date: string | null) =>
  date ? new Date(date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "Not supplied";

export default function CompanyScan() {
  const [number, setNumber] = useState("");
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState("");
  const [personalData, setPersonalData] = useState("unknown");
  const [website, setWebsite] = useState("unknown");

  async function lookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setCompany(null); setLoading(true);
    try {
      const response = await fetch("/api/company-lookup?number=" + encodeURIComponent(number.trim().toUpperCase()));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Lookup unavailable.");
      setCompany(data as Company);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup unavailable.");
    } finally {
      setLoading(false);
    }
  }

  const filings: Filing[] = company ? [
    { label: "Annual accounts", due: company.accountsDue, overdue: company.accountsOverdue },
    { label: "Confirmation statement", due: company.confirmationDue, overdue: company.confirmationOverdue }
  ] : [];
  const employeeCount = employees.trim() === "" ? null : Number(employees);
  const assessments = company ? [
    { title: "Written health and safety policy", status: employeeCount === null ? "Information required" : employeeCount >= 5 ? "Evidence review required" : "Five-employee threshold not met", detail: "The written-policy requirement depends on employee count. This does not assess other H&S duties.", source: "https://www.hse.gov.uk/simple-health-safety/policy/" },
    { title: "ICO data protection fee", status: personalData === "unknown" ? "Information required" : personalData === "yes" ? "Exemption assessment required" : "Confirm business data-processing activities", detail: "Processing personal data alone does not establish that a fee is payable.", source: "https://ico.org.uk/for-organisations/data-protection-fee/" },
    { title: "Company website disclosures", status: website === "unknown" ? "Information required" : website === "yes" ? "Website review required" : "No website reported", detail: "If you operate a website, check the required limited-company disclosures.", source: "https://www.gov.uk/running-a-limited-company/signs-stationery-and-promotional-material" }
  ] : [];

  const panel: React.CSSProperties = { background: "#fff", border: "1px solid #dbe3ee", borderRadius: 14, padding: 22, marginTop: 18 };
  const control: React.CSSProperties = { padding: 12, borderRadius: 8, border: "1px solid #94a3b8", fontSize: 16, maxWidth: "100%" };
  return <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 18px 70px", lineHeight: 1.5 }}>
    <Link href="/" style={{ color: "#1d4ed8" }}>← Back to RegPilot</Link>
    <h1>UK company compliance scan</h1>
    <p>Start with verified public company information. Answer a few questions to identify areas that may require review.</p>
    <section style={panel}>
      <form onSubmit={lookup}>
        <label htmlFor="company-number" style={{ display: "block", fontWeight: 700, marginBottom: 8 }}>Companies House number</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <input id="company-number" required value={number} onChange={e => setNumber(e.target.value)} placeholder="SC123456" style={control} />
          <button disabled={loading} type="submit" style={{ ...control, background: "#1d4ed8", color: "white", cursor: "pointer", border: 0 }}>{loading ? "Checking…" : "Find company"}</button>
        </div>
      </form>
      {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
    </section>
    {company && <>
      <section style={panel}>
        <p style={{ color: "#475569", marginBottom: 4 }}>Verified source: {company.source}</p>
        <h2 style={{ marginTop: 0 }}>{company.companyName}</h2>
        <p><strong>{company.companyNumber}</strong> · {company.status} · {company.type}</p>
        <p>SIC codes: {company.sicCodes.length ? company.sicCodes.join(", ") : "Not supplied"}</p>
        <h3>Official filing dates</h3>
        {filings.map(f => <div key={f.label} style={{ padding: "12px 0", borderTop: "1px solid #e2e8f0" }}>
          <strong>{f.label}</strong> — {dateLabel(f.due)} {f.overdue ? <strong style={{ color: "#b91c1c" }}> · Reported overdue</strong> : ""}
        </div>)}
        <p style={{ fontSize: 13, color: "#475569" }}>Dates reflect the most recent lookup, not proof that all filing obligations have been met.</p>
      </section>
      <section style={panel}>
        <h2>Business-specific questions</h2>
        <div style={{ display: "grid", gap: 18 }}>
          <label>How many employees does the business have?<div><input type="number" min="0" step="1" value={employees} onChange={e => setEmployees(e.target.value)} placeholder="Not answered" style={control} /></div></label>
          <label>Does the business process personal data?<div><select value={personalData} onChange={e => setPersonalData(e.target.value)} style={control}><option value="unknown">Not sure / not answered</option><option value="yes">Yes</option><option value="no">No</option></select></div></label>
          <label>Does the company operate a website?<div><select value={website} onChange={e => setWebsite(e.target.value)} style={control}><option value="unknown">Not answered</option><option value="yes">Yes</option><option value="no">No</option></select></div></label>
        </div>
      </section>
      <section style={panel}>
        <h2>Preliminary assessment</h2>
        <p>These are review prompts, not a legal compliance certification. No score is generated from unanswered questions.</p>
        {assessments.map(a => <article key={a.title} style={{ borderTop: "1px solid #e2e8f0", padding: "16px 0" }}>
          <h3 style={{ margin: "0 0 5px" }}>{a.title}</h3>
          <strong>{a.status}</strong>
          <p style={{ margin: "5px 0" }}>{a.detail}</p>
          <a href={a.source} target="_blank" rel="noopener noreferrer">View official guidance</a>
        </article>)}
      </section>
    </>}
    <p style={{ fontSize: 13, color: "#475569", marginTop: 22 }}>Development preview. Information is not saved to an account. Do not enter sensitive personal or regulated information.</p>
  </main>;
}
