import { useEffect, useState } from 'react';
import { addDoc, collection, doc, getDoc, getDocs, limit, query, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore';
import { QrCode, CheckCircle, X, RefreshCw } from 'lucide-react';
import { db } from '../lib/firebase';
import { isCheckInCode } from '../lib/checkin';

interface Vehicle { make: string; model: string; plate: string }
interface Props {
  // Either the station's 6-character check-in code (new posters, typed codes,
  // in-app scanner) or its database id (old posters with ?checkin=<id>).
  businessId: string;
  profile: { uid: string; role: string; vehicles?: Vehicle[] };
  onClose: () => void;
}

// Opens after a customer scans a station's QR code (?checkin=<businessId>).
// Confirming creates a "walk-in" booking that appears live in that station's
// queue, where staff press Check-In to start and log the wash.
export default function CheckInModal({ businessId, profile, onClose }: Props) {
  const [station, setStation] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [plate, setPlate] = useState(profile.vehicles?.[0]?.plate || '');
  const [manual, setManual] = useState({ make: '', model: '', plate: '' });
  const [submitting, setSubmitting] = useState(false);
  const [doneAt, setDoneAt] = useState<string | null>(null);
  const hasVehicles = !!profile.vehicles?.length;
  const [mode, setMode] = useState<'select' | 'manual'>(hasVehicles ? 'select' : 'manual');

  useEffect(() => {
    const notFound = () => setError('This code does not match any station. Check the code on the poster, or ask the staff for help.');
    const load = isCheckInCode(businessId)
      ? getDocs(query(collection(db, 'wash_businesses'), where('checkInCode', '==', businessId), limit(1)))
          .then((snap) => (snap.empty ? notFound() : setStation({ id: snap.docs[0].id, ...snap.docs[0].data() })))
      : getDoc(doc(db, 'wash_businesses', businessId))
          .then((snap) => (snap.exists() ? setStation({ id: snap.id, ...snap.data() }) : notFound()));
    load.catch(() => setError('Could not load the station. Check your internet connection and try again.'));
  }, [businessId]);

  const submit = async () => {
    if (!station) return;
    const v: Vehicle | undefined = mode === 'select'
      ? profile.vehicles?.find((x) => x.plate === plate)
      : { make: manual.make.trim(), model: manual.model.trim(), plate: manual.plate.trim().toUpperCase() };
    if (!v || !v.plate || !v.make || !v.model) {
      alert('Please choose your car or enter its make, model and plate number.');
      return;
    }
    setSubmitting(true);
    try {
      // Don't create a second entry if they scan twice.
      const mine = await getDocs(query(collection(db, 'bookings'), where('userId', '==', profile.uid), where('businessId', '==', station.id)));
      const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
      const already = mine.docs.find((d) => {
        const b = d.data();
        return ['pending', 'confirmed'].includes(b.status) && b.vehicleId === v.plate && (b.slot?.toMillis?.() || 0) > threeHoursAgo;
      });
      if (already) {
        setDoneAt('You were already checked in. The team has you in their queue.');
        return;
      }

      const model = v.model.toLowerCase();
      const type = model.includes('suv') ? 'suv' : model.includes('truck') ? 'truck' : 'sedan';
      const price = Number(station.pricing?.[type] ?? station.pricing?.sedan ?? 0);

      await addDoc(collection(db, 'bookings'), {
        userId: profile.uid,
        vehicleId: v.plate,
        vehicleInfo: `${v.make} ${v.model} (${v.plate})`,
        businessId: station.id,
        stationId: station.ownerUid,
        businessName: station.name || 'Station',
        slot: Timestamp.now(),
        status: 'pending',
        serviceType: 'walk-in',
        checkedInVia: 'qr',
        price,
        createdAt: serverTimestamp(),
      });

      // Save a newly typed car to their garage for next time.
      if (mode === 'manual' && !profile.vehicles?.some((x) => x.plate.toUpperCase() === v.plate)) {
        const vehicles = [...(profile.vehicles || []), { ...v, year: new Date().getFullYear(), intensity: 'low', tirePressure: 'Normal', dirtLevel: 'low' }];
        updateDoc(doc(db, 'users', profile.uid), { vehicles }).catch(() => {});
      }
      setDoneAt(`You're checked in at ${station.name}. Stay nearby; staff will call your car shortly.`);
    } catch (e: any) {
      alert(`Check-in failed: ${e.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  const input = 'w-full bg-bg border border-border rounded-xl px-4 py-3 text-text-main font-bold outline-none focus:ring-2 focus:ring-accent';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-bg/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card border border-border p-8 rounded-[2.5rem] shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-6 right-6 text-text-dim hover:text-text-main" aria-label="Close"><X size={20} /></button>
        <div className="flex items-center gap-3 text-accent">
          <QrCode size={22} />
          <span className="text-xs font-black uppercase tracking-[0.25em]">Station Check-in</span>
        </div>

        {error ? (
          <p className="text-text-main font-bold">{error}</p>
        ) : profile.role !== 'customer' ? (
          <p className="text-text-main font-bold">This QR code is for customers. You are signed in as a {profile.role}, so there is nothing to check in.</p>
        ) : doneAt ? (
          <div className="text-center space-y-4 py-4">
            <CheckCircle size={56} className="text-success mx-auto" />
            <p className="text-text-main font-bold leading-relaxed">{doneAt}</p>
            <button onClick={onClose} className="w-full bg-accent text-white font-black py-4 rounded-xl uppercase tracking-widest text-xs">Done</button>
          </div>
        ) : !station ? (
          <p className="text-text-dim flex items-center gap-2"><RefreshCw size={16} className="animate-spin" /> Loading station…</p>
        ) : (
          <>
            <h2 className="text-3xl font-black text-text-main uppercase tracking-tighter leading-none">{station.name}</h2>
            {hasVehicles && (
              <div className="flex gap-2">
                {(['select', 'manual'] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border ${mode === m ? 'bg-accent text-white border-accent' : 'border-border text-text-dim'}`}>
                    {m === 'select' ? 'My cars' : 'Another car'}
                  </button>
                ))}
              </div>
            )}
            {mode === 'select' ? (
              <select value={plate} onChange={(e) => setPlate(e.target.value)} className={input}>
                {profile.vehicles!.map((v) => <option key={v.plate} value={v.plate}>{v.make} {v.model} ({v.plate})</option>)}
              </select>
            ) : (
              <div className="space-y-3">
                <input className={input} placeholder="Make (e.g. Toyota)" value={manual.make} onChange={(e) => setManual({ ...manual, make: e.target.value })} />
                <input className={input} placeholder="Model (e.g. Corolla)" value={manual.model} onChange={(e) => setManual({ ...manual, model: e.target.value })} />
                <input className={input} placeholder="Plate number" value={manual.plate} onChange={(e) => setManual({ ...manual, plate: e.target.value.toUpperCase() })} />
              </div>
            )}
            <button onClick={submit} disabled={submitting} className="w-full bg-accent text-white font-black py-4 rounded-xl uppercase tracking-widest text-xs disabled:opacity-50 flex items-center justify-center gap-2">
              {submitting ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle size={16} />} Check me in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
