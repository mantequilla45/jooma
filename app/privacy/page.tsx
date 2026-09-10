import type { Metadata } from "next";

/* See the note in app/terms/page.tsx: same inherited-title problem, same
 * canonical reasoning. */
export const metadata: Metadata = {
  title: "Privacy Policy | Jooma",
  description: "What data Jooma collects, why, and what you can ask us to do with it.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--j-tint)" }}>
      <div className="max-w-3xl mx-auto px-6 py-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/logo-v2.svg" alt="Jooma" className="mb-10" style={{ height: 30, width: "auto" }} />

        <h1 className="text-4xl font-semibold tracking-tight mb-2" style={{ color: "var(--j-purple)" }}>
          Privacy Policy
        </h1>
        <p className="text-sm mb-10" style={{ color: "#7a604a" }}>Last updated: 3 September 2026</p>

        <div className="rounded-2xl p-8 space-y-8" style={{ backgroundColor: "var(--j-card)" }}>

          <Section title="1. Who We Are">
            <p>Jooma Ltd (&quot;Jooma&quot;, &quot;we&quot;, &quot;us&quot;) is the data controller for personal data processed through our service. We are registered in England and Wales.</p>
            <p>If you have any questions about how we handle your data, contact our team at <a href="mailto:info@jooma.ai" className="underline">info@jooma.ai</a>.</p>
          </Section>

          <Section title="2. Data We Collect">
            <p>We collect the following categories of personal data:</p>
            <Table rows={[
              ["Account data", "First name, surname, email address, phone number, country"],
              ["Usage data", "Pages visited, features used, prompts submitted, content generated, timestamps"],
              ["Technical data", "IP address, browser type, device type, operating system"],
              ["Payment data", "Billing details processed by our payment provider (we do not store card numbers)"],
              ["Communications", "Any messages you send us via email or support channels"],
            ]} />
            <p>We do not knowingly collect data from anyone under 18. If you believe a minor has created an account, contact us and we will delete it.</p>
          </Section>

          <Section title="3. How We Use Your Data">
            <p>We use your personal data to:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Provide and improve the service</strong> — process your prompts, generate content, and save your work.</li>
              <li><strong>Manage your account</strong> — authenticate you, send important service notifications, and handle support queries.</li>
              <li><strong>Process payments</strong> — handle subscription billing and send receipts.</li>
              <li><strong>Analyse usage</strong> — understand how the service is used so we can improve it (aggregated and anonymised where possible).</li>
              <li><strong>Legal compliance</strong> — meet our obligations under UK and EU law.</li>
            </ul>
          </Section>

          <Section title="4. Legal Basis for Processing">
            <p>Under UK GDPR, we process your data on the following bases:</p>
            <Table rows={[
              ["Contract performance", "Processing necessary to provide the service you signed up for"],
              ["Legitimate interests", "Improving the service, fraud prevention, security monitoring"],
              ["Legal obligation", "Compliance with UK tax, accounting, and data protection law"],
              ["Consent", "Marketing communications (you can withdraw consent at any time)"],
            ]} />
          </Section>

          <Section title="5. Sharing Your Data">
            <p>We share personal data only with trusted third parties needed to deliver the service:</p>
            <Table rows={[
              ["Supabase", "Database, authentication, and file storage — hosted in the EU"],
              ["OpenAI", "AI content generation — your prompts are sent to OpenAI’s API. See openai.com/privacy"],
              ["Anthropic", "AI content generation — your prompts are sent to Anthropic’s API. See anthropic.com/legal/privacy"],
              ["Stripe", "Payment processing — see stripe.com/gb/privacy"],
              ["Twilio SendGrid", "Delivery of account and service emails — operated by Twilio Inc. See twilio.com/en-us/legal/privacy"],
              ["Sentry", "Error monitoring and diagnostics, which may record your IP address and account identifier when something goes wrong — operated by Functional Software, Inc. See sentry.io/privacy"],
              ["Vercel", "Hosting and edge delivery — see vercel.com/legal/privacy-policy"],
            ]} />
            <p>We do not sell your personal data. We do not share it with third parties for their own marketing purposes.</p>
          </Section>

          <Section title="6. AI and Your Content">
            <p>When you use Jooma&apos;s AI features, your prompts and inputs are sent to one of our model providers for processing. Depending on the feature, that provider is either OpenAI or Anthropic.</p>
            <p>OpenAI does not use API data to train its models by default, and Anthropic&apos;s commercial terms state that it does not train models on customer content submitted through its API. We encourage you to review <a href="https://openai.com/privacy" className="underline" target="_blank" rel="noreferrer">OpenAI&apos;s privacy policy</a> and <a href="https://www.anthropic.com/legal/privacy" className="underline" target="_blank" rel="noreferrer">Anthropic&apos;s privacy policy</a> for full details.</p>
            <p>Do not include sensitive personal data about pupils or third parties in your prompts.</p>
          </Section>

          <Section title="7. Data Retention">
            <p>We retain your account data for as long as your account is active. If you close your account, we will delete or anonymise your personal data within 90 days, except where we are required to retain it for legal or accounting purposes (typically up to 7 years).</p>
            <p>Generated content (slideshows, lesson plans, etc.) is retained until you delete it or close your account.</p>
          </Section>

          <Section title="8. Your Rights">
            <p>Under UK GDPR you have the right to:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Access</strong> — request a copy of the personal data we hold about you.</li>
              <li><strong>Rectification</strong> — ask us to correct inaccurate data.</li>
              <li><strong>Erasure</strong> — ask us to delete your data (&quot;right to be forgotten&quot;).</li>
              <li><strong>Restriction</strong> — ask us to limit how we use your data.</li>
              <li><strong>Portability</strong> — receive your data in a structured, machine-readable format.</li>
              <li><strong>Object</strong> — object to processing based on legitimate interests.</li>
              <li><strong>Withdraw consent</strong> — where processing is based on consent, withdraw it at any time.</li>
            </ul>
            <p>To exercise any of these rights, email <a href="mailto:info@jooma.ai" className="underline">info@jooma.ai</a>. We will respond within 30 days. You also have the right to lodge a complaint with the <a href="https://ico.org.uk" className="underline" target="_blank" rel="noreferrer">Information Commissioner&apos;s Office (ICO)</a>.</p>
          </Section>

          <Section title="9. Cookies">
            <p>We use strictly necessary cookies to maintain your login session. We do not use third-party advertising or tracking cookies. You can control cookies through your browser settings, though disabling session cookies will prevent you from logging in.</p>
          </Section>

          <Section title="10. Security">
            <p>We implement appropriate technical and organisational measures to protect your data, including TLS encryption in transit, row-level security in our database, and access controls on our systems. No system is 100% secure; if you believe your account has been compromised, contact us immediately.</p>
          </Section>

          <Section title="11. International Transfers">
            <p>Some of the service providers named in section 5 (including OpenAI, Anthropic, Twilio SendGrid and Sentry) are based in the United States and may process data outside the UK/EEA. Where this occurs, we rely on appropriate safeguards such as the UK International Data Transfer Agreement (IDTA) or Standard Contractual Clauses.</p>
          </Section>

          <Section title="12. Changes to This Policy">
            <p>We may update this Privacy Policy from time to time. We will notify you of material changes by email or by a prominent notice in the app. Continued use of Jooma after the effective date constitutes acceptance of the updated policy.</p>
          </Section>

          <Section title="13. Contact">
            <p>
              Jooma Ltd<br />
              Email: <a href="mailto:info@jooma.ai" className="underline">info@jooma.ai</a>
            </p>
          </Section>

        </div>

        <p className="text-xs text-center mt-8" style={{ color: "#7a604a" }}>
          © {new Date().getFullYear()} Jooma Ltd · <a href="/terms" className="underline">Terms of Service</a>
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--j-purple)" }}>{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed" style={{ color: "var(--j-body)" }}>
        {children}
      </div>
    </section>
  );
}

function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--j-line)" }}>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, value], i) => (
            <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "var(--j-tint)" : "var(--j-card)" }}>
              <td className="px-4 py-2.5 font-semibold w-2/5 align-top" style={{ color: "var(--j-purple)" }}>{label}</td>
              <td className="px-4 py-2.5 align-top" style={{ color: "var(--j-body)" }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
