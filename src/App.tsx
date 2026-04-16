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
  doc, getDoc, setDoc, collection, query, where, orderBy, onSnapshot, addDoc, limit, serverTimestamp, Timestamp, updateDoc
} from 'firebase/firestore';
import { 
  Car, TrendingUp, Users, LogOut, Plus, Star, Award, ChevronRight, Gauge, Briefcase, DollarSign, Check, Share2, Filter, Calendar, ArrowUp, ArrowDown, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from './lib/utils';
import { getMaintenanceTip } from './services/geminiService';

// --- Types ---
interface UserProfile {
  uid: string;
  name: string;
  role: 'owner' | 'worker';
  email: string;
  photoUrl?: string;
}

interface WashJob {
  id: string;
  workerId: string;
  workerName: string;
  carModel: string;
  plateNumber: string;
  price: number;
  timestamp: Timestamp;
  status: 'completed';
  rating?: number;
  review?: string;
  maintenanceTip?: string;
}

interface Incentive {
  id: string;
  workerId: string;
  amount: number;
  reason: string;
  timestamp: Timestamp;
}

// --- Components ---

function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const handleError = (e: ErrorEvent) => setError(e.error);
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-red-100">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Something went wrong</h2>
          <p className="text-gray-600 mb-6">We've encountered an error. Our team has been notified.</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-red-600 text-white font-semibold py-3 rounded-xl hover:bg-red-700 transition"
          >
            Retry Application
          </button>
          <pre className="mt-6 p-4 bg-gray-900 text-gray-300 text-xs rounded-lg overflow-auto max-h-40">
            {error.message}
          </pre>
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
  const [view, setView] = useState<'dashboard' | 'log' | 'history' | 'performance'>('dashboard');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const rateJobId = new URLSearchParams(window.location.search).get('rate');

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
            const newProfile: UserProfile = {
              uid: u.uid,
              name: u.displayName || 'Anonymous User',
              email: u.email || '',
              role: isOwnerEmail ? 'owner' : 'worker',
              photoUrl: u.photoURL || undefined
            };
            await setDoc(docRef, { ...newProfile, createdAt: serverTimestamp() });
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
              <NavItem 
                icon={<Gauge size={20} />} 
                label="Dashboard" 
                active={view === 'dashboard'} 
                onClick={() => setView('dashboard')} 
              />
              <NavItem 
                icon={<Plus size={20} />} 
                label="Log Wash" 
                active={view === 'log'} 
                onClick={() => setView('log')} 
              />
              <NavItem 
                icon={<Briefcase size={20} />} 
                label="History" 
                active={view === 'history'} 
                onClick={() => setView('history')} 
              />
              {profile?.role === 'owner' && (
                <NavItem 
                  icon={<Users size={20} />} 
                  label="Team" 
                  active={view === 'performance'} 
                  onClick={() => setView('performance')} 
                />
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
              <SyncStatus isOnline={isOnline} />
            </div>

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
              <LogWashForm profile={profile} onComplete={() => setView('history')} />
            )}
            {view === 'history' && profile && (
              <HistoryView profile={profile} />
            )}
            {view === 'performance' && profile?.role === 'owner' && (
              <OwnerPerformanceView />
            )}
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

function SyncStatus({ isOnline }: { isOnline: boolean }) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border",
      isOnline ? "bg-success/5 text-success border-success/20" : "bg-red-500/5 text-red-500 border-red-500/20"
    )}>
      <div className={cn("w-2 h-2 rounded-full animate-pulse", isOnline ? "bg-success" : "bg-red-500")} />
      {isOnline ? "System Online" : "Working Offline"}
    </div>
  );
}

function CustomerRatingView({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<WashJob | null>(null);
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDoc(doc(db, 'washes', jobId)).then(docSnap => {
      if (docSnap.exists()) {
        setJob(docSnap.data() as WashJob);
      }
      setLoading(false);
    });
  }, [jobId]);

  const handleSubmit = async () => {
    if (rating === 0) return;
    try {
      await updateDoc(doc(db, 'washes', jobId), { rating, review });
      setSubmitted(true);
    } catch (error) {
       console.error(error);
    }
  };

  if (loading) return <div className="text-white font-black animate-pulse uppercase tracking-widest text-sm">Validating Unit ID...</div>;
  if (!job) return <div className="text-red-500 font-black uppercase tracking-widest text-sm">Reference Not Found</div>;
  if (submitted || job.rating) return (
    <div className="bento-card text-center py-12 max-w-sm">
      <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center text-success mx-auto mb-6">
        <Check size={32} />
      </div>
      <h2 className="text-2xl font-black text-white mb-2 uppercase tracking-tight">Appreciated.</h2>
      <p className="text-text-dim text-sm italic">Feedback synced to operative ledger.</p>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bento-card max-w-sm w-full">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center text-white">
          <Car size={20} />
        </div>
        <div>
          <h3 className="text-white font-bold leading-none">{job.carModel}</h3>
          <p className="text-[10px] text-text-dim uppercase font-black mt-1">Service ID: {jobId.slice(0, 8)}</p>
        </div>
      </div>

      <h2 className="text-2xl font-black text-white mb-6 tracking-tight">Rate the Flow</h2>
      
      <div className="flex justify-between mb-8">
        {[1, 2, 3, 4, 5].map(star => (
          <button 
            key={star} 
            onClick={() => setRating(star)}
            className={cn("transition-all", rating >= star ? "text-yellow-400 scale-110" : "text-white/10 hover:text-white/30")}
          >
            <Star size={32} fill={rating >= star ? "currentColor" : "none"} />
          </button>
        ))}
      </div>

      <textarea 
        placeholder="Brief comment (optional)..."
        value={review}
        onChange={e => setReview(e.target.value)}
        className="w-full bg-bg border border-border rounded-xl p-4 text-white text-sm outline-none focus:ring-1 focus:ring-accent mb-6 h-24"
      />

      <button 
        onClick={handleSubmit} 
        disabled={rating === 0}
        className="w-full bg-white text-bg font-black py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-accent hover:text-white transition disabled:opacity-30"
      >
        Finalize Feedback
        <ChevronRight size={18} />
      </button>
    </motion.div>
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
          The bento-style transparency layer for car wash hubs. Track, incentivize, and scale with real-time AI insights.
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
  const [stats, setStats] = useState({ todayRevenue: 0, todayCount: 0, totalCount: 0 });
  const [recentWashes, setRecentWashes] = useState<WashJob[]>([]);

  useEffect(() => {
    const q = profile.role === 'owner' 
      ? query(collection(db, 'washes'), orderBy('timestamp', 'desc'), limit(50))
      : query(collection(db, 'washes'), where('workerId', '==', profile.uid), orderBy('timestamp', 'desc'), limit(50));

    return onSnapshot(q, (snap) => {
      const washes = snap.docs.map(d => ({ id: d.id, ...d.data() } as WashJob));
      setRecentWashes(washes.slice(0, 10));
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayWashes = washes.filter(w => w.timestamp?.toDate() >= today);
      
      const rev = todayWashes.reduce((acc, curr) => acc + curr.price, 0);
      setStats({ 
        todayRevenue: rev, 
        todayCount: todayWashes.length,
        totalCount: washes.length 
      });
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'washes'));
  }, [profile]);

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
            <span className="text-[10px] font-black text-accent uppercase tracking-[0.2em]">Live: Today's Revenue</span>
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

        {/* Counter Stat */}
        <div className="md:col-span-1 bento-card flex flex-col justify-between">
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
             <button className="text-xs font-bold text-accent mt-3 flex items-center gap-1 hover:underline">
               View analytics report <ChevronRight size={14} />
             </button>
           </div>
        </div>

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
                  <div className="w-1.5 h-1.5 bg-accent rounded-full" />
                  <span className="font-medium">{wash.carModel}</span>
                  <span className="text-text-dim text-xs select-none">•</span>
                  <span className="text-text-dim text-xs font-mono">{wash.plateNumber}</span>
                </div>
                <span className="text-xs text-text-dim group-hover:text-white transition">{wash.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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

function StatCard({ icon, label, value, color }: { icon: React.ReactNode, label: string, value: string, color: string }) {
  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mb-4", color)}>
        {icon}
      </div>
      <p className="text-sm text-gray-500 font-medium mb-1">{label}</p>
      <p className="text-3xl font-black text-gray-900 tracking-tighter">{value}</p>
    </div>
  );
}

function LogWashForm({ profile, onComplete }: { profile: UserProfile, onComplete: () => void }) {
  const [form, setForm] = useState({ carModel: '', plateNumber: '', price: '20' });
  const [submitting, setSubmitting] = useState(false);
  const [lastLoggedId, setLastLoggedId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    
    try {
      const tip = await getMaintenanceTip(form.carModel);
      const washData = {
        workerId: profile.uid,
        workerName: profile.name,
        carModel: form.carModel,
        plateNumber: form.plateNumber,
        price: parseFloat(form.price),
        timestamp: serverTimestamp(),
        status: 'completed',
        maintenanceTip: tip
      };
      
      const docRef = await addDoc(collection(db, 'washes'), washData);
      setLastLoggedId(docRef.id);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'washes');
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
            
            const ratings = workerWashes.filter(w => w.rating !== undefined).map(w => w.rating as number);
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
    <div className="flex items-center justify-center py-20">
      <div className="text-accent animate-pulse font-black uppercase tracking-widest">Aggregating Team Ledger...</div>
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
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    workerId: 'all',
    status: 'all'
  });
  const [sort, setSort] = useState<{ field: 'timestamp' | 'price' | 'rating', desc: boolean }>({
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
    let q = profile.role === 'owner' 
      ? query(collection(db, 'washes'), orderBy('timestamp', 'desc'))
      : query(collection(db, 'washes'), where('workerId', '==', profile.uid), orderBy('timestamp', 'desc'));

    return onSnapshot(q, (snap) => {
      setWashes(snap.docs.map(d => ({ id: d.id, ...d.data() } as WashJob)));
    });
  }, [profile]);

  const filteredAndSortedWashes = washes
    .filter(wash => {
      if (filters.workerId !== 'all' && wash.workerId !== filters.workerId) return false;
      if (filters.status !== 'all' && wash.status !== filters.status) return false;
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
      if (sort.field === 'rating') {
        valA = a.rating || 0;
        valB = b.rating || 0;
      }

      const comparison = valA > valB ? 1 : -1;
      return sort.desc ? -comparison : comparison;
    });

  const toggleSort = (field: 'timestamp' | 'price' | 'rating') => {
    setSort(prev => ({
      field,
      desc: prev.field === field ? !prev.desc : true
    }));
  };

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
                  <Gauge size={12} /> Sort Ledger
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Date', field: 'timestamp' },
                    { label: 'Price', field: 'price' },
                    { label: 'Rating', field: 'rating' }
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
                  <span className="inline-block px-3 py-1 bg-success/10 text-success text-[10px] font-black uppercase rounded-md tracking-widest border border-success/20">
                    {wash.status}
                  </span>
                  {wash.rating && (
                    <div className="flex items-center gap-1 text-yellow-400">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} size={10} fill={i < wash.rating! ? "currentColor" : "none"} strokeWidth={3} />
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
