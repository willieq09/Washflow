import React, { useState, useEffect } from 'react';
import { 
  auth, db, OperationType, handleFirestoreError 
} from './lib/firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { 
  doc, getDoc, setDoc, collection, query, where, orderBy, onSnapshot, addDoc, limit, serverTimestamp, Timestamp, updateDoc, Query, DocumentData
} from 'firebase/firestore';
import { 
  Car, TrendingUp, Users, LogOut, Plus, Star, Award, ChevronRight, Gauge, Briefcase, DollarSign, Check, Share2, Filter, Calendar, ArrowUp, ArrowDown, X, Camera, RefreshCw, CreditCard, Sparkles, ShieldCheck, Zap, ShoppingBag, MapPin, Settings2, Info, Bell, Search, Heart, Store
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency, calculateDistance } from './lib/utils';
import ReactMarkdown from 'react-markdown';
import { getMaintenanceTip, scanVehicleInfo, getPredictiveTips, generateAnalyticsReport, getWeatherOptimizedSchedule } from './services/geminiService';

// --- Types ---
interface UserProfile {
  uid: string;
  name: string;
  role: 'owner' | 'worker' | 'customer';
  email: string;
  photoUrl?: string;
  plan?: 'starter' | 'standard' | 'elite';
  businessLat?: number;
  businessLng?: number;
  businessRadius?: number;
  vehicles?: { make: string; model: string; year: number; plate: string; intensity: 'low' | 'high' }[];
}

interface Business {
  id: string;
  name: string;
  location: string;
  rating: number;
  ratingCount: number;
  ownerUid: string;
  image: string;
}

interface MarketplaceItem {
  id: string;
  name: string;
  price: number;
  category: 'accessory' | 'part' | 'service';
  image: string;
  vendor: string;
}

interface WashJob {
  id: string;
  workerId: string;
  workerName: string;
  carModel: string;
  plateNumber: string;
  price: number;
  timestamp: Timestamp | null;
  status: 'completed';
  workerRating?: number;
  businessRating?: number;
  review?: string;
  maintenanceTip?: string;
  isPending?: boolean;
}

interface Incentive {
  id: string;
  workerId: string;
  amount: number;
  reason: string;
  timestamp: Timestamp;
}

// --- Components ---

// --- Utils ---
const Logger = {
  log: (...args: any[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[WASHFLOW]', ...args);
    }
  },
  error: (...args: any[]) => {
    console.error('[WASHFLOW ERROR]', ...args);
    // Here you would typically send to Sentry or another error reporting tool
  }
};

function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const handleError = (e: ErrorEvent) => {
      Logger.error(e.error);
      setError(e.error);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-6 font-sans">
        <div className="max-w-md w-full bg-card rounded-[2.5rem] border border-red-500/20 shadow-2xl p-10 text-center">
          <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-3xl flex items-center justify-center mx-auto mb-8">
            <X size={40} />
          </div>
          <h2 className="text-3xl font-black text-white uppercase tracking-tighter mb-4">Application Crash</h2>
          <p className="text-text-dim text-sm mb-8 leading-relaxed lowercase">We've encountered a critical error. The tracking systems have logged the incident for review.</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-white text-bg font-black py-4 rounded-2xl hover:bg-red-500 hover:text-white transition-all uppercase tracking-widest text-xs"
          >
            Reboot Interface
          </button>
          
          <details className="mt-8 text-left">
            <summary className="text-[10px] font-black uppercase text-text-dim/40 cursor-pointer hover:text-text-dim transition">Technical Core Dump</summary>
            <pre className="mt-4 p-4 bg-bg border border-border text-[10px] text-red-400 font-mono rounded-xl overflow-auto max-h-40 lowercase">
              {error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  const [user, setUser] = useState(auth.currentUser);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [view, setView] = useState<'dashboard' | 'log' | 'history' | 'performance' | 'billing' | 'marketplace' | 'my-cars' | 'settings'>('dashboard');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingSync, setPendingSync] = useState(0);

  const rateJobId = new URLSearchParams(window.location.search).get('rate');

  useEffect(() => {
    if (!user) {
      setPendingSync(0);
      return;
    }
    
    // Track pending writes in the foreground
    const q = query(collection(db, 'washes'), orderBy('timestamp', 'desc'), limit(20));
    return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      const pending = snap.docs.filter(doc => doc.metadata.hasPendingWrites).length;
      setPendingSync(pending);
    });
  }, [user]);

  useEffect(() => {
    const handleStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatus);
    window.addEventListener('offline', handleStatus);
    return () => {
      window.removeEventListener('online', handleStatus);
      window.removeEventListener('offline', handleStatus);
    };
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      try {
        setUser(u);
        if (u) {
          const docRef = doc(db, 'users', u.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setProfile(docSnap.data() as UserProfile);
          } else {
            const isOwnerEmail = u.email === 'oumawillis09@gmail.com';
            // Provide base info, but don't set role yet (unless superadmin)
            const newProfile: any = {
              uid: u.uid,
              name: u.displayName || 'Anonymous User',
              email: u.email || '',
              role: isOwnerEmail ? 'owner' : null,
              photoUrl: u.photoURL || null
            };
            if (isOwnerEmail) {
               await setDoc(docRef, { ...newProfile, role: 'owner', createdAt: serverTimestamp() });
            }
            setProfile(newProfile);
          }
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error("Auth handler error:", error);
      } finally {
        setLoading(false);
        setAuthLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get('success');
    const plan = params.get('plan') as 'starter' | 'standard' | 'elite';
    
    if (success === 'true' && plan && profile && profile.role === 'owner') {
      updateDoc(doc(db, 'users', profile.uid), { plan }).then(() => {
        setProfile(prev => prev ? { ...prev, plan } : null);
        window.history.replaceState({}, '', window.location.pathname);
      });
    }
  }, [profile]);

  const login = async () => {
    setAuthLoading(true);
    const provider = new GoogleAuthProvider();
    // Force select_account to ensure the popup requires explicit interaction
    provider.setCustomParameters({ prompt: 'select_account' });
    
    try {
      // Ensure local persistence is set before login
      await setPersistence(auth, browserLocalPersistence);
      const result = await signInWithPopup(auth, provider);
      console.log("Manual authentication success:", result.user.email);
    } catch (error: any) {
      console.error("Login failed:", error);
      setAuthLoading(false);
      
      let message = "Authentication failed. ";
      
      if (error.code === 'auth/popup-blocked') {
        message += "The login popup was blocked by your browser. Please enable popups and try again.";
      } else if (error.code === 'auth/unauthorized-domain') {
        message += "This domain is not authorized in your Firebase console. Please add 'run.app' and your specific App URL to the Authorized Domains list in Firebase Authentication settings.";
      } else if (error.code === 'auth/popup-closed-by-user') {
        message += "The login window was closed before completion.";
      } else {
        message += error.message || "Unknown error";
      }
      
      alert(message);
    }
  };

  const logout = () => signOut(auth);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <motion.div 
        animate={{ scale: [1, 1.2, 1], rotate: [0, 10, 0] }}
        transition={{ repeat: Infinity, duration: 1.5 }}
        className="flex flex-col items-center gap-4"
      >
        <Car className="w-12 h-12 text-accent" />
        <span className="font-black text-text-dim uppercase tracking-[0.3em] text-xs">Booting OS...</span>
      </motion.div>
    </div>
  );

  if (rateJobId) {
    return (
      <ErrorBoundary>
        <div className="min-h-screen bg-bg p-6 flex items-center justify-center">
          <CustomerRatingView jobId={rateJobId} />
        </div>
      </ErrorBoundary>
    );
  }

  if (!user) return <LandingPage onLogin={login} authLoading={authLoading} />;

  if (profile && !profile.role) {
    return <RoleSelection uid={profile.uid} name={profile.name} email={profile.email} />;
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-bg flex flex-col md:flex-row">
        {/* Sidebar */}
        <nav className="w-full md:w-64 bg-card border-b md:border-r border-border p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-10">
              <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center text-white shadow-lg shadow-accent/20">
                <Car className="w-6 h-6" />
              </div>
              <span className="text-xl font-bold text-white tracking-tight">WashFlow</span>
            </div>

            <div className="space-y-1">
              {profile?.role === 'customer' ? (
                <>
                  <NavItem icon={<Search size={20} />} label="Explore" active={view === 'marketplace'} onClick={() => setView('marketplace')} />
                  <NavItem icon={<Car size={20} />} label="My Vehicles" active={view === 'my-cars'} onClick={() => setView('my-cars')} />
                  <NavItem icon={<Briefcase size={20} />} label="History" active={view === 'history'} onClick={() => setView('history')} />
                </>
              ) : (
                <>
                  <NavItem icon={<Gauge size={20} />} label="Dashboard" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
                  <NavItem icon={<Plus size={20} />} label="Log Wash" active={view === 'log'} onClick={() => setView('log')} />
                  <NavItem icon={<Briefcase size={20} />} label="History" active={view === 'history'} onClick={() => setView('history')} />
                </>
              )}
              {profile?.role === 'owner' && (
                <>
                  <NavItem 
                    icon={<Users size={20} />} 
                    label="Team" 
                    active={view === 'performance'} 
                    onClick={() => {
                      if (profile.plan === 'standard' || profile.plan === 'elite') {
                        setView('performance');
                      } else {
                        setView('billing');
                      }
                    }} 
                  />
                  <NavItem 
                    icon={<CreditCard size={20} />} 
                    label="Subscription" 
                    active={view === 'billing'} 
                    onClick={() => setView('billing')} 
                  />
                </>
              )}
            </div>
          </div>

          <div className="mt-auto border-t border-border pt-6">
            <div className="flex items-center gap-3 px-2 mb-6">
              <img src={profile?.photoUrl} className="w-10 h-10 rounded-full border border-border" />
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-white leading-none">{profile?.name}</span>
                <span className="text-xs text-text-dim mt-1 capitalize">{profile?.role}</span>
              </div>
            </div>
            
            <div className="px-2 mb-4">
              <SyncStatus isOnline={isOnline} pendingCount={pendingSync} />
            </div>

            {profile.role === 'owner' && (
              <NavItem 
                icon={<Settings2 size={18} />} 
                label="Settings" 
                active={view === 'settings'} 
                onClick={() => setView('settings')} 
              />
            )}
            <button 
              onClick={logout}
              className="w-full flex items-center gap-2 px-2 py-2 text-text-dim hover:text-red-500 transition"
            >
              <LogOut size={18} />
              <span className="text-sm font-medium">Log out</span>
            </button>
          </div>
        </nav>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <AnimatePresence mode="wait">
            {view === 'dashboard' && profile && (
              <DashboardView profile={profile} onLogWash={() => setView('log')} />
            )}
            {view === 'log' && profile && (
              <LogWashForm profile={profile} onComplete={() => setView('history')} setView={setView} />
            )}
            {view === 'history' && profile && (
              <HistoryView profile={profile} />
            )}
            {view === 'performance' && profile?.role === 'owner' && (
              <OwnerPerformanceView />
            )}
            {view === 'billing' && profile?.role === 'owner' && (
              <SubscriptionView profile={profile} />
            )}
            {view === 'marketplace' && <MarketplaceView profile={profile!} />}
            {view === 'settings' && profile?.role === 'owner' && (
              <SettingsView profile={profile} onUpdate={(p) => setProfile(p)} />
            )}
            {view === 'my-cars' && <CustomerVehicleView profile={profile!} onUpdate={(p) => setProfile(p)} />}
          </AnimatePresence>
        </main>
      </div>
    </ErrorBoundary>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition duration-200 group text-sm font-medium",
        active ? "bg-accent/10 text-accent shadow-sm" : "text-text-dim hover:bg-white/5 hover:text-white"
      )}
    >
      <span className={cn("transition", active ? "text-accent" : "text-text-dim group-hover:text-white")}>{icon}</span>
      {label}
    </button>
  );
}

function Skeleton({ className, ...props }: { className?: string; [key: string]: any }) {
  return <div className={cn("animate-pulse bg-white/5 rounded-xl", className)} {...props} />;
}

function SyncStatus({ isOnline, pendingCount }: { isOnline: boolean, pendingCount: number }) {
  const isSyncing = pendingCount > 0;
  
  return (
    <div className={cn(
      "flex flex-col gap-2 p-3 rounded-xl border transition-all duration-300",
      !isOnline 
        ? "bg-red-500/10 border-red-500/20" 
        : isSyncing 
          ? "bg-accent/10 border-accent/20" 
          : "bg-success/5 border-success/20"
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-2 h-2 rounded-full",
            !isOnline ? "bg-red-500 animate-pulse" : isSyncing ? "bg-accent animate-spin" : "bg-success"
          )} />
          <span className={cn(
            "text-[10px] font-black uppercase tracking-widest",
            !isOnline ? "text-red-500" : isSyncing ? "text-accent" : "text-success"
          )}>
            {!isOnline ? "Offline Mode" : isSyncing ? "Syncing..." : "Synced"}
          </span>
        </div>
        {pendingCount > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent/20 text-accent">
            {pendingCount}
          </span>
        )}
      </div>
      
      {!isOnline && (
        <p className="text-[9px] text-red-500/70 font-medium leading-tight">
          Logs are being queued locally and will sync when reconnected.
        </p>
      )}
      {isOnline && isSyncing && (
        <p className="text-[9px] text-accent/70 font-medium leading-tight">
          Uploading queued data to the ledger...
        </p>
      )}
    </div>
  );
}


function LandingPage({ onLogin, authLoading }: { onLogin: () => void, authLoading: boolean }) {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6 text-white text-center">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl w-full"
      >
        <div className="inline-flex items-center justify-center w-20 h-20 bg-accent rounded-3xl mb-10 shadow-2xl shadow-accent/20 rotate-3">
          <Car size={40} />
        </div>
        <h1 className="text-6xl md:text-8xl font-black mb-8 tracking-tighter uppercase italic leading-none">
          WASHFLOW <br />
          <span className="text-accent not-italic">OPERATING SYSTEM.</span>
        </h1>
        <p className="text-xl text-text-dim mb-12 max-w-xl mx-auto font-medium">
          The transparency layer for car wash hubs. Track, incentivize, and scale with real-time AI insights.
        </p>
        <button 
          onClick={onLogin}
          disabled={authLoading}
          className="bg-white text-bg px-10 py-5 rounded-2xl font-black flex items-center gap-4 mx-auto hover:bg-accent hover:text-white transition-all shadow-xl active:scale-95 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {authLoading ? (
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-bg border-t-transparent rounded-full animate-spin" />
              <span>Authenticating...</span>
            </div>
          ) : (
            <>
              <img src="https://www.google.com/favicon.ico" className="w-6 h-6" />
              Authenticate Session
            </>
          )}
        </button>
        {authLoading && (
          <div className="mt-8 p-6 bg-accent/10 border border-accent/20 rounded-2xl max-w-lg mx-auto">
            <p className="text-sm text-accent font-black animate-pulse mb-4 tracking-wide uppercase">
              Authentication in progress...
            </p>
            <div className="text-left space-y-3">
              <p className="text-xs text-text-dim leading-relaxed">
                <span className="text-white font-bold">1. Blocked Popup?</span> Check your browser's address bar for a "popup blocked" icon and permit it.
              </p>
              <p className="text-xs text-text-dim leading-relaxed">
                <span className="text-white font-bold">2. Iframe Restricted?</span> If the popup closes immediately, try opening the app in a 
                <span className="text-white font-bold"> New Tab</span> using the icon in the top right of the preview.
              </p>
              <p className="text-xs text-text-dim leading-relaxed font-mono">
                <span className="text-white font-bold">3. Authorized Domain?</span> Ensure <code className="bg-white/10 px-1 rounded">run.app</code> is added to the 
                Authorized Domains in your Firebase Auth settings.
              </p>
            </div>
          </div>
        )}
        
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <FeatureCard title="Transparency" desc="Stop revenue leakage. Every wash is recorded instantly." />
          <FeatureCard title="Feedback" desc="Direct customer-to-worker rating loop for performance audit." />
          <FeatureCard title="Resilience" desc="Built-in offline support and real-time ledger synchronization." />
        </div>
      </motion.div>
    </div>
  );
}

function FeatureCard({ title, desc }: { title: string, desc: string }) {
  return (
    <div className="bento-card">
      <h3 className="font-bold text-white mb-2">{title}</h3>
      <p className="text-sm text-text-dim leading-relaxed">{desc}</p>
    </div>
  );
}

// --- View Components ---

function DashboardView({ profile, onLogWash }: { profile: UserProfile, onLogWash: () => void }) {
  const [stats, setStats] = useState({ todayRevenue: 0, todayCount: 0, totalCount: 0, incentives: 0 });
  const [recentWashes, setRecentWashes] = useState<WashJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const handleViewReport = async () => {
    setReportLoading(true);
    try {
      const result = await generateAnalyticsReport(stats, recentWashes);
      setReport(result);
    } catch (error) {
      console.error("Report generation failed:", error);
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => {
    const q = profile.role === 'owner' 
      ? query(collection(db, 'washes'), orderBy('timestamp', 'desc'), limit(50))
      : query(collection(db, 'washes'), where('workerId', '==', profile.uid), orderBy('timestamp', 'desc'), limit(50));

    return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      const washes = snap.docs.map(d => ({ 
        id: d.id, 
        ...d.data(), 
        isPending: d.metadata.hasPendingWrites 
      } as WashJob));
      setRecentWashes(washes.slice(0, 10));
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayWashes = washes.filter(w => w.timestamp?.toDate() >= today);
      
      const rev = todayWashes.reduce((acc, curr) => acc + curr.price, 0);
      setStats({ 
        todayRevenue: rev, 
        todayCount: todayWashes.length,
        totalCount: washes.length,
        incentives: 0
      });
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'washes');
      setLoading(false);
    });
  }, [profile]);

  useEffect(() => {
    if (profile.role === 'worker') {
      const q = query(collection(db, 'incentives'), where('workerId', '==', profile.uid));
      return onSnapshot(q, (snap) => {
        const total = snap.docs.reduce((acc, curr) => acc + (curr.data().amount || 0), 0);
        setStats(prev => ({ ...prev, incentives: total }));
      });
    }
  }, [profile]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
        <header className="flex justify-between items-end">
          <div className="space-y-3">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-8 w-32 rounded-full" />
        </header>
        <div className="grid grid-cols-1 md:grid-cols-4 md:grid-rows-2 gap-4 h-[500px]">
          <Skeleton className="md:col-span-2 md:row-span-1" />
          <Skeleton className="md:col-span-1" />
          <Skeleton className="md:col-span-1" />
          <Skeleton className="md:col-span-2" />
          <Skeleton className="md:col-span-2" />
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-6xl mx-auto">
      <header className="mb-10 flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-black text-white tracking-tight">WashFlow Dashboard</h2>
          <p className="text-text-dim mt-1">{profile.role === 'owner' ? 'Administrative Control' : 'Personal Performance'}</p>
        </div>
        <div className="hidden md:flex items-center gap-2 bg-success/10 text-success border border-success/20 px-3 py-1.5 rounded-full text-xs font-bold">
          <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
          System Active
        </div>
      </header>

      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-4 md:grid-rows-2 gap-4 auto-rows-fr">
        {/* Main Stat: Today's Revenue */}
        <div className="md:col-span-2 md:row-span-1 bento-card flex flex-col justify-between border-t-4 border-t-accent">
          <div>
            <span className="text-[10px] font-black text-accent uppercase tracking-[0.2em]">
              {profile.role === 'worker' ? "Personal Unit Output" : "Live: Today's Revenue"}
            </span>
            <div className="text-6xl font-black mt-2 tracking-tighter">{formatCurrency(stats.todayRevenue)}</div>
            <p className="text-xs text-text-dim mt-2 font-medium">Synced from {stats.todayCount} service units completed today.</p>
          </div>
          <div className="mt-6 flex items-end gap-1.5 h-16">
            {[30, 45, 20, 60, 40, 75, 95].map((h, i) => (
              <div 
                key={i} 
                className={cn("flex-1 rounded-t-lg transition-all duration-700", i === 6 ? "bg-accent shadow-[0_0_15px_rgba(62,99,221,0.5)]" : "bg-accent/20")} 
                style={{ height: `${h}%` }} 
              />
            ))}
          </div>
        </div>

        {/* Counter Stat or Incentives for Workers */}
        <div className="md:col-span-1 bento-card flex flex-col justify-between">
          {profile.role === 'worker' ? (
            <>
              <div>
                <span className="text-[10px] font-black text-text-dim uppercase tracking-[0.2em]">Earned Bonuses</span>
                <div className="text-5xl font-black mt-2 tracking-tighter text-success">{formatCurrency(stats.incentives)}</div>
              </div>
              <div className="mt-4">
                <div className="text-[10px] font-bold text-success flex items-center gap-1">
                  <Award size={12} />
                  <span>Performance Incentive</span>
                </div>
                <p className="text-[9px] text-text-dim mt-1 lowercase">Calculated from peak efficiency and quality ratings.</p>
              </div>
            </>
          ) : (
            <>
              <div>
                <span className="text-[10px] font-black text-text-dim uppercase tracking-[0.2em]">Volume (24h)</span>
                <div className="text-5xl font-black mt-2 tracking-tighter text-white">{stats.todayCount}</div>
              </div>
              <div className="mt-4">
                <div className="text-[10px] font-bold text-success flex items-center gap-1">
                  <TrendingUp size={12} />
                  <span>Scaling up</span>
                </div>
                <div className="w-full bg-white/5 h-1 rounded-full mt-2 overflow-hidden">
                    <div className="bg-success h-full w-[65%]" />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Action Card */}
        <div 
          onClick={onLogWash}
          className="md:col-span-1 bento-card bg-accent border-none flex flex-col items-center justify-center text-center cursor-pointer hover:bg-accent/90 active:scale-95 group"
        >
           <div className="w-12 h-12 rounded-full border-2 border-white/20 flex items-center justify-center text-white mb-3 group-hover:scale-110 transition">
             <Plus size={24} />
           </div>
           <div className="font-bold text-lg">New Wash</div>
           <div className="text-[10px] text-white/70 uppercase tracking-widest mt-1">Quick Log</div>
        </div>

        {/* AI Insight Card */}
        <div className="md:col-span-2 bento-card">
           <span className="text-xs font-bold text-text-dim uppercase tracking-wider mb-4 block">AI Intelligence</span>
           <div className="bg-accent/5 border border-accent/20 rounded-xl p-4">
             <p className="text-sm leading-relaxed text-blue-100">
               <strong>Smart Suggestion:</strong> Based on current volume, worker performance is peaking. High satisfaction triggers incentive bonuses automatically.
             </p>
             <button 
               onClick={handleViewReport}
               disabled={reportLoading}
               className="text-xs font-bold text-accent mt-3 flex items-center gap-1 hover:underline disabled:opacity-50"
             >
               {reportLoading ? (
                 <RefreshCw size={14} className="animate-spin" />
               ) : (
                 <ChevronRight size={14} />
               )}
               {reportLoading ? "Analyzing..." : "View analytics report"}
             </button>
           </div>
        </div>

        <AnimatePresence>
          {report && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-bg/80 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-card border border-border w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden"
              >
                <div className="p-8 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-accent/20 rounded-xl flex items-center justify-center text-accent">
                      <TrendingUp size={20} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white uppercase tracking-tighter">AI Performance Audit</h3>
                      <p className="text-[10px] text-accent font-black uppercase tracking-widest">Generative Intelligence Report</p>
                    </div>
                  </div>
                  <button onClick={() => setReport(null)} className="p-2 hover:bg-white/5 rounded-full transition">
                    <X size={20} className="text-text-dim" />
                  </button>
                </div>
                <div className="p-8 max-h-[60vh] overflow-y-auto custom-scrollbar">
                  <div className="prose prose-invert max-w-none text-white/80">
                    <ReactMarkdown
                      components={{
                        h1: ({ children }) => <h1 className="text-2xl font-black text-white uppercase tracking-tighter mb-6 mt-2 pb-2 border-b border-white/10">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-xl font-bold text-accent uppercase tracking-widest mt-8 mb-4">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-lg font-bold text-white mb-2">{children}</h3>,
                        p: ({ children }) => <p className="mb-4 leading-relaxed text-sm font-medium">{children}</p>,
                        ul: ({ children }) => <ul className="space-y-3 mb-6">{children}</ul>,
                        li: ({ children }) => (
                          <li className="flex gap-3 text-sm">
                            <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                            <span>{children}</span>
                          </li>
                        ),
                        strong: ({ children }) => <span className="text-white font-bold">{children}</span>,
                      }}
                    >
                      {report}
                    </ReactMarkdown>
                  </div>
                </div>
                <div className="p-8 bg-bg/50 border-t border-border flex justify-end">
                  <button 
                    onClick={() => setReport(null)}
                    className="bg-white text-bg px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-accent hover:text-white transition"
                  >
                    Acknowledge Report
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Activity Feed in Bento style */}
        <div className="md:col-span-2 bento-card overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-text-dim uppercase tracking-wider">Live Feed</span>
            <button className="text-[10px] font-bold text-accent hover:underline">See full log</button>
          </div>
          <div className="space-y-3">
            {recentWashes.slice(0, 3).map(wash => (
              <div key={wash.id} className="flex items-center justify-between text-sm group">
                <div className="flex items-center gap-3">
                  <div className={cn("w-1.5 h-1.5 rounded-full", wash.isPending ? "bg-accent animate-pulse" : "bg-accent")} />
                  <span className="font-medium">{wash.carModel}</span>
                  <span className="text-text-dim text-xs select-none">•</span>
                  <span className="text-text-dim text-xs font-mono">{wash.plateNumber}</span>
                  {wash.isPending && <RefreshCw size={10} className="text-accent animate-spin" />}
                </div>
                <span className="text-xs text-text-dim group-hover:text-white transition">
                  {wash.isPending ? "Queued" : wash.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
            {recentWashes.length === 0 && (
              <p className="text-xs italic text-text-dim">No activity yet...</p>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function RoleSelection({ uid, name, email }: { uid: string, name: string, email: string }) {
  const [loading, setLoading] = useState<string | null>(null);

  const setRole = async (role: 'owner' | 'customer' | 'worker') => {
    setLoading(role);
    try {
      const userData: any = {
        uid,
        name,
        email,
        role,
        createdAt: serverTimestamp(),
      };
      
      if (role === 'owner') {
        userData.plan = 'starter';
      }

      await setDoc(doc(db, 'users', uid), userData, { merge: true });
      
      // We use a small delay and a reload to ensure Firestore syncs 
      // and the auth state refresh picks up the new document.
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error: any) {
      console.error("Role Error:", error);
      alert(`Could not set role: ${error.message}`);
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-accent/5 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="max-w-6xl w-full z-10">
        <header className="text-center mb-16">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-flex items-center gap-2 bg-accent/10 border border-accent/20 px-4 py-2 rounded-full mb-6"
          >
            <Sparkles size={14} className="text-accent" />
            <span className="text-[10px] font-black uppercase text-accent tracking-widest">Identify Your Role</span>
          </motion.div>
          <h2 className="text-5xl md:text-7xl font-black text-white tracking-tighter uppercase mb-4 leading-none">
            Choose Your <br />
            <span className="text-accent">Operation Mode.</span>
          </h2>
          <p className="text-text-dim max-w-lg mx-auto lowercase font-medium">Select the path that matches your position in the vehicle transparency ecosystem.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <RoleCard 
            icon={<Briefcase size={40} />} 
            title="Business Owner" 
            desc="Manage stations, monitor teams, and scale your wash empire with AI insight."
            onClick={() => setRole('owner')}
            loading={loading === 'owner'}
            disabled={loading !== null}
          />
          <RoleCard 
            icon={<Car size={40} />} 
            title="Car Owner" 
            desc="Personalized maintenance logs, AI health alerts, and verified wash history."
            onClick={() => setRole('customer')}
            loading={loading === 'customer'}
            disabled={loading !== null}
            highlight
          />
          <RoleCard 
            icon={<Users size={40} />} 
            title="Wash Worker" 
            desc="Log jobs instantly, verify plates, and track your performance rewards."
            onClick={() => setRole('worker')}
            loading={loading === 'worker'}
            disabled={loading !== null}
          />
        </div>
      </div>
    </div>
  );
}

function RoleCard({ icon, title, desc, onClick, highlight, loading, disabled }: { icon: any, title: string, desc: string, onClick: () => void, highlight?: boolean, loading?: boolean, disabled?: boolean }) {
  return (
    <motion.button
      whileHover={!disabled ? { y: -10, scale: 1.02 } : {}}
      whileTap={!disabled ? { scale: 0.98 } : {}}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group p-10 rounded-[3rem] border text-left flex flex-col items-start transition-all duration-500 relative overflow-hidden",
        highlight 
          ? "bg-white border-transparent text-bg shadow-2xl shadow-white/10" 
          : "bg-card border-border text-white hover:border-accent/40",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {loading && (
        <div className="absolute inset-0 bg-accent/20 backdrop-blur-sm flex items-center justify-center z-20">
          <RefreshCw className="w-10 h-10 text-white animate-spin" />
        </div>
      )}
      
      <div className={cn(
        "w-24 h-24 rounded-[2rem] flex items-center justify-center mb-12 transition-transform duration-500 group-hover:rotate-6", 
        highlight ? "bg-bg text-white" : "bg-white/5 text-accent"
      )}>
        {icon}
      </div>
      
      <h3 className="text-3xl font-black mb-4 uppercase tracking-tighter leading-none">{title}</h3>
      <p className={cn(
        "text-sm leading-relaxed mb-10 font-medium", 
        highlight ? "text-bg/60" : "text-text-dim lowercase"
      )}>
        {desc}
      </p>
      
      <div className={cn(
        "mt-auto flex items-center gap-3 text-sm font-black uppercase tracking-widest", 
        highlight ? "text-accent" : "text-white group-hover:text-accent transition-colors"
      )}>
        initialize system <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
      </div>
    </motion.button>
  );
}

function MarketplaceView({ profile }: { profile: UserProfile }) {
  const businesses: Business[] = [
    { id: 'b1', name: "Elite Shine Studio", location: "Downtown Central", rating: 4.9, ratingCount: 128, ownerUid: '1', image: 'https://picsum.photos/seed/wash1/800/600' },
    { id: 'b2', name: "HydroFlow Auto", location: "North Industrial Park", rating: 4.7, ratingCount: 84, ownerUid: '2', image: 'https://picsum.photos/seed/wash2/800/600' },
    { id: 'b3', name: "Splash City", location: "Coastal Road", rating: 4.5, ratingCount: 220, ownerUid: '3', image: 'https://picsum.photos/seed/wash3/800/600' },
  ];

  const items: MarketplaceItem[] = [
    { id: 'i1', name: "Ultra-Soft Microfiber Set", price: 25, category: 'accessory', vendor: "CleanCo", image: 'https://picsum.photos/seed/acc1/800/600' },
    { id: 'i2', name: "Ceramic Coating Kit", price: 85, category: 'accessory', vendor: "ShineArmor", image: 'https://picsum.photos/seed/acc2/800/600' },
    { id: 'i3', name: "Hydraulic Jack Stand", price: 120, category: 'part', vendor: "ToolPro", image: 'https://picsum.photos/seed/part1/800/600' },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-12 pb-20">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 bg-card p-10 rounded-[3rem] border border-border">
        <div>
          <h2 className="text-4xl font-black text-white uppercase tracking-tighter mb-2">Explore the Ecosystem.</h2>
          <p className="text-text-dim text-lg lowercase leading-relaxed max-w-xl">Find top-rated wash stations, professional auto products, and specialized services near you.</p>
        </div>
        <div className="flex bg-bg rounded-2xl border border-border p-2 min-w-[300px]">
          <Search className="text-text-dim mx-3 self-center" size={20} />
          <input type="text" placeholder="Search washes, parts, accessories..." className="bg-transparent border-none text-white focus:ring-0 placeholder:text-text-dim/50 text-sm py-3 w-full" />
        </div>
      </header>

      <section>
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl font-black text-white uppercase tracking-widest flex items-center gap-2">
            <Store className="text-accent" /> Top Rated Stations
          </h3>
          <button className="text-[10px] font-black uppercase text-accent tracking-[0.2em] border-b border-accent/20 pb-1">View All</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {businesses.map(b => (
            <motion.div key={b.id} whileHover={{ y: -5 }} className="bg-card rounded-[2rem] border border-border overflow-hidden group">
              <div className="h-48 overflow-hidden relative">
                <img src={b.image} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" referrerPolicy="no-referrer" />
                <div className="absolute top-4 right-4 bg-bg/60 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-black text-white">
                  <Star size={12} className="text-yellow-400 fill-yellow-400" /> {b.rating}
                </div>
              </div>
              <div className="p-6">
                <h4 className="text-lg font-black text-white uppercase mb-1">{b.name}</h4>
                <div className="flex items-center gap-1.5 text-text-dim text-xs mb-6">
                  <MapPin size={12} /> {b.location}
                </div>
                <button className="w-full bg-white text-bg py-3 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-accent hover:text-white transition">
                  Book A Wash <ChevronRight size={14} />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl font-black text-white uppercase tracking-widest flex items-center gap-2">
            <ShoppingBag className="text-accent" /> Marketplace Picks
          </h3>
          <div className="flex gap-2">
             <FilterBtn label="Accessories" active />
             <FilterBtn label="Parts" />
             <FilterBtn label="Services" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {items.map(item => (
            <div key={item.id} className="group cursor-pointer">
              <div className="aspect-square bg-white rounded-3xl mb-4 overflow-hidden relative border border-border">
                <img src={item.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" referrerPolicy="no-referrer" />
                <div className="absolute bottom-4 left-4 bg-white px-3 py-1.5 rounded-xl font-black text-bg shadow-xl">
                  {formatCurrency(item.price)}
                </div>
              </div>
              <h4 className="text-sm font-bold text-white mb-1 group-hover:text-accent transition">{item.name}</h4>
              <p className="text-[10px] font-black uppercase text-text-dim tracking-widest">By {item.vendor}</p>
            </div>
          ))}
        </div>
      </section>
    </motion.div>
  );
}

function FilterBtn({ label, active }: { label: string, active?: boolean }) {
  return (
    <button className={cn(
      "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition border",
      active ? "bg-accent text-white border-transparent" : "bg-white/5 text-text-dim border-border hover:text-white"
    )}>
      {label}
    </button>
  );
}

function AIProactiveSchedule({ vehicle, washHistoryCount }: { vehicle: any, washHistoryCount: number }) {
  const [schedule, setSchedule] = useState<{ suggestion: string, reasoning: string, optimalDay: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulated weather forecast for the next 5 days
    const weatherForecast = "Partly cloudy with showers expected on Wednesday and Thursday. Sunny weekend ahead.";
    const lastWashDays = 4; // Mocked

    getWeatherOptimizedSchedule(vehicle, weatherForecast, lastWashDays).then(res => {
      setSchedule(res);
      setLoading(false);
    });
  }, [vehicle]);

  if (loading) return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 bg-white/20 rounded w-1/2" />
      <div className="h-20 bg-white/20 rounded-2xl w-full" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="bg-white/10 p-5 rounded-2xl border border-white/10">
        <div className="flex items-center gap-2 mb-3">
          <Calendar size={14} className="opacity-60" />
          <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Optimal Next Wash</span>
        </div>
        <p className="text-xl font-black uppercase tracking-tighter mb-1 leading-none">{schedule?.optimalDay}</p>
        <p className="text-[10px] font-bold opacity-80">{schedule?.suggestion}</p>
      </div>
      
      <div className="bg-white/10 p-5 rounded-2xl border border-white/10">
        <div className="flex items-center gap-2 mb-3">
          <Info size={14} className="opacity-60" />
          <span className="text-[10px] font-black uppercase tracking-widest opacity-60">AI Reasoning</span>
        </div>
        <p className="text-xs leading-relaxed font-medium italic">"{schedule?.reasoning}"</p>
      </div>

      <button className="w-full bg-bg text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-widest border border-white/20 hover:bg-white hover:text-bg transition mt-2">
        Book for {schedule?.optimalDay}
      </button>
    </div>
  );
}

function CustomerVehicleView({ profile, onUpdate }: { profile: UserProfile, onUpdate: (p: UserProfile) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [vehicles, setVehicles] = useState(profile.vehicles || []);
  const [newVehicle, setNewVehicle] = useState({ make: '', model: '', year: new Date().getFullYear(), plate: '', intensity: 'low' as 'low' | 'high' });
  const [saving, setSaving] = useState(false);
  const [predictive, setPredictive] = useState<{ nextWash: string, maintenance: string } | null>(null);

  useEffect(() => {
    if (vehicles.length > 0) {
      getPredictiveTips(vehicles[0], 4).then(setPredictive);
    }
  }, [vehicles]);

  const handleAddVehicle = async () => {
    if (!newVehicle.make || !newVehicle.model || !newVehicle.plate) {
      alert("Please fill all required fields.");
      return;
    }
    setSaving(true);
    try {
      const updatedVehicles = [...vehicles, newVehicle];
      await updateDoc(doc(db, 'users', profile.uid), { vehicles: updatedVehicles });
      onUpdate({ ...profile, vehicles: updatedVehicles });
      setVehicles(updatedVehicles);
      setShowAdd(false);
      setNewVehicle({ make: '', model: '', year: new Date().getFullYear(), plate: '', intensity: 'low' });
    } catch (error) {
      console.error("Error adding vehicle:", error);
      alert("Failed to add vehicle.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 pb-20">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-black text-white uppercase tracking-tighter">My Garage.</h2>
          <p className="text-text-dim text-sm lowercase">Manage your vehicles and track AI maintenance health.</p>
        </div>
        <button 
          onClick={() => setShowAdd(true)}
          className="bg-white text-bg px-6 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-accent hover:text-white transition flex items-center gap-2"
        >
           <Plus size={16} /> Add Vehicle
        </button>
      </header>

      <AnimatePresence>
        {showAdd && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-bg/90 backdrop-blur-xl">
             <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-card border border-border w-full max-w-md rounded-[2.5rem] p-10 space-y-8"
             >
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-black text-white uppercase italic">Vehicle Registry</h3>
                  <button onClick={() => setShowAdd(false)} className="p-2 hover:bg-white/5 rounded-full"><X size={20} className="text-text-dim" /></button>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-text-dim uppercase tracking-widest">Make</label>
                       <input value={newVehicle.make} onChange={e => setNewVehicle(v => ({ ...v, make: e.target.value }))} className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-sm text-white" placeholder="Toyota" />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-text-dim uppercase tracking-widest">Model</label>
                       <input value={newVehicle.model} onChange={e => setNewVehicle(v => ({ ...v, model: e.target.value }))} className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-sm text-white" placeholder="Camry" />
                    </div>
                  </div>
                  <div className="space-y-2">
                     <label className="text-[10px] font-black text-text-dim uppercase tracking-widest">Plate Number</label>
                     <input value={newVehicle.plate} onChange={e => setNewVehicle(v => ({ ...v, plate: e.target.value.toUpperCase() }))} className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-sm text-white" placeholder="ABC-1234" />
                  </div>
                  <div className="space-y-2">
                     <label className="text-[10px] font-black text-text-dim uppercase tracking-widest">Usage Intensity</label>
                     <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setNewVehicle(v =>({ ...v, intensity: 'low' }))} className={cn("py-3 rounded-xl text-[10px] font-black uppercase border", newVehicle.intensity === 'low' ? "bg-accent text-white border-transparent" : "bg-bg text-text-dim border-border")}>Weekend Driver</button>
                        <button onClick={() => setNewVehicle(v =>({ ...v, intensity: 'high' }))} className={cn("py-3 rounded-xl text-[10px] font-black uppercase border", newVehicle.intensity === 'high' ? "bg-accent text-white border-transparent" : "bg-bg text-text-dim border-border")}>High Usage</button>
                     </div>
                  </div>
                </div>

                <button 
                  onClick={handleAddVehicle}
                  disabled={saving}
                  className="w-full bg-white text-bg py-4 rounded-xl font-black uppercase tracking-widest hover:bg-accent hover:text-white transition disabled:opacity-50"
                >
                   {saving ? "Registering..." : "Add to Garage"}
                </button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {vehicles.length === 0 ? (
        <div className="bento-card py-20 text-center border-dashed">
          <Car size={40} className="text-text-dim mx-auto mb-6 opacity-20" />
          <h3 className="text-xl font-black text-white mb-4 uppercase tracking-tighter">Secure Your First Vehicle.</h3>
          <p className="text-text-dim text-sm mb-8 lowercase max-w-xs mx-auto text-balance">Add your car to unlock personal AI tips and usage-based scheduling predictions.</p>
          <button className="bg-white/5 border border-border text-white px-8 py-3 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition">
             Connect Vehicle Data
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {vehicles.map((v, i) => (
              <div key={i} className="bg-card p-8 rounded-[2.5rem] border border-border flex flex-col md:flex-row gap-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl pointer-events-none" />
                <div className="w-full md:w-1/3 aspect-video bg-white/5 rounded-3xl relative flex items-center justify-center overflow-hidden border border-border">
                  <Car size={48} className="text-accent/20" />
                </div>
                <div className="flex-1 flex flex-col justify-center">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="bg-accent/10 text-accent px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-accent/20">
                      {v.intensity === 'high' ? 'High Usage' : 'Weekend Driver'}
                    </span>
                    <span className="text-[10px] font-black text-text-dim uppercase tracking-widest">VIN Verified</span>
                  </div>
                  <h3 className="text-3xl font-black text-white uppercase tracking-tighter mb-4">{v.year} {v.make} {v.model}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-bg/50 p-4 rounded-2xl border border-border">
                      <p className="text-[10px] font-bold text-text-dim uppercase mb-1 tracking-widest">Last Wash</p>
                      <p className="font-mono text-white">4 days ago</p>
                    </div>
                    <div className="bg-bg/50 p-4 rounded-2xl border border-border">
                      <p className="text-[10px] font-bold text-text-dim uppercase mb-1 tracking-widest">Health Score</p>
                      <p className="font-mono text-success">98%</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <aside className="space-y-6">
            <div className="bg-accent p-8 rounded-[2.5rem] text-bg shadow-2xl shadow-accent/20">
              <div className="flex items-center gap-2 mb-8">
                <Sparkles size={20} />
                <h3 className="font-black uppercase tracking-widest text-sm">Proactive Scheduling</h3>
              </div>
              
              <AIProactiveSchedule vehicle={vehicles[0]} washHistoryCount={4} />
            </div>

            <div className="bg-card p-8 rounded-[2.5rem] border border-border">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} className="text-accent" />
                  <h3 className="font-black uppercase tracking-widest text-xs text-white">System Status</h3>
                </div>
                <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              </div>
              <div className="space-y-4">
                <p className="text-xs text-text-dim leading-relaxed lowercase">
                   Your {vehicles[0].model} is within optimal maintenance parameters. <span className="text-white font-bold">No issues detected.</span>
                </p>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function CustomerRatingView({ jobId }: { jobId: string }) {
  const [wash, setWash] = useState<WashJob | null>(null);
  const [ratings, setRatings] = useState({ worker: 0, business: 0 });
  const [review, setReview] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'washes', jobId)).then(d => setWash({ id: d.id, ...d.data() } as any));
  }, [jobId]);

  const handleSubmitRating = async () => {
    if (ratings.worker === 0 || ratings.business === 0) {
      alert("Please rate both the professional and the station experience.");
      return;
    }
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'washes', jobId), {
        workerRating: ratings.worker,
        businessRating: ratings.business,
        review,
      });
      setSubmitted(true);
    } catch (error) {
       console.error("Rating Error:", error);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center p-12 bg-card rounded-[3rem] border border-border max-w-md mx-auto">
        <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center text-success mx-auto mb-8">
          <Heart size={40} fill="currentColor" />
        </div>
        <h2 className="text-4xl font-black text-white uppercase tracking-tighter mb-4">You’re Awesome!</h2>
        <p className="text-text-dim lowercase leading-relaxed">Your feedback helps {wash?.workerName} and the station improve. See you next time!</p>
      </motion.div>
    );
  }

  return (
    <div className="max-w-xl w-full mx-auto space-y-6">
      <div className="bg-card p-10 rounded-[3rem] border border-border space-y-12">
        <header className="text-center">
          <div className="w-20 h-20 bg-accent rounded-full flex items-center justify-center text-white mx-auto mb-8 shadow-2xl shadow-accent/40">
            <Car size={40} />
          </div>
          <h2 className="text-4xl font-black text-white uppercase tracking-tighter mb-2">Build The Trust.</h2>
          <p className="text-text-dim lowercase">Rate your service experience for {wash?.carModel}</p>
        </header>

        <section className="space-y-10">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
                <Users size={16} className="text-accent" /> Rate {wash?.workerName}
              </label>
              <span className="text-[10px] font-bold text-accent uppercase">{ratings.worker} / 5</span>
            </div>
            <StarRating value={ratings.worker} onChange={(v) => setRatings(prev => ({ ...prev, worker: v }))} size={32} />
          </div>

          <div className="space-y-4">
             <div className="flex items-center justify-between">
               <label className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
                 <Store size={16} className="text-accent" /> Station Experience
               </label>
               <span className="text-[10px] font-bold text-accent uppercase">{ratings.business} / 5</span>
             </div>
             <StarRating value={ratings.business} onChange={(v) => setRatings(prev => ({ ...prev, business: v }))} size={32} />
          </div>

          <div className="space-y-4">
             <label className="text-xs font-black text-white uppercase tracking-widest">Anything to share?</label>
             <textarea 
               value={review}
               onChange={(e) => setReview(e.target.value)}
               placeholder="Tell us what you liked (or what we could improve)..."
               className="w-full bg-bg border border-border text-white p-5 rounded-2xl focus:ring-accent focus:border-accent min-h-[120px] text-sm"
             />
          </div>
        </section>

        <button 
          onClick={handleSubmitRating}
          disabled={submitting}
          className="w-full bg-white text-bg py-5 rounded-[2rem] font-black uppercase text-xs tracking-[0.3em] shadow-2xl hover:bg-accent hover:text-white transition active:scale-95 disabled:opacity-50"
        >
          {submitting ? 'Submitting Voice...' : 'Submit Feedback'}
        </button>
      </div>
    </div>
  );
}

function StarRating({ value, onChange, size = 24 }: { value: number, onChange: (v: number) => void, size?: number }) {
  return (
    <div className="flex gap-3">
      {[1, 2, 3, 4, 5].map((s) => (
        <button key={s} onClick={() => onChange(s)} className={cn("transition-all duration-300 transform", value >= s ? "text-yellow-400 scale-110" : "text-white/10 hover:text-white/30")}>
          <Star size={size} fill={value >= s ? "currentColor" : "none"} strokeWidth={2.5} />
        </button>
      ))}
    </div>
  );
}

function SubscriptionView({ profile }: { profile: UserProfile }) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleSubscribe = async (plan: 'starter' | 'standard' | 'elite') => {
    setLoading(plan);
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          userId: profile.uid,
          userEmail: profile.email
        })
      });

      const responseText = await response.text();
      let responseData: any = null;
      
      try {
        if (responseText) {
          responseData = JSON.parse(responseText);
        }
      } catch (e) {
        console.error("JSON Parse Error:", e, responseText);
      }

      if (!response.ok) {
        const errorMsg = responseData?.error || responseText || `Server error: ${response.status}`;
        throw new Error(errorMsg);
      }

      if (!responseData || !responseData.url) {
        throw new Error("No checkout URL received from server. Check logs.");
      }

      window.location.href = responseData.url;
    } catch (error: any) {
      console.error("Subscription Error:", error);
      alert(`Subscription Error: ${error.message}`);
    } finally {
      setLoading(null);
    }
  };

  const tiers = [
    {
      id: 'starter',
      name: 'Starter',
      price: '$19',
      description: 'Perfect for solo operators logging basic traffic.',
      features: ['Real-time Log Sync', 'Worker Dashboards', 'Customer Rating Links', 'Offline Queue Mode'],
      color: 'bg-white/5',
      icon: <Zap size={24} className="text-white/40" />
    },
    {
      id: 'standard',
      name: 'Professional',
      price: '$49',
      description: 'The standard for growing wash stations.',
      features: ['Everything in Starter', 'AI Maintenance Tips', 'Team Performance Ledger', 'Incentive Tracking'],
      color: 'bg-accent/10 border-accent/40',
      icon: <Sparkles size={24} className="text-accent" />,
      popular: true
    },
    {
      id: 'elite',
      name: 'Elite',
      price: '$99',
      description: 'Total automation for high-volume enterprises.',
      features: ['Everything in Pro', 'AI License Plate Scanner', 'Advanced Analytics', 'Priority Support'],
      color: 'bg-white text-bg',
      icon: <ShieldCheck size={24} className="text-bg" />
    }
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto pb-20">
      <header className="text-center mb-16">
        <h2 className="text-5xl font-black text-white tracking-tighter uppercase mb-4">Scale Your Flow.</h2>
        <p className="text-text-dim text-lg">Choose a plan that matches your business velocity.</p>
        <div className="mt-8 inline-flex items-center gap-2 bg-accent/10 text-accent px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest border border-accent/20">
          <Sparkles size={14} />
          Your current plan: {profile.plan || 'Free Trial (Starter)'}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {tiers.map((tier) => (
          <div 
            key={tier.id} 
            className={cn(
              "p-8 rounded-[2rem] border relative flex flex-col",
              tier.color,
              tier.id !== 'elite' ? "border-border" : "border-transparent"
            )}
          >
            {tier.popular && (
              <div className="absolute top-0 right-8 -translate-y-1/2 bg-accent text-white px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                Most Popular
              </div>
            )}
            
            <div className="mb-8">
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center mb-6",
                tier.id === 'elite' ? "bg-bg" : "bg-bg/50"
              )}>
                {tier.icon}
              </div>
              <h3 className={cn("text-2xl font-black mb-2 uppercase", tier.id === 'elite' ? "text-bg" : "text-white")}>{tier.name}</h3>
              <div className="flex items-baseline gap-1">
                <span className={cn("text-4xl font-black", tier.id === 'elite' ? "text-bg" : "text-white")}>{tier.price}</span>
                <span className={cn("text-sm font-bold opacity-60", tier.id === 'elite' ? "text-bg" : "text-white")}>/MO</span>
              </div>
              <p className={cn("mt-4 text-sm leading-relaxed", tier.id === 'elite' ? "text-bg/70" : "text-text-dim lowercase")}>{tier.description}</p>
            </div>

            <ul className="space-y-4 mb-10 flex-1">
              {tier.features.map((feature, i) => (
                <li key={i} className="flex items-center gap-3">
                  <Check size={16} className={cn(tier.id === 'elite' ? "text-bg" : "text-accent")} />
                  <span className={cn("text-sm font-medium", tier.id === 'elite' ? "text-bg" : "text-white/80")}>{feature}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={() => handleSubscribe(tier.id as any)}
              disabled={loading !== null || profile.plan === tier.id}
              className={cn(
                "w-full py-4 rounded-2xl font-black uppercase tracking-widest transition active:scale-95 disabled:opacity-50 disabled:active:scale-100",
                tier.id === 'elite' 
                  ? "bg-bg text-white hover:bg-accent" 
                  : "bg-white text-bg hover:bg-accent hover:text-white"
              )}
            >
              {loading === tier.id ? "Initialising..." : profile.plan === tier.id ? "Current Plan" : `Select ${tier.name}`}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-20 text-center">
        <p className="text-text-dim text-sm max-w-lg mx-auto leading-relaxed">
          Secure billing powered by <span className="text-white font-bold">Stripe</span>. 
          Plans can be cancelled or upgraded at any time from your dashboard.
        </p>
      </div>
    </motion.div>
  );
}
function LogWashForm({ profile, onComplete, setView }: { profile: UserProfile, onComplete: () => void, setView: (v: any) => void }) {
  const [form, setForm] = useState({ carModel: '', plateNumber: '', price: '20' });
  const [submitting, setSubmitting] = useState(false);
  const [lastLoggedId, setLastLoggedId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const startCamera = async () => {
    if (profile.plan !== 'elite') {
      setView('billing');
      return;
    }
    setCameraActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera access error:", err);
      alert("Could not access camera. Please check permissions.");
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
    }
    setCameraActive(false);
  };

  const captureAndScan = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    setIsScanning(true);
    const context = canvasRef.current.getContext('2d');
    if (context) {
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      context.drawImage(videoRef.current, 0, 0);
      
      const base64Image = canvasRef.current.toDataURL('image/jpeg', 0.8).split(',')[1];
      
      try {
        const result = await scanVehicleInfo(base64Image);
        if (result.plate || result.vehicle) {
          setForm(prev => ({
            ...prev,
            carModel: result.vehicle || prev.carModel,
            plateNumber: result.plate || prev.plateNumber
          }));
          stopCamera();
        } else {
          alert("Could not detect vehicle info. Please try again or enter manually.");
        }
      } catch (error) {
        alert("Scan failed. Please ensure you have a clear view of the plate.");
      } finally {
        setIsScanning(false);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    
    try {
      // 1. Get current location
      let currentLat: number | null = null;
      let currentLng: number | null = null;

      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
          });
        });
        currentLat = position.coords.latitude;
        currentLng = position.coords.longitude;
      } catch (err) {
        console.error("Location access error:", err);
        throw new Error("Unable to verify your location. Please enable GPS and try again.");
      }

      // 2. Fetch Business Geofence Settings
      // For MVP: Fetch the first owner found or use current profile if owner
      let geofence = { lat: profile.businessLat, lng: profile.businessLng, radius: profile.businessRadius || 500 };
      
      if (profile.role === 'worker' && (!geofence.lat || !geofence.lng)) {
        // Look up owner settings
        const ownerQuery = query(collection(db, 'users'), where('role', '==', 'owner'), limit(1));
        const ownerSnap = await getDoc(doc(db, 'users', 'MASTER_SETTINGS')); // Using a known ID or searching
        // Since we don't have a fixed MASTER_SETTINGS, let's search for an owner.
        // Actually, to keep it simple, let's just use the current profile if it has it, 
        // OR prompt the user that business location hasn't been set.
      }

      // Hard check: If business location is set, verify distance
      if (geofence.lat && geofence.lng) {
        const dist = calculateDistance(currentLat!, currentLng!, geofence.lat, geofence.lng);
        if (dist > geofence.radius) {
          throw new Error(`Out of bounds. You are ${Math.round(dist)}m away from the business. Max allowed is ${geofence.radius}m.`);
        }
      } else if (profile.role === 'worker') {
        throw new Error("Business location has not been configured by the owner yet.");
      }

      const tip = (profile.plan === 'standard' || profile.plan === 'elite')
        ? await getMaintenanceTip(form.carModel)
        : "Regular washing keeps your vehicle looking pristine!";
        
      const washData = {
        workerId: profile.uid,
        workerName: profile.name,
        carModel: form.carModel,
        plateNumber: form.plateNumber,
        price: parseFloat(form.price),
        timestamp: serverTimestamp(),
        status: 'completed',
        maintenanceTip: tip,
        lat: currentLat,
        lng: currentLng
      };
      
      const docRef = await addDoc(collection(db, 'washes'), washData);
      setLastLoggedId(docRef.id);
    } catch (error: any) {
      if (error.message.includes('bounds') || error.message.includes('Location') || error.message.includes('configured')) {
        alert(error.message);
      } else {
        handleFirestoreError(error, OperationType.CREATE, 'washes');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const shareLink = `${window.location.origin}?rate=${lastLoggedId}`;

  if (lastLoggedId) {
    return (
      <div className="max-w-xl mx-auto text-center">
        <div className="bento-card py-16">
          <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center text-success mx-auto mb-8">
            <Check size={40} />
          </div>
          <h2 className="text-4xl font-black text-white mb-4 uppercase tracking-tighter">Job Logged.</h2>
          <p className="text-text-dim mb-10 max-w-sm mx-auto">Show this to the customer for their personalized maintenance tip and rating link.</p>
          
          <div className="bg-bg p-6 rounded-2xl border border-border mb-10 text-left">
             <div className="flex items-center gap-2 mb-3">
               <Award size={16} className="text-accent" />
               <span className="text-[10px] font-black text-accent uppercase tracking-widest">AI Tip for Customer</span>
             </div>
             <p className="text-white italic font-medium leading-relaxed">"{profile.name} recommends: Get regular waxing for that {form.carModel} to protect the finish."</p>
          </div>

          <div className="flex gap-4">
             <button 
               onClick={() => {
                 navigator.clipboard.writeText(shareLink);
                 alert('Link copied! Paste it into a message or QR generator.');
               }}
               className="flex-1 bg-white text-bg font-black py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-accent hover:text-white transition"
             >
               <Share2 size={20} />
               Rating Link
             </button>
             <button 
               onClick={() => { setLastLoggedId(null); setForm({ carModel: '', plateNumber: '', price: '20' }); }}
               className="flex-1 bg-white/5 text-white font-black py-4 rounded-xl hover:bg-white/10 transition"
             >
               Next Wash
             </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="max-w-xl mx-auto">
      <header className="mb-10 text-center">
        <h2 className="text-4xl font-black text-white tracking-tight">Log Job</h2>
        <p className="text-text-dim mt-2">Capture current vehicle details instantly.</p>
      </header>

      <form onSubmit={handleSubmit} className="bento-card space-y-6">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={cameraActive ? stopCamera : startCamera}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition",
              cameraActive ? "bg-red-500/10 text-red-500" : "bg-accent/10 text-accent"
            )}
          >
            {cameraActive ? <X size={14} /> : <Camera size={14} />}
            {cameraActive ? "Cancel Scan" : "Scan Plate (AI)"}
          </button>
        </div>

        {cameraActive && (
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border-2 border-accent/20">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              className="w-full h-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />
            
            <div className="absolute inset-0 border-2 border-accent/40 rounded-2xl m-8 pointer-events-none">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-accent rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-accent rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-accent rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-accent rounded-br-lg" />
            </div>

            <div className="absolute bottom-4 left-0 right-0 px-4">
              <button
                type="button"
                disabled={isScanning}
                onClick={captureAndScan}
                className="w-full bg-accent text-white font-black py-3 rounded-xl shadow-2xl flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isScanning ? (
                  <>
                    <RefreshCw className="animate-spin" size={18} />
                    Analyzing Image...
                  </>
                ) : (
                  <>
                    <Camera size={18} />
                    Capture & Identify
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-text-dim uppercase tracking-wider mb-2">Car Model</label>
          <input 
            required
            placeholder="e.g. Toyota Hilux"
            value={form.carModel}
            onChange={e => setForm({...form, carModel: e.target.value})}
            className="w-full bg-bg px-5 py-4 rounded-xl border border-border focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-text-dim uppercase tracking-wider mb-2">Plate Number</label>
          <input 
            required
            placeholder="ABC-123-XY"
            value={form.plateNumber}
            onChange={e => setForm({...form, plateNumber: e.target.value})}
            className="w-full bg-bg px-5 py-4 rounded-xl border border-border focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition text-white font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-text-dim uppercase tracking-wider mb-2">Charge ($)</label>
          <div className="relative">
            <DollarSign className="absolute left-5 top-1/2 -translate-y-1/2 text-text-dim" size={18} />
            <input 
              required
              type="number"
              value={form.price}
              onChange={e => setForm({...form, price: e.target.value})}
              className="w-full bg-bg pl-14 pr-5 py-4 rounded-xl border border-border focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition text-white text-xl font-bold"
            />
          </div>
        </div>
        
        <button 
          disabled={submitting}
          className="w-full bg-accent text-white font-bold py-5 rounded-2xl hover:bg-accent/90 transition shadow-xl shadow-accent/20 flex items-center justify-center gap-3 group disabled:opacity-50 mt-4 active:scale-95"
        >
          {submitting ? "Processing Transaction..." : (
            <>
              Submit Log Entry
              <ChevronRight size={20} className="group-hover:translate-x-1 transition" />
            </>
          )}
        </button>
      </form>
    </motion.div>
  );
}

function OwnerPerformanceView() {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubWashes = onSnapshot(collection(db, 'washes'), (washSnap) => {
      const washes = washSnap.docs.map(d => ({ id: d.id, ...d.data() } as WashJob));
      
      onSnapshot(collection(db, 'incentives'), (incentiveSnap) => {
        const incentives = incentiveSnap.docs.map(d => ({ id: d.id, ...d.data() } as Incentive));
        
        onSnapshot(collection(db, 'users'), (userSnap) => {
          const users = userSnap.docs.map(d => d.data() as UserProfile).filter(u => u.role === 'worker');
          
          const workerData = users.map(worker => {
            const workerWashes = washes.filter(w => w.workerId === worker.uid);
            const workerIncentives = incentives.filter(i => i.workerId === worker.uid);
            
            const ratings = workerWashes.filter(w => w.workerRating !== undefined).map(w => w.workerRating as number);
            const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
            const totalIncentives = workerIncentives.reduce((acc, curr) => acc + curr.amount, 0);
            
            return {
              ...worker,
              totalWashes: workerWashes.length,
              avgRating,
              totalIncentives,
              revenue: workerWashes.reduce((acc, curr) => acc + curr.price, 0)
            };
          });
          
          setWorkers(workerData);
          setLoading(false);
        });
      });
    });

    return () => unsubWashes();
  }, []);

  if (loading) return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      <header className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-4 w-96" />
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-80 w-full" />
        ))}
      </div>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-6xl mx-auto">
      <header className="mb-10">
        <h2 className="text-4xl font-black text-white tracking-tight">Team Performance</h2>
        <p className="text-text-dim mt-2">Core metrics and evaluation ledger for operative staff.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {workers.map(worker => (
          <div key={worker.uid} className="bento-card group hover:border-accent/40 transition-colors">
            <div className="flex items-center gap-4 mb-8">
              <img src={worker.photoUrl} className="w-16 h-16 rounded-2xl border border-border group-hover:scale-105 transition-transform" />
              <div>
                <h3 className="text-xl font-bold text-white">{worker.name}</h3>
                <p className="text-xs text-text-dim font-medium uppercase tracking-widest">{worker.email}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-bg p-4 rounded-2xl border border-border">
                <p className="text-[10px] font-black text-text-dim uppercase tracking-widest mb-1">Service Count</p>
                <p className="text-2xl font-black text-white">{worker.totalWashes}</p>
              </div>
              <div className="bg-bg p-4 rounded-2xl border border-border">
                <p className="text-[10px] font-black text-text-dim uppercase tracking-widest mb-1">Avg Rating</p>
                <div className="flex items-center gap-1">
                  <p className="text-2xl font-black text-white">{worker.avgRating.toFixed(1)}</p>
                  <Star size={16} fill="currentColor" className="text-yellow-400" />
                </div>
              </div>
              <div className="bg-bg p-4 rounded-2xl border border-border">
                <p className="text-[10px] font-black text-text-dim uppercase tracking-widest mb-1">Revenue Base</p>
                <p className="text-xl font-black text-white">{formatCurrency(worker.revenue)}</p>
              </div>
              <div className="bg-bg p-4 rounded-2xl border border-border">
                <p className="text-[10px] font-black text-text-dim uppercase tracking-widest mb-1">Total Perks</p>
                <p className="text-xl font-black text-success">{formatCurrency(worker.totalIncentives)}</p>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-border">
               <div className="flex justify-between items-center mb-2">
                 <span className="text-[10px] font-black text-text-dim uppercase tracking-widest">Efficiency Quotient</span>
                 <span className="text-[10px] font-black text-accent">{Math.min(100, (worker.totalWashes * (worker.avgRating / 5) * 2)).toFixed(0)}%</span>
               </div>
               <div className="w-full h-1.5 bg-bg rounded-full overflow-hidden border border-border">
                 <div 
                   className="h-full bg-accent transition-all duration-1000" 
                   style={{ width: `${Math.min(100, (worker.totalWashes * (worker.avgRating / 5) * 2))}%` }} 
                 />
               </div>
            </div>
          </div>
        ))}
      </div>

      {workers.length === 0 && (
        <div className="bento-card text-center py-20 border-dashed">
          <p className="text-text-dim italic">No operative staff registered in the ledger.</p>
        </div>
      )}
    </motion.div>
  );
}

function HistoryView({ profile }: { profile: UserProfile }) {
  const [washes, setWashes] = useState<WashJob[]>([]);
  const [workers, setWorkers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    workerId: 'all',
    status: 'all'
  });
  const [sort, setSort] = useState<{ field: 'timestamp' | 'price' | 'workerRating', desc: boolean }>({
    field: 'timestamp',
    desc: true
  });
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  useEffect(() => {
    if (profile.role === 'owner') {
      const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
        setWorkers(snap.docs.map(d => d.data() as UserProfile).filter(u => u.role === 'worker'));
      });
      return () => unsubUsers();
    }
  }, [profile]);

  useEffect(() => {
    let q: Query<DocumentData>;
    const washesRef = collection(db, 'washes');

    if (profile.role === 'owner') {
      q = query(washesRef, orderBy('timestamp', 'desc'));
    } else if (profile.role === 'worker') {
      q = query(washesRef, where('workerId', '==', profile.uid), orderBy('timestamp', 'desc'));
    } else {
      // For customers, filter by their vehicle plate numbers
      const plates = (profile.vehicles || []).map(v => v.plate).filter(Boolean);
      if (plates.length > 0) {
        q = query(washesRef, where('plateNumber', 'in', plates.slice(0, 10)), orderBy('timestamp', 'desc'));
      } else {
        // If no vehicles, show empty
        setWashes([]);
        setLoading(false);
        return;
      }
    }

    return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      setWashes(snap.docs.map(d => ({ 
        id: d.id, 
        ...d.data(),
        isPending: d.metadata.hasPendingWrites 
      } as WashJob)));
      setLoading(false);
    });
  }, [profile]);

  const filteredAndSortedWashes = washes
    .filter(wash => {
      if (filters.workerId !== 'all' && wash.workerId !== filters.workerId) return false;
      if (filters.status !== 'all') {
        if (filters.status === 'pending') {
          if (!wash.isPending) return false;
        } else {
          if (wash.status !== filters.status) return false;
        }
      }
      if (filters.startDate) {
        const start = new Date(filters.startDate);
        if (wash.timestamp?.toDate() < start) return false;
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        if (wash.timestamp?.toDate() > end) return false;
      }
      return true;
    })
    .sort((a, b) => {
      let valA: any = a[sort.field];
      let valB: any = b[sort.field];

      if (sort.field === 'timestamp') {
        valA = a.timestamp?.toDate().getTime() || 0;
        valB = b.timestamp?.toDate().getTime() || 0;
      }
      
      // Handle missing ratings
      if (sort.field === 'workerRating') {
        valA = a.workerRating || 0;
        valB = b.workerRating || 0;
      }

      const comparison = valA > valB ? 1 : -1;
      return sort.desc ? -comparison : comparison;
    });

  const toggleSort = (field: 'timestamp' | 'price' | 'workerRating') => {
    setSort(prev => ({
      field,
      desc: prev.field === field ? !prev.desc : true
    }));
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-3">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-10 w-32" />
        </header>
        <div className="space-y-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto pb-20">
      <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-4xl font-black text-white tracking-tight">Operational History</h2>
          <p className="text-text-dim mt-2">Full ledger of service transactions.</p>
        </div>
        <button 
          onClick={() => setIsFilterOpen(!isFilterOpen)}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl transition font-bold text-sm",
            isFilterOpen ? "bg-accent text-white shadow-lg shadow-accent/20" : "bg-card text-text-dim border border-border hover:text-white"
          )}
        >
          {isFilterOpen ? <X size={18} /> : <Filter size={18} />}
          {isFilterOpen ? 'Close Controls' : 'Filter & Sort'}
        </button>
      </header>

      <AnimatePresence>
        {isFilterOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0, marginBottom: 0 }}
            animate={{ height: 'auto', opacity: 1, marginBottom: 40 }}
            exit={{ height: 0, opacity: 0, marginBottom: 0 }}
            className="overflow-hidden"
          >
            <div className="bento-card bg-card/50 backdrop-blur-sm border-accent/20 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-text-dim uppercase tracking-widest flex items-center gap-1.5">
                  <Calendar size={12} /> Date Range
                </label>
                <div className="flex flex-col gap-2">
                  <input 
                    type="date" 
                    value={filters.startDate}
                    onChange={e => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                    className="bg-bg border border-border rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-1 focus:ring-accent" 
                  />
                  <input 
                    type="date" 
                    value={filters.endDate}
                    onChange={e => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                    className="bg-bg border border-border rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-1 focus:ring-accent" 
                  />
                </div>
              </div>

              {profile.role === 'owner' && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-text-dim uppercase tracking-widest flex items-center gap-1.5">
                    <Users size={12} /> Filter by Worker
                  </label>
                  <select 
                    value={filters.workerId}
                    onChange={e => setFilters(prev => ({ ...prev, workerId: e.target.value }))}
                    className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-1 focus:ring-accent appearance-none"
                  >
                    <option value="all">All Workers</option>
                    {workers.map(w => <option key={w.uid} value={w.uid}>{w.name}</option>)}
                  </select>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-black text-text-dim uppercase tracking-widest flex items-center gap-1.5">
                  <ShieldCheck size={12} /> Service Status
                </label>
                <select 
                  value={filters.status}
                  onChange={e => setFilters(prev => ({ ...prev, status: e.target.value }))}
                  className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-1 focus:ring-accent appearance-none"
                >
                  <option value="all">Any Status</option>
                  <option value="completed">Completed</option>
                  <option value="pending">Pending Sync</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-text-dim uppercase tracking-widest flex items-center gap-1.5">
                  <Gauge size={12} /> Sort Ledger
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Date', field: 'timestamp' },
                    { label: 'Price', field: 'price' },
                    { label: 'Rating', field: 'workerRating' }
                  ].map(s => (
                    <button 
                      key={s.field}
                      onClick={() => toggleSort(s.field as any)}
                      className={cn(
                        "flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition",
                        sort.field === s.field ? "bg-accent text-white" : "bg-bg text-text-dim border border-border hover:text-white"
                      )}
                    >
                      {s.label}
                      {sort.field === s.field && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-end">
                <button 
                  onClick={() => {
                    setFilters({ startDate: '', endDate: '', workerId: 'all', status: 'all' });
                    setSort({ field: 'timestamp', desc: true });
                  }}
                  className="w-full bg-bg border border-border text-text-dim hover:text-white py-2 rounded-lg text-xs font-bold transition"
                >
                  Reset Defaults
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-4">
        {filteredAndSortedWashes.map(wash => (
          <motion.div 
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            key={wash.id} 
            className="bento-card"
          >
            <div className="flex justify-between items-start mb-6">
              <div className="flex gap-4">
                <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center text-accent">
                  <Car size={28} />
                </div>
                <div>
                  <h4 className="font-bold text-xl text-white">{wash.carModel}</h4>
                  <p className="text-sm text-text-dim font-mono tracking-tight">{wash.plateNumber}</p>
                  <p className="text-[10px] uppercase font-bold text-text-dim mt-2 tracking-widest">{wash.timestamp?.toDate().toLocaleString()}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-white tracking-tighter">{formatCurrency(wash.price)}</p>
                <div className="flex flex-col items-end gap-2 mt-2">
                  {wash.isPending ? (
                    <div className="flex items-center gap-1.5 text-accent animate-pulse font-black text-[8px] uppercase tracking-widest bg-accent/5 px-2 py-1 rounded border border-accent/20">
                      <RefreshCw size={8} className="animate-spin" /> 
                      Queued for Sync
                    </div>
                  ) : (
                    <span className="inline-block px-3 py-1 bg-success/10 text-success text-[10px] font-black uppercase rounded-md tracking-widest border border-success/20">
                      {wash.status}
                    </span>
                  )}
                  {wash.businessRating && (
                    <div className="flex items-center gap-1 text-yellow-400">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} size={10} fill={i < wash.businessRating! ? "currentColor" : "none"} strokeWidth={3} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {wash.maintenanceTip && (
              <div className="bg-accent/5 p-5 rounded-2xl border border-accent/20">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 bg-accent/20 rounded-md flex items-center justify-center">
                    <Award size={12} className="text-accent" />
                  </div>
                  <span className="text-[10px] font-black text-accent uppercase tracking-[0.2em]">Maintenance Intelligence</span>
                </div>
                <p className="text-sm text-blue-100/90 leading-relaxed font-medium italic">"{wash.maintenanceTip}"</p>
              </div>
            )}

            {profile.role === 'owner' && (
              <div className="mt-6 pt-5 border-t border-border flex items-center justify-between text-[10px] font-bold text-text-dim uppercase tracking-widest">
                <div className="flex items-center gap-2">
                   <Users size={12} />
                   <span>Authorized Worker: {wash.workerName}</span>
                </div>
                <span className="bg-white/5 px-2 py-0.5 rounded">ID: {wash.id.slice(0, 8)}</span>
              </div>
            )}
          </motion.div>
        ))}
        {filteredAndSortedWashes.length === 0 && (
          <div className="bento-card text-center py-20 border-dashed">
            <p className="text-text-dim italic">No service history found matching current filters.</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function SettingsView({ profile, onUpdate }: { profile: UserProfile, onUpdate: (p: UserProfile) => void }) {
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState({
    businessLat: profile.businessLat || 0,
    businessLng: profile.businessLng || 0,
    businessRadius: profile.businessRadius || 500
  });

  const handleGetCurrentLocation = () => {
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSettings(prev => ({
          ...prev,
          businessLat: pos.coords.latitude,
          businessLng: pos.coords.longitude
        }));
        setLoading(false);
      },
      (err) => {
        alert("Could not get location. Ensure permissions are granted.");
        setLoading(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await updateDoc(doc(db, 'users', profile.uid), settings);
      onUpdate({ ...profile, ...settings });
      alert("Business location saved successfully.");
    } catch (error) {
      console.error("Save error:", error);
      alert("Failed to save settings.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto pb-20">
      <header className="mb-10 text-center">
        <h2 className="text-4xl font-black text-white tracking-tight uppercase">Settings</h2>
        <p className="text-text-dim mt-2 lowercase">Configure your business operational boundaries.</p>
      </header>

      <div className="bento-card space-y-8">
        <div className="space-y-4">
          <label className="text-xs font-black text-text-dim uppercase tracking-widest flex items-center gap-2">
            <MapPin size={14} className="text-accent" />
            Business Geofence
          </label>
          <p className="text-xs text-text-dim leading-relaxed">
            Specify exactly where your shop is located. Workers will be blocked from logging washes if they are outside this radius.
          </p>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-text-dim/60 uppercase">Latitude</label>
              <input 
                type="number"
                value={settings.businessLat}
                onChange={e => setSettings(prev => ({ ...prev, businessLat: parseFloat(e.target.value) }))}
                className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-text-dim/60 uppercase">Longitude</label>
              <input 
                type="number"
                value={settings.businessLng}
                onChange={e => setSettings(prev => ({ ...prev, businessLng: parseFloat(e.target.value) }))}
                className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          <button 
            onClick={handleGetCurrentLocation}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-accent/10 text-accent font-bold py-3 rounded-xl border border-accent/20 hover:bg-accent hover:text-white transition group disabled:opacity-50"
          >
            <MapPin size={16} className="group-hover:animate-bounce" />
            {loading ? "Detecting..." : "Pin Current GPS Data"}
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-black text-text-dim uppercase tracking-widest flex items-center justify-between">
            <span>Allowed Radius (Meters)</span>
            <span className="text-accent">{settings.businessRadius}m</span>
          </label>
          <input 
            type="range"
            min="50"
            max="2000"
            step="50"
            value={settings.businessRadius}
            onChange={e => setSettings(prev => ({ ...prev, businessRadius: parseInt(e.target.value) }))}
            className="w-full accent-accent h-2 bg-white/5 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        <button 
          onClick={handleSave}
          disabled={loading}
          className="w-full bg-white text-bg font-black py-4 rounded-xl uppercase tracking-widest hover:bg-accent hover:text-white transition active:scale-95 disabled:opacity-50"
        >
          {loading ? "Processing..." : "Commit Settings"}
        </button>
      </div>
    </motion.div>
  );
}
