import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";

const COMPANY = "DevAudit, Inc.";
const EFFECTIVE = "October 8, 2026";
const CONTACT_EMAIL = "sean@devaudit.lol";
const DATA_REGION = "the UK (London)";

export const metadata = {
  title: "Privacy Policy — DevAudit",
  description: "How DevAudit collects, uses and protects your information.",
};

type Item = [label: string, text: string];
type Block = string | Item[];
type Section = { title: string; blocks: Block[] };

const SECTIONS: Section[] = [
  {
    title: "1. Overview",
    blocks: [
      `This Privacy Policy explains how ${COMPANY} (“DevAudit”, “we”, “us”) collects, uses and shares personal information when you use the DevAudit website, dashboard, command-line tool (CLI), public API and GitHub integration (together, the “Service”).`,
      "For account and usage data, we act as the controller (or “business”). For the code, error data and other content you submit to the Service, we process it on your behalf and on your instructions. If you need a data processing agreement, contact us using the details in Section 13.",
    ],
  },
  {
    title: "2. Information we collect",
    blocks: [
      [
        ["Account information.", "You sign in with GitHub. We receive your GitHub user ID, username, email address and the basic profile details GitHub shares with us."],
        ["GitHub access.", "At sign-in we request GitHub’s `repo` permission, which GitHub treats as broad read and write access to the repositories you can access, including private ones. DevAudit uses it to read your repositories and, only when you ask for it (for example, applying a suggested fix or committing from the code editor), to create branches and commits, create new repositories and change a repository’s public or private setting. Our servers only make a fixed set of GitHub API calls on your behalf. We store the resulting GitHub access token, encrypted, on our servers so the dashboard, CLI and API can act for you. You can revoke access at any time in your GitHub settings."],
        ["Repository, project and error data.", "Repository and project names, file paths, commit SHAs, source-code excerpts, error messages, stack traces, severity, causes, suggested fixes and patches, and project membership and roles."],
        ["Environment variables.", "Values you save for deployments are encrypted at rest. They are decrypted on our servers only at deploy time and sent to the hosting provider you selected."],
        ["Deployment credentials.", "Access tokens (for Vercel, Netlify, Cloudflare, Render or GitHub) or webhook URLs you enter to deploy. We use them only to carry out that request and do not store them in our database."],
        ["API tokens.", "We store a one-way hash of each token, its name, a short non-secret prefix, and created, last-used and revoked timestamps. The full token is shown to you once."],
        ["AI feature inputs.", "Your prompts, code excerpts, file names, error details and dependency manifests (such as package.json or requirements.txt) that you submit to our AI features. Deployment recommendations use only file names, dependency manifests and environment variable names, never variable values. AI Assistant chat history is kept in your browser’s local storage."],
        ["Collaborator information.", "When you invite someone, we look them up by GitHub username or email. Members of a project can see each other’s username or email."],
        ["Technical and security data.", "IP address (IPv6 addresses are reduced to their network prefix), request timestamps and basic device and browser information, used for rate limiting, abuse prevention and operating the Service. Our infrastructure providers also keep standard server logs."],
        ["Messages you send us.", "Anything you share when you contact us, for example through Discord or email."],
      ],
    ],
  },
  {
    title: "3. Cookies and local storage",
    blocks: [
      "We use your browser’s local storage, not advertising cookies, to keep your sign-in session and to remember preferences and work in progress: theme and layout settings, onboarding state, cached project files, bug logs, test-run summaries and AI Assistant conversations. This storage is essential to how the Service works. You can clear it in your browser settings, but you may be signed out and lose unsynced local work.",
      "As of the effective date we do not use third-party analytics or advertising trackers. If that changes, we will update this policy and ask for consent where the law requires it.",
    ],
  },
  {
    title: "4. How we use information",
    blocks: [
      [
        ["Provide the Service:", "authenticate you, connect repositories, record and analyze errors, generate explanations and fixes, and run deployments you request."],
        ["Keep the Service safe:", "rate limiting, abuse and fraud prevention, debugging and security monitoring."],
        ["Communicate:", "respond to requests and send service-related notices."],
        ["Improve the Service:", "understand reliability and performance and fix problems."],
        ["Comply with the law:", "meet legal obligations and enforce our Terms of Service."],
      ],
      "We do not use your code or error data to train our own AI models, and we do not sell your personal information. The third-party AI providers described in Section 6 handle your inputs under their own terms, which we do not control.",
    ],
  },
  {
    title: "5. Legal bases (EEA and UK)",
    blocks: [
      "Where the GDPR or UK GDPR applies, we rely on: performance of our contract with you (providing the Service); our legitimate interests (security, abuse prevention, reliability and improving the Service); your consent, where we ask for it, which you can withdraw at any time; and compliance with legal obligations.",
    ],
  },
  {
    title: "6. AI processing",
    blocks: [
      "To power features such as error explanations, suggested fixes, the AI Assistant and deployment recommendations, we send the inputs described in Section 2 to third-party AI inference providers, currently OpenRouter and Groq, and to the model providers they route to. We try several models in sequence, and some may be free-tier models.",
      "These providers process your inputs under their own terms and privacy policies. Free-tier models in particular are often offered on looser terms: the provider serving a request may log your inputs and may use them to improve or train its own models. We cannot control or guarantee how any provider retains or uses that data. Please do not submit secrets, credentials, personal data or code you are not comfortable sharing in prompts or code excerpts you send to AI features.",
    ],
  },
  {
    title: "7. How we share information",
    blocks: [
      [
        ["Infrastructure providers:", "Supabase (database and authentication) and our hosting provider (currently Vercel)."],
        ["GitHub:", "to read repositories and, when you ask, write branches and commits."],
        ["AI providers:", "OpenRouter, Groq and the underlying model providers (Section 6)."],
        ["Deployment platforms you choose:", "Vercel, Netlify, Cloudflare, Render, GitHub Pages or a custom webhook receive your project files and environment variables when you deploy."],
        ["Collaborators:", "people you add to a project can see its data and your username or email."],
        ["Legal and safety:", "when required by law or to protect rights, safety and the security of the Service."],
        ["Business transfers:", "in a merger, acquisition or sale of assets, subject to this policy."],
      ],
      "We do not sell personal information or share it for cross-context behavioral advertising.",
    ],
  },
  {
    title: "8. International transfers",
    blocks: [
      `Our primary database is hosted in ${DATA_REGION}, and our providers may process data in other countries, including the United States. Where required, we rely on safeguards such as the UK International Data Transfer Agreement or Addendum, the European Commission’s Standard Contractual Clauses, or equivalent mechanisms.`,
    ],
  },
  {
    title: "9. Retention",
    blocks: [
      "We keep account, project and error data until you delete it or your account, or ask us to. Rate-limiting records are kept only as long as needed for abuse prevention. After deletion, residual copies may remain in backups for a limited period, and we may keep information we are legally required to retain.",
    ],
  },
  {
    title: "10. Security",
    blocks: [
      "We protect data with TLS in transit, AES-256-GCM encryption for stored environment variables and GitHub access tokens, one-way hashing of API tokens, and row-level access controls on our database. No system is perfectly secure, so we cannot guarantee absolute security. Keep your GitHub account and API tokens safe, and tell us right away if you suspect misuse.",
    ],
  },
  {
    title: "11. Your rights and choices",
    blocks: [
      "Depending on where you live, you may have the right to access, correct, delete, restrict or object to our processing of your personal information, to data portability, and to withdraw consent. If you are in California, you also have the right to know what we collect, to delete it, to correct it, and not to be discriminated against for exercising these rights. EEA and UK residents may also complain to their local data protection authority.",
      `To exercise a right, email ${CONTACT_EMAIL}. We may need to verify your identity first. You can also disconnect DevAudit from GitHub in your GitHub settings and delete projects, environment variables and API tokens in the dashboard.`,
    ],
  },
  {
    title: "12. Children and changes",
    blocks: [
      "The Service is not directed to anyone under 16, and we do not knowingly collect their personal information. If you believe a child has given us data, contact us and we will delete it.",
      "We may update this policy from time to time. We will post the new version here with a new effective date and, for material changes, give additional notice.",
    ],
  },
  {
    title: "13. Contact",
    blocks: [`${COMPANY}. Email: ${CONTACT_EMAIL}.`],
  },
];

export default function PrivacyPage() {
  return (
    <main>
      <Navbar />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-24">
        <Reveal direction="up">
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">Privacy Policy</h1>
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
                      {b.map(([label, text]) => (
                        <li key={label}>
                          <span className="font-medium text-ink">{label}</span> {text}
                        </li>
                      ))}
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
