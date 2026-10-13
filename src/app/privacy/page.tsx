import type { Metadata } from 'next';
import { LegalPage, legalEntity } from '@/client/site/LegalPage';

export const metadata: Metadata = { title: 'Privacy policy' };

export default function Privacy() {
  const { company, email } = legalEntity();
  const contact = email ? <a href={`mailto:${email}`} className="underline underline-offset-2">{email}</a> : 'the contact address on this website';
  return (
    <LegalPage title="Privacy policy" updated="13 October 2026">
      <p>
        {company} is the controller of the personal data processed in AI 3D Studio. This policy explains what we collect, why, and the choices you have. We process personal data in accordance with the EU General Data Protection
        Regulation (GDPR).
      </p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data:</strong> your name, email address and a one-way hash of your password (we never store the password itself).</li>
        <li><strong>Project data:</strong> the models, chat history with the assistant, thumbnails and files (such as floor plans) you create or upload.</li>
        <li><strong>Usage data:</strong> monthly counters of AI requests and projects, used to apply your plan’s limits.</li>
        <li><strong>Billing data:</strong> if you subscribe, Stripe processes your payment details. We receive a customer reference, subscription status and plan — never your full card number.</li>
        <li><strong>Technical data:</strong> server logs with IP addresses and request information, kept for security and troubleshooting.</li>
      </ul>
      <h2>Why we process it</h2>
      <ul>
        <li>To provide the Service you signed up for (contract): your account, projects, AI features and exports.</li>
        <li>To bill paid plans and meet accounting obligations (contract and legal obligation).</li>
        <li>To keep the Service secure and prevent abuse, such as rate-limiting sign-in attempts (legitimate interest).</li>
      </ul>
      <h2>AI processing</h2>
      <p>
        When you send an instruction to the AI assistant, use automatic drawing recognition or server speech-to-text, the relevant content — your instruction, a compact description of your model, and any image or audio you provide — is
        sent to the AI provider configured for the Service (for example Anthropic or OpenAI) to produce a response. These providers act as our processors. Edits handled by the built-in interpreter run in your browser and are not sent to an
        AI provider.
      </p>
      <h2>Who we share it with</h2>
      <ul>
        <li>Hosting and database providers that run the Service on our behalf.</li>
        <li>Stripe, for payments.</li>
        <li>The AI providers described above.</li>
      </ul>
      <p>Some of these providers may process data outside the EU/EEA; where they do, transfers rely on appropriate safeguards such as the EU Standard Contractual Clauses. We do not sell personal data.</p>
      <h2>Cookies</h2>
      <p>We use one strictly necessary cookie to keep you signed in. We do not use advertising or third-party tracking cookies.</p>
      <h2>Retention</h2>
      <p>We keep account and project data while your account exists. Billing records are kept as long as accounting law requires. Server logs are kept for a limited period.</p>
      <h2>Your rights</h2>
      <p>
        You can delete your account and all its projects yourself from the account page. You can also request access to, correction or deletion of your personal data, object to or restrict certain processing, and receive your data in a portable format. Contact us at {contact}. You also have the right to lodge a
        complaint with your data protection authority (in Sweden, IMY).
      </p>
      <h2>Changes</h2>
      <p>We will post changes to this policy here and point out significant changes in the Service before they take effect.</p>
    </LegalPage>
  );
}
