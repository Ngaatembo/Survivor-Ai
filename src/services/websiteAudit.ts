import type { WebsiteAudit } from '../types';

const MAX_HTML_BYTES = 600_000;
const TIMEOUT_MS = 8_000;

function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    if (u.port && !['80', '443'].includes(u.port)) return null;
    const h = u.hostname.toLowerCase();
    if (!h || h === 'localhost' || h.endsWith('.localhost') || h === '::1' ||
        /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
        h === 'metadata.google.internal' || h === 'metadata.internal' || h.startsWith('[')) return null;
    return u;
  } catch { return null; }
}

function emptyChecks(https: boolean, reachable = false) {
  return { https, reachable, mobileViewport:false, title:false, metaDescription:false,
    contactPath:false, conversionPath:false, serviceEvidence:false, imageAltCoverage:false,
    lightweightResponse:false };
}

function textOf(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi,' ')
    .replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim().toLowerCase();
}

function auditHtml(url: URL, html: string, ms: number, status: number): WebsiteAudit {
  const text = textOf(html);
  const images = (html.match(/<img\b/gi) ?? []).length;
  const altImages = (html.match(/<img\b[^>]*\balt=["'][^"']*["']/gi) ?? []).length;
  const checks = {
    https: url.protocol === 'https:',
    reachable: status >= 200 && status < 300,
    mobileViewport: /<meta[^>]+name=["']viewport["'][^>]+content=/i.test(html) ||
      /<meta[^>]+content=["'][^"']*width=device-width[^"']*["'][^>]+name=["']viewport["']/i.test(html),
    title: /<title(?:\s[^>]*)?>\s*[^<]{2,}\s*<\/title>/i.test(html),
    metaDescription: /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}["']/i.test(html) ||
      /<meta[^>]+content=["'][^"']{20,}["'][^>]+name=["']description["']/i.test(html),
    contactPath: /(tel:|mailto:|whatsapp|contact(?:\s+us)?|call\s+(?:us|now))/i.test(html),
    conversionPath: /(book(?:ing)?|reserve|appointment|order\s+online|request\s+(?:a\s+)?quote|get\s+(?:a\s+)?quote|enquir|buy\s+now|shop\s+now)/i.test(text),
    serviceEvidence: /(services?|products?|menu|rooms?|packages?|pricing|prices?|our\s+work|portfolio)/i.test(text),
    imageAltCoverage: images === 0 || altImages / images >= 0.6,
    lightweightResponse: ms <= 3000 && html.length <= MAX_HTML_BYTES,
  };
  const weights = { https:10, reachable:20, mobileViewport:15, title:5, metaDescription:5,
    contactPath:15, conversionPath:10, serviceEvidence:5, imageAltCoverage:5, lightweightResponse:10 };
  const score = (Object.keys(checks) as (keyof typeof checks)[]).reduce((n,k)=>n+(checks[k]?weights[k]:0),0);
  const criticalIssues:string[]=[]; const opportunities:string[]=[];
  if(!checks.https) criticalIssues.push('Website is not served over HTTPS.');
  if(!checks.reachable) criticalIssues.push(`Homepage returned HTTP ${status}.`);
  if(!checks.mobileViewport) opportunities.push('No mobile viewport declaration detected.');
  if(!checks.title) opportunities.push('Page title is missing or too short.');
  if(!checks.metaDescription) opportunities.push('Meta description is missing or weak.');
  if(!checks.contactPath) opportunities.push('No obvious phone, email, WhatsApp, or contact path detected.');
  if(!checks.conversionPath) opportunities.push('No obvious booking, enquiry, ordering, quote, or purchase path detected.');
  if(!checks.serviceEvidence) opportunities.push('Homepage does not clearly expose services, products, menu, rooms, pricing, or portfolio evidence.');
  if(!checks.imageAltCoverage) opportunities.push(`Only ${altImages} of ${images} images have detectable alt text.`);
  if(!checks.lightweightResponse) opportunities.push('Homepage response was relatively heavy or slow from the audit server.');
  return { status:'AUDITED', url:url.toString(), httpStatus:status, responseMs:ms, score,
    verdict:score>=70?'HEALTHY':'NEEDS_WORK', criticalIssues, opportunities, checks,
    auditedAt:Date.now(), notes:[
      'First-page commercial/technical signal audit; not a Lighthouse or real-user Core Web Vitals measurement.',
      'Response time is measured from the Survivor Worker and can differ from a visitor device/network.'
    ] };
}

export async function auditWebsite(rawUrl:string, fetchImpl: typeof fetch = fetch):Promise<WebsiteAudit>{
  const u=safeUrl(rawUrl);
  if(!u) return {status:'UNSUPPORTED',url:rawUrl,criticalIssues:['Website URL failed safe HTTP/HTTPS validation.'],
    opportunities:[],checks:emptyChecks(false),auditedAt:Date.now(),notes:['Audit skipped for safety.']};
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS); const started=Date.now();
  try{
    const response=await fetchImpl(u.toString(),{method:'GET',redirect:'manual',signal:controller.signal,
      headers:{'user-agent':'Survivor-AI-Website-Audit/1.0'}});
    const ms=Date.now()-started;
    if(response.status>=300&&response.status<400) return {status:'UNREACHABLE',url:u.toString(),httpStatus:response.status,responseMs:ms,
      criticalIssues:['Homepage returned a redirect; Survivor does not follow redirects during audits.'],
      opportunities:['Audit the final verified HTTPS homepage URL instead.'],checks:emptyChecks(u.protocol==='https:'),
      auditedAt:Date.now(),notes:['Redirects are not followed to reduce SSRF risk.']};
    if(response.status>=400) return {status:'UNREACHABLE',url:u.toString(),httpStatus:response.status,responseMs:ms,
      criticalIssues:[`Homepage returned HTTP ${response.status}; commercial quality was not scored.`],opportunities:[],
      checks:emptyChecks(u.protocol==='https:'),auditedAt:Date.now(),
      notes:['HTTP errors are treated as unavailable rather than as proof of poor site quality.']};
    const ct=response.headers.get('content-type')??'';
    if(!ct.toLowerCase().includes('text/html')) return {status:'UNSUPPORTED',url:u.toString(),httpStatus:response.status,responseMs:ms,
      criticalIssues:[`Homepage content type is ${ct||'unknown'}, not HTML.`],opportunities:[],
      checks:{...emptyChecks(u.protocol==='https:'),reachable:response.ok},auditedAt:Date.now(),notes:['HTML homepages only.']};
    const html=(await response.text()).slice(0,MAX_HTML_BYTES);
    return auditHtml(u,html,ms,response.status);
  }catch(error){
    const ms=Date.now()-started; const reason=error instanceof Error&&error.name==='AbortError'?'Audit timed out after 8 seconds.':'Homepage could not be fetched from the audit worker.';
    return {status:'UNREACHABLE',url:u.toString(),responseMs:ms,criticalIssues:[reason],opportunities:[],
      checks:emptyChecks(u.protocol==='https:'),auditedAt:Date.now(),notes:['No quality claim is made when the audit cannot fetch the homepage.']};
  }finally{clearTimeout(timer);}
}
