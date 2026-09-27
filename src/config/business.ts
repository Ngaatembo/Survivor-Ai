/* ============================================================================
 * Who is doing the selling — used in every outreach message Survivor drafts.
 * Edit these to change how messages are signed. Nothing here is secret.
 * ========================================================================== */

export const BUSINESS = {
  /** First name used to sign messages. */
  senderName: 'Ngaatendwe',
  /** Brand the client is buying from. */
  company: 'WebAura',
  /** One-line description used in the first message. */
  companyLine: 'a web design studio in Marondera',
  /** Where a prospect can see WebAura itself. */
  website: 'webaura.ngaatendwew.workers.dev',
  /** Finished client sites to show as proof — real, live projects only. */
  proofSites: ['venmax.co.zw', 'culturesresort.co.zw'],
  /** WebAura's own WhatsApp number (shown to prospects on request). */
  phone: '+263 78 051 1822',
} as const;
