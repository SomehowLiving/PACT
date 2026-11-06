import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/*
 * PACT's public landing page (route "/"). Everything it claims is built and tested; what is not
 * yet proven (a funded mainnet fill) is said plainly. Screenshots are the real app on DEMO data.
 */

const SERIF = "font-[family-name:var(--font-serif)]";

function Section({ id, eyebrow, title, intro, children }: { id?: string; eyebrow: string; title: ReactNode; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-[1180px] scroll-mt-24 px-4 py-16 md:px-8 md:py-24">
      <div className="text-[12px] uppercase tracking-[0.16em] text-accent">{eyebrow}</div>
      <h2 className={`${SERIF} mt-3 max-w-3xl text-[34px] font-medium leading-[1.1] text-ink md:text-[46px]`}>{title}</h2>
      {intro ? <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-ink/75">{intro}</p> : null}
      <div className="mt-10">{children}</div>
    </section>
  );
}

function Shot({ src, alt, caption, priority = false }: { src: string; alt: string; caption: string; priority?: boolean }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
      <Image src={src} alt={alt} width={1440} height={941} priority={priority} className="h-auto w-full" />
      <figcaption className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[12px] text-mute">
        <span>{caption}</span>
        <span className="shrink-0 whitespace-nowrap rounded-full border border-dashed border-line px-2 py-0.5 text-[10.5px] uppercase tracking-wide">DEMO data</span>
      </figcaption>
    </figure>
  );
}

const STEPS = [
  {
    n: "01",
    title: "A leader publishes a plan",
    body: "Pair, side, Flash order type, entry, stop, target, invalidation and how many followers it can take. The leader can attach their own Flash order and Base trades as evidence.",
  },
  {
    n: "02",
    title: "Your mandate decides",
    body: "Your own rules for that leader size the copy and return COPY, SCALE, WAIT, REVIEW or DECLINE, with the reason. A blocked plan never reaches Flash.",
  },
  {
    n: "03",
    title: "You sign; Flash executes",
    body: "PACT gets a Flash quote, your browser re-checks the exact payload, and you sign in your wallet. Your stop and target go on as a Flash TP/SL pair on your position.",
  },
  {
    n: "04",
    title: "Every step is on the record",
    body: "Fills, drift against the leader's entry, fees and protection are read back from Flash. Each decision joins a hash-chained evidence log your browser can verify.",
  },
];

const FEATURES: { title: string; body: string; tag: string }[] = [
  { tag: "Mandate", title: "One mandate per leader", body: "Follow up to ten leaders. Each gets its own sizing (proportional, fixed or stop-risk), daily sleeve, order types and exit, inside your portfolio caps." },
  { tag: "Policy", title: "Policy before price", body: "Entry drift becomes the Flash limit price; impact, cost and concentration are checked before a quote. Blocked plans are never quoted." },
  { tag: "Wallet guard", title: "Your browser checks what you sign", body: "Recipient, tokens, amount, spender, fee vault and deadline are re-checked in the page. In tests it refused a quote whose amount a server had inflated 20×." },
  { tag: "Exits", title: "Your exit, not the leader's", body: "PACT never mirrors a leader's exit. Your stop and target sit on Flash as a protective pair; cancelling a copy cancels both with one signature." },
  { tag: "Evidence", title: "Plans backed by execution", body: "A leader's attached Flash order and Base trades are read and compared with the plan. A plan the leader's own execution contradicts is held for every follower." },
  { tag: "Fairness", title: "Catches leaders who dump on followers", body: "PACT flags a leader who traded long before publishing at a better price, or whose asset left their wallet on Base while followers' copies filled. A repeat holds new copies." },
  { tag: "World ID", title: "Verified humans", body: "A leader can prove one unique human is behind their wallet; one human backs one leader address. Followers can copy verified humans only, and approve Autopilot limits as a human." },
  { tag: "Autopilot", title: "Automation with limits on chain", body: "An optional session key that can only sign within limits your PACT wallet enforces on chain: tokens, amounts, recipient, expiry. Revocable in one call." },
  { tag: "Paper copies", title: "Probation with real quotes", body: "Every new plan is paper-copied at Flash's real all-in price, with no signature. Followers can require a leader to pass probation before copying." },
];

const NEVER = [
  "Hold your private key or your funds.",
  "Place a trade you did not sign, or that a session key you created and limited on chain did not sign.",
  "Invent PnL, win rates or leader rankings. Numbers come from Flash fills and on-chain records, or they are not shown.",
  "Claim to see what it cannot: it reads Flash and Base, not centralized exchanges or other chains.",
];

const STACK = [
  { name: "Definitive Flash", what: "Quotes, TWAP, limit and market orders, TP/SL pairs, order stream, batch cancel" },
  { name: "Base", what: "Primary chain; leader evidence and conduct are read from Base RPC" },
  { name: "Arc", what: "Same follower flow on chain 5042, validated up to Flash's funding check" },
  { name: "World ID 4.0", what: "Verified-human leaders and human approval of Autopilot limits" },
  { name: "Chainlink", what: "ETH/USD reference price beside Flash and the chart at quote time" },
];

export function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-bg text-ink">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-[68px] max-w-[1180px] items-center gap-6 px-4 md:px-8">
          <Link href="/" className={`${SERIF} flex items-start text-[28px] leading-none tracking-[0.02em]`}>
            PACT<span className="-mt-1 ml-0.5 text-[16px] text-ink/80">+</span>
          </Link>
          <nav className="hidden items-center gap-7 text-[14px] text-ink/70 md:flex" aria-label="Sections">
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#why" className="hover:text-ink">Why PACT</a>
            <a href="#fairness" className="hover:text-ink">Fairness</a>
            <a href="#built" className="hover:text-ink">Built on</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/lab" className="btn hidden h-10 px-4 sm:inline-flex">
              Demo lab
            </Link>
            <Link href="/discover" className="btn btn-primary h-10 px-5">
              Launch app
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_70%_0%,color-mix(in_oklab,var(--accent)_18%,transparent),transparent)]" />
        <div className="relative mx-auto grid max-w-[1180px] items-center gap-12 px-4 pb-10 pt-14 md:px-8 md:pt-20 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div>
            <div className="text-[12px] uppercase tracking-[0.16em] text-accent">ETHGlobal Mumbai 2026 · built on Definitive Flash</div>
            <h1 className={`${SERIF} mt-4 text-[48px] font-medium leading-[1.02] md:text-[68px]`}>
              Copy the plan.
              <br />
              Keep the control.
            </h1>
            <p className="mt-6 max-w-xl text-[16.5px] leading-relaxed text-ink/75">
              PACT is non-custodial copy trading. Leaders publish structured trade plans; your own mandate decides what to copy, how much, and how you exit. You sign
              every order in your wallet, and Flash executes it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/discover" className="btn btn-primary h-12 px-6 text-[15px]">
                Launch app
              </Link>
              <Link href="/lab" className="btn h-12 px-6 text-[15px]">
                Explore the demo
              </Link>
              <Link href="/leader" className="btn btn-ghost h-12 px-5 text-[15px]">
                Publish a plan →
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-mute">
              <li>✓ No custody, no private keys</li>
              <li>✓ You sign every order</li>
              <li>✓ Every decision on the record</li>
            </ul>
          </div>
          <Shot src="/landing/review.webp" alt="PACT proposal review: chart with the leader's levels, the trade plan, the policy check and Flash signing" caption="Proposal review: plan, policy check and Flash signing" priority />
        </div>
      </section>

      {/* Problem */}
      <Section
        id="why"
        eyebrow="The problem"
        title="Copy trading works for leaders. Followers pay for it."
        intro={
          <>
            A publisher-reported study of 100,236 copier outcomes on Binance, Bybit and MEXC found 97% of leaders green on their own PnL, but only 44% of them made money for
            the people copying them. The idea can be right and the copy still loses.
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { t: "A different trade", b: "Followers get a worse entry, a size that does not fit their capital, costs that erase the edge, and an exit they do not control." },
            { t: "Exit liquidity", b: "A leader can buy early, publish, and sell into the buying their own followers create. Most platforms cannot see it, or do not show it." },
            { t: "Blind automation", b: "Copy bots hold keys or mirror every move. Followers rarely see what they are signing, or why a trade was taken." },
          ].map((c) => (
            <div key={c.t} className="panel p-6">
              <h3 className={`${SERIF} text-[22px] font-medium`}>{c.t}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink/70">{c.b}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* How it works */}
      <Section id="how" eyebrow="How it works" title="A leader proposes. Your mandate decides. You sign." intro="PACT sits between a leader's plan and your wallet. It never holds either.">
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="panel relative p-6">
              <div className={`${SERIF} text-[34px] leading-none text-accent`}>{s.n}</div>
              <h3 className="mt-4 text-[16px] font-medium text-ink">{s.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink/70">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 grid gap-3 sm:grid-cols-5">
          {[
            ["COPY", "fits the mandate", "good"],
            ["SCALE", "fits, smaller", "good"],
            ["WAIT", "not now", "warn"],
            ["REVIEW", "needs your eyes", "warn"],
            ["DECLINE", "outside the mandate", "bad"],
          ].map(([a, d, tone]) => (
            <div key={a} className="rounded-xl border border-line bg-panel-2 px-4 py-3">
              <div className={`text-[13px] font-semibold tracking-wide ${tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-bad"}`}>{a}</div>
              <div className="text-[12px] text-mute">{d}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Product */}
      <section className="mx-auto max-w-[1180px] px-4 md:px-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <Shot src="/landing/discover.webp" alt="Discover leaders: a table of leaders with plan quality, evidence, reward to risk and copyability for your desk" caption="Discover: leaders by plan quality, evidence and copyability for you" />
          <Shot src="/landing/portfolio.webp" alt="Portfolio: copied positions, exposure and allocation by leader" caption="Portfolio: positions, exposure and sleeves by leader" />
        </div>
      </section>

      {/* Features */}
      <Section eyebrow="What makes it different" title="Familiar trading. Follower-owned rules." intro="The shell looks like the terminals you know. What is new is who is in charge of the copy.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="panel p-6">
              <div className="text-[11px] uppercase tracking-[0.14em] text-accent">{f.tag}</div>
              <h3 className="mt-2 text-[16.5px] font-medium text-ink">{f.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink/70">{f.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Fairness */}
      <Section
        id="fairness"
        eyebrow="Follower fairness"
        title="The first copy desk that can show a leader dumped on their followers."
        intro="Every evidence-backed plan carries the leader's own trade and its time. PACT compares it with followers' real Flash fills and with what left the leader's wallet on Base while followers were buying."
      >
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <Shot src="/landing/conduct.webp" alt="Leader profile with a Follower fairness panel: the leader sold into followers' buys twice, and new copies are held for review" caption="A leader flagged twice: new copies are held for every follower" />
          <div className="space-y-4">
            {[
              { t: "Traded well before publishing", b: "The leader's own trade came at least 30 minutes before the plan, and followers paid at least 1% more. Trading just before publishing is normal skin in the game." },
              { t: "Sold into followers' buys", b: "The plan's asset left the leader's wallet on Base while followers' copies were filling: at least a quarter of the position." },
              { t: "Once is a warning. Twice is a hold.", b: "A repeat holds every follower's new copies of that leader for review, and the finding goes into the evidence log." },
              { t: "Honest limits", b: "PACT reads Base. Sales on a centralized exchange, another chain or another wallet are not visible, and the page says so." },
            ].map((c) => (
              <div key={c.t} className="border-l-2 border-accent/60 pl-4">
                <h3 className="text-[15.5px] font-medium text-ink">{c.t}</h3>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink/70">{c.b}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Never */}
      <Section eyebrow="Trust" title="What PACT will never do">
        <ul className="grid gap-3 md:grid-cols-2">
          {NEVER.map((n) => (
            <li key={n} className="flex gap-3 rounded-xl border border-line bg-panel px-5 py-4 text-[14px] leading-relaxed text-ink/80">
              <span aria-hidden className="text-bad">✕</span>
              {n}
            </li>
          ))}
        </ul>
      </Section>

      {/* Built on */}
      <Section id="built" eyebrow="Built on" title="Real execution, real identity, real prices.">
        <div className="overflow-hidden rounded-2xl border border-line">
          {STACK.map((s, i) => (
            <div key={s.name} className={`grid gap-1 bg-panel px-5 py-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-center ${i ? "border-t border-line" : ""}`}>
              <div className={`${SERIF} text-[20px] font-medium`}>{s.name}</div>
              <div className="text-[13.5px] text-ink/70">{s.what}</div>
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-2xl border border-dashed border-line px-5 py-4 text-[13.5px] leading-relaxed text-ink/75">
          <span className="font-medium text-ink">Status.</span> Tested end to end against live Flash on Base and Arc with throwaway wallets: real quotes, the wallet guard, real
          signatures, and Flash checking them before refusing on balance. World ID tested on World&apos;s staging network. The first funded mainnet fill is in progress.
          Hackathon software, not audited, not investment advice.
        </div>
      </Section>

      {/* CTA */}
      <section className="mx-auto max-w-[1180px] px-4 pb-24 md:px-8">
        <div className="panel relative overflow-hidden px-6 py-14 text-center md:px-12">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_80%_at_50%_100%,color-mix(in_oklab,var(--accent)_14%,transparent),transparent)]" />
          <h2 className={`${SERIF} relative text-[36px] font-medium leading-tight md:text-[48px]`}>Follow leaders on your terms.</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-[15px] text-ink/70">Open the app on a DEMO desk to see every decision PACT makes, or connect a wallet and set your own mandate.</p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/discover" className="btn btn-primary h-12 px-7 text-[15px]">
              Launch app
            </Link>
            <Link href="/leader" className="btn h-12 px-6 text-[15px]">
              Become a leader
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-[12.5px] text-mute md:px-8">
          <span className={`${SERIF} text-[18px] text-ink`}>PACT⁺</span>
          <span>Non-custodial copy trading on Definitive Flash · ETHGlobal Mumbai 2026</span>
          <span className="flex gap-4">
            <Link href="/desk" className="hover:text-ink">
              Desk
            </Link>
            <Link href="/lab" className="hover:text-ink">
              Demo lab
            </Link>
            <Link href="/discover" className="hover:text-ink">
              Leaders
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
