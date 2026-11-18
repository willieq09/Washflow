import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Camera, QrCode, Zap, CheckCircle2, AlertCircle, X, 
  Car, Shield, Clock, CreditCard, Sparkles, RefreshCw, 
  MapPin, Star, ArrowRight, Upload, Phone, Check, 
  Receipt, Download, Printer, ExternalLink, ChevronRight,
  Info, Volume2, VolumeX, Flame
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import QRCode from 'qrcode';
import { 
  collection, query, where, getDocs, doc, setDoc, 
  updateDoc, serverTimestamp, Timestamp, addDoc 
} from 'firebase/firestore';
import { db } from '../App';
import { cn } from '../lib/utils';

export interface StationQrPayload {
  protocol?: string;
  stationId: string;
  stationName: string;
  location?: string;
  bay?: string;
  ownerUid?: string;
  pricing?: {
    sedan: number;
    suv: number;
    truck: number;
  };
  action?: 'check-in' | 'check-out';
  bookingId?: string;
}

interface StationQrScannerProps {
  profile: any;
  onNavigate?: (view: any) => void;
  onSuccessPayment?: (receipt: any) => void;
  onClose?: () => void;
  embedded?: boolean;
}

export function StationQrScanner({
  profile,
  onNavigate,
  onSuccessPayment,
  onClose,
  embedded = false
}: StationQrScannerProps) {
  const [activeTab, setActiveTab] = useState<'scan' | 'poster'>('scan');
  const [scannerStarted, setScannerStarted] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchOn, setTorchOn] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isProcessingFile, setIsProcessingFile] = useState(false);

  // Scanned Station State
  const [scannedData, setScannedData] = useState<StationQrPayload | null>(null);
  const [flowMode, setFlowMode] = useState<'check-in' | 'check-out'>('check-in');
  const [activeSession, setActiveSession] = useState<any | null>(null);
  const [selectedVehiclePlate, setSelectedVehiclePlate] = useState<string>(
    profile?.vehicles?.[0]?.plate || ''
  );
  const [manualVehiclePlate, setManualVehiclePlate] = useState('');
  const [manualVehicleModel, setManualVehicleModel] = useState('');
  const [selectedService, setSelectedService] = useState<'sedan' | 'suv' | 'truck' | 'express' | 'ceramic'>('sedan');
  const [bayNumber, setBayNumber] = useState('Bay 1');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkInSuccessPass, setCheckInSuccessPass] = useState<any | null>(null);
  const [checkoutCompleteReceipt, setCheckoutCompleteReceipt] = useState<any | null>(null);

  // Station Poster State
  const [posterStation, setPosterStation] = useState<string>('sample-1');
  const [posterBay, setPosterBay] = useState<string>('Bay 1');
  const [posterQrUrl, setPosterQrUrl] = useState<string>('');
  const [stationList, setStationList] = useState<any[]>([]);

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const readerElementId = 'wash-station-qr-box';

  // Demo Station Presets for instant testing without needing camera
  const demoStations: StationQrPayload[] = [
    {
      protocol: 'autolux-wash',
      stationId: 'sample-1',
      stationName: 'Hydro-Dynamic Pros',
      location: '742 Evergreen Terrace, Westlands',
      bay: 'Bay 1 (Express Lane)',
      pricing: { sedan: 2500, suv: 3500, truck: 5000 },
      ownerUid: 'system'
    },
    {
      protocol: 'autolux-wash',
      stationId: 'sample-2',
      stationName: 'EcoShine Station',
      location: '123 Industrial Way, Kilimani',
      bay: 'Bay A (Eco Wash)',
      pricing: { sedan: 2000, suv: 3000, truck: 4500 },
      ownerUid: 'system'
    },
    {
      protocol: 'autolux-wash',
      stationId: 'sample-3',
      stationName: 'Velocity Detailers',
      location: '45 Business District, Upperhill',
      bay: 'Bay 2 (Ceramic & Detail)',
      pricing: { sedan: 3000, suv: 4000, truck: 6000 },
      ownerUid: 'system'
    },
    {
      protocol: 'autolux-wash',
      stationId: 'sample-4',
      stationName: 'The Wash Vault',
      location: '88 Coastal Ave, CBD',
      bay: 'Bay 3 (Underbody Wash)',
      pricing: { sedan: 2200, suv: 3200, truck: 4800 },
      ownerUid: 'system'
    }
  ];

  // Load registered wash businesses from Firestore
  useEffect(() => {
    async function loadStations() {
      try {
        const q = query(collection(db, 'wash_businesses'));
        const snap = await getDocs(q);
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (docs.length > 0) {
          setStationList(docs);
        } else {
          setStationList(demoStations.map(s => ({ id: s.stationId, name: s.stationName, location: s.location, pricing: s.pricing })));
        }
      } catch (e) {
        setStationList(demoStations.map(s => ({ id: s.stationId, name: s.stationName, location: s.location, pricing: s.pricing })));
      }
    }
    loadStations();
  }, []);

  // Generate QR for Station Poster tab
  useEffect(() => {
    async function generatePoster() {
      const selected = stationList.find(s => s.id === posterStation) || demoStations[0];
      const payload: StationQrPayload = {
        protocol: 'autolux-wash',
        stationId: selected.id,
        stationName: selected.name,
        location: selected.location,
        bay: posterBay,
        pricing: selected.pricing || { sedan: 2500, suv: 3500, truck: 5000 },
        ownerUid: selected.ownerUid || 'system'
      };
      try {
        const url = await QRCode.toDataURL(JSON.stringify(payload), {
          width: 400,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#ffffff'
          }
        });
        setPosterQrUrl(url);
      } catch (err) {
        console.error("Poster QR generation error:", err);
      }
    }
    generatePoster();
  }, [posterStation, posterBay, stationList]);

  // Audio chime on successful scan
  const playScanBeep = () => {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
      // AudioContext not allowed or muted
    }
  };

  // Start Camera QR Scanner
  const startScanner = async () => {
    setCameraError(null);
    try {
      if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode(readerElementId);
      }

      await html5QrCodeRef.current.start(
        { facingMode: facingMode },
        {
          fps: 15,
          qrbox: { width: 260, height: 260 },
          aspectRatio: 1.0
        },
        (decodedText) => {
          handleDecodedQr(decodedText);
        },
        (errorMessage) => {
          // ignore scan frame errors
        }
      );
      setScannerStarted(true);
    } catch (err: any) {
      console.warn("Scanner start error:", err);
      setCameraError(err?.message || "Camera permission denied or camera not found. You can upload a QR image or select a demo station below.");
      setScannerStarted(false);
    }
  };

  // Stop Camera QR Scanner
  const stopScanner = async () => {
    if (html5QrCodeRef.current && scannerStarted) {
      try {
        await html5QrCodeRef.current.stop();
      } catch (e) {
        console.warn("Error stopping scanner:", e);
      }
      setScannerStarted(false);
    }
  };

  // Cleanup on unmount or tab change
  useEffect(() => {
    if (activeTab === 'scan' && !scannedData) {
      startScanner();
    } else {
      stopScanner();
    }
    return () => {
      stopScanner();
    };
  }, [activeTab, scannedData, facingMode]);

  // Handle parsed QR payload
  const handleDecodedQr = async (rawText: string) => {
    playScanBeep();
    stopScanner();

    let payload: StationQrPayload | null = null;
    try {
      // Check if it's JSON
      if (rawText.trim().startsWith('{')) {
        payload = JSON.parse(rawText);
      } else if (rawText.includes('station=') || rawText.includes('stationId=')) {
        // Parse from URL
        const url = new URL(rawText.startsWith('http') ? rawText : `https://autolux.app/${rawText}`);
        const stationId = url.searchParams.get('station') || url.searchParams.get('stationId') || 'sample-1';
        const bay = url.searchParams.get('bay') || 'Bay 1';
        const match = demoStations.find(s => s.stationId === stationId);
        payload = {
          protocol: 'autolux-wash',
          stationId,
          stationName: match?.stationName || 'AutoLux Express Station',
          location: match?.location || 'Verified Wash Terminal',
          bay,
          pricing: match?.pricing || { sedan: 2500, suv: 3500, truck: 5000 }
        };
      } else if (rawText.startsWith('AUTOLUX:STATION:')) {
        const parts = rawText.split(':');
        const stationId = parts[2] || 'sample-1';
        const bay = parts[3] || 'Bay 1';
        const match = demoStations.find(s => s.stationId === stationId);
        payload = {
          protocol: 'autolux-wash',
          stationId,
          stationName: match?.stationName || 'AutoLux Station',
          location: match?.location || 'Wash Station',
          bay,
          pricing: match?.pricing || { sedan: 2500, suv: 3500, truck: 5000 }
        };
      } else {
        // Plain string station id or name
        const match = demoStations.find(s => s.stationId === rawText || s.stationName.toLowerCase().includes(rawText.toLowerCase())) || demoStations[0];
        payload = {
          ...match,
          bay: 'Bay 1'
        };
      }
    } catch (e) {
      // Fallback
      payload = demoStations[0];
    }

    if (!payload || !payload.stationId) {
      payload = demoStations[0];
    }

    setScannedData(payload);
    if (payload.bay) setBayNumber(payload.bay);

    // Check if user has an active booking / wash session at this station
    await checkForExistingSession(payload.stationId);
  };

  // Check Firestore for user's active session at this station
  const checkForExistingSession = async (stationId: string) => {
    if (!profile?.uid) return;
    try {
      const q = query(
        collection(db, 'bookings'),
        where('userId', '==', profile.uid),
        where('status', 'in', ['pending', 'confirmed'])
      );
      const snap = await getDocs(q);
      const matching = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .find((b: any) => b.businessId === stationId || b.stationId === stationId || !b.stationId);

      if (matching) {
        setActiveSession(matching);
        setFlowMode('check-out'); // Default to check-out & pay if active session found!
      } else {
        setActiveSession(null);
        setFlowMode('check-in'); // Arrived at station, ready to check in
      }
    } catch (err) {
      console.warn("Could not check active session:", err);
      setFlowMode('check-in');
    }
  };

  // Handle File Upload QR Scan
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessingFile(true);
    try {
      const html5QrCode = new Html5Qrcode('qr-file-processor');
      const decodedText = await html5QrCode.scanFile(file, true);
      handleDecodedQr(decodedText);
    } catch (err: any) {
      alert("Could not detect a valid Wash Station QR code in this image. Try another photo or tap a demo station below.");
    } finally {
      setIsProcessingFile(false);
      e.target.value = '';
    }
  };

  // Toggle Torch/Flashlight
  const toggleTorch = async () => {
    if (!html5QrCodeRef.current || !scannerStarted) return;
    try {
      // @ts-ignore
      const track = html5QrCodeRef.current.getRunningTrackCameraCapabilities();
      if (track && track.torchFeature().isSupported()) {
        await track.torchFeature().apply(!torchOn);
        setTorchOn(!torchOn);
      } else {
        alert("Flashlight is not supported on this camera device.");
      }
    } catch (e) {
      // Torch not supported on desktop webcam
      alert("Flashlight not available on this device.");
    }
  };

  // Calculate wash price
  const getSelectedPrice = () => {
    const pricing = scannedData?.pricing || { sedan: 2500, suv: 3500, truck: 5000 };
    switch (selectedService) {
      case 'sedan': return pricing.sedan || 2500;
      case 'suv': return pricing.suv || 3500;
      case 'truck': return pricing.truck || 5000;
      case 'express': return Math.round((pricing.sedan || 2500) * 0.7);
      case 'ceramic': return (pricing.suv || 3500) + 1500;
      default: return 2500;
    }
  };

  const getVehiclePlate = () => {
    if (selectedVehiclePlate && selectedVehiclePlate !== 'manual') {
      return selectedVehiclePlate;
    }
    return manualVehiclePlate.trim().toUpperCase() || 'KCB-492L';
  };

  const getVehicleModel = () => {
    if (selectedVehiclePlate && selectedVehiclePlate !== 'manual') {
      const match = profile?.vehicles?.find((v: any) => v.plate === selectedVehiclePlate);
      return match ? `${match.make} ${match.model}` : 'Vehicle';
    }
    return manualVehicleModel.trim() || 'Custom Vehicle';
  };

  // FLOW 1: Check-in Now (Start Wash)
  const handleExecuteCheckIn = async (prePay: boolean = false) => {
    if (!scannedData || !profile?.uid) return;
    setIsSubmitting(true);
    const plate = getVehiclePlate();
    const model = getVehicleModel();
    const price = getSelectedPrice();

    try {
      const newBookingRef = doc(collection(db, 'bookings'));
      const bookingData = {
        userId: profile.uid,
        stationId: scannedData.stationId,
        businessId: scannedData.stationId,
        businessName: scannedData.stationName,
        bay: bayNumber,
        slot: Timestamp.now(),
        status: 'confirmed',
        serviceType: 'in-station',
        price: price,
        servicePackage: selectedService.toUpperCase(),
        vehicleInfo: `${model} (${plate})`,
        plateNumber: plate,
        checkInTime: serverTimestamp(),
        createdAt: serverTimestamp(),
        notes: `Checked in via Wash Station QR at ${bayNumber}`
      };

      await setDoc(newBookingRef, bookingData);

      // Also create an in-progress wash log entry
      const washRef = doc(collection(db, 'washes'));
      await setDoc(washRef, {
        userId: profile.uid,
        stationId: scannedData.stationId,
        stationName: scannedData.stationName,
        carModel: model,
        plateNumber: plate,
        price: price,
        status: 'in-progress',
        bay: bayNumber,
        workerId: 'station-qr',
        workerName: `${scannedData.stationName} Auto-Bay`,
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp()
      });

      if (prePay) {
        // Pre-pay initiated
        await handleInitiatePaystack(price, newBookingRef.id, 'Check-In Pre-Payment');
      } else {
        // Success check-in pass
        setCheckInSuccessPass({
          bookingId: newBookingRef.id,
          stationName: scannedData.stationName,
          bay: bayNumber,
          plate: plate,
          model: model,
          service: selectedService,
          price: price,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
      }
    } catch (err: any) {
      console.error("Check-in error:", err);
      alert(`Check-in error: ${err.message || 'Please check your connection.'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // FLOW 2: Check-Out with Payment Gateway (Paystack)
  const handleInitiatePaystack = async (amount: number, bookingId?: string, label?: string) => {
    if (!profile?.email) {
      alert("Please ensure your email is saved in your profile to initialize Paystack checkout.");
      return;
    }
    setIsSubmitting(true);
    const plate = getVehiclePlate();
    const stationName = scannedData?.stationName || 'AutoLux Wash';

    try {
      const res = await fetch('/api/paystack/initialize-wash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: profile.email,
          amount: Math.round(amount * 100), // in kobo/cents
          stationId: scannedData?.stationId || 'sample-1',
          stationName: stationName,
          vehiclePlate: plate,
          servicePackage: `${label || 'Wash Service'} (${selectedService.toUpperCase()})`,
          userId: profile.uid,
          bookingId: bookingId || activeSession?.id || ''
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Payment gateway initialization failed");

      if (data.authorization_url) {
        // Redirect to Paystack gateway
        if (window.top) {
          window.top.location.href = data.authorization_url;
        } else {
          window.location.href = data.authorization_url;
        }
      } else {
        throw new Error("No payment authorization URL returned");
      }
    } catch (err: any) {
      console.error("Paystack error:", err);
      alert(`Payment Gateway Error: ${err.message}. If testing in sandbox, you can also complete check-out using Credits or Cash terminal.`);
      setIsSubmitting(false);
    }
  };

  // FLOW 3: Check-out with AutoLux Wash Credits (1-click, 0 delay)
  const handlePayWithCredits = async () => {
    if (!profile || (profile.credits || 0) < 1) {
      alert("You need at least 1 AutoLux wash credit. You can purchase credits from the Subscription tab or pay via Paystack.");
      return;
    }
    setIsSubmitting(true);
    const plate = getVehiclePlate();
    const model = getVehicleModel();
    const ref = `CREDIT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    try {
      // 1. Deduct 1 credit
      await updateDoc(doc(db, 'users', profile.uid), {
        credits: (profile.credits || 1) - 1
      });

      // 2. Mark booking completed if exists
      if (activeSession?.id) {
        try {
          await updateDoc(doc(db, 'bookings', activeSession.id), {
            status: 'completed',
            paymentRef: ref,
            paymentMethod: 'credit',
            completedAt: serverTimestamp()
          });
        } catch (e) {}
      }

      // 3. Record wash record
      const washId = `wash_${ref}`;
      await setDoc(doc(db, 'washes', washId), {
        userId: profile.uid,
        stationId: scannedData?.stationId || 'sample-1',
        stationName: scannedData?.stationName || 'Wash Station',
        carModel: model,
        plateNumber: plate,
        price: getSelectedPrice(),
        status: 'completed',
        usedCredit: true,
        paymentRef: ref,
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp()
      });

      // 4. Record Notification
      const notifId = `notif_${ref}`;
      await setDoc(doc(db, 'notifications', notifId), {
        userId: profile.uid,
        recipient: 'user',
        type: 'payment_confirmation',
        title: 'Wash Check-Out Confirmed (1 Credit Applied)',
        message: `Your wash at ${scannedData?.stationName} was finalized using 1 AutoLux Credit. Remaining balance: ${(profile.credits || 1) - 1} credits.`,
        amount: getSelectedPrice(),
        reference: ref,
        itemName: `${scannedData?.stationName} Wash`,
        customerName: profile.name,
        customerEmail: profile.email,
        read: false,
        createdAt: serverTimestamp()
      });

      setCheckoutCompleteReceipt({
        reference: ref,
        stationName: scannedData?.stationName,
        bay: bayNumber,
        plate: plate,
        model: model,
        amount: getSelectedPrice(),
        method: '1 AutoLux Wash Credit',
        date: new Date().toLocaleString()
      });
    } catch (err: any) {
      console.error("Credit check-out error:", err);
      alert(`Could not process credits: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // FLOW 4: Instant Station Terminal / Cash Check-Out
  const handleCashTerminalCheckout = async () => {
    setIsSubmitting(true);
    const plate = getVehiclePlate();
    const model = getVehicleModel();
    const price = getSelectedPrice();
    const ref = `CASH-POS-${Date.now().toString().slice(-6)}`;

    try {
      if (activeSession?.id) {
        try {
          await updateDoc(doc(db, 'bookings', activeSession.id), {
            status: 'completed',
            paymentRef: ref,
            paymentMethod: 'cash_terminal',
            completedAt: serverTimestamp()
          });
        } catch (e) {}
      }

      const washId = `wash_${ref}`;
      await setDoc(doc(db, 'washes', washId), {
        userId: profile.uid,
        stationId: scannedData?.stationId || 'sample-1',
        stationName: scannedData?.stationName || 'Wash Station',
        carModel: model,
        plateNumber: plate,
        price: price,
        status: 'completed',
        paymentMethod: 'cash_terminal',
        paymentRef: ref,
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp()
      });

      setCheckoutCompleteReceipt({
        reference: ref,
        stationName: scannedData?.stationName,
        bay: bayNumber,
        plate: plate,
        model: model,
        amount: price,
        method: 'Station Terminal / Cash (Validated)',
        date: new Date().toLocaleString()
      });
    } catch (err: any) {
      alert(`Terminal checkout error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={cn("w-full mx-auto", embedded ? "max-w-4xl" : "max-w-4xl p-4 md:p-8")}>
      {/* Hidden file processor element */}
      <div id="qr-file-processor" className="hidden" />

      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-accent text-white flex items-center justify-center shadow-lg shadow-accent/20">
              <QrCode size={22} />
            </div>
            <div>
              <h2 className="text-3xl font-black text-text-main uppercase tracking-tighter">
                Wash Station QR.
              </h2>
              <p className="text-xs text-text-dim lowercase font-semibold">
                Instant bay check-in, auto vehicle recognition & fast Paystack checkout.
              </p>
            </div>
          </div>
        </div>

        {/* Tab & Action Controls */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <div className="bg-card p-1 rounded-2xl border border-border flex items-center gap-1 shadow-sm">
            <button
              onClick={() => { setActiveTab('scan'); setScannedData(null); }}
              className={cn(
                "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5",
                activeTab === 'scan' ? "bg-accent text-white shadow-md shadow-accent/20" : "text-text-dim hover:text-text-main"
              )}
            >
              <Camera size={14} /> Scan Station QR
            </button>
            <button
              onClick={() => { setActiveTab('poster'); stopScanner(); }}
              className={cn(
                "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5",
                activeTab === 'poster' ? "bg-accent text-white shadow-md shadow-accent/20" : "text-text-dim hover:text-text-main"
              )}
            >
              <Printer size={14} /> Bay Posters & QR Codes
            </button>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="p-2.5 rounded-xl bg-card border border-border text-text-dim hover:text-text-main hover:bg-white/5 transition"
              title="Close Scanner"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: SCANNER */}
      {activeTab === 'scan' && (
        <>
          {/* If a station QR was scanned and decoded */}
          {scannedData ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              {/* Check-In Success Pass Modal */}
              {checkInSuccessPass && (
                <div className="bento-card border-2 border-success/40 bg-card p-8 rounded-[2.5rem] relative overflow-hidden shadow-2xl">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-success/20 text-success flex items-center justify-center">
                        <CheckCircle2 size={28} />
                      </div>
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-success">
                          Check-In Successful
                        </span>
                        <h3 className="text-2xl font-black text-text-main uppercase tracking-tight">
                          Wash Pass Activated
                        </h3>
                      </div>
                    </div>
                    <span className="text-xs font-mono font-bold bg-white/5 px-3 py-1.5 rounded-xl border border-border">
                      {checkInSuccessPass.time}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5 bg-bg rounded-2xl border border-border mb-6">
                    <div>
                      <span className="text-[8px] font-black uppercase text-text-dim block">Station</span>
                      <span className="text-sm font-black text-text-main truncate block">{checkInSuccessPass.stationName}</span>
                    </div>
                    <div>
                      <span className="text-[8px] font-black uppercase text-text-dim block">Assigned Bay</span>
                      <span className="text-sm font-black text-accent">{checkInSuccessPass.bay}</span>
                    </div>
                    <div>
                      <span className="text-[8px] font-black uppercase text-text-dim block">Vehicle Plate</span>
                      <span className="text-sm font-mono font-black text-text-main">{checkInSuccessPass.plate}</span>
                    </div>
                    <div>
                      <span className="text-[8px] font-black uppercase text-text-dim block">Estimated Wash</span>
                      <span className="text-sm font-black text-text-main">20 - 25 mins</span>
                    </div>
                  </div>

                  <p className="text-xs text-text-dim leading-relaxed mb-6">
                    Your car has been checked into <strong>{checkInSuccessPass.bay}</strong>. When your wash is complete, scan this station's QR code again or tap below to check out and initiate payment gateway.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      onClick={() => {
                        setCheckInSuccessPass(null);
                        setFlowMode('check-out');
                      }}
                      className="flex-1 bg-accent text-white py-3.5 rounded-xl font-black text-xs uppercase tracking-widest hover:brightness-110 shadow-lg shadow-accent/20 transition flex items-center justify-center gap-2"
                    >
                      <CreditCard size={14} /> Proceed to Check-Out & Pay
                    </button>
                    <button
                      onClick={() => {
                        setScannedData(null);
                        setCheckInSuccessPass(null);
                        startScanner();
                      }}
                      className="px-6 py-3.5 bg-white/5 hover:bg-white/10 text-text-main rounded-xl font-black text-xs uppercase tracking-widest transition"
                    >
                      Scan Another
                    </button>
                  </div>
                </div>
              )}

              {/* Check-Out Complete Receipt */}
              {checkoutCompleteReceipt && (
                <div className="bento-card border-2 border-accent/40 bg-card p-8 rounded-[2.5rem] relative overflow-hidden shadow-2xl">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-accent/20 text-accent flex items-center justify-center">
                        <Receipt size={28} />
                      </div>
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-accent">
                          Session Finalized
                        </span>
                        <h3 className="text-2xl font-black text-text-main uppercase tracking-tight">
                          Digital Wash Receipt
                        </h3>
                      </div>
                    </div>
                    <span className="text-xs font-mono font-bold bg-white/5 px-3 py-1.5 rounded-xl border border-border">
                      Ref: {checkoutCompleteReceipt.reference}
                    </span>
                  </div>

                  <div className="space-y-3 p-5 bg-bg rounded-2xl border border-border mb-6">
                    <div className="flex justify-between text-xs py-1 border-b border-border/50">
                      <span className="text-text-dim">Wash Station:</span>
                      <span className="font-bold text-text-main">{checkoutCompleteReceipt.stationName}</span>
                    </div>
                    <div className="flex justify-between text-xs py-1 border-b border-border/50">
                      <span className="text-text-dim">Vehicle:</span>
                      <span className="font-mono font-bold text-text-main">{checkoutCompleteReceipt.model} ({checkoutCompleteReceipt.plate})</span>
                    </div>
                    <div className="flex justify-between text-xs py-1 border-b border-border/50">
                      <span className="text-text-dim">Payment Method:</span>
                      <span className="font-bold text-success">{checkoutCompleteReceipt.method}</span>
                    </div>
                    <div className="flex justify-between text-xs py-1 border-b border-border/50">
                      <span className="text-text-dim">Timestamp:</span>
                      <span className="font-bold text-text-main">{checkoutCompleteReceipt.date}</span>
                    </div>
                    <div className="flex justify-between text-base pt-2 font-black">
                      <span className="text-text-main">Total Settled:</span>
                      <span className="text-accent">₦{checkoutCompleteReceipt.amount?.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setCheckoutCompleteReceipt(null);
                        setScannedData(null);
                        if (onNavigate) onNavigate('dashboard');
                      }}
                      className="flex-1 bg-accent text-white py-3.5 rounded-xl font-black text-xs uppercase tracking-widest hover:brightness-110 shadow-lg shadow-accent/20 transition"
                    >
                      Return to Dashboard
                    </button>
                    <button
                      onClick={() => window.print()}
                      className="px-6 py-3.5 bg-white/5 hover:bg-white/10 text-text-main rounded-xl font-black text-xs uppercase tracking-widest transition flex items-center gap-2"
                    >
                      <Printer size={14} /> Print Receipt
                    </button>
                  </div>
                </div>
              )}

              {/* Station Verified Banner & Mode Switcher */}
              {!checkInSuccessPass && !checkoutCompleteReceipt && (
                <div className="space-y-6">
                  {/* Station Card */}
                  <div className="bento-card bg-card border-2 border-accent/30 p-6 md:p-8 rounded-[2.5rem] relative overflow-hidden">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/30 text-accent flex items-center justify-center shadow-lg">
                          <Car size={32} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-success/20 text-success border border-success/30 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-success animate-ping" /> Station Verified
                            </span>
                            <span className="text-[10px] font-mono text-accent font-black uppercase">
                              {bayNumber}
                            </span>
                          </div>
                          <h3 className="text-2xl font-black text-text-main uppercase tracking-tight mt-1">
                            {scannedData.stationName}
                          </h3>
                          <p className="text-xs text-text-dim flex items-center gap-1 mt-0.5">
                            <MapPin size={12} /> {scannedData.location || 'Verified Wash Hub'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setScannedData(null);
                            startScanner();
                          }}
                          className="text-xs font-bold text-text-dim hover:text-white px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition"
                        >
                          Rescan QR
                        </button>
                      </div>
                    </div>

                    {/* Flow Mode Selector */}
                    <div className="mt-6 flex bg-bg p-1.5 rounded-2xl border border-border">
                      <button
                        onClick={() => setFlowMode('check-in')}
                        className={cn(
                          "flex-1 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2",
                          flowMode === 'check-in'
                            ? "bg-accent text-white shadow-lg shadow-accent/20"
                            : "text-text-dim hover:text-text-main"
                        )}
                      >
                        <Check size={16} /> 1. Arrived (Check-In)
                      </button>
                      <button
                        onClick={() => setFlowMode('check-out')}
                        className={cn(
                          "flex-1 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2",
                          flowMode === 'check-out'
                            ? "bg-accent text-white shadow-lg shadow-accent/20"
                            : "text-text-dim hover:text-text-main"
                        )}
                      >
                        <CreditCard size={16} /> 2. Wash Done (Check-Out & Pay)
                      </button>
                    </div>

                    {/* Active Session Alert if detected */}
                    {activeSession && (
                      <div className="mt-4 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <AlertCircle size={18} className="text-amber-500 shrink-0" />
                          <div className="text-xs text-amber-500 font-bold">
                            Active session detected for this station ({activeSession.vehicleInfo || 'Vehicle'}). Tap "Wash Done (Check-Out & Pay)" to complete and settle via Paystack!
                          </div>
                        </div>
                        <button
                          onClick={() => setFlowMode('check-out')}
                          className="px-3 py-1 bg-amber-500 text-bg text-[10px] font-black uppercase rounded-lg shrink-0"
                        >
                          Settle Now
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Flow Form */}
                  <div className="bento-card bg-card p-6 md:p-8 rounded-[2.5rem] space-y-6">
                    {/* Vehicle Selection */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-[10px] font-black text-text-dim uppercase tracking-widest">
                          Select Vehicle
                        </label>
                        {profile?.vehicles && profile.vehicles.length > 0 && (
                          <span className="text-[10px] text-accent font-bold">
                            {profile.vehicles.length} Saved in Garage
                          </span>
                        )}
                      </div>

                      {profile?.vehicles && profile.vehicles.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                          {profile.vehicles.map((v: any, idx: number) => (
                            <button
                              key={idx}
                              onClick={() => setSelectedVehiclePlate(v.plate)}
                              className={cn(
                                "p-3.5 rounded-xl border text-left flex items-center justify-between transition-all",
                                selectedVehiclePlate === v.plate
                                  ? "border-accent bg-accent/10 text-white shadow-sm"
                                  : "border-border bg-bg text-text-dim hover:border-text-dim/40"
                              )}
                            >
                              <div>
                                <span className="font-black text-xs text-text-main uppercase block">
                                  {v.make} {v.model}
                                </span>
                                <span className="font-mono text-[10px] text-text-dim tracking-wider">
                                  {v.plate}
                                </span>
                              </div>
                              {selectedVehiclePlate === v.plate && (
                                <CheckCircle2 size={16} className="text-accent" />
                              )}
                            </button>
                          ))}
                          <button
                            onClick={() => setSelectedVehiclePlate('manual')}
                            className={cn(
                              "p-3.5 rounded-xl border text-left flex items-center justify-between transition-all",
                              selectedVehiclePlate === 'manual'
                                ? "border-accent bg-accent/10 text-white"
                                : "border-border bg-bg text-text-dim hover:border-text-dim/40"
                            )}
                          >
                            <span className="text-xs font-bold uppercase">Enter Another Plate</span>
                            {selectedVehiclePlate === 'manual' && <CheckCircle2 size={16} className="text-accent" />}
                          </button>
                        </div>
                      ) : null}

                      {/* Manual plate input if selected or no vehicles */}
                      {(!profile?.vehicles || profile.vehicles.length === 0 || selectedVehiclePlate === 'manual') && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-bg rounded-2xl border border-border">
                          <div>
                            <label className="text-[8px] font-black text-text-dim uppercase tracking-widest block mb-1">
                              Plate Number
                            </label>
                            <input
                              type="text"
                              value={manualVehiclePlate}
                              onChange={(e) => setManualVehiclePlate(e.target.value.toUpperCase())}
                              placeholder="e.g. KCB 892M"
                              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-xs font-mono font-bold text-text-main uppercase outline-none focus:border-accent"
                            />
                          </div>
                          <div>
                            <label className="text-[8px] font-black text-text-dim uppercase tracking-widest block mb-1">
                              Vehicle Make & Model
                            </label>
                            <input
                              type="text"
                              value={manualVehicleModel}
                              onChange={(e) => setManualVehicleModel(e.target.value)}
                              placeholder="e.g. Mercedes C200"
                              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-xs font-bold text-text-main outline-none focus:border-accent"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Wash Package Selection */}
                    <div>
                      <label className="text-[10px] font-black text-text-dim uppercase tracking-widest mb-3 block">
                        Service Package
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <button
                          onClick={() => setSelectedService('sedan')}
                          className={cn(
                            "p-3 rounded-xl border text-left transition-all",
                            selectedService === 'sedan'
                              ? "border-accent bg-accent/10 shadow-sm"
                              : "border-border bg-bg text-text-dim hover:border-text-dim/40"
                          )}
                        >
                          <div className="text-[9px] font-black uppercase text-accent">Standard</div>
                          <div className="text-xs font-black text-text-main mt-0.5">Sedan Wash</div>
                          <div className="text-xs font-bold text-text-dim mt-1">₦{scannedData.pricing?.sedan || 2500}</div>
                        </button>

                        <button
                          onClick={() => setSelectedService('suv')}
                          className={cn(
                            "p-3 rounded-xl border text-left transition-all",
                            selectedService === 'suv'
                              ? "border-accent bg-accent/10 shadow-sm"
                              : "border-border bg-bg text-text-dim hover:border-text-dim/40"
                          )}
                        >
                          <div className="text-[9px] font-black uppercase text-accent">Popular</div>
                          <div className="text-xs font-black text-text-main mt-0.5">SUV & Crossover</div>
                          <div className="text-xs font-bold text-text-dim mt-1">₦{scannedData.pricing?.suv || 3500}</div>
                        </button>

                        <button
                          onClick={() => setSelectedService('truck')}
                          className={cn(
                            "p-3 rounded-xl border text-left transition-all",
                            selectedService === 'truck'
                              ? "border-accent bg-accent/10 shadow-sm"
                              : "border-border bg-bg text-text-dim hover:border-text-dim/40"
                          )}
                        >
                          <div className="text-[9px] font-black uppercase text-accent">Heavy Duty</div>
                          <div className="text-xs font-black text-text-main mt-0.5">Truck / Pickup</div>
                          <div className="text-xs font-bold text-text-dim mt-1">₦{scannedData.pricing?.truck || 5000}</div>
                        </button>

                        <button
                          onClick={() => setSelectedService('express')}
                          className={cn(
                            "p-3 rounded-xl border text-left transition-all",
                            selectedService === 'express'
                              ? "border-accent bg-accent/10 shadow-sm"
                              : "border-border bg-bg text-text-dim hover:border-text-dim/40"
                          )}
                        >
                          <div className="text-[9px] font-black uppercase text-success">Quick In & Out</div>
                          <div className="text-xs font-black text-text-main mt-0.5">Express Exterior</div>
                          <div className="text-xs font-bold text-text-dim mt-1">₦{Math.round((scannedData.pricing?.sedan || 2500) * 0.7)}</div>
                        </button>

                        <button
                          onClick={() => setSelectedService('ceramic')}
                          className={cn(
                            "p-3 rounded-xl border text-left transition-all col-span-2 sm:col-span-1",
                            selectedService === 'ceramic'
                              ? "border-accent bg-accent/10 shadow-sm"
                              : "border-border bg-bg text-text-dim hover:border-text-dim/40"
                          )}
                        >
                          <div className="text-[9px] font-black uppercase text-amber-400">Deep Shine</div>
                          <div className="text-xs font-black text-text-main mt-0.5">Ceramic & Detail</div>
                          <div className="text-xs font-bold text-text-dim mt-1">₦{(scannedData.pricing?.suv || 3500) + 1500}</div>
                        </button>
                      </div>
                    </div>

                    {/* Summary & Actions depending on Flow Mode */}
                    <div className="pt-4 border-t border-border">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <span className="text-[8px] font-black uppercase text-text-dim tracking-widest">
                            Estimated Total
                          </span>
                          <div className="text-3xl font-black text-text-main">
                            ₦{getSelectedPrice().toLocaleString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-[8px] font-black uppercase text-text-dim tracking-widest">
                            AutoLux Balance
                          </span>
                          <div className="text-sm font-black text-accent">
                            {profile?.credits || 0} Credits
                          </div>
                        </div>
                      </div>

                      {flowMode === 'check-in' ? (
                        /* CHECK-IN ACTIONS */
                        <div className="space-y-3">
                          <button
                            disabled={isSubmitting}
                            onClick={() => handleExecuteCheckIn(false)}
                            className="w-full bg-accent text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:brightness-110 active:scale-98 transition shadow-xl shadow-accent/20 flex items-center justify-center gap-2"
                          >
                            {isSubmitting ? (
                              <RefreshCw size={16} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={16} />
                            )}
                            Check-In Now & Start Wash ({bayNumber})
                          </button>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button
                              disabled={isSubmitting}
                              onClick={() => handleExecuteCheckIn(true)}
                              className="bg-card border border-border hover:border-accent text-text-main py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-white/5 transition flex items-center justify-center gap-2"
                            >
                              <CreditCard size={14} className="text-accent" />
                              Fast-Track: Pre-Pay via Paystack
                            </button>

                            {(profile?.credits || 0) >= 1 && (
                              <button
                                disabled={isSubmitting}
                                onClick={handlePayWithCredits}
                                className="bg-success/10 border border-success/30 text-success hover:bg-success/20 py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition flex items-center justify-center gap-2"
                              >
                                <Sparkles size={14} />
                                Pre-Pay 1 Credit (0 Latency)
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        /* CHECK-OUT & PAYMENT ACTIONS */
                        <div className="space-y-4">
                          <div className="p-4 bg-accent/10 border border-accent/20 rounded-2xl">
                            <div className="flex items-center gap-2 text-accent text-xs font-black uppercase tracking-wider mb-1">
                              <Zap size={14} /> Instant Settlement Gateway
                            </div>
                            <p className="text-[11px] text-text-dim leading-relaxed">
                              Choose your payment gateway below to reduce checkout time and receive an instant digital receipt.
                            </p>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* Paystack Payment Gateway */}
                            <button
                              disabled={isSubmitting}
                              onClick={() => handleInitiatePaystack(getSelectedPrice(), activeSession?.id, 'Wash Check-Out')}
                              className="bg-accent text-white py-4 px-6 rounded-2xl font-black text-xs uppercase tracking-widest hover:brightness-110 active:scale-98 shadow-xl shadow-accent/20 transition flex items-center justify-center gap-2.5 sm:col-span-2"
                            >
                              {isSubmitting ? (
                                <RefreshCw size={16} className="animate-spin" />
                              ) : (
                                <CreditCard size={18} />
                              )}
                              Initiate Paystack Gateway (Card, Bank, USSD, M-Pesa)
                            </button>

                            {/* 1 AutoLux Credit */}
                            {(profile?.credits || 0) >= 1 ? (
                              <button
                                disabled={isSubmitting}
                                onClick={handlePayWithCredits}
                                className="bg-success text-bg py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest hover:brightness-110 active:scale-98 transition flex items-center justify-center gap-2"
                              >
                                <Sparkles size={14} /> Pay 1 Credit ({profile.credits} Available)
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  if (onNavigate) onNavigate('subscription');
                                }}
                                className="bg-card border border-border text-text-dim hover:text-text-main py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition"
                              >
                                Buy Credits (Save 20%)
                              </button>
                            )}

                            {/* Cash / Terminal Check-out */}
                            <button
                              disabled={isSubmitting}
                              onClick={handleCashTerminalCheckout}
                              className="bg-card border border-border hover:border-text-dim text-text-main py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition flex items-center justify-center gap-2"
                            >
                              <Receipt size={14} /> Station POS / Cash Terminal
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            /* ACTIVE CAMERA SCANNER VIEW */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Column: Live Camera Video Stream */}
              <div className="lg:col-span-7 space-y-4">
                <div className="bento-card p-0 overflow-hidden relative aspect-square sm:aspect-[4/3] bg-black rounded-[2.5rem] shadow-2xl border border-border flex flex-col justify-center items-center">
                  {/* Camera Video Target */}
                  <div id={readerElementId} className="w-full h-full object-cover [&>video]:w-full [&>video]:h-full [&>video]:object-cover" />

                  {/* Laser Beam & Targeting Reticle */}
                  {scannerStarted && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      {/* Targeting Corner Brackets */}
                      <div className="relative w-64 h-64 border-2 border-accent/40 rounded-3xl">
                        {/* Corner Accents */}
                        <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-accent rounded-tl-lg" />
                        <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-accent rounded-tr-lg" />
                        <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-accent rounded-bl-lg" />
                        <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-accent rounded-br-lg" />

                        {/* Animated Laser Scanning Line */}
                        <div className="absolute inset-x-2 h-1 bg-gradient-to-r from-transparent via-accent to-transparent rounded-full animate-bounce shadow-[0_0_15px_rgba(255,100,50,0.8)]" />

                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[9px] font-black uppercase tracking-widest text-accent/80 bg-black/60 px-3 py-1 rounded-full border border-accent/20 backdrop-blur-md">
                            Align Wash Station QR
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Camera Error / Fallback message if permissions denied */}
                  {cameraError && (
                    <div className="absolute inset-0 bg-bg/95 p-8 flex flex-col items-center justify-center text-center z-20 space-y-4">
                      <div className="w-14 h-14 rounded-full bg-accent/10 text-accent flex items-center justify-center">
                        <Camera size={28} />
                      </div>
                      <h4 className="text-lg font-black text-text-main uppercase tracking-tight">
                        Camera Offline or Inactive
                      </h4>
                      <p className="text-xs text-text-dim max-w-sm lowercase">
                        {cameraError}
                      </p>
                      <div className="flex gap-3">
                        <button
                          onClick={startScanner}
                          className="bg-accent text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:brightness-110 shadow-lg shadow-accent/20 transition"
                        >
                          Retry Camera
                        </button>
                        <label className="bg-white/10 hover:bg-white/20 text-text-main px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest cursor-pointer transition flex items-center gap-2">
                          <Upload size={14} /> Upload QR Photo
                          <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Camera Controls Overlay */}
                  <div className="absolute top-4 inset-x-4 flex items-center justify-between pointer-events-auto z-10">
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 bg-black/70 backdrop-blur-md border border-white/10 rounded-full text-[9px] font-black uppercase tracking-widest text-text-main flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-success animate-ping" /> Optical QR Lens
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={toggleTorch}
                        className={cn(
                          "p-2 rounded-xl backdrop-blur-md border transition",
                          torchOn ? "bg-accent text-white border-accent" : "bg-black/60 text-white border-white/10 hover:bg-black/80"
                        )}
                        title="Toggle Flashlight"
                      >
                        <Zap size={14} />
                      </button>

                      <button
                        onClick={() => {
                          setFacingMode(facingMode === 'environment' ? 'user' : 'environment');
                        }}
                        className="p-2 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-white hover:bg-black/80 transition"
                        title="Switch Camera (Front/Rear)"
                      >
                        <RefreshCw size={14} />
                      </button>

                      <button
                        onClick={() => setSoundEnabled(!soundEnabled)}
                        className="p-2 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-white hover:bg-black/80 transition"
                        title="Toggle Sound"
                      >
                        {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* File Upload Option */}
                <div className="flex items-center justify-between p-4 bg-card rounded-2xl border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-text-dim">
                      <Upload size={18} />
                    </div>
                    <div>
                      <span className="text-xs font-black text-text-main uppercase block">
                        Have a photo or screenshot?
                      </span>
                      <span className="text-[10px] text-text-dim lowercase">
                        Upload any QR code image to parse instantly.
                      </span>
                    </div>
                  </div>
                  <label className="bg-text-main text-bg hover:bg-accent hover:text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest cursor-pointer transition shadow-sm">
                    {isProcessingFile ? "Reading..." : "Select File"}
                    <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
              </div>

              {/* Right Column: Demo Station Presets for 1-Click Testing */}
              <div className="lg:col-span-5 space-y-4">
                <div className="bento-card bg-card p-6 rounded-[2.5rem] border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles size={16} className="text-accent" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-accent">
                      Instant Testing & Simulation
                    </span>
                  </div>
                  <h3 className="text-xl font-black text-text-main uppercase tracking-tight">
                    Quick-Scan Wash Bays
                  </h3>
                  <p className="text-xs text-text-dim lowercase mt-1 mb-4 leading-relaxed">
                    Tap any verified wash bay below to simulate an instant QR scan and test the full check-in/out and Paystack flow:
                  </p>

                  <div className="space-y-2.5">
                    {demoStations.map((station, i) => (
                      <button
                        key={i}
                        onClick={() => handleDecodedQr(JSON.stringify(station))}
                        className="w-full p-3.5 bg-bg border border-border hover:border-accent rounded-2xl flex items-center justify-between group transition-all text-left shadow-sm hover:translate-x-1"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center font-black text-xs group-hover:bg-accent group-hover:text-white transition">
                            #{i + 1}
                          </div>
                          <div>
                            <div className="text-xs font-black text-text-main uppercase leading-tight">
                              {station.stationName}
                            </div>
                            <div className="text-[10px] text-accent font-bold mt-0.5">
                              {station.bay} • From ₦{station.pricing?.sedan}
                            </div>
                          </div>
                        </div>
                        <ChevronRight size={16} className="text-text-dim group-hover:text-accent transition" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* How it works info */}
                <div className="p-5 bg-card/60 rounded-2xl border border-border space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-black text-text-main uppercase text-[10px] tracking-wider">
                    <Info size={14} className="text-accent" /> How Station QR Works
                  </div>
                  <ul className="space-y-1.5 text-[11px] text-text-dim list-disc pl-4">
                    <li>Scan when you pull up to any AutoLux wash bay to auto-assign your spot.</li>
                    <li>Scan again when the wash is completed to initiate instant Paystack payment.</li>
                    <li>Use AutoLux Wash Credits to settle in 1 tap without pulling out a credit card!</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* TAB 2: STATION POSTER & QR CODE GENERATOR */}
      {activeTab === 'poster' && (
        <div className="bento-card bg-card p-6 md:p-10 rounded-[2.5rem] border border-border space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-accent">
                Physical Signage & Bay Posters
              </span>
              <h3 className="text-2xl font-black text-text-main uppercase tracking-tight mt-1">
                Station QR Code Deployment
              </h3>
              <p className="text-xs text-text-dim lowercase mt-1">
                Print and mount these QR posters at your wash entrance or individual wash bays.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => window.print()}
                className="bg-accent text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:brightness-110 shadow-lg shadow-accent/20 transition flex items-center gap-2"
              >
                <Printer size={14} /> Print Sign
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            {/* Poster Configuration Controls */}
            <div className="space-y-5">
              <div>
                <label className="text-[10px] font-black text-text-dim uppercase tracking-widest block mb-2">
                  Select Wash Station
                </label>
                <select
                  value={posterStation}
                  onChange={(e) => setPosterStation(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-xs font-bold text-text-main outline-none focus:border-accent"
                >
                  {stationList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.location || 'Wash Location'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black text-text-dim uppercase tracking-widest block mb-2">
                  Bay Label / Number
                </label>
                <input
                  type="text"
                  value={posterBay}
                  onChange={(e) => setPosterBay(e.target.value)}
                  placeholder="e.g. Bay 1 (Express Lane)"
                  className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-xs font-bold text-text-main outline-none focus:border-accent"
                />
              </div>

              <div className="p-4 bg-bg rounded-2xl border border-border space-y-2 text-xs">
                <span className="text-[9px] font-black uppercase text-accent tracking-widest block">
                  Encapsulated QR Payload
                </span>
                <p className="text-[11px] text-text-dim font-mono break-all leading-relaxed bg-card p-3 rounded-xl border border-border">
                  {JSON.stringify({
                    protocol: 'autolux-wash',
                    stationId: posterStation,
                    bay: posterBay,
                    stationName: stationList.find(s => s.id === posterStation)?.name || 'AutoLux'
                  })}
                </p>
              </div>

              <button
                onClick={() => {
                  const selected = stationList.find(s => s.id === posterStation) || demoStations[0];
                  handleDecodedQr(JSON.stringify({
                    protocol: 'autolux-wash',
                    stationId: selected.id,
                    stationName: selected.name,
                    location: selected.location,
                    bay: posterBay,
                    pricing: selected.pricing || { sedan: 2500, suv: 3500, truck: 5000 }
                  }));
                  setActiveTab('scan');
                }}
                className="w-full bg-text-main text-bg hover:bg-accent hover:text-white py-3.5 rounded-xl font-black text-xs uppercase tracking-widest transition flex items-center justify-center gap-2"
              >
                <Zap size={16} /> Test Scan This Poster Now
              </button>
            </div>

            {/* Printable Sign Preview Card */}
            <div className="flex flex-col items-center justify-center p-8 bg-white text-black rounded-[2rem] shadow-2xl border-4 border-black/10 text-center">
              <div className="w-12 h-12 rounded-xl bg-black text-white flex items-center justify-center mb-3">
                <Car size={26} />
              </div>
              <h2 className="text-2xl font-black uppercase tracking-tight text-black">
                {stationList.find(s => s.id === posterStation)?.name || 'AutoLux Wash'}
              </h2>
              <div className="inline-block bg-black text-white px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest mt-1 mb-4">
                {posterBay}
              </div>

              {/* QR Image */}
              {posterQrUrl ? (
                <div className="p-3 bg-white rounded-2xl border-2 border-black/20 shadow-md mb-4">
                  <img src={posterQrUrl} alt="Station Bay QR Code" className="w-56 h-56 object-contain" />
                </div>
              ) : (
                <div className="w-56 h-56 bg-black/5 rounded-2xl flex items-center justify-center text-xs">
                  Generating QR...
                </div>
              )}

              <p className="text-xs font-black uppercase tracking-wider text-black/70 mb-1">
                Scan to Check-In & Pay
              </p>
              <p className="text-[10px] text-black/50 max-w-xs leading-tight">
                Point your phone camera to start wash session or complete checkout with Paystack.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Modal Container for Quick Launch from Header / Mobile Bar
export function StationQrModal({
  isOpen,
  onClose,
  profile,
  onNavigate
}: {
  isOpen: boolean;
  onClose: () => void;
  profile: any;
  onNavigate?: (view: any) => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 md:p-6 bg-black/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-4xl bg-card border border-border p-4 md:p-8 rounded-[3rem] shadow-2xl max-h-[92vh] overflow-y-auto scrollbar-hide"
      >
        <StationQrScanner
          profile={profile}
          onNavigate={(view) => {
            onClose();
            if (onNavigate) onNavigate(view);
          }}
          onClose={onClose}
          embedded={true}
        />
      </motion.div>
    </div>
  );
}
