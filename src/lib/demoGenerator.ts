/* ============================================================================
 * SURVIVE AI — Prospect demo generator (Phase 3, "here's what YOUR website
 * could look like").
 * ----------------------------------------------------------------------------
 * Builds a real, self-contained, working single-page HTML demo for ONE
 * specific business — not a generic template. Uses only the prospect's own
 * real, stored fields, the linked offer's website brief, and (when
 * confident and LLM-synthesized) the deep-research report. Never invents a
 * photo, testimonial, review, or claim the business hasn't demonstrated —
 * photo slots are honest, clearly-labeled placeholders the client fills in
 * themselves, and every page carries a visible "demo" disclaimer so it can
 * never be mistaken for the business's real, live site.
 *
 * Pure function — produces the HTML string; callers persist/serve it.
 * ========================================================================== */

import type { Offer, Prospect, ProspectDemo, ProspectIntelligence } from '../types';
import { uid } from './format';

/** A small, distinctive palette per category — avoids the generic default-
 *  blue "corporate template" look without needing any external assets. */
const PALETTES: Record<string, { primary: string; primaryDark: string; accent: string; bg: string; text: string }> = {
  'Local food business': { primary: '#c1440e', primaryDark: '#8a3009', accent: '#f4a950', bg: '#fffaf3', text: '#2b1a10' },
  'Local personal services': { primary: '#7b3f9e', primaryDark: '#54296e', accent: '#e0aaff', bg: '#faf5ff', text: '#241a2e' },
  'Local service business': { primary: '#1f6f5c', primaryDark: '#14493c', accent: '#8fd6c1', bg: '#f3fbf9', text: '#122420' },
  'Local retail': { primary: '#a4243b', primaryDark: '#6e1826', accent: '#e8998d', bg: '#fff5f4', text: '#2b1414' },
  default: { primary: '#1d4e89', primaryDark: '#123456', accent: '#7fb2e5', bg: '#f5f8fb', text: '#141c24' },
};

function paletteFor(category: string) {
  const key = Object.keys(PALETTES).find((k) => category.toLowerCase().includes(k.toLowerCase().replace('local ', '')));
  return PALETTES[key ?? 'default'] ?? PALETTES.default;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function heroHeadline(prospect: Prospect, intelligence?: ProspectIntelligence): string {
  if (intelligence && intelligence.generator === 'llm' && intelligence.confidence !== 'LOW' && intelligence.apparentServices.length > 0) {
    return `${prospect.businessName} — ${intelligence.apparentServices[0]}`;
  }
  return `${prospect.businessName}`;
}

function servicesFor(prospect: Prospect, offer: Offer, intelligence?: ProspectIntelligence): string[] {
  if (intelligence && intelligence.generator === 'llm' && intelligence.confidence !== 'LOW' && intelligence.apparentServices.length > 0) {
    return intelligence.apparentServices.slice(0, 6);
  }
  // Honest fallback: generic, category-shaped placeholders the client
  // confirms/edits — never invented specifics about this business.
  return ['Service 1 — to confirm with ' + prospect.businessName, 'Service 2 — to confirm', 'Service 3 — to confirm'];
}

function aboutText(prospect: Prospect, intelligence?: ProspectIntelligence): string {
  if (intelligence && intelligence.generator === 'llm' && intelligence.confidence !== 'LOW' && intelligence.businessOverview) {
    return intelligence.businessOverview;
  }
  return `${prospect.businessName} is a ${prospect.category.toLowerCase()} based in ${prospect.location}. This section will describe the business in ${prospect.businessName}'s own words — final copy to be confirmed together.`;
}

function contactBlock(prospect: Prospect): { label: string; href?: string } {
  const value = prospect.contactValue;
  switch (prospect.contactChannel) {
    case 'WHATSAPP':
      return value ? { label: `WhatsApp ${value}`, href: `https://wa.me/${value.replace(/[^0-9]/g, '')}` } : { label: 'WhatsApp us' };
    case 'PHONE':
      return value ? { label: `Call ${value}`, href: `tel:${value.replace(/[^0-9+]/g, '')}` } : { label: 'Call us' };
    case 'EMAIL':
      return value ? { label: `Email ${value}`, href: `mailto:${value}` } : { label: 'Email us' };
    case 'FACEBOOK':
    case 'INSTAGRAM':
      return value ? { label: 'Message us', href: value } : { label: 'Message us' };
    default:
      return { label: 'Contact us' };
  }
}

/** Honest, labeled placeholder — never a stock photo passed off as the
 *  business's own, and never invented. The website brief already tells
 *  the client they need to supply real photos (requiredAssets). */
function placeholderBlock(label: string, palette: ReturnType<typeof paletteFor>): string {
  return `<div class="placeholder" style="background:linear-gradient(135deg, ${palette.primary}22, ${palette.accent}33);">
    <span>${esc(label)}</span>
  </div>`;
}

export function generateDemoHtml(
  prospect: Prospect,
  offer: Offer,
  intelligence?: ProspectIntelligence,
): { html: string; heroHeadline: string; sectionsIncluded: string[]; generator: 'llm' | 'template' } {
  const palette = paletteFor(prospect.category);
  const headline = heroHeadline(prospect, intelligence);
  const services = servicesFor(prospect, offer, intelligence);
  const about = aboutText(prospect, intelligence);
  const contact = contactBlock(prospect);
  const sections = offer.websiteBrief.sitemap.length ? offer.websiteBrief.sitemap : ['Home', 'About', 'Services', 'Contact'];
  const usedLlm = Boolean(intelligence && intelligence.generator === 'llm' && intelligence.confidence !== 'LOW');

  // Nav only ever points at anchors this page actually builds below — the
  // offer's full sitemap (which can include sections like "Testimonials"
  // or "Menu" this generic demo doesn't build yet) is preserved separately
  // as sectionsIncluded metadata, never rendered as a dead link.
  const REAL_ANCHORS: [string, string][] = [
    ['home', 'Home'],
    ['about', 'About'],
    ['services', 'Services'],
    ['gallery', 'Gallery'],
    ['contact', 'Contact'],
  ];
  const navLinks = REAL_ANCHORS.map(([id, label]) => `<a href="#${id}">${esc(label)}</a>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>${esc(prospect.businessName)} — Website Demo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --primary: ${palette.primary};
    --primary-dark: ${palette.primaryDark};
    --accent: ${palette.accent};
    --bg: ${palette.bg};
    --text: ${palette.text};
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Inter', system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
  h1, h2, h3 { font-family: 'Fraunces', Georgia, serif; margin: 0 0 .4em; }
  a { color: var(--primary-dark); }
  header { position: sticky; top: 0; background: var(--bg); border-bottom: 1px solid ${palette.primary}22; z-index: 10; }
  .nav-inner { max-width: 1000px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; }
  .nav-inner nav { display: flex; gap: 18px; flex-wrap: wrap; }
  .nav-inner nav a { text-decoration: none; font-weight: 500; font-size: 14px; color: var(--text); }
  .brand { font-family: 'Fraunces', serif; font-weight: 700; font-size: 18px; }
  .hero { max-width: 1000px; margin: 0 auto; padding: 70px 20px 50px; text-align: center; }
  .hero h1 { font-size: clamp(28px, 5vw, 44px); }
  .hero p { font-size: 17px; max-width: 560px; margin: 14px auto 26px; opacity: .85; }
  .cta { display: inline-block; background: var(--primary); color: #fff; padding: 13px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; }
  .cta:hover { background: var(--primary-dark); }
  section { max-width: 1000px; margin: 0 auto; padding: 50px 20px; }
  section h2 { font-size: 26px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; }
  .card { background: #fff; border: 1px solid ${palette.primary}18; border-radius: 12px; padding: 20px; }
  .placeholder { border-radius: 12px; aspect-ratio: 4/3; display: flex; align-items: center; justify-content: center; color: ${palette.primaryDark}; font-size: 13px; font-weight: 500; border: 1.5px dashed ${palette.primary}55; }
  footer { max-width: 1000px; margin: 0 auto; padding: 30px 20px 50px; text-align: center; font-size: 13px; opacity: .6; }
  .demo-badge { background: #111; color: #fff; text-align: center; padding: 8px 12px; font-size: 12.5px; }
  .demo-badge strong { color: var(--accent); }
</style>
</head>
<body>
<div class="demo-badge">🎨 <strong>DEMO</strong> — a preview built by SURVIVE AI for ${esc(prospect.businessName)}. Not yet live, not the business's official site.</div>
<header>
  <div class="nav-inner">
    <div class="brand">${esc(prospect.businessName)}</div>
    <nav>${navLinks}</nav>
  </div>
</header>

<div class="hero" id="home">
  <h1>${esc(headline)}</h1>
  <p>${esc(about)}</p>
  <a class="cta" href="${contact.href ?? '#contact'}">${esc(contact.label)}</a>
</div>

<section id="about">
  <h2>About ${esc(prospect.businessName)}</h2>
  <p>${esc(about)}</p>
  <p style="font-size:14px;opacity:.7;">📍 ${esc(prospect.location)}</p>
</section>

<section id="services">
  <h2>What we offer</h2>
  <div class="grid">
    ${services.map((s) => `<div class="card"><strong>${esc(s)}</strong></div>`).join('\n    ')}
  </div>
</section>

<section id="gallery">
  <h2>Gallery</h2>
  <div class="grid">
    ${placeholderBlock('Your photo here', palette)}
    ${placeholderBlock('Your photo here', palette)}
    ${placeholderBlock('Your photo here', palette)}
  </div>
  <p style="font-size:13px;opacity:.65;margin-top:14px;">Real photos of ${esc(prospect.businessName)} go here once shared — nothing here is a stock image.</p>
</section>

<section id="contact">
  <h2>Get in touch</h2>
  <p>${esc(prospect.businessName)} · ${esc(prospect.location)}</p>
  <a class="cta" href="${contact.href ?? '#'}">${esc(contact.label)}</a>
</section>

<footer>
  This is an unpublished demo prepared for ${esc(prospect.businessName)} to review — ${usedLlm ? 'personalized from public research about the business' : 'a starting layout, ready to be personalized together'}. Not affiliated with or endorsed by ${esc(prospect.businessName)}.
</footer>
</body>
</html>`;

  return { html, heroHeadline: headline, sectionsIncluded: sections, generator: usedLlm ? 'llm' : 'template' };
}

export function generateProspectDemo(
  prospect: Prospect,
  offer: Offer,
  intelligence?: ProspectIntelligence,
  now: number = Date.now(),
): ProspectDemo {
  const { html, heroHeadline: headline, sectionsIncluded, generator } = generateDemoHtml(prospect, offer, intelligence);
  return {
    id: uid('demo'),
    prospectId: prospect.id,
    offerId: offer.id,
    businessName: prospect.businessName,
    html,
    heroHeadline: headline,
    sectionsIncluded,
    generator,
    generatedAt: now,
    updatedAt: now,
  };
}
