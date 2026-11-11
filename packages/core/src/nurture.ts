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
export type Touch = 'home' | 'community' | 'discovery';

/**
 * Know what they want → show them a home. Don't know yet → ask one easy question
 * (the answer unlocks matched homes). Every third touch is a new-build community
 * when one fits, so new construction stays in front of them.
 */
export function touchKind(fields: LeadFields, step: number, has: { home: boolean; community: boolean }): Touch {
  const knowsWhat = !!(fields.areas?.length || fields.budgetMax);
  if (has.community && (step % 3 === 2 || (!has.home && knowsWhat))) return 'community';
  if (has.home && knowsWhat) return 'home';
  if (has.community && step > 0 && step % 2 === 1) return 'community';
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
};

/** A first name we can greet someone by, or null when the CRM has a handle like "rlpmontanez" or "jdog_23". */
export function greetableName(raw: string | undefined | null): string | null {
  const n = (raw ?? '').trim();
  if (!n || n.length > 14 || /[\d_@.]/.test(n)) return null;
  if (n === n.toLowerCase() && n.length > 8) return null; // all-lowercase long strings are usually usernames
  if (!/[aeiouy]/i.test(n) || /^[^aeiouy]{4}/i.test(n)) return null; // "Rlpmontanez"
  return n.charAt(0).toUpperCase() + n.slice(1);
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
  const home = c.home
    ? c.home.kind === 'listing'
      ? `HOME TO SHARE (real MLS listing): ${c.home.title}${c.home.city ? `, ${c.home.city}` : ''}${c.home.price ? ` — $${c.home.price.toLocaleString('en-US')}` : ''}${c.home.beds ? `, ${c.home.beds} bd` : ''}${c.home.baths ? `/${c.home.baths} ba` : ''}${c.home.sqft ? `, ${c.home.sqft.toLocaleString('en-US')} sqft` : ''}${c.home.lotSqft && c.home.lotSqft >= 7000 ? `, ${c.home.lotSqft.toLocaleString('en-US')} sqft lot` : ''}${c.home.facts?.length ? `. VERIFIED FROM THE MLS LISTING (you may mention these, nothing else about the home): ${c.home.facts.map((x) => `"${x}"`).join('; ')}` : ''}${c.home.badge ? `. ${{ coming_soon: 'COMING SOON: not on the open market yet', new: `NEW LISTING: on the market ${c.home.daysOnMarket ?? 'a few'} days`, price_drop: 'PRICE JUST DROPPED' }[c.home.badge]}` : ''}${c.home.url ? `. Link: ${c.home.url}` : ''}`
      : `NEW-BUILD COMMUNITY TO SHARE: ${c.home.title}${c.home.subtitle ? ` by ${c.home.subtitle}` : ''} in ${c.home.city}${c.home.priceFrom ? `, from $${c.home.priceFrom.toLocaleString('en-US')}` : ''}${c.home.highlights ? `. ${c.home.highlights}` : ''}${c.home.url ? `. Link: ${c.home.url}` : ''}`
    : null;
  const goal =
    c.touch === 'home'
      ? 'Share the home below because it fits what they told us. Lead with why it is worth their attention right now (coming soon before most buyers see it / just listed / price just dropped), the way an insider would tip off a friend, then why it fits them in a few words. Make them feel they are getting early access, without hype or pressure. End with one easy yes/no question (e.g. want to see it before it gets busy?).'
      : c.touch === 'community'
        ? 'Share the new-build community below as something worth a look. Mention one concrete reason. End with one easy question.'
        : `We do not know enough yet to send homes. Ask ONE easy question about ${
            { area: 'where they want to live (a city or two is enough)', price: 'a comfortable price range or monthly payment', timing: 'when they would ideally like to move', beds: 'how many bedrooms they need', open: 'what would make a home a yes for them right now' }[nextQuestion(f, c.step)]
          }. Make it answerable in a few words.`;
  return `You are writing a ${c.channel} from ${c.agentName}, a real estate agent, to a lead.

LEAD (facts you may use — nothing else):
${facts.join('\n')}
Recent history (newest first):
${c.history.length ? c.history.map((h) => `- ${h}`).join('\n') : '- none'}
${home ? `\n${home}\n` : ''}
GOAL: ${goal}

RULES
- Sound like a real person texting from their phone: short, warm, specific. ${c.channel === 'text' ? 'Max 300 characters. No emojis unless natural. No links other than the one given.' : 'Max 90 words. Plain text, no formatting.'}
- Never say "just checking in", "touching base", "hope this finds you well", "hope your year's going well", or anything that reads like a mass message. No small talk filler; get to the point in the first sentence.
- Use their first name once if we have one. ${c.step === 0 ? `Since this may be the first message in a while, say who you are ("it's ${c.agentName.split(' ')[0]}").` : 'Do not re-introduce yourself.'}
- Only use facts above. Never invent prices, homes, addresses, rates, dates or promises. About a home, say only the numbers given and the VERIFIED MLS phrases; never add features, adjectives about the yard, views, condition or upgrades that are not written there.
- Never show the lead our internal labels: no CRM stage names ("Sent to Lender", "Contacted"), campaign or source codes (e.g. "NB4Y", "IG Messenger", "text code"), tags or scores. You may say "Instagram" or "Facebook" only if the source plainly says so.
- Fair housing: never describe a place by who lives there; no schools-as-demographics, no "family neighborhood" style steering.
${c.voice ? `- Write in this agent's style: ${c.voice}` : ''}

Return JSON only: {"body": "...", ${c.channel === 'email' ? '"subject": "short, specific, lowercase-ish subject", ' : ''}"why": "one short line for the agent on why this message, e.g. 'Asks budget — we only know Fontana'"}`;
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
