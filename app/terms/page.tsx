import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";

const COMPANY = "DevAudit, Inc.";
const EFFECTIVE = "October 8, 2026";
const CONTACT_EMAIL = "sean@devaudit.lol";
const GOVERNING_LAW = "England and Wales";
const COURTS = "the courts of England and Wales";

export const metadata = {
  title: "Terms of Service — DevAudit",
  description: "The terms that govern your use of DevAudit.",
};

type Item = [label: string, text: string];
type Block = string | (string | Item)[];
type Section = { title: string; blocks: Block[] };

const SECTIONS: Section[] = [
  {
    title: "1. Agreement",
    blocks: [
      `These Terms of Service (“Terms”) are a binding agreement between you and ${COMPANY} (“DevAudit”, “we”, “us”) governing your use of the DevAudit website, dashboard, CLI, public API and GitHub integration (the “Service”). By accessing or using the Service you agree to these Terms and to our Privacy Policy. If you do not agree, do not use the Service.`,
      "You must be at least 18 years old, or the age of majority where you live, to use the Service. If you use it on behalf of a company or other organization, you confirm you have authority to bind it, and “you” includes that organization.",
    ],
  },
  {
    title: "2. The Service",
    blocks: [
      "DevAudit records and analyzes errors in your code, explains likely causes, suggests fixes, offers an AI assistant and deployment recommendations, and can deploy your projects to third-party hosting platforms you choose. We may add, change or remove features at any time. Some features may be labeled beta or experimental and are provided as-is.",
    ],
  },
  {
    title: "3. Your account",
    blocks: [
      "You sign in with your GitHub account. You are responsible for all activity under your account, for keeping your GitHub credentials, DevAudit API tokens and any deployment tokens secure, and for the accuracy of the information you provide. Tell us promptly if you suspect unauthorized access. We are not liable for loss caused by your failure to protect your credentials.",
    ],
  },
  {
    title: "4. Your content and code",
    blocks: [
      "You keep all rights in the code, error data, environment variables and other content you submit or connect to the Service (“Your Content”). You grant us a limited, worldwide, non-exclusive licence to host, process, analyze, transmit and display Your Content solely to operate, secure and provide the Service to you, including sending it to the third-party providers described in our Privacy Policy.",
      "You represent that you have all rights and permissions needed to use Your Content and to connect the repositories you add, including any permission required by your employer, client or repository owner, and that Your Content and your use of the Service do not violate any law or third-party right.",
    ],
  },
  {
    title: "5. GitHub and other third-party services",
    blocks: [
      "The Service works with third-party services such as GitHub, Supabase, AI model providers and deployment platforms (Vercel, Netlify, Cloudflare, Render, GitHub Pages or a custom webhook). Your use of those services is governed by their own terms, and you are responsible for any fees, quotas and consequences on your accounts with them.",
      "When you ask the Service to act on GitHub, for example to create a fix branch or commit, create a repository or change its visibility, or to deploy a project, it does so using the permissions and credentials you provided and on your instruction. We are not responsible for the availability, changes or conduct of third-party services.",
    ],
  },
  {
    title: "6. AI features",
    blocks: [
      "Explanations, suggested fixes, patches, deployment recommendations and other AI output may be inaccurate, incomplete or unsuitable for your code. Review, test and understand all output before you apply, merge or deploy it. You are solely responsible for decisions you make and changes you commit or deploy based on it.",
      "Do not submit secrets, credentials or sensitive personal data to AI features. Inputs are processed by third-party AI providers, as described in our Privacy Policy. AI output may be similar to output given to other users, and we make no promise that it is original or free of third-party rights.",
    ],
  },
  {
    title: "7. Acceptable use",
    blocks: [
      "You agree not to:",
      [
        "break the law, or infringe or violate anyone’s rights, including by connecting repositories you have no right to access;",
        "use the Service, including the deploy feature, to host or distribute malware, phishing, spam or other unlawful, deceptive or harmful content;",
        "probe, scan or test the vulnerability of the Service, or bypass authentication, rate limits or other protections;",
        "overload, disrupt or abuse the Service or its API, or use it to attack other systems, including through the custom deploy webhook;",
        "reverse engineer or copy the Service, except where the law allows it despite this restriction;",
        "share your account or API tokens, or resell or provide the Service to third parties without our written permission; or",
        "use the Service to build a competing product or to train a machine-learning model.",
      ],
    ],
  },
  {
    title: "8. API and CLI",
    blocks: [
      "API tokens are personal credentials. You are responsible for all use of them. We may apply rate limits and quotas and may revoke tokens that are abused or compromised. Public API behaviour may change over time.",
    ],
  },
  {
    title: "9. Fees",
    blocks: [
      "Unless we tell you otherwise, the Service is currently provided free of charge. If we introduce paid plans, we will describe the price and billing terms before you are charged, and you may stop using the Service instead. Third-party providers may charge you separately.",
    ],
  },
  {
    title: "10. Our intellectual property and feedback",
    blocks: [
      "The Service, including its software, design, text, logos and trademarks, belongs to DevAudit and its licensors and is protected by law. We grant you a limited, revocable, non-exclusive, non-transferable right to use the Service under these Terms. If you give us feedback or suggestions, you allow us to use them without restriction or payment.",
    ],
  },
  {
    title: "11. Availability, suspension and termination",
    blocks: [
      "We do not guarantee that the Service will be uninterrupted, error-free or secure, and we may modify or discontinue it. You may stop using the Service and delete your account at any time. We may suspend or end your access immediately, with notice where practical, if you breach these Terms, create risk or legal exposure for us or others, or if we discontinue the Service. Sections that by their nature should survive termination will survive, including 4 (licence for stored content until deleted), 10, 12, 13 and 14.",
    ],
  },
  {
    title: "12. Disclaimers",
    blocks: [
      "To the fullest extent permitted by law, the Service is provided “as is” and “as available”, without warranties of any kind, whether express, implied or statutory, including merchantability, fitness for a particular purpose, accuracy, non-infringement and uninterrupted or error-free operation. DevAudit does not warrant that it will find every error or vulnerability, or that its suggestions are correct or secure. Nothing in these Terms limits rights you have under mandatory consumer-protection law.",
    ],
  },
  {
    title: "13. Limitation of liability and indemnity",
    blocks: [
      "To the fullest extent permitted by law, DevAudit and its officers, employees and suppliers will not be liable for any indirect, incidental, special, consequential, exemplary or punitive damages, or for lost profits, revenue, data, goodwill or business, arising from or related to the Service, even if advised of the possibility. Our total liability for any claim relating to the Service is limited to the greater of the amount you paid us in the 12 months before the claim or USD 100. Nothing in these Terms excludes or limits liability that cannot lawfully be excluded or limited, such as liability for fraud or for death or personal injury caused by negligence.",
      "You will defend and indemnify DevAudit against third-party claims, losses and expenses (including reasonable legal fees) arising from Your Content, your use of the Service in breach of these Terms, or your violation of any law or third-party right.",
    ],
  },
  {
    title: "14. Governing law and disputes",
    blocks: [
      `These Terms are governed by the laws of ${GOVERNING_LAW}, without regard to conflict-of-law rules. Any dispute will be brought exclusively in ${COURTS}, and you and we consent to that jurisdiction. If you are a consumer, you also keep any right to bring a claim in the courts of your country of residence and to rely on the mandatory consumer laws there.`,
    ],
  },
  {
    title: "15. Changes and general terms",
    blocks: [
      "We may update these Terms. We will post the new version here with a new effective date and, for material changes, give additional notice. Continued use after the effective date means you accept the changes. These Terms and the Privacy Policy are the entire agreement between you and us about the Service. If a provision is unenforceable, the rest remains in effect. Our failure to enforce a provision is not a waiver. You may not assign these Terms without our consent; we may assign them in connection with a merger, acquisition or sale of assets.",
    ],
  },
  {
    title: "16. Contact",
    blocks: [`Questions about these Terms? Email ${CONTACT_EMAIL}.`],
  },
];

export default function TermsPage() {
  return (
    <main>
      <Navbar />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-24">
        <Reveal direction="up">
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">Terms of Service</h1>
          <p className="mt-3 text-sm text-ink-soft">Effective {EFFECTIVE}</p>
        </Reveal>

        <div className="mt-10 space-y-10">
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <h2 className="font-display text-xl font-semibold text-ink">{s.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-6 text-ink-soft">
                {s.blocks.map((b, i) =>
                  typeof b === "string" ? (
                    <p key={i}>{b}</p>
                  ) : (
                    <ul key={i} className="list-disc space-y-2 pl-5">
                      {b.map((item) =>
                        typeof item === "string" ? (
                          <li key={item}>{item}</li>
                        ) : (
                          <li key={item[0]}>
                            <span className="font-medium text-ink">{item[0]}</span> {item[1]}
                          </li>
                        ),
                      )}
                    </ul>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      <Footer />
    </main>
  );
}
