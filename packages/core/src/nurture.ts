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
 * How the text ends: one easy, casual ask, varied per lead.
 * Each is a direction the model writes in its own words.
 */
export function closingQuestion(touch: Touch, f: LeadFields, variant: number, now = new Date()): string {
  const city = f.areas?.[0];
  const soon = (() => {
    const m = now.getMonth(); // 0-11
    return m >= 9 ? `early ${now.getFullYear() + 1}` : m >= 6 ? 'before the end of the year' : 'this summer';
  })();
  const pool: string[] = [];
  const see = 'Ask if they want to go see it (e.g. "Want to go see it before anyone else does?" / "Want me to get you in?").';
  const weekend = 'Ask if they are around to see it (e.g. "You around this weekend?").';
  const pics = 'Offer to send the pictures (e.g. "Want me to send you the pics?").';
  const still = 'Ask if they are still looking in that area (e.g. "Still looking out that way?").';
  const timing = `Ask about timing casually (e.g. "Still thinking ${soon}?" / "Are you thinking of moving ${soon}?").`;
  if (touch === 'home') {
    pool.push(see, weekend, pics);
    if (!f.timeline) pool.push(timing);
    if (city && (f.areas?.length ?? 0) === 1) pool.push(`Ask if ${city} is still the spot (e.g. "Still set on ${city}?").`);
  } else if (touch === 'teaser') {
    pool.push(still, 'Ask if that is the right price range (e.g. "Is that around what you had in mind?").', see, pics, timing);
  } else if (touch === 'community') {
    pool.push('Offer the floor plans (e.g. "Want me to send you the floor plans?").', weekend, timing);
  } else if (touch === 'offer') {
    pool.push('Offer to send the details (e.g. "Want me to send you the details?").', timing, 'Ask where they would want to be (e.g. "Where would you want to be?").');
  } else {
    return ''; // discovery: the plan already says what to ask
  }
  return pool[Math.abs(variant) % pool.length]!;
}

/**
 * How the text opens. Every one sounds like the agent just found something for
 * this person and is excited to tell them. Varied so leads don't all get the same line.
 */
export function openingAngle(touch: Touch, variant: number, rapport = true): string {
  if (touch === 'discovery') return '';
  const angles = [
    'Open like you think you found THE one for them (e.g. "Daniel!! I think I found it.").',
    'Open like you know they will love it (e.g. "Ann, ok you\'re going to love this one.").',
    'Open like you just came across it (e.g. "Hey Chris, just came across one that hasn\'t hit the market.").',
    rapport
      ? 'Open like it made you think of them (e.g. "Saw this come up today and thought of you.").'
      : 'Open with what just happened, casually (e.g. "This one just came up today.").',
    'Open with the one detail that makes it exciting, casually (e.g. "Pool, spa, AND a bedroom downstairs.").',
    'Open with a quick, casual heads-up (e.g. "Hey Francisco, quick one.").',
  ];
  return angles[Math.abs(Math.floor(variant / 7)) % angles.length]!;
}

/**
 * Have we actually talked with this person? Past the first-contact stages, or the
 * agent has notes from a conversation. Without that, "thought of you" reads as fake.
 */
export function hasRapport(stage: string, history: string[]): boolean {
  const st = classifyStage(stage);
  if (st.kind === 'active' && st.phase >= 2) return true;
  return history.some((h) => /\bnote\b|talked/i.test(h));
}

/** A casual way to say who's texting, only when they might not know: "It's Jeffry from IG 👋". */
export function introLine(agentName: string, source?: string): string {
  const first = agentName.split(' ')[0] || agentName;
  const s = (source ?? '').toLowerCase();
  const from = /instagram|\big\b|ig messenger|insta/.test(s) ? ' from IG' : /facebook|\bfb\b|meta/.test(s) ? ' from Facebook' : /tiktok/.test(s) ? ' from TikTok' : /youtube/.test(s) ? ' from YouTube' : '';
  return `It's ${first}${from}`;
}

/** The instructions the model gets. Facts only from the record; sounds like a person, not a system. */
export function nurturePrompt(c: DraftContext): string {
  const f = c.lead.fields;
  const facts = [
    `First name: ${greetableName(c.lead.firstName) ?? 'unknown (no name; just start with "Hey!" or skip the greeting)'}`,
    c.lead.source ? `Came from: ${c.lead.source}` : null,
    `Stage: ${c.lead.stage}`,
    `Became a lead: ${c.lead.createdAt.slice(0, 10)}`,
    `Last contact: ${c.lead.lastContactAt?.slice(0, 10) ?? 'never'}`,
    f.timeline ? `Buying timeline: ${f.timeline}` : null,
    f.budgetMax ? `Price range: ${f.budgetMin ? `$${f.budgetMin.toLocaleString('en-US')}–` : 'up to '}$${f.budgetMax.toLocaleString('en-US')}` : null,
    f.areas?.length ? `Looking in: ${f.areas.join(', ')}` : null,
    f.bedsMin ? `Wants ${f.bedsMin}+ beds` : null,
    f.mustHave?.length ? `Must have: ${f.mustHave.join(', ')}` : null,
    f.preApproved ? 'Pre-approved: yes' : null,
  ].filter(Boolean);
  const homeLine = (h: HomeCard) =>
    `${h.title}${h.city ? `, ${h.city}` : ''}${h.price ? ` — $${h.price.toLocaleString('en-US')}` : ''}${h.beds ? `, ${h.beds} bd` : ''}${h.baths ? `/${h.baths} ba` : ''}${h.sqft ? `, ${h.sqft.toLocaleString('en-US')} sqft` : ''}${h.lotSqft && h.lotSqft >= 7000 ? `, ${h.lotSqft.toLocaleString('en-US')} sqft lot` : ''}${h.facts?.length ? `. VERIFIED FROM THE MLS LISTING (you may mention these, nothing else about the home): ${h.facts.map((x) => `"${x}"`).join('; ')}` : ''}${h.badge ? `. ${{ coming_soon: 'COMING SOON: not on the open market yet', new: h.daysOnMarket === 0 ? 'NEW LISTING: listed today' : `NEW LISTING: on the market ${h.daysOnMarket ?? 'a few'} days`, price_drop: 'PRICE JUST DROPPED' }[h.badge]}` : ''}${h.url ? `. Link: ${h.url}` : ''}`;
  const home = c.home
    ? c.home.kind === 'listing'
      ? c.touch === 'teaser'
        ? `HOME YOU FOUND (real MLS listing in the area this agent's buyers usually shop; we do NOT know yet if it is this lead's area or price, so don't say it fits them): ${homeLine(c.home)}`
        : `HOME YOU FOUND FOR THEM (real MLS listing that fits what they told us): ${homeLine(c.home)}`
      : `NEW-BUILD COMMUNITY: ${c.home.title}${c.home.subtitle ? ` by ${c.home.subtitle}` : ''} in ${c.home.city}${c.home.priceFrom ? `, from $${c.home.priceFrom.toLocaleString('en-US')}` : ''}${c.home.highlights ? `. ${c.home.highlights}` : ''}${c.home.url ? `. Link: ${c.home.url}` : ''}`
    : null;
  const offer = c.touch === 'offer' && c.offer ? `PROGRAM (written by the agent; use only what it says): ${c.offer.text}${c.offer.url ? `. Link: ${c.offer.url}` : ''}` : null;
  const ask = { area: 'where they want to live', price: 'what price they have in mind', timing: 'when they are hoping to move', beds: 'how many bedrooms they need', open: 'what would make a home a yes for them' }[nextQuestion(f, c.step)];
  const plan = {
    home: 'You just found this home for them and you are genuinely excited. Tell them like a friend would: what you found, the one or two things that make it great for them, and an easy ask.',
    teaser: 'You just came across this home and it made you think of them. Share it like a friend would, then ask something easy that tells you if it is their kind of place.',
    community: 'You found a new-build community worth a look. Share the one concrete thing that makes it interesting and an easy ask.',
    offer: 'You have a program that could help them. Share the most concrete part in plain words and an easy ask.',
    discovery: `Nothing to share yet. Send a short, friendly text that asks ${ask}, the way you'd ask a friend. Give them a reason to answer (e.g. you can send them homes before they hit Zillow). No intro speech.`,
  }[c.touch];
  const closing = closingQuestion(c.touch, f, c.variant ?? c.step, c.now);
  const rapport = hasRapport(c.lead.stage, c.history);
  const opening = openingAngle(c.touch, c.variant ?? c.step, rapport);
  const intro = introLine(c.agentName, c.lead.source);
  const first = c.agentName.split(' ')[0] || c.agentName;
  return `You are ${first}, a real estate agent, texting a lead from your own phone. Write THREE different texts you'd actually send, so the agent can pick the one that sounds most like them.

LEAD (facts you may use — nothing else):
${facts.join('\n')}
Recent history (newest first):
${c.history.length ? c.history.map((h) => `- ${h}`).join('\n') : '- none'}
${home ? `\n${home}\n` : ''}${offer ? `\n${offer}\n` : ''}
WHAT TO WRITE
${plan}
${opening ? `- Text 1 opens this way: ${opening}\n` : ''}${closing ? `- Text 1 ends this way: ${closing}\n` : ''}- Texts 2 and 3 each take a different angle: a different opening style, a different lead detail where there is one, and a different easy ask (see the patterns above and below). No two texts may start the same way or end with the same question.

HOW IT SHOULD SOUND (these are the style to match; never reuse their facts):
"Daniel!! I think I found it. Single story in Riverside, 4 bed, $599K, and it's not even on the market yet. Want to go see it before anyone else does?"
"Ann, ok you're going to love this one. Heated pool, spa, and a full bedroom downstairs in Ontario. It's not listed yet. Want me to get you in?"
"Hey Chris, just came across a Corona home that hasn't hit the market. $585K. Honestly think it's worth a look before it goes live. You around this weekend?"
"Francisco, this one just listed in Corona. 3 bed with solar for $569K. Want me to send you the pics?"
"Hey! ${intro} 👋 Saw a Fontana home come up today under $500K on a huge lot. Still looking out that way?"

- Two or three short sentences, like a real text. Loose and human: "ok", "honestly", "!!" or one emoji are fine when they fit; perfect grammar is not the goal.
- Sound like YOU found it for THEM: "I think I found it", "you're going to love this"${rapport ? ', "thought of you"' : ''}. Never sound like an alert or a listing.
${rapport ? '' : `- You haven't really talked with this person yet. Never write "thought of you", "made me think of you", "reminded me of you" or anything that implies you know them well.\n`}
- Pick the ONE or TWO details that matter (pool, single story, big lot, not on the market yet, under a price). Never list specs like a listing sheet; no square footage unless it is the whole point.
- Never mention utilities or finishes: water heaters, HVAC, sinks, flooring, laminate, paint, appliances.
- No self-introduction speeches. Never write "This is ${first}, the Realtor", "${first} here", "I'm a real estate agent" or "I wanted to reach out". ${c.step === 0 ? `If they might not know who's texting, you may slip in "${intro}" casually, like the last example. Most texts don't need it.` : 'They already know who you are; don\'t introduce yourself.'}
- Use a different opening and wording than the examples; they show the feel, not lines to copy.
- One easy ask at the end. If there is a link, it goes on its own line after the text.
- Only say "not on the market yet", "hasn't hit the market" or "before it lists" when the home is COMING SOON.
- Honest excitement only: never claim other buyers, multiple offers, showings booked, a price going up or a deadline unless written above.

RULES
${c.channel === 'text' ? '- Max 280 characters before the link. No links other than the one given.' : '- Max 80 words. Plain text, no formatting. Same casual voice as a text.'}
- Never: "just checking in", "touching base", "hope this finds you well", "hope you're doing well", "let me know if you have any questions", or anything that reads like a mass message.
- Only use facts above. Never invent prices, homes, addresses, rates, programs, dates or promises. About a home, say only the numbers given and the VERIFIED MLS phrases; never add features or describe condition, yard, views or upgrades that are not written there.
- Never show internal labels: no CRM stage names, campaign or source codes (e.g. "NB4Y", "IG Messenger", "text code"), tags or scores.
- Fair housing: never describe a place by who lives there; no schools-as-demographics, no "family neighborhood" steering.
${c.voice ? `- Match this agent's own texting style: ${c.voice}` : ''}

Every rule above applies to all three texts.

Return exactly one JSON object and nothing else: {"options": [{"body": "...", ${c.channel === 'email' ? '"subject": "short, casual subject, like a text", ' : ''}"why": "one short line for the agent on why this message, e.g. 'Coming soon in Fontana; asks if that is their area'"}, {…}, {…}]}`;
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
2. Copy up to 3 short phrases (3-8 words) WORD FOR WORD from the listing text that a buyer who wants ${wants.length ? wants.join(', ') : 'a good home'} would get excited about (a pool, an ADU, a view, a big yard, a downstairs bedroom, upgrades they can see). Never pick mechanical or utility items (water heater, HVAC, plumbing, sinks, flooring, paint). Exact substrings only; no rewording.
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
