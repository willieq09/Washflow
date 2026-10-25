import { useEffect, useState } from 'react';
import { Landmark, CheckCircle, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface Payout { subaccountCode?: string; bankName?: string; accountName?: string; accountLast4?: string }

// Station owners connect their bank account here. The server turns it into a
// Paystack subaccount, so customer payments to this station are split by
// Paystack automatically: the platform fee stays with WashFlow and the rest
// settles straight into this account.
export default function PayoutSetupCard({ payout, onSaved }: { payout?: Payout; onSaved: (p: Payout) => void }) {
  const [banks, setBanks] = useState<{ name: string; code: string }[]>([]);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [resolvedName, setResolvedName] = useState('');
  const [busy, setBusy] = useState<'resolve' | 'save' | null>(null);
  const [editing, setEditing] = useState(!payout?.subaccountCode);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/paystack/banks')
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setBanks(d.map((b: any) => ({ name: b.name, code: b.code }))) : setError(d.error || 'Could not load banks.'))
      .catch(() => setError('Could not load banks.'));
  }, []);

  useEffect(() => { setResolvedName(''); }, [bankCode, accountNumber]);

  const resolve = async () => {
    setError(''); setBusy('resolve');
    try {
      const d = await apiFetch(`/api/paystack/resolve-account?account_number=${accountNumber}&bank_code=${encodeURIComponent(bankCode)}`);
      setResolvedName(d.account_name);
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  const save = async () => {
    setError(''); setBusy('save');
    try {
      const bankName = banks.find((b) => b.code === bankCode)?.name || '';
      const d = await apiFetch('/api/paystack/subaccount', {
        method: 'POST',
        body: JSON.stringify({ bank_code: bankCode, bank_name: bankName, account_number: accountNumber }),
      });
      onSaved(d);
      setEditing(false);
      setAccountNumber(''); setResolvedName('');
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  const input = 'w-full bg-bg border border-border rounded-xl px-4 py-3 text-text-main font-bold outline-none focus:ring-2 focus:ring-accent';

  return (
    <div className="bg-card border border-border rounded-[2.5rem] p-8 md:p-12 space-y-6 shadow-2xl">
      <label className="text-xs md:text-sm font-black text-accent uppercase tracking-[0.25em] flex items-center gap-3">
        <Landmark size={20} className="text-accent" /> Payout Account
      </label>

      {payout?.subaccountCode && !editing ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 text-success">
            <CheckCircle size={20} className="shrink-0 mt-0.5" />
            <p className="text-sm font-bold text-text-main leading-relaxed">
              Payments settle automatically to {payout.accountName} at {payout.bankName || 'your bank'} (account ending {payout.accountLast4}). Paystack pays out on its normal settlement schedule.
            </p>
          </div>
          <button onClick={() => setEditing(true)} className="px-5 py-3 bg-bg border border-border text-text-main rounded-xl font-black text-[10px] uppercase tracking-widest">Change account</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-text-main font-bold leading-relaxed">
            Add the bank account your station gets paid into. Customer payments will be split automatically by Paystack.
          </p>
          <select value={bankCode} onChange={(e) => setBankCode(e.target.value)} className={input}>
            <option value="">{banks.length ? 'Choose your bank' : 'Loading banks…'}</option>
            {banks.map((b) => <option key={`${b.code}-${b.name}`} value={b.code}>{b.name}</option>)}
          </select>
          <input className={input} inputMode="numeric" maxLength={10} placeholder="10 digit account number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))} />
          {resolvedName && <p className="text-sm font-black text-success">Account name: {resolvedName}</p>}
          {error && <p className="text-sm font-bold text-red-500">{error}</p>}
          <div className="flex flex-wrap gap-3">
            {!resolvedName ? (
              <button onClick={resolve} disabled={!bankCode || accountNumber.length !== 10 || !!busy} className="px-5 py-3 bg-accent text-white rounded-xl font-black text-[10px] uppercase tracking-widest disabled:opacity-50 flex items-center gap-2">
                {busy === 'resolve' && <RefreshCw size={14} className="animate-spin" />} Verify account
              </button>
            ) : (
              <button onClick={save} disabled={!!busy} className="px-5 py-3 bg-accent text-white rounded-xl font-black text-[10px] uppercase tracking-widest disabled:opacity-50 flex items-center gap-2">
                {busy === 'save' && <RefreshCw size={14} className="animate-spin" />} Confirm & save
              </button>
            )}
            {payout?.subaccountCode && <button onClick={() => setEditing(false)} className="px-5 py-3 text-text-dim font-black text-[10px] uppercase tracking-widest">Cancel</button>}
          </div>
        </div>
      )}
    </div>
  );
}
