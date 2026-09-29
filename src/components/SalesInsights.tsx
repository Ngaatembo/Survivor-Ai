/* Sales analytics + settings (company profile, cadence, editable pricing). */

import { useEffect, useState } from 'react';
import { Bar } from './ui';
import { Notice, errText } from './salesUi';
import {
  getAnalytics,
  getSalesSettings,
  saveSalesSettings,
  type SettingsResponse,
} from '../services/salesApi';
import type { RateRow, SalesAnalytics } from '../sales/analytics';
import { PRICING_KEYS, type CadenceSettings, type CompanyProfile, type PricingKey } from '../sales/types';

const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);

/* -------------------------------- analytics -------------------------------- */

export function SalesAnalyticsView() {
  const [a, setA] = useState<SalesAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAnalytics().then((r) => setA(r.analytics)).catch((e) => setError(errText(e)));
  }, []);

  if (error) return <Notice tone="err">{error}</Notice>;
  if (!a) return <div className="cl-empty">Loading analytics…</div>;

  const top = a.funnel[0]?.reached || 1;
  return (
    <>
      <section className="cl-card">
        <h2>Lead → conversation → opportunity → client</h2>
        <p className="muted">How many leads reach each meaningful stage. The number that matters is how far leads move, not how many are found.</p>
        <div className="sl-bars">
          {a.funnel.map((f) => <Bar key={f.stage} label={f.label} value={f.reached} max={top} tone={f.stage === 'WON' ? 'green' : ''} />)}
        </div>
      </section>

      <section className="cl-card">
        <h2>Conversion rates</h2>
        <table className="data-table sl-table">
          <tbody>
            {a.conversions.map((c) => (
              <tr key={c.label}><td>{c.label}</td><td className="sl-num">{c.from ? `${c.to}/${c.from}` : '—'}</td><td className="sl-num"><strong>{pct(c.rate)}</strong></td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="cl-card">
        <h2>What is working</h2>
        {!a.learningReady && <p className="muted">{a.notes[0] ?? 'Not enough data yet.'}</p>}
        <div className="sl-best">
          <BestRow title="Best contact channel" row={a.best.channel} min={a.minSample} />
          <BestRow title="Best sales angle" row={a.best.angle} min={a.minSample} />
          <BestRow title="Best message type" row={a.best.messageType} min={a.minSample} />
        </div>
        <RateTable title="Reply rate by channel" rows={a.byChannel} />
        <RateTable title="Reply rate by angle" rows={a.byAngle} />
        <RateTable title="Reply rate by message type" rows={a.byMessageType} />
      </section>

      <section className="cl-card">
        <h2>Speed and money</h2>
        <table className="data-table sl-table">
          <tbody>
            <tr><td>Average time to reply</td><td className="sl-num">{a.avgHoursToReply === null ? '—' : a.avgHoursToReply < 48 ? `${a.avgHoursToReply.toFixed(1)} hours` : `${(a.avgHoursToReply / 24).toFixed(1)} days`}</td></tr>
            <tr><td>Average time to close</td><td className="sl-num">{a.avgDaysToClose === null ? '—' : `${a.avgDaysToClose.toFixed(1)} days`}</td></tr>
            <tr><td>Deals won</td><td className="sl-num">{a.revenue.wonCount}</td></tr>
            <tr><td>Deal value recorded</td><td className="sl-num">${a.revenue.recordedTotal.toLocaleString()}</td></tr>
            <tr><td>Average deal</td><td className="sl-num">{a.revenue.averageDeal === null ? '—' : `$${Math.round(a.revenue.averageDeal)}`}</td></tr>
          </tbody>
        </table>
        <p className="muted small">{a.revenue.note}</p>
        {a.notes.slice(a.learningReady ? 0 : 1).map((n) => <p key={n} className="muted small">{n}</p>)}
      </section>

      <section className="cl-card">
        <h2>Why leads were lost</h2>
        {a.lostReasons.length === 0
          ? <p className="muted">No lost leads recorded yet.</p>
          : <table className="data-table sl-table"><tbody>{a.lostReasons.map((r) => <tr key={r.reason}><td>{r.reason.replace(/_/g, ' ').toLowerCase()}</td><td className="sl-num">{r.count}</td></tr>)}</tbody></table>}
      </section>
    </>
  );
}

function BestRow({ title, row, min }: { title: string; row: RateRow | null; min: number }) {
  return (
    <div className="sl-best-row">
      <span>{title}</span>
      {row
        ? <strong>{row.label} · {pct(row.replyRate)} replied ({row.replied}/{row.contacted})</strong>
        : <em className="muted">Not enough data (needs {min}+ contacts)</em>}
    </div>
  );
}

function RateTable({ title, rows }: { title: string; rows: RateRow[] }) {
  if (rows.length === 0) return null;
  return (
    <details className="cl-sources">
      <summary>{title}</summary>
      <table className="data-table sl-table">
        <tbody>{rows.map((r) => <tr key={r.key}><td>{r.label}</td><td className="sl-num">{r.replied}/{r.contacted}</td><td className="sl-num">{pct(r.replyRate)}</td></tr>)}</tbody>
      </table>
    </details>
  );
}

/* -------------------------------- settings --------------------------------- */

const COMPANY_FIELDS: { key: keyof CompanyProfile; label: string; long?: boolean }[] = [
  { key: 'senderName', label: 'Your first name (signs messages)' },
  { key: 'company', label: 'Company / brand' },
  { key: 'companyLine', label: 'One-line description (e.g. "a web design studio in Marondera")' },
  { key: 'valueLine', label: 'What you help businesses with (one sentence)', long: true },
  { key: 'phone', label: 'Your WhatsApp / phone' },
  { key: 'website', label: 'Your website' },
  { key: 'homeTown', label: 'Home town (for the physical-visit channel)' },
  { key: 'paymentTerms', label: 'Payment terms shown in proposals (optional)' },
];

const CADENCE_FIELDS: { key: keyof CadenceSettings; label: string }[] = [
  { key: 'followUp1Days', label: 'Days until follow-up 1' },
  { key: 'followUp2Days', label: 'Days between follow-up 1 and 2' },
  { key: 'dormantAfterDays', label: 'Days after follow-up 2 before going dormant' },
  { key: 'proposalChaseDays', label: 'Days before chasing a proposal' },
  { key: 'demoFeedbackDays', label: 'Days before asking for demo feedback' },
];

export function SalesSettingsView() {
  const [s, setS] = useState<SettingsResponse | null>(null);
  const [company, setCompany] = useState<Partial<CompanyProfile>>({});
  const [cadence, setCadence] = useState<Partial<Record<keyof CadenceSettings, string>>>({});
  const [pricing, setPricing] = useState<Partial<Record<PricingKey, string>>>({});
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const hydrate = (r: SettingsResponse) => {
    setS(r);
    setCompany(r.settings.company);
    setCadence(Object.fromEntries(Object.entries(r.settings.cadence).map(([k, v]) => [k, String(v)])));
    setPricing(Object.fromEntries(PRICING_KEYS.map((k) => [k, r.pricing[k] === null ? '' : String(r.pricing[k])])));
  };

  useEffect(() => {
    getSalesSettings().then(hydrate).catch((e) => setMsg({ tone: 'err', text: errText(e) }));
  }, []);

  if (!s) return msg ? <Notice tone="err">{msg.text}</Notice> : <div className="cl-empty">Loading settings…</div>;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveSalesSettings({
        company,
        cadence: Object.fromEntries(Object.entries(cadence).map(([k, v]) => [k, Number(v)])) as Partial<CadenceSettings>,
        pricing: Object.fromEntries(PRICING_KEYS.map((k) => [k, pricing[k] === '' || pricing[k] === undefined ? null : Number(pricing[k])])),
      });
      hydrate(r);
      setMsg({ tone: 'ok', text: 'Saved. New messages and proposals use these settings.' });
    } catch (e) {
      setMsg({ tone: 'err', text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="cl-card">
        <h2>Pricing</h2>
        <p className="muted">Survivor never invents a price. Leave a field empty and any quote that needs it shows MANUAL_REVIEW_REQUIRED instead of a number.</p>
        <div className="sl-form">
          {PRICING_KEYS.map((k) => (
            <label key={k}>
              <span>{s.pricingLabels[k]}</span>
              <input className="cl-input" inputMode="decimal" placeholder="not set" value={pricing[k] ?? ''} onChange={(e) => setPricing({ ...pricing, [k]: e.target.value })} />
              <small className="muted">{s.pricingHelp[k]}</small>
            </label>
          ))}
        </div>
      </section>

      <section className="cl-card">
        <h2>Your company</h2>
        <p className="muted">Used in every message. Only put things here that are true.</p>
        <div className="sl-form">
          {COMPANY_FIELDS.map((f) => (
            <label key={f.key} className={f.long ? 'wide' : ''}>
              <span>{f.label}</span>
              <input className="cl-input" value={String(company[f.key] ?? '')} onChange={(e) => setCompany({ ...company, [f.key]: e.target.value })} />
            </label>
          ))}
        </div>
      </section>

      <section className="cl-card">
        <h2>Follow-up timing</h2>
        <div className="sl-form">
          {CADENCE_FIELDS.map((f) => (
            <label key={f.key}>
              <span>{f.label}</span>
              <input className="cl-input" inputMode="numeric" value={cadence[f.key] ?? ''} onChange={(e) => setCadence({ ...cadence, [f.key]: e.target.value })} />
            </label>
          ))}
        </div>
      </section>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <button className="btn primary big" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save settings'}</button>
    </>
  );
}
