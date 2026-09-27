import { auditWebsite } from '../src/services/websiteAudit';

let failures = 0;
const assert = (ok:boolean,label:string) => ok ? console.log('  OK:',label) : (failures++,console.error('  FAIL:',label));

console.log('--- Website audit: healthy commercial homepage ---');
{
  const html = `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Chido Cuts | Harare</title>
    <meta name="description" content="Book Chido Cuts in Harare for professional hair services.">
  </head><body>
    <h1>Chido Cuts</h1><p>Services and pricing</p>
    <a href="tel:+263771234567">Call us</a>
    <a href="https://wa.me/263771234567">WhatsApp</a>
    <a href="/booking">Book appointment</a>
    <img src="/hero.jpg" alt="Chido Cuts salon">
  </body></html>`;
  const fakeFetch: typeof fetch = async () => new Response(html,{status:200,headers:{'content-type':'text/html; charset=utf-8'}});
  const audit = await auditWebsite('https://chidocuts.co.zw/',fakeFetch);
  assert(audit.status === 'AUDITED','HTML homepage is audited');
  assert(audit.verdict === 'HEALTHY','commercially healthy homepage crosses the documented 70-point threshold');
  assert(audit.checks.mobileViewport,'mobile viewport detected');
  assert(audit.checks.contactPath,'contact path detected');
  assert(audit.checks.conversionPath,'booking/conversion path detected');
}

console.log('--- Website audit: weak commercial homepage ---');
{
  const html = '<html><head><title>x</title></head><body><h1>Business</h1><img src="x.jpg"></body></html>';
  const fakeFetch: typeof fetch = async () => new Response(html,{status:200,headers:{'content-type':'text/html'}});
  const audit = await auditWebsite('https://example.co.zw/',fakeFetch);
  assert(audit.status === 'AUDITED','weak HTML homepage is still audited');
  assert(audit.verdict === 'NEEDS_WORK','missing conversion/mobile/contact signals produce NEEDS_WORK');
  assert(audit.opportunities.length >= 3,'audit exposes actionable improvement signals');
}

console.log('--- Website audit: unsafe target fails closed ---');
{
  const audit = await auditWebsite('http://127.0.0.1:8787/');
  assert(audit.status === 'UNSUPPORTED','private/loopback target is rejected before fetch');
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
