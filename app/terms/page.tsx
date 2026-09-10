import type { Metadata } from "next";

/* Without this the page inherited the root layout's title and description, so
 * it announced itself as the home page. The canonical is the same apex/www
 * point as everywhere else: relative, resolved against metadataBase. */
export const metadata: Metadata = {
  title: "Terms of Service | Jooma",
  description: "The terms you agree to when you use Jooma.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--j-tint)" }}>
      <div className="max-w-3xl mx-auto px-6 py-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/logo-v2.svg" alt="Jooma" className="mb-10" style={{ height: 30, width: "auto" }} />

        <h1 className="text-4xl font-semibold tracking-tight mb-2" style={{ color: "var(--j-purple)" }}>
          Terms of Service
        </h1>
        <p className="text-sm mb-10" style={{ color: "#7a604a" }}>Last updated: 1 June 2026</p>

        <div className="rounded-2xl p-8 space-y-8" style={{ backgroundColor: "var(--j-card)" }}>

          <Section title="1. About Jooma">
            <p>Jooma (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) is an AI-powered lesson planning tool operated by Jooma Ltd, a company registered in England and Wales. Jooma helps educators create lesson plans, worksheets, slideshows, and other classroom materials using artificial intelligence.</p>
            <p>By creating an account or using our service you agree to these Terms of Service (&quot;Terms&quot;). If you do not agree, please do not use Jooma.</p>
          </Section>

          <Section title="2. Eligibility">
            <p>You must be at least 18 years old and, if using Jooma on behalf of an institution, you must have authority to bind that institution to these Terms. Jooma is intended for professional educators and school staff. It is not designed for direct use by pupils or minors.</p>
          </Section>

          <Section title="3. Your Account">
            <p>You are responsible for keeping your login credentials secure and for all activity that occurs under your account. Notify us immediately at <a href="mailto:info@jooma.ai" className="underline">info@jooma.ai</a> if you suspect unauthorised access.</p>
            <p>You must provide accurate information when registering and keep it up to date. We reserve the right to suspend or delete accounts that contain false information or violate these Terms.</p>
          </Section>

          <Section title="4. Acceptable Use">
            <p>You may use Jooma only for lawful educational purposes. You must not:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Use Jooma to generate content that is illegal, abusive, discriminatory, or harmful to minors.</li>
              <li>Attempt to reverse-engineer, scrape, or otherwise extract our underlying models or data.</li>
              <li>Resell or redistribute Jooma or its outputs as a standalone product without our written permission.</li>
              <li>Use Jooma in a way that violates any applicable UK or international law.</li>
              <li>Introduce malware, viruses, or any code designed to disrupt our systems.</li>
            </ul>
          </Section>

          <Section title="5. AI-Generated Content">
            <p>Jooma uses third-party AI providers (including OpenAI) to generate content. You acknowledge that:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>AI-generated content may be inaccurate, incomplete, or inappropriate for some audiences. You are responsible for reviewing all content before using it with pupils.</li>
              <li>We do not guarantee that outputs are factually correct, curriculum-aligned, or free from bias.</li>
              <li>The same prompt may produce different results each time.</li>
            </ul>
            <p>Content you generate is yours. You retain ownership of the outputs produced using your prompts, subject to any restrictions from our AI providers.</p>
          </Section>

          <Section title="6. Intellectual Property">
            <p>All software, design, trademarks, and other materials that make up Jooma (excluding your inputs and outputs) are owned by Jooma Ltd or our licensors and are protected by UK and international intellectual property law.</p>
            <p>You grant us a limited, non-exclusive licence to process your inputs solely to provide the service to you.</p>
          </Section>

          <Section title="7. Subscription and Payment">
            <p>Jooma offers free and paid subscription plans. Paid features are subject to the pricing displayed on our website at the time of purchase. Subscriptions renew automatically unless cancelled before the renewal date.</p>
            <p>All fees are quoted in GBP and are inclusive of VAT where applicable. Refunds are provided at our discretion, except where required by law.</p>
          </Section>

          <Section title="8. Availability and Changes">
            <p>We aim to provide Jooma without interruption but cannot guarantee 100% uptime. We may modify, suspend, or discontinue any feature at any time. We will give reasonable notice of material changes where possible.</p>
          </Section>

          <Section title="9. Limitation of Liability">
            <p>To the fullest extent permitted by law, Jooma Ltd shall not be liable for any indirect, incidental, or consequential damages arising out of your use of the service, including loss of data or profits.</p>
            <p>Our total aggregate liability to you in any twelve-month period shall not exceed the greater of £100 or the total fees you paid to us in that period.</p>
            <p>Nothing in these Terms limits our liability for fraud, death, or personal injury caused by our negligence, or any other liability that cannot be excluded under English law.</p>
          </Section>

          <Section title="10. Termination">
            <p>You may close your account at any time by contacting <a href="mailto:info@jooma.ai" className="underline">info@jooma.ai</a>. We may suspend or terminate your account if you breach these Terms, without liability to you.</p>
            <p>On termination, your right to use Jooma ceases immediately. We will retain your data as set out in our Privacy Policy.</p>
          </Section>

          <Section title="11. Governing Law">
            <p>These Terms are governed by the laws of England and Wales. Any disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales.</p>
          </Section>

          <Section title="12. Contact">
            <p>If you have questions about these Terms, please contact us at:</p>
            <p>
              Jooma Ltd<br />
              Email: <a href="mailto:info@jooma.ai" className="underline">info@jooma.ai</a>
            </p>
          </Section>

        </div>

        <p className="text-xs text-center mt-8" style={{ color: "#7a604a" }}>
          © {new Date().getFullYear()} Jooma Ltd · <a href="/privacy" className="underline">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--j-purple)" }}>{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed" style={{ color: "#3a2814" }}>
        {children}
      </div>
    </section>
  );
}
