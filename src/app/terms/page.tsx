import type { Metadata } from 'next';
import { LegalPage, legalEntity } from '@/client/site/LegalPage';

export const metadata: Metadata = { title: 'Terms of service' };

export default function Terms() {
  const { company, email } = legalEntity();
  const contact = email ? <a href={`mailto:${email}`} className="underline underline-offset-2">{email}</a> : 'the contact address on this website';
  return (
    <LegalPage title="Terms of service" updated="13 October 2026">
      <p>
        These terms govern your use of AI 3D Studio (the “Service”), provided by {company} (“we”, “us”). By creating an account or using the Service you agree to them. If you use the Service on behalf of an organisation, you
        confirm that you may bind it to these terms.
      </p>
      <h2>Your account</h2>
      <ul>
        <li>You must give accurate information and keep your password confidential. You are responsible for activity under your account.</li>
        <li>You must be at least 16 years old, or the age of digital consent where you live.</li>
      </ul>
      <h2>Plans, payment and cancellation</h2>
      <ul>
        <li>The Free plan is free of charge. Paid plans (Pro, Studio) are subscriptions billed in advance monthly or yearly through our payment provider, Stripe, and renew automatically until cancelled.</li>
        <li>You can change or cancel your subscription at any time from your account. Cancellation takes effect at the end of the current billing period; you keep paid features until then.</li>
        <li>Plan limits (projects, monthly AI requests, export formats) are described on the pricing page. Unused AI requests do not carry over to the next month.</li>
        <li>We may change prices with at least 30 days’ notice before your next renewal. Statutory rights, including any right of withdrawal applicable to consumers, are not affected.</li>
      </ul>
      <h2>Your content</h2>
      <ul>
        <li>You own the projects, drawings and other material you create or upload (“Your Content”). You grant us a licence to host, process and display Your Content only as needed to provide the Service to you, including sending relevant parts to AI providers when you make an AI request.</li>
        <li>You are responsible for having the rights to material you upload, such as floor plans.</li>
        <li>Share links give anyone with the link read-only access to that project until you revoke the link.</li>
      </ul>
      <h2>Acceptable use</h2>
      <ul>
        <li>Do not misuse the Service: no attempts to break or bypass security or plan limits, no automated scraping or excessive load, no unlawful content, and no reselling of the Service without our written permission.</li>
      </ul>
      <h2>AI output and professional responsibility</h2>
      <p>
        Models produced with the Service are design aids. AI-generated geometry may contain errors, and the Service does not check compliance with building codes, structural requirements or accessibility rules. You remain
        responsible for verifying any design before it is used for construction, permits or other professional purposes.
      </p>
      <h2>Availability and changes</h2>
      <p>We work to keep the Service available and your data safe, but we do not guarantee uninterrupted operation. We may improve or change features; if we discontinue the Service we will give reasonable notice so you can export your projects.</p>
      <h2>Liability</h2>
      <p>
        To the extent permitted by law, our total liability arising from the Service is limited to the amount you paid us in the 12 months before the claim, and we are not liable for indirect or consequential loss. Nothing in these
        terms limits liability that cannot be limited by law.
      </p>
      <h2>Termination</h2>
      <p>You can delete your projects and stop using the Service at any time. We may suspend accounts that seriously or repeatedly breach these terms.</p>
      <h2>Contact</h2>
      <p>Questions about these terms: {contact}.</p>
    </LegalPage>
  );
}
