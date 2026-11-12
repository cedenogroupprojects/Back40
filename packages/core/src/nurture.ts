// Nurture: the rules for keeping in touch with leads that aren't on today's
// call list. Pure functions so every agent gets the same behavior and it's
// testable. The planner (supabase/functions/nurture) does the I/O.
import type { Lead, LeadFields } from './types.ts';
import { classifyStage } from './pipeline.ts';

const DAY = 86_400_000;

/** How often to reach out, from what the lead told us about their timeline. */
export function cadenceDays(fields: LeadFields): number {
  const tl = (fields.timeline ?? '').toLowerCase();
  if (tl.startsWith('0')) return 7; // 0–3 months
  if (tl.startsWith('3')) return 14; // 3–6 months
  if (tl.startsWith('6')) return 30; // 6–12 months
  if (tl.startsWith('12') || tl.includes('looking')) return 45;
  return 21; // unknown: every 3 weeks until we learn more
}

/**
 * Text when we're allowed to; otherwise email; otherwise nothing.
 * Automatic sending only texts leads whose consent the CRM recorded; when the agent
 * approves each message it's the agent texting their own lead.
 */
export function pickChannel(lead: Pick<Lead, 'phone' | 'email' | 'fields'>, allowed: ('text' | 'email')[], auto = false): 'text' | 'email' | null {
  const f = lead.fields;
  if (allowed.includes('text') && lead.phone && !f.doNotText && (!auto || f.textConsent)) return 'text';
  if (allowed.includes('email') && lead.email && !f.doNotEmail) return 'email';
  return null;
}

/** Leads that belong on Today (or were just worked) aren't nurtured — the agent is on them. */
export function nurtureEligible(lead: Pick<Lead, 'createdAt' | 'lastContactAt' | 'fields' | 'pinned'>, now = Date.now()): boolean {
  if (lead.pinned) return false;
  if (now - Date.parse(lead.createdAt) < 7 * DAY && !lead.lastContactAt) return false; // brand new: call, don't drip
  if (lead.lastContactAt && now - Date.parse(lead.lastContactAt) < 3 * DAY) return false; // just talked
  const f = lead.fields;
  return !(f.doNotText && f.doNotEmail);
}

/** What kind of message this touch should be. */
/**
 * What a message is built around:
 *  home      — a listing that fits what the lead told us
 *  teaser    — we don't know what they want yet, so a hot home from the agent's usual
 *              market is the hook, and the question finds out if that's their area/price
 *  community — a new-build community
 *  offer     — a program or incentive the agent added (closing costs paid, rate buydown…)
 *  discovery — nothing to share: a sharp question that's easy to answer
 */
export type Touch = 'home' | 'teaser' | 'community' | 'offer' | 'discovery';

/** Something the agent wants to tell leads about, written by the agent. */
export type Offer = { text: string; url?: string };

/**
 * Know what they want → show them a home. Don't know yet → ask one easy question
 * (the answer unlocks matched homes). Every third touch is a new-build community
 * when one fits, so new construction stays in front of them.
 */
export function touchKind(fields: LeadFields, step: number, has: { home: boolean; community: boolean; offer?: boolean }): Touch {
  const knowsWhat = !!(fields.areas?.length || fields.budgetMax);
  if (knowsWhat) {
    if (has.community && (step % 3 === 2 || !has.home)) return 'community';
    if (has.offer && step % 3 === 1 && !has.home) return 'offer';
    if (has.home) return 'home';
    if (has.offer) return 'offer';
    return 'discovery';
  }
  // Nothing on file about what they want: lead with something worth reading anyway.
  if (has.offer && (step % 2 === 1 || !has.home)) return 'offer';
  if (has.home) return 'teaser';
  if (has.community) return 'community';
  return 'discovery';
}

/** Spread first touches over two weeks so nobody gets a 400-message morning. */
export function firstTouchAt(index: number, now = Date.now()): string {
  const day = index % 14;
  return new Date(now + day * DAY).toISOString();
}

export type HomeCard = {
  kind: 'listing' | 'community';
  id: string;
  title: string; // address or community name
  subtitle?: string; // builder / city
  price?: number;
  priceFrom?: number;
  beds?: string;
  baths?: number;
  city?: string;
  url?: string;
  photo?: string;
  highlights?: string;
  /** Why this home is worth a text today. */
  badge?: 'coming_soon' | 'new' | 'price_drop';
  sqft?: number;
  daysOnMarket?: number;
  /** Lofty's own listing id (for the full record and the before-send check). */
  listingId?: string;
  photos?: string[];
  lotSqft?: number;
  yearBuilt?: number;
  garage?: number;
  hoaFee?: number;
  /** Short phrases copied word for word from the MLS listing. The only home details a message may mention. */
  facts?: string[];
};

export const BADGE_TEXT: Record<NonNullable<HomeCard['badge']>, string> = { coming_soon: 'Coming soon', new: 'New listing', price_drop: 'Price drop' };

export type DraftContext = {
  agentName: string;
  channel: 'text' | 'email';
  step: number;
  touch: Touch;
  home: HomeCard | null;
  lead: {
    firstName: string;
    source?: string;
    stage: string;
    createdAt: string;
    lastContactAt: string | null;
    fields: LeadFields;
  };
  history: string[]; // newest first, short lines
  voice?: string; // learned style notes, if any
  offer?: Offer | null;
  /** Any stable number per lead+message (e.g. a hash of the lead id + step), so the closing question varies. */
  variant?: number;
  /** Today, for things like "early 2027". */
  now?: Date;
};

/** A first name we can greet someone by, or null when the CRM has a handle like "rlpmontanez" or "jdog_23". */
export function greetableName(raw: string | undefined | null): string | null {
  const n = (raw ?? '').trim();
  if (!n || n.length > 14 || /[\d_@.]/.test(n)) return null;
  if (n === n.toLowerCase() && n.length > 8) return null; // all-lowercase long strings are usually usernames
  if (!/[aeiouy]/i.test(n) || /^[^aeiouy]{4}/i.test(n)) return null; // "Rlpmontanez"
  if (/(.)\1\1/i.test(n)) return null; // "Sweetkenzzz"
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/**
 * The closing question, varied so every lead doesn't get the same ending.
 * Each one is a style the model writes in its own words; it can't add facts.
 */
export function closingQuestion(touch: Touch, f: LeadFields, variant: number, now = new Date()): string {
  const city = f.areas?.[0];
  const soon = (() => {
    const m = now.getMonth(); // 0-11
    return m >= 9 ? `early ${now.getFullYear() + 1}` : m >= 6 ? 'before the end of the year' : 'this summer';
  })();
  const pool: string[] = [];
  const tour = 'Invite them to text back if they want to see it in person (e.g. "Text me back if you want to walk through it this week.").';
  const more = 'Ask if they want more homes like this one (e.g. "Want me to send you a few more like this?").';
  const timing = `Ask about timing in a light way (e.g. "Are you thinking of making a move ${soon}?").`;
  if (touch === 'home') {
    pool.push('Ask a yes/no about seeing it (e.g. "Want to see it Saturday?").', tour, more);
    if (!f.timeline) pool.push(timing);
    if (city && (f.areas?.length ?? 0) === 1) pool.push(`Ask if they're only looking in ${city} (e.g. "Are you only looking in ${city}, or open to nearby?").`);
  } else if (touch === 'teaser') {
    pool.push(
      'Ask if this area and price are in range, or where to look instead.',
      'Ask which city they want if not this one (e.g. "Is this area on your list, or should I look somewhere else?").',
      timing,
      tour,
      'Ask what price range feels comfortable (e.g. "Is this around your price, or should I aim higher or lower?").',
    );
  } else if (touch === 'community') {
    pool.push('Ask if they want the floor plans.', tour, timing);
  } else if (touch === 'offer') {
    pool.push('Ask a yes/no to send the details.', timing, 'Ask which city they would want it in.');
  } else {
    return ''; // discovery: the plan already says what to ask
  }
  return pool[Math.abs(variant) % pool.length]!;
}

/** The instructions the model gets. Facts only from the record, one clear ask, never generic. */
export function nurturePrompt(c: DraftContext): string {
  const f = c.lead.fields;
  const facts = [
    `First name: ${greetableName(c.lead.firstName) ?? 'unknown (greet them without a name, e.g. "Hi there")'}`,
    c.lead.source ? `Came from: ${c.lead.source}` : null,
    `Stage: ${c.lead.stage}`,
    `Became a lead: ${c.lead.createdAt.slice(0, 10)}`,
    `Last contact: ${c.lead.lastContactAt?.slice(0, 10) ?? 'never'}`,
    f.timeline ? `Buying timeline: ${f.timeline}` : null,
    f.budgetMax ? `Price range: ${f.budgetMin ? `$${f.budgetMin.toLocaleString('en-US')}–` : 'up to '}$${f.budgetMax.toLocaleString('en-US')}` : null,
    f.areas?.length ? `Looking in: ${f.areas.join(', ')}` : null,
    f.bedsMin ? `Wants ${f.bedsMin}+ beds` : null,
    f.preApproved ? 'Pre-approved: yes' : null,
  ].filter(Boolean);
  const homeLine = (h: HomeCard) =>
    `${h.title}${h.city ? `, ${h.city}` : ''}${h.price ? ` — $${h.price.toLocaleString('en-US')}` : ''}${h.beds ? `, ${h.beds} bd` : ''}${h.baths ? `/${h.baths} ba` : ''}${h.sqft ? `, ${h.sqft.toLocaleString('en-US')} sqft` : ''}${h.lotSqft && h.lotSqft >= 7000 ? `, ${h.lotSqft.toLocaleString('en-US')} sqft lot` : ''}${h.facts?.length ? `. VERIFIED FROM THE MLS LISTING (you may mention these, nothing else about the home): ${h.facts.map((x) => `"${x}"`).join('; ')}` : ''}${h.badge ? `. ${{ coming_soon: 'COMING SOON: not on the open market yet', new: h.daysOnMarket === 0 ? 'NEW LISTING: listed today' : `NEW LISTING: on the market ${h.daysOnMarket ?? 'a few'} days`, price_drop: 'PRICE JUST DROPPED' }[h.badge]}` : ''}${h.url ? `. Link: ${h.url}` : ''}`;
  const home = c.home
    ? c.home.kind === 'listing'
      ? c.touch === 'teaser'
        ? `HOME TO USE AS THE HOOK (real MLS listing in the area this agent's buyers usually shop; we do NOT know yet if it is this lead's area or price): ${homeLine(c.home)}`
        : `HOME TO SHARE (real MLS listing that fits them): ${homeLine(c.home)}`
      : `NEW-BUILD COMMUNITY TO SHARE: ${c.home.title}${c.home.subtitle ? ` by ${c.home.subtitle}` : ''} in ${c.home.city}${c.home.priceFrom ? `, from $${c.home.priceFrom.toLocaleString('en-US')}` : ''}${c.home.highlights ? `. ${c.home.highlights}` : ''}${c.home.url ? `. Link: ${c.home.url}` : ''}`
    : null;
  const offer = c.touch === 'offer' && c.offer ? `PROGRAM TO SHARE (written by the agent; use only what it says): ${c.offer.text}${c.offer.url ? `. Link: ${c.offer.url}` : ''}` : null;
  const ask = { area: 'where they want to live (a city or two)', price: 'a comfortable price or monthly payment', timing: 'when they would like to move', beds: 'how many bedrooms they need', open: 'what would make a home a yes for them' }[nextQuestion(f, c.step)];
  const plan = {
    home: 'HOOK: the single most interesting thing about this home for them — the status (coming soon / just listed / just dropped), the price, or the one feature they asked for. VALUE: the few facts that prove it fits what they told us. CTA: an easy yes/no to see it (e.g. "Want to see it Saturday?").',
    teaser: `HOOK: this home — its status and price, and the city. VALUE: one or two facts that make it a good deal. CTA: turn it into a question that tells us what they want, e.g. is this area / price in range, or where should I look instead? (We still need ${ask}.)`,
    community: 'HOOK: the most concrete thing about this community (price from, builder incentive, move-in date) — only what is written above. VALUE: one reason it could fit them. CTA: one easy question (want the floor plans / a tour?).',
    offer: `HOOK: the most concrete part of the program (a dollar amount, a rate, a deadline) — only what the agent wrote. VALUE: what it means for them in plain words. CTA: an easy question that also tells us ${ask}, or a yes/no to send details.`,
    discovery: `There is nothing to share yet. HOOK: something specific we know about them (what they asked about, where they came from, how long they have been looking) or a sharp, curious question — never a greeting plus an introduction. VALUE: why answering helps them (e.g. you can send coming-soon homes before they hit Zillow). CTA: ask ${ask}, answerable in a few words.`,
  }[c.touch];
  const closing = closingQuestion(c.touch, f, c.variant ?? c.step, c.now);
  const name = greetableName(c.lead.firstName);
  return `You are writing a ${c.channel} from ${c.agentName}, a real estate agent, to a lead. It has to earn a reply.

LEAD (facts you may use — nothing else):
${facts.join('\n')}
Recent history (newest first):
${c.history.length ? c.history.map((h) => `- ${h}`).join('\n') : '- none'}
${home ? `\n${home}\n` : ''}${offer ? `\n${offer}\n` : ''}
BUILD IT IN THREE BEATS — HOOK, VALUE, CTA
${plan}
${closing ? `- For THIS message, end with this kind of question instead of the default: ${closing} Write it in your own words; it must still be about this lead and this home.\n` : ''}- The HOOK is the first line and the only line most people read. Under 12 words. Specific beats clever: a number, a status, a place, or something they told us. ${name ? `It can start with their name ("${name}, ...").` : ''}
- Never open with "Hi ${name ?? 'there'}, it's ${c.agentName.split(' ')[0]}" or any greeting + who-I-am line. ${c.step === 0 ? `Say who you are AFTER the hook, in a few words ("${c.agentName.split(' ')[0]} here").` : 'Do not re-introduce yourself.'}
- VALUE is one or two short lines. CTA is the last line: ONE question they can answer in a few words or with yes/no. If there is a link, it goes on its own line after the question.
- Before writing, draft 3 different hooks and keep the most specific, most curiosity-driving one.

SHAPE ONLY — never reuse these facts:
weak: "Hi Ernesto, it's Jeffry, a real estate agent. You reached out a while back. What city are you hoping to buy in?"
strong: "Ernesto, a 4 bed in Fontana just went coming soon at $579K. Jeffry here, you messaged us a while back. Is Fontana on your list, or should I look somewhere else?"
strong: "Maria, that Rialto 3 bed just dropped $15K. Now $524,900, single story, no HOA. Want to see it Saturday?"

RULES
- Sound like a real person texting from their phone. ${c.channel === 'text' ? 'Max 320 characters before the link. No emojis unless natural. No links other than the one given.' : 'Max 90 words. Plain text, no formatting.'}
- Never: "just checking in", "touching base", "hope this finds you well", "hope you're doing well", "I wanted to reach out", "let me know if you have any questions", exclamation-mark hype, or anything that reads like a mass message.
- Only use facts above. Never invent prices, homes, addresses, rates, programs, dates or promises. About a home, say only the numbers given and the VERIFIED MLS phrases; never add features, adjectives about the yard, views, condition or upgrades that are not written there.
- Never show the lead our internal labels: no CRM stage names ("Sent to Lender", "Contacted"), campaign or source codes (e.g. "NB4Y", "IG Messenger", "text code"), tags or scores. You may say "Instagram" or "Facebook" only if the source plainly says so.
- Fair housing: never describe a place by who lives there; no schools-as-demographics, no "family neighborhood" style steering.
${c.voice ? `- Write in this agent's style: ${c.voice}` : ''}

Return JSON only: {"hooks": ["three", "candidate", "hooks"], "body": "...", ${c.channel === 'email' ? '"subject": "short, specific, lowercase-ish subject that works as a hook", ' : ''}"why": "one short line for the agent on why this message, e.g. 'Coming soon in Fontana; asks if that is their area'"}`;
}

/** Stages that mean the deal is done or dead: never nurture these. */
/** Closed, dead or non-lead stages (same rules the Pipeline uses to hide them). */
export const DONE_STAGE = { test: (stage: string | null | undefined) => !!stage && classifyStage(stage).kind !== 'active' };

/**
 * The one thing we most need to learn next, so discovery messages don't all ask
 * the same question: area first, then price, then timing, then beds.
 */
export function nextQuestion(f: LeadFields, step: number): 'area' | 'price' | 'timing' | 'beds' | 'open' {
  const missing: ('area' | 'price' | 'timing' | 'beds')[] = [];
  if (!f.areas?.length) missing.push('area');
  if (!f.budgetMax) missing.push('price');
  if (!f.timeline) missing.push('timing');
  if (!f.bedsMin) missing.push('beds');
  if (!missing.length) return 'open';
  return missing[step % missing.length]!;
}

/** Next touch time after this one. */
export function nextTouchAt(fields: LeadFields, now = Date.now()): string {
  return new Date(now + cadenceDays(fields) * DAY).toISOString();
}

/** Bump when the notes reader learns new fields, so every lead is read again. */
export const NOTES_READER_VERSION = 2;

/** Prompt that pulls search criteria out of an agent's notes on a lead. */
export function criteriaFromNotesPrompt(notes: string[]): string {
  return `These are a real estate agent's notes about a home buyer (newest first):
${notes.map((n) => `- ${n.replace(/\s+/g, ' ').slice(0, 600)}`).join('\n')}

Pull out what the buyer wants. Only include what the notes clearly say; leave anything unclear out.
A MUST-HAVE is something they need ("needs", "has to", "only", "minimum", "no", "must", a firm number). A NICE-TO-HAVE is a preference ("prefers", "would like", "open to", "ideally").
Return JSON only, leaving out any key the notes don't support:
{"areas": ["City"], "budgetMin": 0, "budgetMax": 0, "bedsMin": 0, "bathsMin": 0, "sqftMin": 0, "lotMinSqft": 0, "singleStory": true, "yearBuiltMin": 0, "garageMin": 0, "noHoa": true, "mustHave": ["pool"], "niceToHave": ["two story"]}
- areas: cities they want (not cities they ruled out), at most 5, proper case, no state.
- money in whole dollars ("500-600k" -> 500000 and 600000; "under 700" -> budgetMax 700000).
- lotMinSqft in square feet ("half acre" -> 21780, "quarter acre" -> 10890, "1 acre" -> 43560).
- singleStory only when they need one story; a preference goes in niceToHave.
- mustHave: other required features in 1-3 plain words each, e.g. "pool", "ADU", "RV parking", "casita", "view", "no carpet". At most 5.
- niceToHave: preferences in 1-4 words each. At most 5.
- If nothing usable, return {}.`;
}

export type Criteria = Pick<LeadFields, 'areas' | 'budgetMin' | 'budgetMax' | 'bedsMin' | 'bathsMin' | 'sqftMin' | 'lotMinSqft' | 'singleStory' | 'yearBuiltMin' | 'garageMin' | 'noHoa' | 'mustHave' | 'niceToHave'>;

/** Keep only sane values from the model's answer. */
export function parseCriteria(raw: unknown): Criteria {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: Criteria = {};
  const words = (v: unknown, max: number) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 1 && x.length < 40).map((x) => x.trim()).slice(0, max) : [];
  const a = words(o.areas, 5);
  if (a.length) out.areas = a;
  const int = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && v >= lo && v <= hi ? Math.round(v) : undefined);
  const set = <K extends keyof Criteria>(k: K, v: Criteria[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set('bathsMin', int(o.bathsMin, 1, 8));
  set('sqftMin', int(o.sqftMin, 400, 20_000));
  set('lotMinSqft', int(o.lotMinSqft, 1_000, 2_000_000));
  set('yearBuiltMin', int(o.yearBuiltMin, 1900, 2030));
  set('garageMin', int(o.garageMin, 1, 6));
  if (o.singleStory === true) out.singleStory = true;
  if (o.noHoa === true) out.noHoa = true;
  const must = words(o.mustHave, 5);
  if (must.length) out.mustHave = must;
  const nice = words(o.niceToHave, 5);
  if (nice.length) out.niceToHave = nice;
  const money = (v: unknown) => (typeof v === 'number' && v >= 50_000 && v <= 20_000_000 ? Math.round(v) : undefined);
  const min = money(o.budgetMin), max = money(o.budgetMax);
  if (max) out.budgetMax = max;
  if (min && (!max || min <= max)) out.budgetMin = min;
  if (typeof o.bedsMin === 'number' && o.bedsMin >= 1 && o.bedsMin <= 8) out.bedsMin = Math.round(o.bedsMin);
  return out;
}

/** Must-haves the MLS record can answer with numbers. Unknown counts as a fail: never send a home we can't prove fits. */
export function checkHardRequirements(f: LeadFields, d: { hoaFee: number | null; garage: number | null; yearBuilt: number | null; lotSqft: number | null }): string | null {
  if (f.noHoa && (d.hoaFee === null || d.hoaFee > 0)) return d.hoaFee === null ? 'HOA unknown' : 'has an HOA';
  if (f.garageMin && (d.garage === null || d.garage < f.garageMin)) return `garage under ${f.garageMin}`;
  if (f.yearBuiltMin && (d.yearBuilt === null || d.yearBuilt < f.yearBuiltMin)) return `built before ${f.yearBuiltMin}`;
  if (f.lotMinSqft && (d.lotSqft === null || d.lotSqft < f.lotMinSqft)) return 'lot too small';
  return null;
}

/** Prompt: does this MLS listing clearly have each must-have? And which short phrases are worth quoting? */
export function listingCheckPrompt(listing: { description: string; interiorFeatures: string; exterior: string }, must: string[], wants: string[]): string {
  return `MLS listing text:
DESCRIPTION: ${listing.description.slice(0, 2500)}
INTERIOR FEATURES: ${listing.interiorFeatures.slice(0, 600)}
EXTERIOR: ${listing.exterior.slice(0, 300)}

1. For each required feature, answer true ONLY if the listing text clearly says the home has it. Not mentioned, unclear, "could add", "room for" or "potential" = false.
Required: ${must.length ? must.map((m) => `"${m}"`).join(', ') : '(none)'}
2. Copy up to 3 short phrases (3-8 words) WORD FOR WORD from the listing text that a buyer who wants ${wants.length ? wants.join(', ') : 'a good home'} would care about. Exact substrings only; no rewording.
Return JSON only: {"has": {"<feature>": true}, "quotes": ["..."]}`;
}

/** Keep the model's answer honest: features it says yes to, and quotes that really appear in the text. */
export function parseListingCheck(raw: unknown, must: string[], text: string): { ok: boolean; missing: string[]; facts: string[] } {
  const o = (raw ?? {}) as { has?: Record<string, unknown>; quotes?: unknown };
  const has = o.has ?? {};
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim();
  const missing = must.filter((m) => has[m] !== true && has[norm(m)] !== true);
  const hay = norm(text);
  const facts = (Array.isArray(o.quotes) ? o.quotes : [])
    .filter((q): q is string => typeof q === 'string' && q.trim().length >= 6 && q.length <= 80)
    .map((q) => q.trim().replace(/[.!]+$/, ''))
    .filter((q) => hay.includes(norm(q)))
    .slice(0, 3);
  return { ok: missing.length === 0, missing, facts };
}

/** Prompt: did a drafted message say anything about the home that the listing doesn't back up? */
export function factCheckPrompt(message: string, home: HomeCard): string {
  const known = [
    home.title, home.city, home.price ? `$${home.price.toLocaleString('en-US')}` : null, home.beds ? `${home.beds} bedrooms` : null, home.baths ? `${home.baths} baths` : null,
    home.sqft ? `${home.sqft} sqft` : null, home.lotSqft ? `${home.lotSqft} sqft lot` : null, home.badge ? { coming_soon: 'coming soon', new: 'new listing', price_drop: 'price recently reduced' }[home.badge] : null,
    ...(home.facts ?? []),
  ].filter(Boolean);
  return `A text to a home buyer about a listing:
"${message}"

Everything we actually know about the home: ${known.join('; ')}.

Does the text claim anything about the HOME (features, size, yard, condition, upgrades, views, schools, neighborhood) that is not in that list? Statements about the buyer, the agent, timing or a showing are fine.
Return JSON only: {"ok": true} or {"ok": false, "problem": "what it made up"}`;
}

/** Texts read best with the question last and the link on its own line under it. */
export function linkLast(body: string): string {
  const urls = body.match(/https?:\/\/\S+/g);
  if (!urls?.length) return body.trim();
  let text = body;
  for (const u of urls) text = text.replace(u, ' ');
  text = text.replace(/[ \t]+/g, ' ').replace(/ +([,.!?])/g, '$1').replace(/\s*\n\s*/g, '\n').trim().replace(/[:\-–—]\s*$/, '').trim();
  const clean = urls.map((u) => u.replace(/[).,!?]+$/, ''));
  return `${text}\n\n${[...new Set(clean)].join('\n')}`;
}
