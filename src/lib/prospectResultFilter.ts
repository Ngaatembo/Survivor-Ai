/* ============================================================================
 * Prospect result filter — "is this search result actually ONE real business,
 * and what is its real name?"
 * ----------------------------------------------------------------------------
 * Root cause this fixes (found in live D1 data, 27 Sept 2026): discovery used
 * the raw search-result TITLE as the business name. So news articles (BBC,
 * Herald), listicles ("THE 10 BEST Harare Business Hotels"), how-to guides
 * ("How to Start a Salon in Zimbabwe"), directory category pages, Reddit,
 * Yelp/MapQuest pages for businesses in Toronto and Washington, and raw
 * Facebook/Instagram post text ("This is SupaFix Workshop. This is how we
 * work 🚗💨…") were all saved as "businesses". Years and number ranges
 * ("2011-2026", "150 - 2000") and UK numbers were saved as phone numbers.
 *
 * Everything here is pure and deterministic so it can be smoke-tested
 * against the exact bad records that were in production.
 * ========================================================================== */

/** Sites whose pages are never a single local business's own presence:
 *  news, blogs, guides, review aggregators, marketplaces, data brokers,
 *  video sites. A result from one of these is content ABOUT businesses. */
const NON_BUSINESS_DOMAINS = [
  'tripadvisor.', 'yelp.', 'mapquest.', 'reddit.', 'wikipedia.', 'quora.',
  'bbc.', 'newrepublic.', 'heraldonline.', 'herald.co.zw', 'newzimbabwe.', 'newsday.co.zw',
  'chronicle.co.zw', 'zimlive.', 'techzim.', 'nehandaradio.', 'thezimbabwemail.', 'bulawayo24.',
  'zimeye.', 'pindula.', 'iharare.', 'allafrica.', 'businessweekly.co.zw', 'equityaxis.',
  'youtube.', 'youtu.be', 'smergers.', 'rocketreach.', 'zoominfo.', 'dnb.com', 'crunchbase.',
  'startupbiz.co.zw', 'registercompany.co.zw', 'hotels.com', 'booking.com', 'expedia.',
  'trip.com', 'agoda.', 'wordpress.com', 'blogspot.', 'medium.com', 'substack.',
  'humanrights.dk', 'workshopsoftware.com', 'scribd.', 'slideshare.', 'academia.edu',
  'researchgate.', 'indeed.', 'glassdoor.', 'vacancymail.', 'classifieds.co.zw',
  'dribbble.', 'upwork.', 'freelancer.', 'fiverr.', 'pinterest.',
];

/** Title shapes that mean "article / list / guide", never one business. */
const ARTICLE_TITLE_PATTERNS: RegExp[] = [
  /^(the\s+)?\d+\s+(best|top|great|cheapest|most)\b/i,
  /^(top|best)\s+\d*/i,
  /\bhow\s+(to|much)\b/i,
  /^(starting|start|opening|open|setting up|running)\s+(a|an|your)\b/i,
  /\b(guide|tutorial|course|licen[cs]es?|franchise|for sale|investment)\b/i,
  /\b(companies|businesses|services|listings|shops|stores)\s*(&|and)\s*(services|companies|products)\b/i,
  /\b(companies|businesses|listings)\s+in\s+/i,
  /\b(news|article|analysis|sector|scene|report|information|profile)\b/i,
  /\bwhy\b.*\b(are|is|do|does)\b/i,
  /\bupdated\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b\d+\s+photos?\b/i,
  /\b\d+\s+reviews?\b/i,
  /^r\//i,
];

/** Segments that are page furniture, never the business's name. */
const GENERIC_SEGMENTS = /^(home|homepage|welcome|about( us)?|contact( us)?|facebook|instagram|tiktok|linkedin|official (site|website|page)|services|gallery|shop|menu|log ?in|sign ?up)$/i;

/** Zimbabwe place names used both to confirm a result is local and to
 *  record the actual town instead of a blanket "Zimbabwe". */
const ZIM_PLACES = [
  'Harare', 'Bulawayo', 'Chitungwiza', 'Mutare', 'Gweru', 'Kwekwe', 'Kadoma', 'Masvingo',
  'Chinhoyi', 'Marondera', 'Norton', 'Ruwa', 'Bindura', 'Beitbridge', 'Victoria Falls', 'Hwange',
  'Kariba', 'Zvishavane', 'Chegutu', 'Rusape', 'Chiredzi', 'Gwanda', 'Karoi', 'Shurugwi',
  'Redcliff', 'Epworth', 'Borrowdale', 'Avondale', 'Belgravia', 'Mount Pleasant', 'Msasa',
  'Eastlea', 'Milton Park', 'Greendale', 'Highlands', 'Hillside', 'Southerton', 'Graniteside',
];
const ZIM_PLACE_RE = new RegExp(`\\b(${ZIM_PLACES.map((p) => p.replace(/ /g, '\\s+')).join('|')})\\b`, 'i');
const ZIM_SIGNAL_RE = /\bzimbabwe\b|\bzim\b|\+263|\b00263|\.co\.zw\b|\.org\.zw\b|\.ac\.zw\b|\.zw\b/i;

export function isZimbabwePlace(s: string): boolean {
  return /zimbabwe/i.test(s) || ZIM_PLACE_RE.test(s);
}

/* ------------------------------ phone numbers ------------------------------ */

/** Zimbabwe numbers only: +263 / 00263 / leading 0, then a real Zimbabwe
 *  prefix (mobile 71/73/77/78, landline area codes). Rejects years,
 *  ranges like "150 - 2000", and foreign numbers like "+44) 330 027 2159". */
const ZIM_PHONE_RE = /(?:\+|00)?263[\s-]?\(?0?\)?[\s-]?[1-9]\d?(?:[\s-]?\d){6,8}|\b0[1-9]\d?(?:[\s-]?\d){6,8}/g;

export function extractZimPhone(text: string): string | undefined {
  for (const match of text.matchAll(ZIM_PHONE_RE)) {
    const raw = match[0].trim();
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('00263')) digits = digits.slice(2);
    if (digits.startsWith('2630')) digits = '263' + digits.slice(4);
    if (digits.startsWith('0')) digits = '263' + digits.slice(1);
    if (!digits.startsWith('263')) continue;
    const national = digits.slice(3);
    const isMobile = /^7[1378]\d{7}$/.test(national);
    const isLandline = /^[2-6]\d{6,8}$/.test(national) || /^8[68]\d{6,8}$/.test(national);
    if (isMobile || isLandline) return raw;
  }
  return undefined;
}

/* ------------------------------- helpers ---------------------------------- */

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isNonBusinessDomain(domain: string, url: string): boolean {
  if (NON_BUSINESS_DOMAINS.some((d) => domain.includes(d))) return true;
  if (/\.pdf($|\?)/i.test(url)) return true;
  if (domain.includes('linkedin.com') && /\/in\//i.test(url)) return true; // a person, not a company page
  return false;
}

export const SOCIAL_DOMAINS = ['facebook.com', 'instagram.com', 'tiktok.com', 'linkedin.com', 'x.com', 'twitter.com'];

export function isSocialDomain(domain: string): boolean {
  return SOCIAL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function hasEmoji(s: string): boolean {
  return /\p{Extended_Pictographic}/u.test(s);
}

function tokensOf(s: string): string[] {
  return s.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((t) => t.length >= 3);
}

/** Does this read like a business's name, rather than a sentence, a post,
 *  a headline or a tagline? */
export function looksLikeBusinessName(name: string): boolean {
  const n = name.trim();
  if (n.length < 3 || n.length > 60) return false;
  if (/[\n\r]/.test(n) || hasEmoji(n)) return false;
  if (/\.\.\.|…|[?!]/.test(n)) return false;
  if (/#/.test(n)) return false;
  if (n.split(/\s+/).length > 7) return false;
  if (GENERIC_SEGMENTS.test(n)) return false;
  if (/^(this|that|these|we|our|i|need|looking|find|video|photo)\b/i.test(n)) return false;
  if (/\b(in|near|across)\s+(zimbabwe|harare|bulawayo)\s*$/i.test(n) && n.split(/\s+/).length > 3) return false; // tagline "Repairs & More in Zimbabwe"
  if (ARTICLE_TITLE_PATTERNS.some((re) => re.test(n))) return false;
  if (!/[a-z]/i.test(n)) return false;
  return true;
}

/** Names that social posts state outright: "This is SupaFix Workshop.",
 *  "Welcome to Chido Cuts!", "Chido Cuts is now open". */
function nameFromPostText(text: string): string | undefined {
  const patterns = [
    /\b[Tt]his is\s+([A-Z][\w&'’.-]*(?:\s+[A-Z&][\w&'’.-]*){0,5})\s*[.!,\n]/,
    /\b[Ww]elcome to\s+([A-Z][\w&'’.-]*(?:\s+[A-Z&][\w&'’.-]*){0,5})\s*[.!,\n]/,
    /^([A-Z][\w&'’.-]*(?:\s+[A-Z&][\w&'’.-]*){0,5})\s+is\s+(now\s+)?open\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && looksLikeBusinessName(m[1])) return m[1].trim();
  }
  return undefined;
}

/** facebook.com/{page}/posts|videos|photos/... → "{page}". Numeric ids and
 *  profile.php give no usable identity. */
function socialPageSlug(url: string): { slug?: string; isPost: boolean } {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const isPost = parts.some((p) => /^(posts|videos|photos|permalink|reel|reels|p|story\.php|watch|video|share)$/i.test(p));
    const first = parts[0];
    if (!first || /^(profile\.php|people|pages|watch|reel|reels|p|share|groups|events|hashtag|explore|stories)$/i.test(first)) return { isPost };
    if (/^\d+$/.test(first)) return { isPost };
    return { slug: first.replace(/^@/, '').toLowerCase(), isPost };
  } catch {
    return { isPost: false };
  }
}

function nameMatchesSlug(name: string, slug: string): boolean {
  const s = slug.replace(/[^a-z0-9]/g, '');
  return tokensOf(name).some((t) => t.length >= 4 && s.includes(t.replace(/[^a-z0-9]/g, '')));
}

/* ------------------------------ public API -------------------------------- */

export type ResultJudgement =
  | { ok: true; businessName: string; location: string; zimPhone?: string; isSocial: boolean }
  | { ok: false; reason: string };

/**
 * Decide whether a search result is one real local business, and if so
 * extract its real name and town. Never guesses: anything ambiguous is
 * rejected, because a wrong name in an outreach message is worse than
 * one fewer prospect.
 */
export function judgeSearchResult(
  r: { title: string; url: string; snippet: string },
  region: string,
): ResultJudgement {
  const domain = extractDomain(r.url);
  const text = `${r.title} ${r.snippet}`;

  if (!domain) return { ok: false, reason: 'no URL' };
  if (/facebook\.com\/groups\//i.test(r.url)) return { ok: false, reason: 'Facebook group, not a business' };
  if (isNonBusinessDomain(domain, r.url)) return { ok: false, reason: `content site (${domain}), not a business` };
  if (ARTICLE_TITLE_PATTERNS.some((re) => re.test(r.title))) return { ok: false, reason: 'article / list / guide title' };

  // Location gate — the result itself must show it is in the target region.
  const zimRegion = /zimbabwe/i.test(region) || ZIM_PLACE_RE.test(region);
  const zimPhone = extractZimPhone(text);
  if (zimRegion) {
    const localEvidence = ZIM_SIGNAL_RE.test(`${text} ${domain}`) || ZIM_PLACE_RE.test(text) || !!zimPhone;
    if (!localEvidence) return { ok: false, reason: 'no evidence the business is in Zimbabwe' };
  } else if (!new RegExp(`\\b${region.split(/[,\s]+/)[0]}\\b`, 'i').test(text)) {
    return { ok: false, reason: `no evidence the business is in ${region}` };
  }

  const isSocial = isSocialDomain(domain);
  const segments = r.title
    .split(/\s+[|·•]\s+|\s+[-–—]\s+|\s*\|\s*/)
    .map((s) => s.replace(/\s*\((@[^)]*)\)\s*/g, ' ').replace(/\s+on\s+(tiktok|instagram|facebook)\s*$/i, '').trim())
    .filter(Boolean);

  let businessName: string | undefined;

  if (isSocial) {
    const { slug, isPost } = socialPageSlug(r.url);
    if (isPost) {
      // A post/video/reel title is the post's TEXT. Only trust a name we can
      // tie to the page that published it — otherwise the name (or a credited
      // third party) may not be the owner of the contact link.
      if (!slug) return { ok: false, reason: 'social post from an unidentifiable page' };
      const candidate = nameFromPostText(r.title) ?? nameFromPostText(r.snippet) ?? segments.find(looksLikeBusinessName);
      if (!candidate || !nameMatchesSlug(candidate, slug)) {
        return { ok: false, reason: 'social post whose business name cannot be tied to the posting page' };
      }
      businessName = candidate;
    } else {
      businessName = segments.find(looksLikeBusinessName);
    }
  } else {
    // Own website: prefer the title segment that matches the domain name
    // ("Installations, Repairs & MORE In Zimbabwe - Premium Electricians"
    // on premiumelectricians.co.zw → "Premium Electricians").
    const label = domain.split('.')[0];
    const valid = segments.filter(looksLikeBusinessName);
    businessName = valid.find((s) => nameMatchesSlug(s, label)) ?? valid[0];
  }

  if (!businessName) return { ok: false, reason: 'no clean business name in the result' };

  const place = text.match(ZIM_PLACE_RE)?.[1];
  const location = place ? place.replace(/\s+/g, ' ') : region;

  return { ok: true, businessName: businessName.slice(0, 60), location, zimPhone, isSocial };
}
