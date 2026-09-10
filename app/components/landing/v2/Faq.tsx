import { PLANS, planCredits } from "@/app/lib/plans";
import Reveal from "./Reveal";
import shared from "./landing.module.css";
import styles from "./Faq.module.css";

/**
 * Native <details>, not a JavaScript accordion.
 *
 * The answers are in the markup either way, so search engines index them, and
 * the disclosure works before hydration and without JavaScript at all.
 */
export default function Faq() {
  const proCredits = planCredits("pro")?.toLocaleString("en-GB") ?? "1,000";
  const proPrice = PLANS.pro.priceMonthly?.toFixed(2) ?? "7.99";

  const QUESTIONS = [
    {
      q: "What actually is Jooma?",
      a: "Thirty five tools that make the things teachers make. You pick a tool, answer a few questions such as year group, subject and topic, and it hands you a finished resource you can edit, print or present. There is no prompt writing and nothing to learn.",
    },
    {
      q: "What is a credit?",
      a: `How we price the work. Bigger jobs such as a full teaching deck cost more than a single worksheet. Pro gives you ${proCredits} credits a month and you can top up any time. Editing or refining something you have already made never costs anything.`,
    },
    {
      q: "Is it aligned to the UK curriculum?",
      a: "Yes. Every tool is written around the national curriculum for England, Scotland, Wales and Northern Ireland. You choose your curriculum once and it applies everywhere, so year group and key stage are built in rather than bolted on.",
    },
    {
      q: "Who is Jo?",
      a: "Jo is the assistant built into Jooma. Tell it what you are teaching in plain English and it opens the right tool with the details already filled in. It asks a question back if something is unclear, so you are never guessing what it will produce.",
    },
    {
      q: "Can I share resources with colleagues?",
      a: "Yes. Add colleagues by username or email, then share any resource straight to their library. They get their own copy to edit, and yours stays untouched. Most schools end up with a shared bank of resources built by the people who teach there.",
    },
    {
      q: "Can I edit what it makes?",
      a: "All of it. Change the wording, the reading age, the difficulty or a single question. Everything saves to your library so you can pick it up next year.",
    },
    {
      q: "Is pupil data safe?",
      a: "Jooma never asks for pupil names or personal data and you should not enter any. Everything you make belongs to you and is stored in the UK.",
    },
    {
      q: "What if my school wants it for everyone?",
      a: `Schools and trusts get pooled credits, an admin dashboard, usage reporting and one invoice. Get in touch and we will put a quote together. For a single teacher, Pro is £${proPrice} a month.`,
    },
  ];

  return (
    <section className={shared.sec}>
      <div className={shared.shell}>
        <Reveal className={`${shared.secHead} ${shared.secHeadCentre}`}>
          <span className={shared.eyebrow}>Questions</span>
          <h2>Before you start.</h2>
        </Reveal>

        <Reveal className={styles.faq}>
          {QUESTIONS.map((item, i) => (
            <details key={item.q} open={i === 0}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
