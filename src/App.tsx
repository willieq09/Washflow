import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  auth, db, OperationType, handleFirestoreError 
} from './lib/firebase';
import { 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { 
  doc, getDoc, getDocs, setDoc, collection, query, where, orderBy, onSnapshot, addDoc, limit, serverTimestamp, Timestamp, updateDoc, deleteDoc, Query, DocumentData
} from 'firebase/firestore';
import { 
  Car, CarFront, Truck, TrendingUp, Users, LogOut, Plus, Star, Award, ChevronRight, Gauge, Briefcase, DollarSign, Check, CheckCircle, Share2, Filter, Calendar, ArrowUp, ArrowDown, X, Menu, Camera, RefreshCw, CreditCard, Sparkles, ShieldCheck, Zap, ShoppingBag, MapPin, Settings2, Info, Bell, Search, Heart, Store, Trash2, Sun, Moon, User, Activity, Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, LineChart, Line, AreaChart, Area, Cell, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from 'recharts';
import { cn, formatCurrency, calculateDistance } from './lib/utils';
import ReactMarkdown from 'react-markdown';
import { getMaintenanceTip, scanVehicleInfo, getPredictiveTips, generateAnalyticsReport, getWeatherOptimizedSchedule } from './services/geminiService';
import { sendEmail, generateBookingNotification } from './services/notificationService';

// --- Constants ---
const COMMISSION_RATE = 0.075; // 7.5% Platform Fee, 92.5% Owner Split
const MIN_WITHDRAWAL = 1000;
const ADMIN_EMAILS = ['oumawillis09@gmail.com', 'autoluxadmin02@gmail.com'];

// --- Types ---
interface UserProfile {
  uid: string;
  name: string;
  role: 'owner' | 'worker' | 'customer' | 'admin';
  email: string;
  phone?: string;
  photoUrl?: string;
  plan?: 'starter' | 'standard' | 'elite';
  stationId?: string; // Links worker to station owner
  credits?: number;
  businessName?: string;
  businessAddress?: string;
  businessLat?: number;
  businessLng?: number;
  businessRadius?: number;
  businessImage?: string;
  pricing?: {
    sedan: number;
    suv: number;
    truck: number;
  };
  vehicles?: { 
    make: string; 
    model: string; 
    year: number; 
    plate: string; 
    intensity: 'low' | 'high';
    tirePressure?: string;
    dirtLevel?: 'low' | 'medium' | 'high';
  }[];
  badges?: { id: string; name: string; icon: any; color: string; bg: string; }[];
  permissions?: {
    canManageTeam?: boolean;
    canViewAnalytics?: boolean;
    canAssignTasks?: boolean;
  };
  theme?: 'light' | 'dark';
}

type AppView = 'dashboard' | 'log' | 'history' | 'performance' | 'billing' | 'marketplace' | 'my-cars' | 'settings' | 'subscription' | 'scanner' | 'business' | 'admin';

interface Booking {
  id: string;
  userId: string;
  vehicleId?: string; // or vehicle plate
  vehicleInfo?: string;
  businessId: string;
  stationId?: string;
  businessName: string;
  slot: Timestamp;
  status: 'pending' | 'confirmed' | 'completed' | 'canceled';
  serviceType: 'in-station' | 'home-service';
  price: number;
  createdAt: Timestamp;
  notes?: string;
  workerId?: string;
  lat?: number;
  lng?: number;
}

interface Business {
  id: string;
  name: string;
  location: string;
  rating: number;
  ratingCount: number;
  ownerUid: string;
  image: string;
  lat?: number;
  lng?: number;
  pricing?: {
    sedan: number;
    suv: number;
    truck: number;
  };
  qrCode?: string;
}

interface MarketplaceItem {
  id: string;
  name: string;
  price: number;
  category: 'accessory' | 'part' | 'service';
  image: string;
  vendor: string;
  businessId?: string;
  ownerUid?: string;
}

interface WashJob {
  id: string;
  workerId: string;
  workerName: string;
  stationId?: string;
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
  usedCredit?: boolean;
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
      console.log('[AUTOLUX]', ...args);
    }
  },
  error: (...args: any[]) => {
    console.error('[AUTOLUX ERROR]', ...args);
    // Here you would typically send to Sentry or another error reporting tool
  }
};

function AnimatedVehicleIcon({ className, size = 24, type = 'car' }: { className?: string, size?: number, type?: 'car' | 'truck' }) {
  const Icon = type === 'truck' ? Truck : CarFront;
  
  return (
    <motion.div
      initial={{ y: 0 }}
      animate={{ 
        y: [0, -2, 0],
        rotate: [0, -0.5, 0.5, 0]
      }}
      transition={{ 
        duration: 4, 
        repeat: Infinity, 
        ease: "easeInOut" 
      }}
      className={cn("flex items-center justify-center", className)}
    >
      <Icon size={size} strokeWidth={1.5} />
    </motion.div>
  );
}

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
          <h2 className="text-3xl font-black text-text-main uppercase tracking-tighter mb-4">Application Crash</h2>
          <p className="text-text-dim text-sm mb-8 leading-relaxed lowercase">We've encountered a critical error. The tracking systems have logged the incident for review.</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-accent text-white font-black py-4 rounded-2xl hover:brightness-110 transition-all uppercase tracking-widest text-xs shadow-xl shadow-accent/20"
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
  const [view, setView] = useState<AppView>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    if (profile?.theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }, [profile?.theme]);

  const navigate = (to: AppView) => {
    setView(to);
    setIsSidebarOpen(false);
  };
  const [preFillWash, setPreFillWash] = useState<{ carModel: string, plateNumber: string, bookingId?: string } | null>(null);
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
    // Set persistence once at startup
    setPersistence(auth, browserLocalPersistence).catch(e => console.error("Persistence error:", e));

    // Handle redirect result for mobile browsers or storage partitioned environments
    getRedirectResult(auth).then((result) => {
      if (result) {
        console.log("Redirect authentication success:", result.user.email);
        setUser(result.user);
        setAuthLoading(false);
      }
    }).catch((error) => {
      // Clear loading state on error to prevent blank white screen
      setAuthLoading(false);
      setLoading(false);

      if (error.code === 'auth/credential-already-in-use') {
        console.warn("Credential already in use, usually safe to ignore if user is logged in.");
      } else if (error.code === 'auth/missing-initial-state') {
        console.warn("Session storage inaccessible on mobile. Clearing state for manual retry.");
      } else if (error.code !== 'auth/web-storage-unsupported') {
        console.error("Redirect auth error:", error);
      }
    });

    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        setUser(u);
        if (u) {
          const docRef = doc(db, 'users', u.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setProfile(docSnap.data() as UserProfile);
          } else {
            const isOwnerEmail = u.email && ADMIN_EMAILS.includes(u.email);
            
            // Check if this email is an authorized worker
            let assignedRole: any = isOwnerEmail ? 'owner' : null;
            let assignedStationId: string | null = null;

            if (!assignedRole && u.email) {
              const authWorkerQuery = query(collection(db, 'authorized_workers'), where('email', '==', u.email));
              const authWorkerSnap = await getDocs(authWorkerQuery);
              if (!authWorkerSnap.empty) {
                const authData = authWorkerSnap.docs[0].data();
                assignedRole = 'worker';
                assignedStationId = authData.stationId;
              }
            }

            const newProfile: any = {
              uid: u.uid,
              name: u.displayName || 'Anonymous User',
              email: u.email || '',
              role: assignedRole,
              stationId: assignedStationId,
              photoUrl: u.photoURL || null
            };
            
            if (assignedRole) {
               await setDoc(docRef, { ...newProfile, createdAt: serverTimestamp() });
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

    return () => unsub();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get('success') || params.get('paystack_success');
    const plan = params.get('plan') as any;
    const orderType = params.get('order_type');
    const itemId = params.get('item_id');
    
    if (success === 'true' && profile) {
      if (orderType === 'item' && itemId) {
        // Record order
        addDoc(collection(db, 'orders'), {
          userId: profile.uid,
          itemId,
          amount: 0, // Should ideally be passed back or fetched
          status: 'completed',
          createdAt: serverTimestamp()
        }).then(() => {
          alert("Order successful! Your product/service is confirmed.");
          window.history.replaceState({}, '', window.location.pathname);
        });
      } else if (plan) {
        let creditsToAward = 0;
        if (plan === 'basic_wash') creditsToAward = 2;
        if (plan === 'premium_wash') creditsToAward = 4;
        if (plan === 'unlimited_wash') creditsToAward = 99;

        const updateData: any = { plan };
        if (creditsToAward > 0) {
          updateData.credits = (profile.credits || 0) + creditsToAward;
        }

        updateDoc(doc(db, 'users', profile.uid), updateData).then(() => {
          setProfile(prev => prev ? { ...prev, ...updateData } : null);
          window.history.replaceState({}, '', window.location.pathname);
          alert(creditsToAward > 0 
            ? `Successfully subscribed to ${plan}. ${creditsToAward} credits have been added to your dashboard.` 
            : `Successfully upgraded to ${plan} plan.`
          );
        });
      }
    }
  }, [profile]);

  const login = async () => {
    setAuthLoading(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    
    try {
      // We skip setPersistence here to keep the user action chain intact for Safari mobile popup
      const result = await signInWithPopup(auth, provider);
      console.log("Manual authentication success:", result.user.email);
      setAuthLoading(false);
    } catch (error: any) {
      console.error("Login failed:", error);
      
      // If we are in an environment where popups are strictly blocked (common in iframes on mobile)
      // we fallback to redirect. Note: redirect can be flakey in iframes.
      if (
        error.code === 'auth/popup-blocked' || 
        error.code === 'auth/web-storage-unsupported' || 
        error.code === 'auth/internal-error'
      ) {
        try {
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirErr) {
          console.error("Redirect fallback failed:", redirErr);
        }
      }

      setAuthLoading(false);
      alert("Authentication failed: " + (error.message || "Unknown error"));
    }
  };

  const logout = () => {
    setLoading(true);
    signOut(auth).finally(() => setLoading(false));
  };

  const [showForceRefresh, setShowForceRefresh] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading) setShowForceRefresh(true);
    }, 6000);
    return () => clearTimeout(timer);
  }, [loading]);

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg p-6 text-center">
      <motion.div 
        animate={{ scale: [1, 1.2, 1], rotate: [0, 10, 0] }}
        transition={{ repeat: Infinity, duration: 1.5 }}
        className="flex flex-col items-center gap-4 mb-8"
      >
        <Car className="w-12 h-12 text-accent" />
        <span className="font-black text-text-main uppercase tracking-[0.3em] text-xs">Booting OS...</span>
      </motion.div>
      
      {showForceRefresh && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="max-w-xs"
        >
          <p className="text-xs text-text-dim mb-4 leading-relaxed italic">
            Synchronization is taking longer than expected. This can happen on some mobile browsers.
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 mx-auto px-4 py-2 bg-accent text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition shadow-lg shadow-accent/20"
          >
            <RefreshCw size={14} />
            Force Refresh
          </button>
        </motion.div>
      )}
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

  // Block workers who aren't assigned to a station
  if (profile?.role === 'worker' && !profile.stationId) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-6">
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 mx-auto">
            <ShieldCheck size={40} />
          </div>
          <h2 className="text-3xl font-black text-text-main uppercase italic tracking-tighter">Access Unauthorized</h2>
          <p className="text-text-dim lowercase font-medium">
            Your worker account is not linked to an active station. 
            Please contact your station owner to verify your authorization.
          </p>
          <button 
            onClick={logout}
            className="px-8 py-3 bg-accent text-white border border-accent/20 rounded-xl text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition shadow-xl shadow-accent/20"
          >
            Switch Account
          </button>
        </div>
      </div>
    );
  }

  // Determine if user has access to AI Scanner (Elite or Admin or specifically granted)
  const hasScannerAccess = profile.plan === 'elite' || 
                          (profile.email && ADMIN_EMAILS.includes(profile.email)) || 
                          profile.role === 'admin' ||
                          (profile.role === 'worker' && profile.permissions?.canManageTeam);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-bg flex flex-col md:flex-row relative overflow-x-hidden">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 bg-card border-b border-border sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center text-white shadow-lg shadow-accent/20">
              <Car className="w-5 h-5" />
            </div>
            <span className="font-bold text-text-main tracking-tight">AutoLux</span>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 text-text-dim hover:text-text-main transition-colors"
          >
            <Menu size={24} />
          </button>
        </div>

        {/* Sidebar Overlay */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 md:hidden"
            />
          )}
        </AnimatePresence>

        {/* Bottom Nav for Mobile */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 h-20 bg-card border-t border-border flex items-center justify-around px-2 z-40 pb-safe shadow-[0_-8px_20px_-10px_rgba(0,0,0,0.5)]">
           <MobileNavItem icon={<Gauge size={26} />} label="Dash" active={view === 'dashboard'} onClick={() => navigate('dashboard')} />
           {profile?.role === 'customer' ? (
             <>
               <MobileNavItem icon={<Search size={26} />} label="Explore" active={view === 'marketplace'} onClick={() => navigate('marketplace')} />
               <MobileNavItem icon={<CarFront size={26} />} label="Cars" active={view === 'my-cars'} onClick={() => navigate('my-cars')} />
             </>
           ) : (
             <>
               <MobileNavItem icon={<Plus size={26} />} label="Log" active={view === 'log'} onClick={() => navigate('log')} />
               <MobileNavItem icon={<Briefcase size={26} />} label="History" active={view === 'history'} onClick={() => navigate('history')} />
             </>
           )}
           <MobileNavItem icon={<Menu size={26} />} label="Menu" active={view === 'settings' || view === 'business' || view === 'admin'} onClick={() => setIsSidebarOpen(true)} />
        </div>

        {/* Sidebar */}
        <nav className={cn(
          "fixed inset-y-0 left-0 z-[60] w-72 bg-card border-r border-border p-6 flex flex-col justify-between transform transition-transform duration-300 md:translate-x-0 md:w-64",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <div>
            <div className="flex items-center justify-between mb-10">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center text-white shadow-lg shadow-accent/20">
                  <Car className="w-6 h-6" />
                </div>
                <span className="text-xl font-bold text-text-main tracking-tight">AutoLux</span>
              </div>
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="md:hidden p-2 text-text-dim hover:text-text-main transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-1">
              {profile?.role === 'customer' ? (
                <>
                  <NavItem icon={<Gauge size={20} />} label="My Hub" active={view === 'dashboard'} onClick={() => navigate('dashboard')} />
                  <NavItem icon={<Search size={20} />} label="Explore" active={view === 'marketplace'} onClick={() => navigate('marketplace')} />
                  <NavItem icon={<CarFront size={20} />} label="My Vehicles" active={view === 'my-cars'} onClick={() => navigate('my-cars')} />
                  <NavItem icon={<CreditCard size={20} />} label="Subscription" active={view === 'subscription'} onClick={() => navigate('subscription')} />
                  <NavItem icon={<Briefcase size={20} />} label="History" active={view === 'history'} onClick={() => navigate('history')} />
                </>
              ) : (
                <>
                  <NavItem icon={<Gauge size={20} />} label="Dashboard" active={view === 'dashboard'} onClick={() => navigate('dashboard')} />
                  <NavItem icon={<Plus size={20} />} label="Log Wash" active={view === 'log'} onClick={() => navigate('log')} />
                  <NavItem icon={<Briefcase size={20} />} label="History" active={view === 'history'} onClick={() => navigate('history')} />
                </>
              )}
              {(profile?.role === 'owner' || profile?.permissions?.canManageTeam) && (
                <>
                  <NavItem 
                    icon={<TrendingUp size={20} />} 
                    label="Performance" 
                    active={view === 'performance'} 
                    onClick={() => {
                      if (profile.plan === 'standard' || profile.plan === 'elite' || (profile.email && ADMIN_EMAILS.includes(profile.email)) || profile.permissions?.canManageTeam) {
                        navigate('performance');
                      } else {
                        navigate('billing');
                      }
                    }} 
                  />
                  {profile.role === 'owner' && (
                    <NavItem 
                      icon={<CreditCard size={20} />} 
                      label="Subscription" 
                      active={view === 'billing'} 
                      onClick={() => navigate('billing')} 
                    />
                  )}
                  {hasScannerAccess && (
                    <NavItem 
                      icon={<Camera size={20} className="text-accent" />} 
                      label="AI Scanner" 
                      active={view === 'scanner'} 
                      onClick={() => navigate('scanner')} 
                    />
                  )}
                  {profile.email && ADMIN_EMAILS.includes(profile.email) && (
                    <NavItem 
                      icon={<ShieldCheck size={20} className="text-success" />} 
                      label="Admin Console" 
                      active={view === 'admin'} 
                      onClick={() => navigate('admin')} 
                    />
                  )}
                </>
              )}
            </div>
          </div>

          <div className="mt-auto border-t border-border pt-6">
            <div className="flex items-center gap-3 px-2 mb-6">
              <img src={profile?.photoUrl} className="w-10 h-10 rounded-full border border-border" />
                <div className="flex flex-col">
                  <span className="text-sm font-black text-text-main leading-none">{profile?.name}</span>
                  <span className="text-xs text-text-dim mt-1 capitalize font-bold">{profile?.role}</span>
                </div>
            </div>
            
            <div className="px-2 mb-4">
              <SyncStatus isOnline={isOnline} pendingCount={pendingSync} />
            </div>

            {profile?.role === 'owner' && (
              <NavItem 
                icon={<Settings2 size={18} />} 
                label="Settings" 
                active={view === 'settings'} 
                onClick={() => navigate('settings')} 
              />
            )}
            <button 
              onClick={logout}
              className="w-full flex items-center gap-2 px-2 py-2 text-text-dim hover:text-accent transition font-bold"
            >
              <LogOut size={18} />
              <span className="text-sm">Log out</span>
            </button>
          </div>
        </nav>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 md:pl-64">
          <AnimatePresence mode="wait">
            {(view === 'dashboard' || view === 'admin') && profile && (
              profile.role === 'customer' 
                ? <CustomerDashboardView profile={profile} setView={setView} />
                : (profile.role === 'admin' || view === 'admin')
                  ? <AdminDashboardView />
                  : <DashboardView profile={profile} setView={setView} onLogWash={(data) => {
                      if (data) setPreFillWash(data);
                      setView('log');
                    }} />
            )}
            {view === 'log' && profile && (
              <LogWashForm 
                profile={profile} 
                onComplete={() => {
                  setPreFillWash(null);
                  setView('history');
                }} 
                setView={setView}
                preFill={preFillWash}
              />
            )}
            {view === 'history' && profile && (
              <HistoryView profile={profile} />
            )}
            {view === 'performance' && profile && (profile.role === 'owner' || profile.permissions?.canManageTeam) && (
              <OwnerPerformanceView />
            )}
            {(view === 'billing' || view === 'subscription') && profile && (
              <SubscriptionView profile={profile} />
            )}
            {view === 'marketplace' && <MarketplaceView profile={profile!} setView={setView} />}
            {view === 'settings' && profile && (
              <SettingsView profile={profile} onUpdate={(p) => setProfile(p)} />
            )}
            {view === 'my-cars' && <MyCarsView profile={profile!} setView={setView} onUpdate={(p) => setProfile(p)} />}
            {view === 'scanner' && profile && (
              <ScannerView profile={profile} setView={setView} onLog={(data) => {
                setPreFillWash(data);
                setView('log');
              }} />
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
        "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition duration-200 group text-sm font-semibold touch-target",
        active ? "bg-accent/10 text-accent shadow-sm" : "text-text-dim hover:bg-text-main/5 hover:text-text-main"
      )}
    >
      <span className={cn("transition", active ? "text-accent" : "text-text-dim group-hover:text-text-main")}>{icon}</span>
      {label}
    </button>
  );
}

function MobileNavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "mobile-nav-item transition-all duration-300",
        active ? "text-accent" : "text-text-dim"
      )}
    >
      <motion.div
        animate={active ? { scale: 1.1, y: -2 } : { scale: 1, y: 0 }}
        className="flex flex-col items-center gap-0.5"
      >
        {icon}
        <span className="text-[9px] font-bold tracking-tight">{label}</span>
      </motion.div>
      {active && (
        <motion.div 
          layoutId="mobileNavUnderline"
          className="absolute bottom-1 w-1 h-1 rounded-full bg-accent"
        />
      )}
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
    <div className="min-h-screen bg-bg flex items-center justify-center p-4 md:p-6 text-text-main text-center pb-12">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl w-full"
      >
        <div className="inline-flex items-center justify-center w-16 h-16 md:w-20 md:h-20 bg-accent rounded-3xl mb-8 md:mb-10 shadow-2xl shadow-accent/20 rotate-3">
          <AnimatedVehicleIcon size={32} className="text-white" />
        </div>
        <h1 className="text-5xl md:text-8xl font-black mb-6 md:mb-8 tracking-tighter uppercase italic leading-[0.9] text-text-main">
          AUTOLUX <br />
          <span className="text-accent not-italic">OPERATING SYSTEM.</span>
        </h1>
        <p className="text-lg md:text-xl text-text-main mb-10 md:mb-12 max-w-xl mx-auto font-black leading-relaxed uppercase tracking-tight italic">
          The car wash owner operating system. Manage operations locally, scale subscriptions globally.
        </p>
        <button 
          onClick={onLogin}
          disabled={authLoading}
          className="w-full md:w-auto bg-accent text-white px-10 py-5 rounded-2xl font-black flex items-center justify-center gap-4 mx-auto hover:brightness-110 transition-all shadow-xl shadow-accent/20 active:scale-95 text-xl disabled:opacity-50 disabled:cursor-not-allowed touch-target"
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
              <p className="text-xs text-text-main leading-relaxed font-bold">
                <span className="text-accent font-black">1. Blocked Popup?</span> Check your browser's address bar for a "popup blocked" icon and permit it.
              </p>
              <p className="text-xs text-text-main leading-relaxed font-bold">
                <span className="text-accent font-black">2. Iframe Restricted?</span> If the popup closes immediately, try opening the app in a 
                <span className="text-accent font-black"> New Tab</span> using the icon in the top right of the preview.
              </p>
              <p className="text-xs text-text-main leading-relaxed font-mono font-bold">
                <span className="text-accent font-black">3. Authorized Domain?</span> Ensure <code className="bg-text-main/10 px-1 rounded">run.app</code> is added to the 
                Authorized Domains in your Firebase Auth settings.
              </p>
            </div>
          </div>
        )}
        
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <FeatureCard title="Operator OS" desc="Stop revenue leakage. Manage team capacity and job logs with a high-fidelity dashboard." />
          <FeatureCard title="Subscription Joy" desc="Layer your favorite wash stations into a single monthly plan. One payment, endless shine." />
          <FeatureCard title="AI Intelligence" desc="Get predictive scheduling based on local weather and your car's personal usage history." />
        </div>
      </motion.div>
    </div>
  );
}

const VEHICLE_DATA = {
  "Toyota": ["Camry", "Corolla", "RAV4", "Hilux", "Prado", "Land Cruiser", "Vitz", "Aqua"],
  "Mercedes-Benz": ["C-Class", "E-Class", "S-Class", "GLE", "G-Wagon", "GLC", "A-Class"],
  "BMW": ["3 Series", "5 Series", "7 Series", "X3", "X5", "X6", "M4"],
  "Tesla": ["Model 3", "Model Y", "Model S", "Model X"],
  "Honda": ["Civic", "Accord", "CR-V", "HR-V", "Fit", "Vezel"],
  "Ford": ["F-150", "Mustang", "Ranger", "Everest", "Explorer"],
  "Nissan": ["Patrol", "Navara", "X-Trail", "Leaf", "Note", "Tiida"],
  "Volkswagen": ["Golf", "Tiguan", "Passat", "Polo", "Touareg"],
  "Hyundai": ["Tucson", "Santa Fe", "Elantra", "Sonata", "Kona"],
  "Kia": ["Sportage", "Sorento", "Cerato", "Rio", "Stinger"],
  "Land Rover": ["Range Rover", "Range Rover Sport", "Defender", "Discovery"],
  "Lexus": ["RX", "NX", "LX", "IS", "ES"]
};

function FeatureCard({ title, desc }: { title: string, desc: string }) {
  return (
    <div className="bento-card">
      <h3 className="font-black text-text-main mb-2 uppercase italic tracking-tighter">{title}</h3>
      <p className="text-sm text-text-main leading-relaxed font-bold lowercase">{desc}</p>
    </div>
  );
}

function WithdrawalModal({ isOpen, onClose, balance, userId }: { isOpen: boolean, onClose: () => void, balance: number, userId: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ bankName: '', accountNumber: '', amount: balance.toString(), accountName: '' });

  useEffect(() => {
    if (isOpen) {
      setForm({ bankName: '', accountNumber: '', amount: balance.toString(), accountName: '' });
    }
  }, [isOpen]);

  const handleWithdraw = async () => {
    const numericAmount = parseFloat(form.amount);
    
    if (!form.bankName || !form.accountNumber || !form.accountName || isNaN(numericAmount) || numericAmount <= 0 || numericAmount > balance) {
      alert("Please fill all fields correctly. Ensure you have sufficient balance.");
      return;
    }
    
    if (numericAmount < MIN_WITHDRAWAL) {
      alert(`Minimum withdrawal amount is ${formatCurrency(MIN_WITHDRAWAL)}`);
      return;
    }

    setSubmitting(true);
    const path = 'withdrawals';
    try {
      await addDoc(collection(db, 'withdrawals'), {
        ownerId: userId,
        amount: numericAmount,
        bankName: form.bankName,
        accountNumber: form.accountNumber,
        accountName: form.accountName,
        timestamp: serverTimestamp(),
        status: 'pending',
        method: 'manual',
        reference: `REQU-${Math.random().toString(36).substr(2, 9).toUpperCase()}`
      });

      alert("Withdrawal request queued! Our team will process this manually within 24-48 hours.");
      onClose();
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, path);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/80 backdrop-blur-sm">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-card w-full max-w-md rounded-[2.5rem] border border-border p-8 md:p-10 shadow-2xl relative overflow-hidden">
        <div className="flex justify-between items-center mb-8 md:mb-10">
          <h3 className="text-2xl md:text-3xl font-black text-text-main uppercase italic tracking-tighter leading-none">Withdrawal Console</h3>
          <button onClick={onClose} className="p-3 bg-accent text-white rounded-full hover:brightness-110 transition-all shadow-lg shadow-accent/20 touch-target">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6 md:space-y-10">
          <div className="p-6 bg-accent text-white rounded-3xl shadow-xl shadow-accent/10">
            <span className="text-[10px] font-black opacity-70 uppercase tracking-widest ml-1">Available to Clear</span>
            <div className="text-3xl md:text-4xl font-black italic tracking-tighter">{formatCurrency(balance)}</div>
          </div>

          <div className="space-y-6 md:space-y-8">
            <div className="grid grid-cols-1 gap-6">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Bank Name</label>
                <input
                  type="text"
                  placeholder="e.g. Zenith Bank"
                  className="w-full bg-bg border border-border rounded-2xl px-6 py-4 text-base font-bold text-text-main focus:border-accent outline-none placeholder:text-text-dim/20"
                  value={form.bankName}
                  onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))}
                />
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Account Number</label>
                <input
                  type="text"
                  placeholder="10 Digits"
                  maxLength={10}
                  className="w-full bg-bg border border-border rounded-2xl px-6 py-4 text-base font-bold text-text-main focus:border-accent outline-none placeholder:text-text-dim/20 font-mono tracking-widest"
                  value={form.accountNumber}
                  onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value.replace(/\D/g, '') }))}
                />
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Account Name</label>
                <input
                  type="text"
                  placeholder="Full Legal Name"
                  className="w-full bg-bg border border-border rounded-2xl px-6 py-4 text-base font-bold text-text-main focus:border-accent outline-none uppercase placeholder:text-text-dim/20"
                  value={form.accountName}
                  onChange={e => setForm(f => ({ ...f, accountName: e.target.value }))}
                />
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Amount to Withdraw</label>
                <input
                  type="number"
                  className="w-full bg-bg border border-border rounded-2xl px-6 py-5 text-3xl font-black text-text-main focus:border-accent outline-none tracking-tighter"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                />
              </div>
            </div>

            <button
              onClick={handleWithdraw}
              disabled={submitting || !form.amount || parseFloat(form.amount) <= 0 || parseFloat(form.amount) > balance}
              className="w-full py-5 bg-accent text-white rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-2xl shadow-accent/20 hover:brightness-110 transition-all disabled:opacity-50 touch-target mt-4 italic"
            >
              {submitting ? <RefreshCw className="animate-spin mx-auto" size={20} /> : "Finalize Withdrawal Flow"}
            </button>

            <p className="text-[9px] text-center text-text-dim/60 uppercase leading-relaxed font-bold px-4">
              Requests are manually verified and processed within 24-48 business hours. Ensure account details perfectly match your legal identification.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function AdminDashboardView() {
  const [stats, setStats] = useState({
    mrr: 0,
    totalWasher: 0,
    totalCars: 0,
    totalOwners: 0,
    totalRevenue: 0
  });
  const [pendingWithdrawals, setPendingWithdrawals] = useState<any[]>([]);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [topEntities, setTopEntities] = useState<{ owners: any[], workers: any[] }>({ owners: [], workers: [] });

  useEffect(() => {
    const unsubUsers = onSnapshot(query(collection(db, 'users')), (usersSnap) => {
      const users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
      
      const unsubWashes = onSnapshot(query(collection(db, 'washes')), (washSnap) => {
        const washes = washSnap.docs.map(d => d.data());

        const owners = users.filter((u: any) => u.role === 'owner');
        const workers = users.filter((u: any) => u.role === 'worker');
        const customers = users.filter((u: any) => u.role === 'customer');
        const allCars = customers.reduce((acc, curr: any) => acc + (curr.vehicles?.length || 0), 0);
        
        let totalMrr = 0;
        owners.forEach((o: any) => {
          if (o.plan === 'starter') totalMrr += 19;
          if (o.plan === 'standard') totalMrr += 49;
          if (o.plan === 'elite') totalMrr += 99;
        });
        customers.forEach((o: any) => {
          if (o.plan === 'basic_wash') totalMrr += 15;
          if (o.plan === 'premium_wash') totalMrr += 35;
          if (o.plan === 'unlimited_wash') totalMrr += 75;
        });

        const totalRevenue = washes.reduce((acc, curr: any) => acc + (curr.price || 0), 0);

        const workerStats = workers.map((w: any) => {
          const wWashes = washes.filter(wash => wash.workerId === w.uid);
          return { name: w.name, count: wWashes.length, revenue: wWashes.reduce((a, b: any) => a + (b.price || 0), 0) };
        }).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

        setStats({
          mrr: totalMrr,
          totalWasher: workers.length,
          totalCars: allCars,
          totalOwners: owners.length,
          totalRevenue
        });
        setTopEntities({ owners: [], workers: workerStats });
        setLoading(false);
      });
      return () => unsubWashes();
    });

    const qW = query(collection(db, 'withdrawals'), where('status', '==', 'pending'), orderBy('timestamp', 'asc'));
    const unsubW = onSnapshot(qW, (snap) => {
      setPendingWithdrawals(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    
    return () => {
      unsubUsers();
      unsubW();
    };
  }, []);

  const handleSettle = async (id: string) => {
    setSettlingId(id);
    const path = `withdrawals/${id}`;
    try {
      await updateDoc(doc(db, 'withdrawals', id), {
        status: 'processed',
        processedAt: serverTimestamp(),
        settledBy: auth.currentUser?.email
      });
      alert("Withdrawal marked as PAID. Internal ledger synchronized.");
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    } finally {
      setSettlingId(null);
    }
  };

  const handleDownloadRegistry = async () => {
    try {
      const usersSnap = await getDocs(query(collection(db, 'users')));
      const users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
      
      const headers = ['UID', 'Name', 'Email', 'Role', 'Status', 'Plan', 'StationID', 'BusinessName', 'JoinedAt'];
      const rows = users.map((u: any) => [
        u.uid,
        u.name || '',
        u.email || '',
        u.role || '',
        u.status || 'active',
        u.plan || 'none',
        u.stationId || '',
        u.businessName || '',
        u.createdAt?.toDate ? u.createdAt.toDate().toISOString() : ''
      ]);

      const csvContent = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.setAttribute('hidden', '');
      a.setAttribute('href', url);
      a.setAttribute('download', `registry_audit_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Download error:", err);
      alert("Failed to compile registry for export.");
    }
  };

  if (loading) return <div className="p-20 text-center animate-pulse uppercase font-black text-text-dim text-xs tracking-widest">Compiling Global Intelligence...</div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-6xl mx-auto space-y-10 pb-20">
      <header>
        <h2 className="text-5xl font-black text-text-main tracking-tighter uppercase italic leading-none">Console.</h2>
        <p className="text-text-dim text-lg lowercase mt-2">Platform-wide operation health and mission control.</p>
      </header>
      
      {/* Withdrawal Queue */}
      <section className="bento-card border-accent/20 bg-accent/5">
        <div className="flex items-center gap-3 mb-6">
          <DollarSign className="text-accent" />
          <h3 className="text-xl font-black text-text-main uppercase italic">Withdrawal Settlement Queue</h3>
          {pendingWithdrawals.length > 0 && (
            <span className="bg-accent text-white px-2 py-0.5 rounded-full text-[10px] font-black">{pendingWithdrawals.length} REQUESTS</span>
          )}
        </div>

        {pendingWithdrawals.length === 0 ? (
          <div className="p-12 text-center border border-dashed border-border rounded-2xl">
            <p className="text-text-dim text-sm uppercase font-bold tracking-widest">No pending payouts require action.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pendingWithdrawals.map((w) => (
              <div key={w.id} className="bg-bg border border-border p-5 rounded-2xl flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <span className="text-[8px] font-black text-text-dim uppercase tracking-[0.2em]">Request Amount</span>
                      <div className="text-2xl font-black text-text-main">{formatCurrency(w.amount)}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-[8px] font-black text-text-dim uppercase tracking-[0.2em]">Target Node</span>
                      <div className="text-[10px] font-bold text-accent uppercase">ID: {w.ownerId.substring(0,8)}</div>
                    </div>
                  </div>
                  
                  <div className="bg-accent-dim p-3 rounded-xl border border-border space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-text-dim uppercase">Account:</span>
                      <span className="text-text-main font-bold uppercase truncate max-w-[120px]">{w.accountName}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-text-dim uppercase">Bank:</span>
                      <span className="text-text-main font-bold truncate max-w-[120px]">{w.bankName}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-text-dim uppercase">Number:</span>
                      <span className="text-text-main font-mono">{w.accountNumber}</span>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => handleSettle(w.id)}
                  disabled={settlingId === w.id}
                  className="mt-6 w-full bg-accent text-white py-4 rounded-xl font-black text-[10px] uppercase tracking-widest hover:brightness-110 transition shadow-xl shadow-accent/20 flex items-center justify-center gap-2 group italic"
                >
                  {settlingId === w.id ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} className="group-hover:scale-125 transition" />}
                  Confirm Manual Payment
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bento-card border-none bg-accent text-white">
           <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Total MRR</span>
           <div className="text-4xl font-black mt-2 tracking-tighter">${stats.mrr}</div>
        </div>
        <div className="bento-card">
           <span className="text-[10px] font-black uppercase tracking-widest text-text-dim">Fleet Growth</span>
           <div className="text-4xl font-black mt-2 tracking-tighter text-text-main">{stats.totalCars} <span className="text-xs opacity-40">Cars</span></div>
        </div>
        <div className="bento-card">
           <span className="text-[10px] font-black uppercase tracking-widest text-text-dim">Active Nodes</span>
           <div className="text-4xl font-black mt-2 tracking-tighter text-text-main">{stats.totalOwners} <span className="text-xs opacity-40">Shops</span></div>
        </div>
        <div className="bento-card border-success/20">
           <span className="text-[10px] font-black uppercase tracking-widest text-success">Total volume</span>
           <div className="text-4xl font-black mt-2 tracking-tighter text-success">{formatCurrency(stats.totalRevenue)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bento-card">
          <h3 className="text-xl font-black text-text-main uppercase italic mb-6">Top Performing Professionals</h3>
          <div className="space-y-4">
            {topEntities.workers.map((w, i) => (
              <div key={i} className="flex items-center justify-between p-4 bg-text-main/5 rounded-2xl border border-border group hover:border-accent transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-accent/20 rounded-xl flex items-center justify-center text-accent font-black text-xs">{i+1}</div>
                  <div>
                    <div className="font-bold text-text-main text-sm uppercase">{w.name}</div>
                    <div className="text-[10px] text-text-dim uppercase tracking-widest">{w.count} washes logged</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-black text-success text-sm">{formatCurrency(w.revenue)}</div>
                  <div className="text-[9px] text-text-dim uppercase">Total Impact</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bento-card bg-accent-dim relative overflow-hidden flex flex-col justify-center items-center text-center">
           <div className="absolute top-0 right-0 p-8 opacity-5">
              <Zap size={160} />
           </div>
           <Award className="text-accent mb-6" size={64} />
           <h3 className="text-3xl font-black text-text-main uppercase italic tracking-tighter mb-4">Platform Audit Active</h3>
           <p className="text-text-dim text-sm max-w-xs lowercase">The system is currently verifying all 7.5% commission payouts across {stats.totalOwners} verified business shards.</p>
           <button 
             onClick={handleDownloadRegistry}
             className="mt-8 bg-accent text-white px-8 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:brightness-110 transition shadow-xl shadow-accent/20"
           >
             Download Full Registry
           </button>
        </div>
      </div>
    </motion.div>
  );
}

// --- View Components ---

function CustomerDashboardView({ profile, setView }: { profile: UserProfile, setView: (v: AppView) => void }) {
  const [upcoming, setUpcoming] = useState<Booking[]>([]);
  const [nearby, setNearby] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState<{ lat: number, lng: number } | null>(null);

  useEffect(() => {
    // Attempt to get customer location
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => console.warn("Geolocation denied, using defaults")
      );
    }
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, 'bookings'), 
      where('userId', '==', profile.uid),
      where('status', 'in', ['pending', 'confirmed']),
      orderBy('slot', 'asc'),
      limit(5)
    );

    const businessesQuery = query(collection(db, 'wash_businesses'), limit(12));

    const unsubBookings = onSnapshot(q, (snap) => {
      setUpcoming(snap.docs.map(d => ({ id: d.id, ...d.data() } as Booking)));
    });

    const unsubBusinesses = onSnapshot(businessesQuery, (snap) => {
      let all = snap.docs.map(d => ({ id: d.id, ...d.data() } as Business));
      
      // If empty, use samples (for UI experience)
      if (all.length === 0) {
        all = [
          {
            id: 'sample-1',
            name: "Hydro-Dynamic Pros",
            location: "742 Evergreen Terrace",
            image: "https://images.unsplash.com/photo-1520340356584-f9917d1eea6f?auto=format&fit=crop&q=80&w=1000",
            rating: 4.9,
            lat: -1.286389,
            lng: 36.817223,
            ownerUid: 'system'
          } as Business,
          {
            id: 'sample-2',
            name: "EcoShine Station",
            location: "123 Industrial Way",
            image: "https://images.unsplash.com/photo-1605610603061-9c3933bc0fa5?auto=format&fit=crop&q=80&w=1000",
            rating: 4.7,
            lat: -1.300000,
            lng: 36.790000,
            ownerUid: 'system'
          } as Business,
          {
            id: 'sample-3',
            name: "Velocity Detailers",
            location: "45 Business District",
            image: "https://images.unsplash.com/photo-1552933529-e359b2477262?auto=format&fit=crop&q=80&w=1000",
            rating: 4.8,
            lat: -1.270000,
            lng: 36.830000,
            ownerUid: 'system'
          } as Business,
          {
            id: 'sample-4',
            name: "The Wash Vault",
            location: "88 Coastal Ave",
            image: "https://images.unsplash.com/photo-1599256621730-5353e6f99f1c?auto=format&fit=crop&q=80&w=1000",
            rating: 4.5,
            lat: -1.290000,
            lng: 36.800000,
            ownerUid: 'system',
          } as Business
        ];
      }
      
      // Sort by proximity if location available
      if (location) {
        all.sort((a, b) => {
          const distA = calculateDistance(location.lat, location.lng, a.lat || 0, a.lng || 0);
          const distB = calculateDistance(location.lat, location.lng, b.lat || 0, b.lng || 0);
          return distA - distB;
        });
      }
      
      setNearby(all);
      setLoading(false);
    });

    return () => {
      unsubBookings();
      unsubBusinesses();
    };
  }, [profile, location]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-6xl mx-auto space-y-8 md:space-y-12 pb-12">
      <header className="flex flex-col md:flex-row md:justify-between md:items-end gap-6">
        <div>
          <h2 className="text-4xl md:text-5xl font-black text-text-main tracking-tighter uppercase italic leading-none">Your Hub.</h2>
          <p className="text-text-main text-base md:text-lg lowercase mt-2 font-bold italic">Manage your fleet and upcoming sessions.</p>
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="flex-1 md:flex-none bg-card px-4 md:px-6 py-3 rounded-2xl border border-border flex flex-col items-center justify-center min-w-[100px] md:min-w-[120px]">
            <span className="text-[9px] md:text-[10px] font-black text-text-main uppercase tracking-widest italic">Credits</span>
            <span className="text-xl md:text-2xl font-black text-accent">{profile.credits || 0}</span>
          </div>
          <button 
            onClick={() => setView('marketplace')}
            className="flex-1 md:flex-none bg-accent text-white px-6 md:px-8 py-3.5 rounded-2xl font-black text-[10px] md:text-[11px] uppercase tracking-widest hover:brightness-110 transition h-full touch-target"
          >
            Book Wash
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Next Session */}
        <div className="lg:col-span-2 bento-card bg-accent border-none flex flex-col justify-between p-6 md:p-10 min-h-[250px] md:min-h-[300px]">
          {upcoming.length > 0 ? (
            <>
              <div>
                <span className="text-[10px] font-black text-text-main uppercase tracking-[0.2em] mb-4 block italic">Up Next</span>
                <div className="text-3xl md:text-5xl font-black text-text-main tracking-tighter uppercase mb-4 leading-tight">
                  {upcoming[0].businessName} <br />
                  <span className="opacity-80 text-xl md:text-3xl italic">@ {upcoming[0].slot.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="inline-flex items-center gap-2 bg-text-main/40 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest text-text-main italic">
                  {upcoming[0].status} • {upcoming[0].vehicleInfo || 'Vehicle Selected'}
                </div>
              </div>
              <div className="flex gap-4 mt-8 md:mt-10">
                <button 
                  onClick={() => {
                    alert("Rescheduling requested. Our system will contact you with available alternatives.");
                  }}
                  className="flex-1 bg-white/10 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-white/20 transition touch-target border border-white/20"
                >
                  Reschedule
                </button>
                <div className="hidden md:flex flex-1 items-center justify-center px-6 py-4 rounded-2xl border-2 border-text-main/40 text-text-main font-black text-[10px] uppercase tracking-widest italic">
                  ETA 45m
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4 md:space-y-6">
                  <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-text-main/10 flex items-center justify-center">
                    <Calendar size={28} className="text-text-main" />
                  </div>
                  <div>
                    <h3 className="text-xl md:text-2xl font-black text-text-main uppercase italic">No Active Bookings</h3>
                    <p className="text-xs md:text-sm text-text-main font-black lowercase mt-1 md:mt-2 italic opacity-80">Your garage is resting. Schedule a session to keep it pristine.</p>
                  </div>
            </div>
          )}
        </div>

        {/* AI Maintenance Corner */}
        <div className="bento-card border-t-4 border-t-accent flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-black text-accent uppercase tracking-[0.2em]">AI Pulse</span>
            <h3 className="text-xl font-black text-text-main uppercase mt-2 mb-4 tracking-tighter italic">Garage Health</h3>
            <div className="space-y-4">
               {profile.vehicles && profile.vehicles.length > 0 ? (
                 <AIProactiveSchedule 
                   vehicle={profile.vehicles[0]} 
                   washHistoryCount={0} 
                   onBook={() => setView('marketplace')}
                 />
               ) : (
                 <p className="text-xs text-text-main leading-relaxed font-black uppercase italic tracking-tight">Add a vehicle to your garage to receive predictive maintenance insights and performance tracking.</p>
               )}
            </div>
          </div>
          <button className="w-full mt-6 py-4 rounded-xl bg-accent text-white font-black text-[10px] uppercase tracking-widest hover:brightness-110 transition shadow-lg shadow-accent/20">
            View Analytics
          </button>
        </div>
      </div>

      {/* Nearby Stations */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="text-accent" />
            <h3 className="text-2xl font-black text-text-main uppercase tracking-tighter">Nearby Stations</h3>
          </div>
          <span className="text-[10px] font-black text-text-main uppercase tracking-widest italic opacity-70">Sorted by Proximity</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {nearby.length > 0 ? nearby.map((biz) => (
            <div 
              key={biz.id}
              onClick={() => setView('marketplace')}
              className="group cursor-pointer bento-card p-0 overflow-hidden hover:border-accent/40 transition-all active:scale-95"
            >
              <div className="h-40 bg-zinc-900/10 relative overflow-hidden">
                <img 
                  src={biz.image || `https://images.unsplash.com/photo-1520340356584-f9917d1eea6f?auto=format&fit=crop&q=80&w=1000`} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-60 group-hover:opacity-100" 
                  alt={biz.name}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-transparent" />
                <div className="absolute top-4 right-4 bg-text-main/10 backdrop-blur-md px-2 py-1 rounded-lg flex items-center gap-1 border border-border">
                  <Star size={12} className="text-accent fill-accent" />
                  <span className="text-[10px] font-bold text-text-main">{biz.rating || '4.8'}</span>
                </div>
              </div>
              <div className="p-5">
                <h4 className="font-black text-text-main group-hover:text-accent transition-colors uppercase italic tracking-tighter">{biz.name}</h4>
                <p className="text-xs text-text-main font-bold mt-1 flex items-center gap-1 italic opacity-70">
                  <MapPin size={10} />
                  {biz.location}
                </p>
                {location && biz.lat && (
                  <div className="mt-3 text-[10px] font-black text-accent uppercase tracking-widest bg-accent/10 w-fit px-2 py-0.5 rounded">
                    {calculateDistance(location.lat, location.lng, biz.lat, biz.lng).toFixed(1)} km away
                  </div>
                )}
              </div>
            </div>
          )) : loading ? (
            [1,2,3,4].map(i => <Skeleton key={i} className="h-64" />)
          ) : (
            <div className="col-span-full p-12 text-center bg-card border border-dashed border-border rounded-3xl">
               <p className="text-text-dim">No stations indexed in your immediate perimeter.</p>
            </div>
          )}
        </div>
      </section>

      {/* Your Fleet */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CarFront className="text-accent" />
            <h3 className="text-2xl font-black text-text-main uppercase tracking-tighter">Your Fleet</h3>
          </div>
          <button 
            onClick={() => setView('my-cars')}
            className="text-[10px] font-bold text-accent uppercase tracking-widest hover:underline"
          >
            Manage Vehicles
          </button>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {profile.vehicles?.map((car, idx) => (
            <div key={idx} className="bento-card border-none bg-accent-dim flex items-center gap-6 group hover:translate-y-[-2px] transition">
              <div className="w-16 h-16 bg-bg rounded-2xl flex items-center justify-center text-text-dim group-hover:text-accent transition">
                <CarFront size={32} />
              </div>
              <div>
                <div className="font-bold text-text-main italic uppercase">{car.make} {car.model}</div>
                <div className="text-[10px] text-text-dim font-bold tracking-[0.2em] mt-1">{car.plate}</div>
                <div className="mt-2 flex items-center gap-2">
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    car.intensity === 'high' ? "bg-red-500" : "bg-success"
                  )} />
                  <span className="text-[9px] font-black uppercase text-text-dim/60">
                    Usage Intensity: {car.intensity}
                  </span>
                </div>
              </div>
            </div>
          ))}
          <button 
            onClick={() => setView('my-cars')}
            className="bento-card border-dashed border-border bg-transparent flex flex-col items-center justify-center gap-3 hover:border-accent hover:text-accent group transition min-h-[100px]"
          >
            <div className="w-8 h-8 rounded-full border border-current flex items-center justify-center">
              <Plus size={16} />
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest">Enlist Vehicle</span>
          </button>
        </div>
      </section>
    </motion.div>
  );
}

function DashboardView({ profile, setView, onLogWash }: { profile: UserProfile, setView: (v: AppView) => void, onLogWash: (data?: { carModel: string, plateNumber: string, bookingId?: string }) => void }) {
  const [stats, setStats] = useState({ 
    todayRevenue: 0, 
    todayCount: 0, 
    totalCount: 0, 
    incentives: 0, 
    ownerRevenue: 0, 
    totalWithdrawn: 0,
    pendingPayouts: 0,
    completedPayouts: 0,
    pendingEscrow: 0 
  });
  const [recentWashes, setRecentWashes] = useState<WashJob[]>([]);
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
  const [workers, setWorkers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [recentWithdrawals, setRecentWithdrawals] = useState<any[]>([]);

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
    // Fetch Workers for assignment if owner/lead
    if (profile.role === 'owner' || profile.permissions?.canManageTeam) {
      const stationId = profile.role === 'owner' ? profile.uid : profile.stationId;
      if (stationId) {
        const qWorkers = query(collection(db, 'users'), where('role', '==', 'worker'), where('stationId', '==', stationId));
        const unsubWorkers = onSnapshot(qWorkers, (snap) => {
          setWorkers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
        });
        return () => unsubWorkers();
      }
    }
  }, [profile]);

  const handleAssignWorker = async (booking: Booking, workerId: string) => {
    setAssigningId(booking.id);
    try {
      const worker = workers.find(w => w.uid === workerId);
      if (!worker) return;

      await updateDoc(doc(db, 'bookings', booking.id), {
        workerId: workerId,
        status: 'confirmed'
      });

      // Send Notification to Worker
      const workerNote = generateBookingNotification(booking, worker.name, 'worker');
      sendEmail({ to: worker.email, ...workerNote });

      // Notify Customer that someone is assigned (Optional but good)
      const customerDoc = await getDoc(doc(db, 'users', booking.userId));
      if (customerDoc.exists()) {
         const customerData = customerDoc.data() as UserProfile;
         const customerNote = {
           subject: `Pro Assigned: ${booking.businessName}`,
           html: `<p>Hi ${customerData.name}, ${worker.name} has been assigned to your wash booking.</p>`
         };
         sendEmail({ to: customerData.email, ...customerNote });
      }

    } catch (error: any) {
      console.error("Assignment failed:", error);
      alert(`Assignment Error: ${error.message}`);
    } finally {
      setAssigningId(null);
    }
  };

  useEffect(() => {
    if (profile.role === 'customer') return;

    const stationId = profile.role === 'owner' ? profile.uid : profile.stationId;
    
    // Sync Washes
    const qWashes = (profile.role === 'owner' || profile.permissions?.canManageTeam) 
      ? query(collection(db, 'washes'), where('stationId', '==', stationId), orderBy('timestamp', 'desc'), limit(50))
      : query(collection(db, 'washes'), where('workerId', '==', profile.uid), orderBy('timestamp', 'desc'), limit(50));

    const unsubWashes = onSnapshot(qWashes, { includeMetadataChanges: true }, (snap) => {
      const washes = snap.docs.map(d => ({ 
        id: d.id, 
        ...d.data(),
        isPending: d.metadata.hasPendingWrites 
      } as WashJob));
      setRecentWashes(washes.slice(0, 10));
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayWashes = washes.filter(w => {
        if (!w.timestamp) return true; // Assume today if pending local write
        try {
          return w.timestamp.toDate() >= today;
        } catch (e) {
          return true; // Fallback for edge cases
        }
      });
      
      const totalRevenue = washes.reduce((acc, curr) => acc + (curr.price || 0), 0);
      const commissionAmount = totalRevenue * COMMISSION_RATE;
      const ownerRevenue = totalRevenue - commissionAmount;

      setStats(prev => ({ 
        ...prev,
        todayRevenue: todayWashes.reduce((acc, curr) => acc + (curr.price || 0), 0),
        todayCount: todayWashes.length,
        totalCount: washes.length,
        ownerRevenue: ownerRevenue,
        pendingEscrow: ownerRevenue * 0.05
      }));
    });

    // Subscribe to withdrawals separately
    const qWithdrawals = query(collection(db, 'withdrawals'), where('ownerId', '==', profile.uid), orderBy('timestamp', 'desc'));
    const unsubWithdrawals = onSnapshot(qWithdrawals, (withdrawSnap) => {
      const docs = withdrawSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const totalRequested = docs.reduce((acc, curr) => acc + (curr.amount || 0), 0);
      const pendingAmount = docs.filter(w => w.status === 'pending').reduce((acc, curr) => acc + (curr.amount || 0), 0);
      const processedAmount = docs.filter(w => w.status === 'processed').reduce((acc, curr) => acc + (curr.amount || 0), 0);
      
      setStats(prev => ({
        ...prev,
        totalWithdrawn: totalRequested,
        pendingPayouts: pendingAmount,
        completedPayouts: processedAmount
      }));
      setRecentWithdrawals(docs.slice(0, 5));
    });

    // Sync Bookings (Queue)
    const qBookings = query(
      collection(db, 'bookings'),
      where('stationId', '==', stationId),
      where('status', '==', 'pending'),
      orderBy('slot', 'asc'),
      limit(10)
    );
    const unsubBookings = onSnapshot(qBookings, (snap) => {
      let bookings = snap.docs.map(d => ({ id: d.id, ...d.data() } as Booking));
      
      // Filter for worker role: Assigned or Nearby (Unless they are Lead/Owner)
      if (profile.role === 'worker' && !profile.permissions?.canManageTeam) {
        bookings = bookings.filter(b => {
          const isAssigned = b.workerId === profile.uid;
          
          // Nearby check (if location data exists in booking)
          let isNearby = false;
          if (profile.businessLat && profile.businessLng && b.lat && b.lng) {
            const dist = calculateDistance(profile.businessLat, profile.businessLng, b.lat, b.lng);
            isNearby = dist <= (profile.businessRadius || 500);
          }
          
          return isAssigned || isNearby || !b.workerId; // Show assigned, nearby, or unassigned available tasks
        });
      }
      
      setUpcomingBookings(bookings);
      setLoading(false); // First time bookings/washes load, we are ready
    });

    return () => {
      unsubWashes();
      unsubBookings();
      unsubWithdrawals();
    };
  }, [profile]);

  // Combined stats calculation for balance
  const availableBalance = stats.ownerRevenue - stats.totalWithdrawn;

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
      {/* Withdrawal Modal */}
      <WithdrawalModal 
        isOpen={isWithdrawModalOpen} 
        onClose={() => setIsWithdrawModalOpen(false)} 
        balance={availableBalance} 
        userId={profile.uid} 
      />
      <header className="mb-6 md:mb-10 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h2 className="text-3xl md:text-4xl font-black text-text-main tracking-tight uppercase italic leading-none">AutoLux Dashboard</h2>
          <p className="text-text-main mt-1 lowercase font-black italic">{profile.role === 'owner' ? 'Administrative Control' : 'Personal Performance'}</p>
        </div>
        <div className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-success/10 text-success border border-success/20 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest">
          <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
          System Active Shard
        </div>
      </header>

      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-4 md:grid-rows-2 gap-3 md:gap-4 auto-rows-fr">
        {/* Main Stat: Today's Revenue */}
        <div className="md:col-span-2 md:row-span-1 bento-card flex flex-col justify-between border-t-4 border-t-accent p-6 md:p-8">
          <div>
            <span className="text-[9px] md:text-[10px] font-black text-accent uppercase tracking-[0.2em] italic">
              {profile.role === 'worker' ? "Personal Unit Output" : "Live: Today's Revenue"}
            </span>
            <div className="text-5xl md:text-6xl font-black mt-2 tracking-tighter text-text-main">{formatCurrency(stats.todayRevenue)}</div>
            <p className="text-[10px] md:text-xs text-text-main mt-2 font-black italic">Synced from {stats.todayCount} service units completed today.</p>
          </div>
          <div className="mt-8 flex items-end gap-1.5 h-16">
            {[30, 45, 20, 60, 40, 75, 95].map((h, i) => (
              <div 
                key={i} 
                className={cn("flex-1 rounded-t-xl transition-all duration-700", i === 6 ? "bg-accent shadow-[0_0_15px_rgba(62,99,221,0.5)]" : "bg-accent/20")} 
                style={{ height: `${h}%` }} 
              />
            ))}
          </div>
        </div>

        {/* Owner Wallet Section */}
        {profile.role === 'owner' && (
          <div className="md:col-span-2 bento-card bg-gradient-to-br from-bg to-card border-accent/20 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
               <DollarSign size={120} strokeWidth={1} />
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 text-accent mb-4">
                <ShieldCheck size={16} />
                <span className="text-[10px] font-black uppercase tracking-widest">Verified Multi-Wallet</span>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <span className="text-[10px] font-black text-text-main uppercase tracking-[0.2em] italic">Liquid Balance</span>
                  <div className="text-4xl font-black mt-2 tracking-tighter text-text-main">{formatCurrency(availableBalance)}</div>
                  <button 
                    onClick={() => setIsWithdrawModalOpen(true)}
                    disabled={availableBalance <= 0}
                    className="mt-4 bg-accent text-white px-6 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest hover:brightness-110 transition shadow-lg shadow-accent/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowDown size={12} /> Claim to Bank
                  </button>
                </div>
                <div>
                  <span className="text-[10px] font-black text-text-main uppercase tracking-[0.2em] italic">In Queue (Manual)</span>
                  <div className="text-4xl font-black mt-2 tracking-tighter text-amber-500 font-bold">{formatCurrency(stats.pendingPayouts || 0)}</div>
                  <p className="text-[8px] text-text-main font-black uppercase mt-1 italic">Pending admin wire transfer</p>
                  
                  {recentWithdrawals.length > 0 && (
                    <div className="mt-4 space-y-2 max-h-40 overflow-y-auto pr-2">
                       <span className="text-[8px] font-black text-text-main uppercase tracking-widest italic">Payout History</span>
                       {recentWithdrawals.map((w) => (
                         <div key={w.id} className="flex justify-between items-center bg-text-main/5 p-2 rounded-lg border border-border">
                            <div className="overflow-hidden">
                               <div className="text-[9px] font-black text-text-main leading-tight uppercase truncate">{w.bankName}</div>
                               <div className="text-[7px] text-text-main font-bold uppercase italic opacity-70">{w.accountNumber}</div>
                            </div>
                            <div className="text-right flex-shrink-0">
                               <div className="text-[9px] font-black text-accent">{formatCurrency(w.amount)}</div>
                               <div className={cn(
                                 "text-[7px] font-black uppercase px-1 rounded-sm",
                                 w.status === 'pending' ? "text-amber-500 bg-amber-500/10" : "text-success bg-success/10"
                               )}>
                                 {w.status === 'pending' ? 'Queued' : 'Settled'}
                               </div>
                            </div>
                         </div>
                       ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Counter Stat or Incentives for Workers */}
        <div className="md:col-span-1 bento-card flex flex-col justify-between">
          {profile.role === 'worker' ? (
            <>
              <div>
                <span className="text-[10px] font-black text-text-main uppercase tracking-[0.2em] italic">Daily Goal Progress</span>
                <div className="flex items-end gap-2 mt-2">
                  <div className="text-5xl font-black tracking-tighter text-text-main">{stats.todayCount}</div>
                  <div className="text-xl font-black text-text-main/60 mb-1">/ 15</div>
                </div>
                <div className="w-full bg-text-main/5 h-2 rounded-full mt-4 overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (stats.todayCount / 15) * 100)}%` }}
                      className="bg-accent h-full" 
                    />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-black text-success flex items-center gap-1 uppercase italic">
                    <Award size={12} />
                    <span>Rank: Top 15%</span>
                  </div>
                  <p className="text-[9px] text-text-main font-black mt-1 lowercase italic">Great job! You're outperforming 85% of staff today.</p>
                </div>
                <div className="text-2xl font-black text-success">#{Math.floor(Math.random() * 3) + 1}</div>
              </div>
            </>
          ) : (
            <>
              <div>
                <span className="text-[10px] font-black text-text-main uppercase tracking-[0.2em] italic">Volume (24h)</span>
                <div className="text-5xl font-black mt-2 tracking-tighter text-text-main">{stats.todayCount}</div>
              </div>
              <div className="mt-4">
                <div className="text-[10px] font-bold text-success flex items-center gap-1">
                  <TrendingUp size={12} />
                  <span>Scaling up</span>
                </div>
                <div className="w-full bg-text-main/5 h-1 rounded-full mt-2 overflow-hidden">
                    <div className="bg-success h-full w-[65%]" />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Action Card */}
        <div 
          onClick={() => onLogWash()}
          className="md:col-span-1 bento-card bg-accent border-none flex flex-col items-center justify-center text-center cursor-pointer hover:brightness-110 active:scale-95 group"
        >
           <div className="w-12 h-12 rounded-full border-2 border-text-main/20 flex items-center justify-center text-text-main mb-3 group-hover:scale-110 transition">
             <Plus size={24} />
           </div>
           <div className="font-black text-lg text-text-main uppercase italic tracking-tighter">New Wash</div>
           <div className="text-[10px] text-text-main font-black uppercase tracking-widest mt-1 italic opacity-70">Quick Log</div>
        </div>

        {/* Elite Scanner Card - Only for Elite Owners */}
        {profile.role === 'owner' && profile.plan === 'elite' && (
          <div 
            onClick={() => setView('scanner')}
            className="md:col-span-1 bento-card bg-text-main border-none flex flex-col justify-between group cursor-pointer hover:brightness-110 transition-all duration-300 shadow-2xl shadow-accent/20"
          >
            <div className="flex justify-between items-start">
               <div className="w-10 h-10 rounded-xl bg-bg/5 flex items-center justify-center group-hover:bg-text-main/10 text-bg group-hover:text-text-main">
                 <Camera size={20} />
               </div>
               <div className="bg-bg/10 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest group-hover:bg-text-main/20 text-bg group-hover:text-text-main">Elite</div>
            </div>
            <div>
               <h3 className="text-lg font-black uppercase tracking-tighter leading-tight group-hover:text-text-main text-bg">AI Plate <br/> Scanner</h3>
               <p className="text-[9px] font-bold opacity-60 mt-2 group-hover:text-text-main text-bg">Instant biometric car identification.</p>
            </div>
          </div>
        )}

        {/* AI Insight Card */}
        <div className="md:col-span-2 bento-card">
           <span className="text-xs font-black text-text-main uppercase tracking-wider mb-4 block italic">AI Intelligence</span>
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
                      <h3 className="text-xl font-black text-text-main uppercase tracking-tighter italic">AI Performance Audit</h3>
                      <p className="text-[10px] text-accent font-black uppercase tracking-widest italic">Generative Intelligence Report</p>
                    </div>
                  </div>
                  <button onClick={() => setReport(null)} className="p-2 hover:bg-text-main/5 rounded-full transition">
                    <X size={20} className="text-text-main font-black" />
                  </button>
                </div>
                <div className="p-8 max-h-[60vh] overflow-y-auto custom-scrollbar">
                  <div className="prose prose-invert max-w-none text-text-main/80">
                    <ReactMarkdown
                      components={{
                        h1: ({ children }) => <h1 className="text-2xl font-black text-text-main uppercase tracking-tighter mb-6 mt-2 pb-2 border-b border-border">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-xl font-bold text-accent uppercase tracking-widest mt-8 mb-4">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-lg font-bold text-text-main mb-2">{children}</h3>,
                        p: ({ children }) => <p className="mb-4 leading-relaxed text-sm font-medium">{children}</p>,
                        ul: ({ children }) => <ul className="space-y-3 mb-6">{children}</ul>,
                        li: ({ children }) => (
                          <li className="flex gap-3 text-sm">
                            <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                            <span>{children}</span>
                          </li>
                        ),
                        strong: ({ children }) => <span className="text-text-main font-bold">{children}</span>,
                      }}
                    >
                      {report}
                    </ReactMarkdown>
                  </div>
                </div>
                <div className="p-8 bg-bg/50 border-t border-border flex justify-end">
                  <button 
                    onClick={() => setReport(null)}
                    className="bg-accent text-white px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:brightness-110 transition shadow-xl shadow-accent/20 flex items-center gap-2"
                  >
                    <CheckCircle size={16} /> Acknowledge Report
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Today's Queue / Upcoming Bookings */}
        <div className="md:col-span-2 bento-card">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-black text-text-main uppercase tracking-wider italic">Today's Queue</span>
            <span className="text-[10px] font-black text-accent uppercase tracking-widest italic">{upcomingBookings.length} pending</span>
          </div>
          <div className="space-y-4">
            {upcomingBookings.map(booking => (
              <div key={booking.id} className="flex items-center justify-between bg-text-main/5 p-4 rounded-2xl border border-border hover:border-accent/20 transition group shadow-md">
                <div className="flex items-center gap-4">
                   <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center text-accent">
                      <Calendar size={18} />
                   </div>
                   <div>
                     <p className="font-black text-sm text-text-main tracking-tight uppercase italic">{booking.vehicleInfo || 'Service Request'}</p>
                     <p className="text-[10px] font-black uppercase text-text-main tracking-widest italic opacity-70">
                       Slot: {booking.slot.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                     </p>
                   </div>
                </div>
                <div className="flex items-center gap-3">
                  {(profile.role === 'owner' || profile.permissions?.canManageTeam) && !booking.workerId && workers.length > 0 && (
                    <select 
                      disabled={assigningId === booking.id}
                      value=""
                      onChange={(e) => handleAssignWorker(booking, e.target.value)}
                      className="bg-bg/50 text-text-main px-3 py-1.5 rounded-lg text-[9px] uppercase tracking-widest border border-border outline-none focus:ring-1 focus:ring-accent cursor-pointer transition-all hover:border-accent/40 font-black italic shadow-lg"
                    >
                      <option value="" disabled className="bg-card text-text-main">Assign Pro</option>
                      {workers.map(w => (
                        <option key={w.uid} value={w.uid} className="bg-card text-text-main">{w.name}</option>
                      ))}
                    </select>
                  )}
                  <button 
                    onClick={() => onLogWash({ 
                      carModel: booking.vehicleInfo?.split('(')[0].trim() || 'Service Request', 
                      plateNumber: booking.vehicleInfo?.match(/\(([^)]+)\)/)?.[1] || '',
                      bookingId: booking.id 
                    })}
                    className="bg-accent text-white px-4 py-2 rounded-lg font-black text-[9px] uppercase tracking-widest transition shadow-xl shadow-accent/20 hover:brightness-110 flex items-center justify-center gap-2"
                  >
                    <Check size={14} /> Check-In
                  </button>
                </div>
              </div>
            ))}
            {upcomingBookings.length === 0 && (
              <div className="text-center py-6">
                <p className="text-xs text-text-dim italic">No bookings in the queue...</p>
              </div>
            )}
          </div>
        </div>

        {/* Live Activity Feed */}
        <div className="md:col-span-2 bento-card overflow-hidden h-full flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-text-dim uppercase tracking-wider">Live Station Activity</span>
              <div className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" />
            </div>
            <button 
              onClick={() => setView('history')}
              className="text-[10px] font-bold text-accent hover:underline uppercase tracking-widest"
            >
              Full Ledger
            </button>
          </div>
          <div className="space-y-3 flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {recentWashes.map(wash => (
              <div key={wash.id} className="flex items-center justify-between text-sm group p-2 bg-text-main/5 rounded-xl border border-border hover:border-accent/20 transition-colors">
                <div className="flex items-center gap-3">
                  <div className={cn("w-1.5 h-1.5 rounded-full", wash.isPending ? "bg-accent animate-pulse" : "bg-accent")} />
                  <div className="flex flex-col">
                    <span className="font-bold text-text-main text-xs uppercase">{wash.carModel}</span>
                    <span className="text-[9px] text-text-dim uppercase font-mono tracking-widest">{wash.plateNumber}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-black text-text-main">{formatCurrency(wash.price)}</div>
                  <div className="text-[8px] text-text-dim uppercase font-bold">
                    {wash.isPending ? "Syncing..." : wash.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
            {recentWashes.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center opacity-30">
                <RefreshCw className="animate-spin mb-2" size={20} />
                <p className="text-[10px] font-black uppercase tracking-[0.2em]">Monitoring station link...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function RoleSelection({ uid, name, email }: { uid: string, name: string, email: string }) {
  const [loading, setLoading] = useState<string | null>(null);

  const setRole = async (role: 'owner' | 'customer' | 'worker' | 'admin') => {
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

      if (role === 'admin') {
        userData.permissions = {
          canManageTeam: true,
          canViewAnalytics: true,
          canAssignTasks: true
        };
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
          <h2 className="text-5xl md:text-7xl font-black text-text-main tracking-tighter uppercase mb-4 leading-none">
            Choose Your <br />
            <span className="text-accent">Operation Mode.</span>
          </h2>
          <p className="text-text-dim max-w-lg mx-auto lowercase font-medium">Select the path that matches your position in the vehicle transparency ecosystem.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <RoleCard 
            icon={<Briefcase size={40} />} 
            title="Business Owner" 
            desc="Manage stations, monitor teams, and scale your wash empire with AI insight."
            onClick={() => setRole('owner')}
            loading={loading === 'owner'}
            disabled={loading !== null}
          />
          <RoleCard 
            icon={<AnimatedVehicleIcon size={40} />} 
            title="Car Owner" 
            desc="Personalized maintenance logs, AI health alerts, and verified wash history."
            onClick={() => setRole('customer')}
            loading={loading === 'customer'}
            disabled={loading !== null}
            highlight
          />
        </div>
        <p className="text-center mt-12 text-[10px] text-text-dim uppercase tracking-[0.3em] font-black">
          Worker accounts are provisioned exclusively by station owners.
        </p>
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
          ? "bg-text-main border-transparent text-bg shadow-2xl shadow-text-main/10" 
          : "bg-card border-border text-text-main hover:border-accent/40",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {loading && (
        <div className="absolute inset-0 bg-accent/20 backdrop-blur-sm flex items-center justify-center z-20">
          <RefreshCw className="w-10 h-10 text-text-main animate-spin" />
        </div>
      )}
      
      <div className={cn(
        "w-24 h-24 rounded-[2rem] flex items-center justify-center mb-12 transition-transform duration-500 group-hover:rotate-6", 
        highlight ? "bg-bg text-text-main" : "bg-text-main/5 text-accent"
      )}>
        {icon}
      </div>
      
      <h3 className="text-3xl font-black mb-4 uppercase tracking-tighter leading-none">{title}</h3>
      <p className={cn(
        "text-sm leading-relaxed mb-10 font-bold", 
        highlight ? "text-bg/80 italic font-black" : "text-text-main/70 lowercase font-bold italic"
      )}>
        {desc}
      </p>
      
      <div className={cn(
        "mt-auto flex items-center gap-3 text-sm font-black uppercase tracking-widest", 
        highlight ? "text-accent" : "bg-accent text-white px-6 py-3 rounded-xl shadow-xl shadow-accent/20 group-hover:scale-105 transition-all"
      )}>
        initialize system <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
      </div>
    </motion.button>
  );
}

function BookingModal({ business, profile, onClose }: { business: Business, profile: UserProfile, onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<'basic' | 'premium'>('basic');
  const [serviceType, setServiceType] = useState<'in-station' | 'home-service'>('in-station');
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");

  const handleConfirm = async () => {
    if (!selectedDate || !selectedTime || !selectedVehicle) return;
    
    setLoading(true);
    try {
      const slot = new Date(`${selectedDate}T${selectedTime}`);
      const bookingData: Partial<Booking> = {
        userId: profile.uid,
        vehicleId: selectedVehicle,
        vehicleInfo: `${selectedVehicle}`,
        businessId: business.id,
        stationId: business.ownerUid,
        businessName: business.name,
        slot: Timestamp.fromDate(slot),
        status: 'pending',
        serviceType: serviceType,
        price: (selectedPlan === 'premium' ? 25 : 15) + (serviceType === 'home-service' ? 10 : 0),
        createdAt: serverTimestamp() as Timestamp
      };

      await addDoc(collection(db, 'bookings'), bookingData);
      
      // Send Notifications
      try {
        // Notify Customer
        const customerNote = generateBookingNotification(bookingData, profile.name, 'customer');
        sendEmail({ to: profile.email, ...customerNote });

        // Notify Owner
        const ownerDoc = await getDoc(doc(db, 'users', business.ownerUid));
        if (ownerDoc.exists()) {
          const ownerData = ownerDoc.data() as UserProfile;
          const ownerNote = generateBookingNotification(bookingData, ownerData.name, 'owner');
          sendEmail({ to: ownerData.email, ...ownerNote });
        }
      } catch (notifyError) {
        console.warn("Notification error:", notifyError);
      }

      alert(`Booking Confirmed! ${serviceType === 'home-service' ? "Our professional will arrive at your location." : "See you at the station!"}`);
      onClose();
    } catch (error: any) {
      console.error("Booking failed:", error);
      alert(`Booking Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const vehicles = profile.vehicles || [];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-bg/90 backdrop-blur-2xl"
      />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-xl bg-card border border-border rounded-[3rem] shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto scrollable-dropdown"
      >
        <div className="p-8 md:p-12">
          <header className="mb-10 text-center md:text-left flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h3 className="text-3xl md:text-4xl font-black text-text-main uppercase italic tracking-tighter leading-none">Book at {business.name}</h3>
              <p className="text-text-dim text-sm mt-3 font-bold uppercase tracking-wider">Step {step} of 4 — {
                step === 1 ? 'Choose Vehicle' : 
                step === 2 ? 'Select Tier' : 
                step === 3 ? 'Service Mode' : 
                'Finalize Slot'
              }</p>
            </div>
            <button onClick={onClose} className="hidden md:flex p-3 bg-text-main/5 rounded-full hover:bg-text-main/10 transition text-text-dim hover:text-text-main">
              <X size={20} />
            </button>
          </header>

          {step === 1 && (
            <div className="space-y-6">
              <label className="text-[10px] font-black text-accent uppercase tracking-widest block ml-1 text-center md:text-left">Select your vehicle</label>
              {vehicles.length > 0 ? (
                <div className="grid grid-cols-1 gap-4">
                  {vehicles.map((v, idx) => (
                    <button 
                      key={idx}
                      onClick={() => setSelectedVehicle(`${v.make} ${v.model} (${v.plate})`)}
                      className={cn(
                        "flex items-center justify-between p-6 rounded-[2rem] border transition-all duration-300 group touch-target",
                        selectedVehicle?.includes(v.plate) 
                          ? "bg-accent border-transparent text-white shadow-xl shadow-accent/20 scale-[1.02]" 
                          : "bg-white/5 border-border text-text-dim hover:border-white/20 hover:bg-white/[0.07]"
                      )}
                    >
                      <div className="flex items-center gap-5">
                        <div className={cn(
                          "w-14 h-14 rounded-2xl flex items-center justify-center transition-colors",
                          selectedVehicle?.includes(v.plate) ? "bg-white/20 text-white" : "bg-bg text-text-dim group-hover:text-white"
                        )}>
                          <CarFront size={28} strokeWidth={1.5} />
                        </div>
                        <div className="text-left">
                          <p className="font-black text-xl tracking-tighter uppercase italic leading-none mb-1">{v.make} {v.model}</p>
                          <p className={cn("text-xs font-black tracking-widest font-mono", selectedVehicle?.includes(v.plate) ? "text-white/70" : "text-text-dim/60")}>{v.plate}</p>
                        </div>
                      </div>
                      {selectedVehicle?.includes(v.plate) && (
                        <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-accent shadow-lg">
                          <Check size={18} strokeWidth={3} />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-16 border-2 border-dashed border-border rounded-[2.5rem] text-center space-y-6">
                  <CarFront className="mx-auto opacity-20" size={56} />
                  <div>
                    <h4 className="text-text-main font-black uppercase italic tracking-tighter text-xl">Garage Vacant</h4>
                    <p className="text-sm text-text-dim mt-2 lowercase max-w-xs mx-auto">Initialize a vehicle unit in your garage first to begin the booking flow.</p>
                  </div>
                  <button onClick={onClose} className="text-accent text-[10px] font-black uppercase tracking-widest border-b border-accent/20 pb-1">Assemble Unit Now →</button>
                </div>
              )}
            </div>
          )}
          
          {step === 2 && (
            <div className="space-y-6">
              <label className="text-[10px] font-black text-accent uppercase tracking-widest block mb-1 text-center md:text-left">Service Tier Selection</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button 
                  onClick={() => setSelectedPlan('basic')}
                  className={cn(
                    "p-6 rounded-[2rem] border transition text-left touch-target relative overflow-hidden group",
                    selectedPlan === 'basic' ? "bg-accent border-transparent text-white shadow-xl shadow-accent/20" : "bg-white/5 border-border text-text-dim hover:border-white/20"
                  )}
                >
                  <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mb-4 transition-colors", selectedPlan === 'basic' ? "bg-white/20 text-white" : "bg-bg text-text-dim group-hover:text-white")}>
                    <Zap size={24} />
                  </div>
                  <p className="font-black text-sm uppercase tracking-widest mb-1 italic">Basic Wash</p>
                  <p className="text-3xl font-black italic tracking-tighter text-text-main">$15</p>
                </button>
                <button 
                  onClick={() => setSelectedPlan('premium')}
                  className={cn(
                    "p-6 rounded-[2rem] border transition text-left touch-target relative overflow-hidden group",
                    selectedPlan === 'premium' ? "bg-accent border-transparent text-white shadow-xl shadow-accent/20" : "bg-white/5 border-border text-text-dim hover:border-white/20"
                  )}
                >
                  <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mb-4 transition-colors", selectedPlan === 'premium' ? "bg-white/20 text-white" : "bg-bg text-text-dim group-hover:text-white")}>
                    <Sparkles size={24} />
                  </div>
                  <p className="font-black text-sm uppercase tracking-widest mb-1 italic">Premium Care</p>
                  <p className="text-3xl font-black italic tracking-tighter text-text-main">$25</p>
                  <div className="absolute top-4 right-4 bg-white text-accent px-2 py-1 rounded text-[8px] font-black uppercase tracking-widest shadow-lg">Elite</div>
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <label className="text-[10px] font-black text-accent uppercase tracking-widest block mb-1 text-center md:text-left">Delivery Method</label>
              <div className="grid grid-cols-1 gap-4">
                <button 
                  onClick={() => setServiceType('in-station')}
                  className={cn(
                    "p-8 rounded-[2rem] border transition flex items-center gap-5 touch-target group",
                    serviceType === 'in-station' ? "bg-accent border-transparent text-white shadow-xl shadow-accent/20" : "bg-white/5 border-border text-text-dim hover:border-white/20"
                  )}
                >
                   <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center transition-colors", serviceType === 'in-station' ? "bg-white/20 text-white" : "bg-bg text-text-dim font-bold")}>
                    <Store size={28} />
                   </div>
                   <div className="text-left flex-1">
                     <p className="font-black text-lg uppercase tracking-tighter italic leading-none mb-1">In-Station</p>
                     <p className={cn("text-xs lowercase", serviceType === 'in-station' ? "text-white/70" : "text-text-dim")}>Visit {business.name} and get served instantly.</p>
                   </div>
                   <div className={cn("text-sm font-black", serviceType === 'in-station' ? "text-white" : "text-accent")}>FREE</div>
                </button>
                <button 
                  onClick={() => setServiceType('home-service')}
                  className={cn(
                    "p-8 rounded-[2rem] border transition flex items-center gap-5 touch-target group",
                    serviceType === 'home-service' ? "bg-accent border-transparent text-white shadow-xl shadow-accent/20" : "bg-white/5 border-border text-text-dim hover:border-white/20"
                  )}
                >
                   <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center transition-colors", serviceType === 'home-service' ? "bg-white/20 text-white" : "bg-bg text-text-dim")}>
                    <MapPin size={28} />
                   </div>
                   <div className="text-left flex-1">
                     <p className="font-black text-lg uppercase tracking-tighter italic leading-none mb-1">Mobile Service</p>
                     <p className={cn("text-xs lowercase", serviceType === 'home-service' ? "text-white/70" : "text-text-dim")}>Our professional comes to your specific location.</p>
                   </div>
                   <div className={cn("text-sm font-black", serviceType === 'home-service' ? "text-white" : "text-accent")}>+$10</div>
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-8">
              <div className="space-y-6">
                <label className="text-[10px] font-black text-accent uppercase tracking-widest block mb-1 text-center md:text-left">Temporal Shard Selection</label>
                <div className="flex flex-col md:flex-row gap-4">
                   <div className="flex-1 space-y-2">
                      <label className="text-[9px] font-black text-text-dim uppercase tracking-[0.2em] ml-1">Calendar Date</label>
                      <input 
                        type="date" 
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="w-full bg-bg border border-border rounded-2xl px-5 py-4 text-text-main text-base font-bold focus:border-accent outline-none transition-all touch-target" 
                      />
                   </div>
                   <div className="flex-1 space-y-2">
                      <label className="text-[9px] font-black text-text-dim uppercase tracking-[0.2em] ml-1">Arrival Time</label>
                      <input 
                        type="time" 
                        value={selectedTime}
                        onChange={(e) => setSelectedTime(e.target.value)}
                        className="w-full bg-bg border border-border rounded-2xl px-5 py-4 text-text-main text-base font-bold focus:border-accent outline-none transition-all touch-target" 
                      />
                   </div>
                </div>
              </div>
              <div className="p-8 bg-accent/10 border border-accent/20 rounded-[2rem] shadow-inner">
                <p className="text-[10px] font-black text-accent uppercase tracking-[0.2em] mb-6 text-center md:text-left">Operation Summary</p>
                <div className="space-y-4">
                   <div className="flex justify-between items-center text-sm">
                      <span className="font-bold text-text-main/50 lowercase">Unit ID</span>
                      <span className="text-text-main font-black italic uppercase tracking-tighter truncate max-w-[150px]">{selectedVehicle}</span>
                   </div>
                   <div className="flex justify-between items-center text-sm">
                      <span className="font-bold text-text-main/50 lowercase">Engagement</span>
                      <span className="text-text-main font-black italic uppercase tracking-tighter">{serviceType.replace('-', ' ')}</span>
                   </div>
                   <div className="flex justify-between items-center text-sm">
                      <span className="font-bold text-text-main/50 lowercase">Service Tier</span>
                      <span className="text-text-main font-black italic uppercase tracking-tighter">{selectedPlan}</span>
                   </div>
                   <div className="border-t border-accent/20 my-4 pt-4 flex justify-between items-end">
                      <span className="text-sm font-black text-text-main uppercase italic tracking-tighter">Total Due</span>
                      <span className="text-xl font-black text-accent italic">
                        {formatCurrency((selectedPlan === 'premium' ? 25 : 15) + (serviceType === 'home-service' ? 10 : 0))}
                      </span>
                   </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-10 flex gap-4">
            {step > 1 && (
              <button 
                onClick={() => setStep(step - 1)}
                className="flex-1 bg-white/5 text-text-dim py-4 rounded-xl font-black text-[10px] uppercase tracking-widest border border-border hover:text-white transition"
              >
                Back
              </button>
            )}
            <button 
              onClick={() => {
                if (step < 4) {
                  if (step === 1 && !selectedVehicle) {
                    alert("Please select a vehicle or add one to your garage.");
                    return;
                  }
                  setStep(step + 1);
                } else {
                  handleConfirm();
                }
              }}
              disabled={loading}
              className="flex-[2] bg-accent text-white py-4 rounded-xl font-black text-[10px] uppercase tracking-widest hover:brightness-110 transition disabled:opacity-50 shadow-xl shadow-accent/20"
            >
              {loading ? "Processing..." : step === 4 ? "Confirm Reservation" : "Continue"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* Redundant business management views consolidated into SettingsView for better operating environment management */


function MarketplaceView({ profile, setView }: { profile: UserProfile, setView: (v: AppView) => void }) {
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [filter, setFilter] = useState<'all' | 'accessory' | 'part' | 'service'>('all');
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);
  
  useEffect(() => {
    const bizQ = query(collection(db, 'wash_businesses'), limit(20));
    const itemQ = query(collection(db, 'marketplace_items'), limit(24));
    
    const unsubBiz = onSnapshot(bizQ, (snapshot) => {
      let bizData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Business));
      if (bizData.length === 0) {
        bizData = [
          { id: 'sb-1', name: "Hydro-Dynamic Pros", location: "Evergreen Terrace", image: "https://images.unsplash.com/photo-1520340356584-f9917d1eea6f?auto=format&fit=crop&q=80&w=1000", rating: 4.9, ownerUid: 'system' } as Business,
          { id: 'sb-2', name: "EcoShine Station", location: "Industrial Way", image: "https://images.unsplash.com/photo-1605610603061-9c3933bc0fa5?auto=format&fit=crop&q=80&w=1000", rating: 4.7, ownerUid: 'system' } as Business,
          { id: 'sb-3', name: "Apex Detailing Hub", location: "Grand Avenue", image: "https://images.unsplash.com/photo-1552933529-e359b2477262?auto=format&fit=crop&q=80&w=1000", rating: 5.0, ownerUid: 'system' } as Business,
          { id: 'sb-4', name: "Skyline Wash & Go", location: "Vista Heights", image: "https://images.unsplash.com/photo-1599250300435-b9693f21830d?auto=format&fit=crop&q=80&w=1000", rating: 4.6, ownerUid: 'system' } as Business
        ];
      }
      setBusinesses(bizData);
    });

    const unsubItems = onSnapshot(itemQ, (snapshot) => {
      let itemData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as MarketplaceItem));
      if (itemData.length === 0) {
        itemData = [
          { id: 'si-1', name: "Ultra-Soft Microfiber Set", price: 25, category: 'accessory', vendor: "Hydro-Dynamic", image: 'https://images.unsplash.com/photo-1607860108855-64acf2078ed9?auto=format&fit=crop&q=80&w=400', ownerUid: 'system', businessId: 'sb-1' },
          { id: 'si-2', name: "Ceramic Coating Kit", price: 85, category: 'accessory', vendor: "EcoShine", image: 'https://images.unsplash.com/photo-1601362840469-51e4d8d59085?auto=format&fit=crop&q=80&w=400', ownerUid: 'system', businessId: 'sb-2' },
          { id: 'si-3', name: "Specialized Brake Pad Set", price: 150, category: 'part', vendor: "Hydro-Dynamic", image: 'https://images.unsplash.com/photo-1590674867551-11c3a2df5785?auto=format&fit=crop&q=80&w=400', ownerUid: 'system', businessId: 'sb-1' },
          { id: 'si-4', name: "Premium Wax Finish", price: 45, category: 'accessory', vendor: "Apex Detailing", image: 'https://images.unsplash.com/photo-1552933529-e359b2477262?auto=format&fit=crop&q=80&w=400', ownerUid: 'system', businessId: 'sb-3' },
          { id: 'si-5', name: "High-Performance Air Filter", price: 65, category: 'part', vendor: "Skyline Parts", image: 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&q=80&w=400', ownerUid: 'system', businessId: 'sb-4' },
          { id: 'si-6', name: "Leather Care Treatment", price: 35, category: 'service', vendor: "Apex Detailing", image: 'https://images.unsplash.com/photo-1589739900243-4b52cd9b104e?auto=format&fit=crop&q=80&w=400', ownerUid: 'system', businessId: 'sb-3' }
        ] as MarketplaceItem[];
      }
      setItems(itemData);
      setLoading(false);
    });

    return () => {
      unsubBiz();
      unsubItems();
    };
  }, []);

  const handleBuy = async (item: MarketplaceItem) => {
    if (!profile || buying) return;
    setBuying(item.id);
    try {
      const response = await fetch('/api/paystack/initialize-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: profile.email,
          amount: Math.round(item.price * 100),
          itemId: item.id,
          itemName: item.name,
          userId: profile.uid
        })
      });

      const contentType = response.headers.get("content-type");
      let responseData: any;
      if (contentType && contentType.includes("application/json")) {
        responseData = await response.json();
      } else {
        const text = await response.text();
        throw new Error(`Server error (${response.status}): ${text.substring(0, 100)}`);
      }

      if (!response.ok) throw new Error(responseData.error || responseData.message || "Failed to initialize checkout.");
      if (!responseData.authorization_url) throw new Error("No authorization URL received.");
      
      // Use top.location to escape the AI Studio iframe for payments
      if (window.top) {
        window.top.location.href = responseData.authorization_url;
      } else {
        window.location.href = responseData.authorization_url;
      }
    } catch (err: any) {
      console.error("Buy error:", err);
      alert(err.message || "An unexpected error occurred during checkout initialization.");
    } finally {
      setBuying(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className ="space-y-12 pb-20">
      {/* Search Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 bg-card p-6 md:p-10 rounded-[2.5rem] md:rounded-[3rem] border border-border overflow-hidden relative">
        <div className="relative z-10 p-2 md:p-0">
          <h2 className="text-3xl md:text-5xl font-black text-text-main uppercase tracking-tighter mb-3 italic leading-none">Explore Ecosystem.</h2>
          <p className="text-text-dim text-base md:text-lg lowercase leading-relaxed max-w-xl font-bold italic">Find premium wash labs, professional components, and mobile experts in your sector.</p>
        </div>
        <div className="flex bg-bg rounded-[1.5rem] border border-border p-3 md:min-w-[400px] relative z-10 mx-2 md:mx-0 shadow-inner group focus-within:border-accent/40 transition-colors">
          <Search className="text-text-dim mx-4 self-center group-focus-within:text-accent transition-colors" size={24} />
          <input type="text" placeholder="Search washes, parts, labs..." className="bg-transparent border-none text-text-main focus:ring-0 placeholder:text-text-dim/40 text-base py-4 w-full font-bold" />
        </div>
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-accent/20 rounded-full blur-[100px]" />
      </header>

      {/* Ecosystem Categories Grid */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Wash Stations', icon: <Store />, count: '24+ Nearby', img: 'https://images.unsplash.com/photo-1520340356584-f9917d1eea6f?auto=format&fit=crop&q=80&w=400', color: 'bg-blue-500' },
          { label: 'Detailing Pros', icon: <Sparkles />, count: '12 Active', img: 'https://images.unsplash.com/photo-1601362840469-51e4d8d59085?auto=format&fit=crop&q=80&w=400', color: 'bg-purple-500' },
          { label: 'Parts & Spares', icon: <Briefcase />, count: '450+ Items', img: 'https://images.unsplash.com/photo-1590674867551-11c3a2df5785?auto=format&fit=crop&q=80&w=400', color: 'bg-emerald-500' },
          { label: 'Mobile Experts', icon: <Truck />, count: '8 Available', img: 'https://images.unsplash.com/photo-1605610603061-9c3933bc0fa5?auto=format&fit=crop&q=80&w=400', color: 'bg-orange-500' }
        ].map((cat, i) => (
          <motion.div 
            key={i}
            whileHover={{ y: -5 }}
            className="group relative h-40 rounded-3xl overflow-hidden cursor-pointer"
          >
            <img src={cat.img} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" referrerPolicy="no-referrer" />
            <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/20 to-transparent" />
            <div className="absolute bottom-4 left-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-white bg-accent/80 p-1 rounded-md scale-75 peer-group-hover:scale-100 transition-transform">
                  {cat.icon}
                </span>
                <h4 className="text-text-main font-black uppercase text-[10px] tracking-widest">{cat.label}</h4>
              </div>
              <p className="text-text-dim text-[8px] font-bold uppercase tracking-[0.2em] ml-6">{cat.count}</p>
            </div>
          </motion.div>
        ))}
      </section>

      {/* Marketplace Picks */}
      <section>
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl font-black text-white uppercase tracking-widest flex items-center gap-2">
            <ShoppingBag className="text-accent" /> Marketplace Picks
          </h3>
          <div className="flex bg-bg rounded-xl border border-border p-1">
             {['all', 'accessory', 'part', 'service'].map((f) => (
                <button 
                  key={f}
                  onClick={() => setFilter(f as any)}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                    filter === f ? "bg-accent text-white" : "text-text-dim hover:text-white"
                  )}
                >
                  {f}
                </button>
             ))}
          </div>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-10">
          {loading ? (
            [1, 2, 3, 4].map(i => <div key={i} className="h-80 bg-card rounded-[3rem] border border-border animate-pulse shadow-2xl" />)
          ) : items.filter(item => filter === 'all' || item.category === filter).length > 0 ? (
            items.filter(item => filter === 'all' || item.category === filter).map(item => (
              <motion.div key={item.id} whileHover={{ y: -8 }} className="bg-card rounded-[3rem] border border-border overflow-hidden group shadow-2xl relative transition-all duration-500 hover:border-accent/40 flex flex-col h-full">
                <div className="h-64 md:h-48 overflow-hidden relative">
                  <img src={item.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-[1200ms]" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-transparent opacity-60" />
                  <div className="absolute top-6 right-6">
                    <span className="bg-bg/90 backdrop-blur-xl px-5 py-2.5 rounded-full text-[9px] font-black text-text-main uppercase tracking-[0.2em] border border-border shadow-2xl">{item.category}</span>
                  </div>
                </div>
                <div className="p-8 md:p-10 flex flex-col flex-1">
                  <div className="mb-10">
                    <div className="flex items-center gap-2 mb-3">
                       <ShieldCheck className="text-accent" size={14} />
                       <p className="text-accent text-[9px] font-black uppercase tracking-[0.25em]">{item.vendor || 'Authorized Lab'}</p>
                    </div>
                    <h4 className="font-black text-3xl md:text-2xl text-text-main uppercase italic tracking-tighter leading-none mb-3">{item.name}</h4>
                  </div>
                  <div className="flex flex-col gap-6 mt-auto">
                    <p className="text-4xl md:text-3xl font-black text-text-main italic tracking-tighter leading-none">{formatCurrency(item.price)}</p>
                    <button 
                      onClick={() => handleBuy(item)}
                      disabled={buying === item.id}
                      className="w-full bg-accent text-white py-6 md:py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-widest shadow-xl shadow-accent/20 hover:brightness-110 transition-all disabled:opacity-50 touch-target italic"
                    >
                      {buying === item.id ? <RefreshCw className="animate-spin mx-auto" size={18} /> : "Initialize Order →"}
                    </button>
                  </div>
                </div>
              </motion.div>
            ))
          ) : (
            <div className="col-span-full py-32 text-center bg-card/50 rounded-[4rem] border border-dashed border-border/60 mx-4 md:mx-0">
               <ShoppingBag className="mx-auto text-text-dim opacity-10 mb-10" size={120} />
               <h4 className="text-3xl font-black text-text-main italic uppercase tracking-tighter mb-4">Inventory Cycle Empty</h4>
               <p className="text-sm text-text-dim lowercase max-w-xs mx-auto font-medium">Re-sync in progress. New units will be broadcasted to this classification shortly.</p>
            </div>
          )}
        </div>
      </section>

      {/* Merchant CTA for Owners */}
      {profile.role === 'owner' && (
        <section className="bg-gradient-to-r from-accent/20 to-transparent p-8 rounded-3xl border border-accent/20 flex flex-col md:flex-row items-center justify-between gap-6 group hover:border-accent/40 transition-colors">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 bg-accent rounded-2xl flex items-center justify-center text-white shadow-xl shadow-accent/20 flex-shrink-0">
               <Store size={32} />
            </div>
            <div>
              <h4 className="text-xl font-black text-text-main uppercase tracking-tight">Expand Your Reach</h4>
              <p className="text-sm text-text-dim max-w-md mt-1 italic font-bold">Register your wash station to appear in searches and receive instant bookings from our curated community.</p>
            </div>
          </div>
          <button 
            onClick={() => setView('business')}
            className="px-8 py-4 bg-white text-bg rounded-xl font-black text-xs uppercase tracking-widest hover:bg-accent hover:text-white transition-all shadow-xl group-hover:scale-105"
          >
            Manage Station <ChevronRight size={14} className="inline ml-1" />
          </button>
        </section>
      )}

      {/* Booking Modal */}
      <AnimatePresence>
        {selectedBusiness && (
          <BookingModal 
            business={selectedBusiness} 
            profile={profile} 
            onClose={() => setSelectedBusiness(null)} 
          />
        )}
      </AnimatePresence>

      <section>
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl font-black text-white uppercase tracking-widest flex items-center gap-2">
            <Store className="text-accent" /> Top Rated Stations
          </h3>
          <button 
            onClick={() => setView('marketplace')}
            className="text-[10px] font-black uppercase text-accent tracking-[0.2em] border-b border-accent/20 pb-1"
          >
            View All
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {loading ? (
            [1, 2, 3].map(i => <Skeleton key={i} className="h-80" />)
          ) : businesses.length > 0 ? (
            businesses.map(b => (
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
                  <button 
                    onClick={() => setSelectedBusiness(b)}
                    className="w-full bg-white text-bg py-3 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-accent hover:text-white transition"
                  >
                    Book A Wash <ChevronRight size={14} />
                  </button>
                </div>
              </motion.div>
            ))
          ) : (
            <div className="col-span-1 md:col-span-3 py-20 text-center bg-card rounded-[3rem] border border-dashed border-border group">
               <Store className="mx-auto text-text-dim/20 mb-4 group-hover:text-accent/20 transition-colors" size={64} />
               <p className="text-sm font-black text-text-dim uppercase tracking-widest">No active stations in this region yet.</p>
               {profile.role === 'owner' && (
                 <button onClick={() => setView('business')} className="mt-4 text-accent text-xs font-black uppercase tracking-widest border-b border-accent/20 pb-0.5 hover:border-accent transition-colors">Be the first to join →</button>
               )}
            </div>
          )}
        </div>
      </section>

      {/* Featured Services/Ecosystem Highlights */}
      <section className="bg-card p-10 rounded-[3rem] border border-border relative overflow-hidden">
        <div className="absolute top-0 right-0 p-10 opacity-10 pointer-events-none">
          <Sparkles size={120} className="text-accent" />
        </div>
        <div className="relative z-10 flex flex-col md:flex-row gap-12">
          <div className="w-full md:w-1/3">
            <h3 className="text-3xl font-black text-white uppercase tracking-tighter mb-4 leading-none">Auto Care <br/> Experts.</h3>
            <p className="text-text-dim text-sm lowercase leading-relaxed mb-8">Our ecosystem connects you with vetted professionals specializing in premium ceramic coatings, interior restoration, and engine detailing.</p>
            <div className="space-y-4">
              {[
                { label: 'Quality Assured', icon: <ShieldCheck size={16} /> },
                { label: 'Certified Pros', icon: <Award size={16} /> },
                { label: 'Fast Turnaround', icon: <RefreshCw size={16} /> }
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 text-white">
                  <div className="w-8 h-8 bg-accent/20 rounded-lg flex items-center justify-center text-accent">
                    {item.icon}
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="w-full md:w-2/3 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-64 rounded-3xl overflow-hidden relative group">
              <img src="https://images.unsplash.com/photo-1601362840469-51e4d8d59085?auto=format&fit=crop&q=80&w=800" className="w-full h-full object-cover transition-transform group-hover:scale-105" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex flex-col justify-end p-6">
                <h5 className="text-white font-black uppercase text-xs">Premium Ceramic Coating</h5>
                <p className="text-white/60 text-[10px] uppercase tracking-widest mt-1">Starting at $299</p>
              </div>
            </div>
            <div className="h-64 rounded-3xl overflow-hidden relative group">
              <img src="https://images.unsplash.com/photo-1552933529-e359b2477262?auto=format&fit=crop&q=80&w=800" className="w-full h-full object-cover transition-transform group-hover:scale-105" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex flex-col justify-end p-6">
                <h5 className="text-white font-black uppercase text-xs">Interior Steam Clean</h5>
                <p className="text-white/60 text-[10px] uppercase tracking-widest mt-1">Starting at $149</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl font-black text-white uppercase tracking-widest flex items-center gap-2">
            <ShoppingBag className="text-accent" /> Marketplace Picks
          </h3>
          <div className="flex gap-2">
             <FilterBtn label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
             <FilterBtn label="Accessories" active={filter === 'accessory'} onClick={() => setFilter('accessory')} />
             <FilterBtn label="Parts" active={filter === 'part'} onClick={() => setFilter('part')} />
             <FilterBtn label="Services" active={filter === 'service'} onClick={() => setFilter('service')} />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {items.filter(i => filter === 'all' || i.category === filter).map(item => (
            <div 
              key={item.id} 
              className="group bg-card border border-border rounded-[2.5rem] p-6 hover:border-accent/40 transition-all flex flex-col"
            >
              <div className="aspect-square rounded-3xl mb-4 overflow-hidden relative bg-bg/50">
                <img src={item.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" referrerPolicy="no-referrer" />
                <div className="absolute bottom-4 left-4 bg-white px-3 py-1.5 rounded-xl font-black text-bg shadow-xl text-xs">
                  {formatCurrency(item.price)}
                </div>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-bold text-white mb-1">{item.name}</h4>
                <p className="text-[10px] font-black uppercase text-text-dim tracking-widest">By {item.vendor}</p>
              </div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleBuy(item);
                }}
                disabled={!!buying}
                className="mt-6 w-full py-3 bg-white/5 border border-border text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-accent hover:border-transparent transition flex items-center justify-center gap-2"
              >
                {buying === item.id ? <RefreshCw size={12} className="animate-spin" /> : <ShoppingBag size={12} />}
                {buying === item.id ? 'Processing...' : 'Quick Buy'}
              </button>
            </div>
          ))}
        </div>
      </section>
    </motion.div>
  );
}

function FilterBtn({ label, active, onClick }: { label: string, active?: boolean, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition border",
        active ? "bg-accent text-white border-transparent" : "bg-white/5 text-text-dim border-border hover:text-white"
      )}
    >
      {label}
    </button>
  );
}

function VehicleCard({ vehicle, onDelete }: { vehicle: any, onDelete?: (plate: string) => void }) {
  const [predictive, setPredictive] = useState<{ nextWash: string, maintenance: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const historyCount = vehicle.intensity === 'high' ? 6 : 2;
    getPredictiveTips(vehicle, historyCount).then(res => {
      setPredictive(res);
      setLoading(false);
    });
  }, [vehicle]);

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-card p-6 md:p-8 rounded-[2.5rem] border border-border flex flex-col gap-6 relative overflow-hidden group"
    >
      <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl pointer-events-none" />
      
      <div className="flex flex-col md:flex-row gap-6 md:gap-8">
        <div className="w-full md:w-1/3 aspect-[16/10] bg-gradient-to-br from-white/10 to-white/5 rounded-3xl relative flex items-center justify-center overflow-hidden border border-white/10 shadow-inner group/icon">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(var(--accent-rgb),0.15),transparent_70%)] opacity-0 group-hover/icon:opacity-100 transition-opacity duration-700" />
          <AnimatedVehicleIcon size={64} className="text-white/20 group-hover:text-accent/40 transition-colors duration-500 relative z-10" />
          <div className="absolute bottom-4 left-4 right-4 h-1 bg-white/5 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: "98%" }}
              transition={{ duration: 1.5, delay: 0.5 }}
              className="h-full bg-success/40"
            />
          </div>
        </div>
        
        <div className="flex-1 flex flex-col justify-center relative">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={cn(
                "px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border",
                vehicle.intensity === 'high' ? "bg-red-500/10 text-red-500 border-red-500/20" : "bg-accent/10 text-accent border-accent/20"
              )}>
                {vehicle.intensity === 'high' ? 'High Intensity' : 'Standard Use'}
              </span>
              <span className="text-[9px] font-black text-text-dim uppercase tracking-widest bg-white/5 px-2.5 py-0.5 rounded-full border border-white/5">Verified</span>
            </div>
            {onDelete && (
              <button 
                onClick={() => onDelete(vehicle.plate)}
                className="p-2 text-text-dim hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all"
                title="Remove Vehicle"
              >
                <X size={16} />
              </button>
            )}
          </div>
          
          <h3 className="text-3xl font-black text-white uppercase tracking-tighter mb-4 leading-none">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-bg/40 p-4 rounded-2xl border border-border/50 group-hover:border-accent/20 transition-colors">
              <p className="text-[9px] font-bold text-text-dim uppercase mb-1 tracking-widest">Plate ID</p>
              <p className="font-mono text-text-main text-sm font-bold">{vehicle.plate}</p>
            </div>
            <div className="bg-bg/40 p-4 rounded-2xl border border-border/50 group-hover:border-accent/20 transition-colors">
              <p className="text-[9px] font-bold text-text-dim uppercase mb-1 tracking-widest">Efficiency</p>
              <p className="font-mono text-success text-sm font-bold">98%</p>
            </div>
            {vehicle.tirePressure && (
              <div className="bg-bg/40 p-4 rounded-2xl border border-border/50 group-hover:border-accent/20 transition-colors">
                <p className="text-[9px] font-bold text-text-dim uppercase mb-1 tracking-widest">Tire Status</p>
                <p className={cn(
                  "text-xs font-bold",
                  vehicle.tirePressure.toLowerCase().includes('low') ? "text-red-400" : "text-success"
                )}>{vehicle.tirePressure}</p>
              </div>
            )}
            {vehicle.dirtLevel && (
              <div className="bg-bg/40 p-4 rounded-2xl border border-border/50 group-hover:border-accent/20 transition-colors">
                <p className="text-[9px] font-bold text-text-dim uppercase mb-1 tracking-widest">Condition</p>
                <p className={cn(
                  "text-xs font-bold uppercase",
                  vehicle.dirtLevel === 'high' ? "text-red-400" : vehicle.dirtLevel === 'medium' ? "text-yellow-400" : "text-success"
                )}>{vehicle.dirtLevel} dirt</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white/5 border border-white/5 rounded-3xl p-5 relative overflow-hidden group/tip hover:bg-white/[0.07] transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={12} className="text-accent" />
            <span className="text-[9px] font-black text-text-dim uppercase tracking-widest">Predictive Wash</span>
          </div>
          {loading ? (
            <div className="space-y-1.5">
              <div className="h-2.5 bg-white/10 rounded w-full animate-pulse" />
              <div className="h-2.5 bg-white/10 rounded w-2/3 animate-pulse" />
            </div>
          ) : (
            <p className="text-xs text-white/70 font-medium leading-relaxed italic line-clamp-2">
               "{predictive?.nextWash}"
            </p>
          )}
        </div>

        <div className="bg-white/5 border border-white/5 rounded-3xl p-5 relative overflow-hidden group/tip hover:bg-white/[0.07] transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <Gauge size={12} className="text-accent" />
            <span className="text-[9px] font-black text-text-dim uppercase tracking-widest">AI Maintenance</span>
          </div>
          {loading ? (
            <div className="space-y-1.5">
              <div className="h-2.5 bg-white/10 rounded w-full animate-pulse" />
              <div className="h-2.5 bg-white/10 rounded w-2/3 animate-pulse" />
            </div>
          ) : (
            <p className="text-xs text-white/70 font-medium leading-relaxed italic line-clamp-2">
               "{predictive?.maintenance}"
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function AIProactiveSchedule({ vehicle, washHistoryCount, onBook }: { vehicle: any, washHistoryCount: number, onBook?: (day: string) => void }) {
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

      <button 
        onClick={() => onBook?.(schedule?.optimalDay || 'future')}
        className="w-full bg-bg text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-widest border border-white/20 hover:bg-white hover:text-bg transition mt-2"
      >
        Book for {schedule?.optimalDay}
      </button>
    </div>
  );
}

function MyCarsView({ profile, setView, onUpdate }: { profile: UserProfile, setView: (v: AppView) => void, onUpdate: (p: UserProfile) => void }) {
  const [vehicles, setVehicles] = useState(profile.vehicles || []);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newVehicle, setNewVehicle] = useState({ 
    make: '', 
    model: '', 
    year: new Date().getFullYear(), 
    plate: '', 
    intensity: 'low' as 'low' | 'high',
    tirePressure: 'Normal',
    dirtLevel: 'low' as 'low' | 'medium' | 'high'
  });
  const [saving, setSaving] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isProcessingScan, setIsProcessingScan] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const startScanning = async () => {
    setIsScannerOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera access error:", err);
      alert("Could not access camera. Please check permissions.");
      setIsScannerOpen(false);
    }
  };

  const stopScanning = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
    }
    setIsScannerOpen(false);
  };

  const handleCaptureAndIdentify = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setIsProcessingScan(true);
    const context = canvasRef.current.getContext('2d');
    if (context) {
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      context.drawImage(videoRef.current, 0, 0);
      const base64Image = canvasRef.current.toDataURL('image/jpeg', 0.8).split(',')[1];
      try {
        const res = await scanVehicleInfo(base64Image);
        if (res.vehicle) {
          const parts = res.vehicle.split(' ');
          let year = new Date().getFullYear();
          let make = '';
          let model = '';
          if (parts[0] && !isNaN(parseInt(parts[0]))) {
            year = parseInt(parts[0]);
            make = parts[1] || '';
            model = parts.slice(2).join(' ') || '';
          } else {
            make = parts[0] || '';
            model = parts.slice(1).join(' ') || '';
          }
          setNewVehicle(prev => ({
            ...prev,
            make: make || prev.make,
            model: model || prev.model,
            year: year || prev.year,
            plate: res.plate || prev.plate
          }));
          stopScanning();
        }
      } catch (error) {
        alert("Autoscan failed. Please enter manually.");
      } finally { setIsProcessingScan(false); }
    }
  };

  const stats = useMemo(() => {
    return {
      total: vehicles.length,
      highIntensity: vehicles.filter(v => v.intensity === 'high').length,
      warningTyres: vehicles.filter(v => v.tirePressure && v.tirePressure !== 'Normal' && v.tirePressure !== 'Unknown').length,
      needsWash: vehicles.filter(v => v.dirtLevel === 'high' || v.dirtLevel === 'medium').length,
    };
  }, [vehicles]);

  const filteredVehicles = useMemo(() => {
    if (!searchTerm.trim()) return vehicles;
    const term = searchTerm.toLowerCase();
    return vehicles.filter(v => 
      v.make.toLowerCase().includes(term) || 
      v.model.toLowerCase().includes(term) || 
      v.plate.toLowerCase().includes(term)
    );
  }, [vehicles, searchTerm]);

  const handleDelete = async (plate: string) => {
    if (!confirm("Are you sure you want to remove this vehicle?")) return;
    try {
      const updatedVehicles = vehicles.filter(v => v.plate !== plate);
      await updateDoc(doc(db, 'users', profile.uid), { vehicles: updatedVehicles });
      const newProfile = { ...profile, vehicles: updatedVehicles };
      onUpdate(newProfile);
      setVehicles(updatedVehicles);
    } catch (error) {
      console.error("Error deleting vehicle:", error);
      alert("Failed to remove vehicle.");
    }
  };

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
      setNewVehicle({ 
        make: '', 
        model: '', 
        year: new Date().getFullYear(), 
        plate: '', 
        intensity: 'low',
        tirePressure: 'Normal',
        dirtLevel: 'low'
      });
    } catch (error) {
      console.error("Error adding vehicle:", error);
      alert("Failed to add vehicle.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl mx-auto space-y-8 md:space-y-12 pb-24 px-4 md:px-0">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12">
        <div>
          <h2 className="text-4xl md:text-5xl font-black text-white tracking-tighter uppercase italic leading-none">Vehicle Garage.</h2>
          <div className="flex items-center gap-3 mt-3">
             <div className="flex items-center gap-2 px-3 py-1 bg-accent/10 border border-accent/20 rounded-full">
               <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
               <span className="text-[9px] font-black uppercase text-accent tracking-widest leading-none">Operating Environment: Active</span>
             </div>
             <p className="text-text-dim text-xs lowercase hidden md:block opacity-60">Verified fleet status monitoring enabled.</p>
          </div>
        </div>
        <button 
          onClick={() => setShowAdd(!showAdd)}
          className="w-full md:w-auto bg-accent text-white px-10 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-white hover:text-bg transition shadow-xl shadow-accent/20 flex items-center justify-center gap-3 touch-target"
        >
          {showAdd ? <X size={18} /> : <Plus size={18} />}
          {showAdd ? "Close Uplink" : "Add New Unit"}
        </button>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bento-card p-6 border-l-4 border-l-accent flex flex-col justify-between">
          <span className="text-[10px] font-black text-text-dim uppercase tracking-widest">Active Units</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-4xl font-black text-text-main">{stats.total}</span>
            <span className="text-[10px] font-bold text-accent uppercase">Fleet</span>
          </div>
        </div>
        <div className="bento-card p-6 border-l-4 border-l-orange-500 flex flex-col justify-between">
          <span className="text-[10px] font-black text-text-dim uppercase tracking-widest">High Intensity</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-4xl font-black text-text-main">{stats.highIntensity}</span>
            <span className="text-[10px] font-bold text-orange-500 uppercase">Alert</span>
          </div>
        </div>
        <div className="bento-card p-6 border-l-4 border-l-yellow-500 flex flex-col justify-between">
          <span className="text-[10px] font-black text-text-dim uppercase tracking-widest">Maintenance</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-4xl font-black text-text-main">{stats.warningTyres}</span>
            <span className="text-[10px] font-bold text-yellow-500 uppercase">Priority</span>
          </div>
        </div>
        <div className="bento-card p-6 border-l-4 border-l-blue-500 flex flex-col justify-between">
          <span className="text-[10px] font-black text-text-dim uppercase tracking-widest">Hygiene Status</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-4xl font-black text-text-main">{stats.needsWash}</span>
            <span className="text-[10px] font-bold text-blue-500 uppercase">Due</span>
          </div>
        </div>
      </div>

      <div className="relative group max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-dim group-focus-within:text-accent transition-colors" size={16} />
        <input 
          type="text"
          placeholder="Filter fleet records..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-white/5 border border-border rounded-2xl pl-12 pr-4 py-4 text-sm font-medium text-white outline-none focus:border-accent/40 focus:ring-4 focus:ring-accent/5 transition-all"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {filteredVehicles.map((vehicle, idx) => (
            <motion.div 
              key={vehicle.plate}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ delay: idx * 0.05 }}
              className="bento-card p-0 overflow-hidden flex flex-col group cursor-default"
            >
              <div className="relative h-48 bg-gradient-to-br from-white/10 to-transparent flex items-center justify-center border-b border-border overflow-hidden">
                <AnimatedVehicleIcon size={80} className="text-white/20 group-hover:text-accent/40 transition-colors duration-500" />
                <div className="absolute top-4 left-4 inline-flex items-center gap-2 bg-black/40 backdrop-blur-md px-2 py-1 rounded-lg border border-white/10 text-[8px] font-black uppercase tracking-[0.2em] text-white">
                  {vehicle.intensity === 'high' ? <Zap size={10} className="text-accent" /> : <ShieldCheck size={10} className="text-success" />}
                  {vehicle.intensity} Priority
                </div>
                <button 
                  onClick={() => handleDelete(vehicle.plate)}
                  className="absolute top-4 right-4 p-2 bg-black/40 backdrop-blur-md rounded-lg border border-white/10 text-text-dim hover:text-red-500 hover:border-red-500/40 transition-all opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="p-8 space-y-6">
                <div>
                  <h3 className="text-2xl font-black text-white tracking-tighter uppercase italic">{vehicle.make} {vehicle.model}</h3>
                  <p className="font-mono text-xs text-text-dim uppercase tracking-widest mt-1">{vehicle.plate}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[8px] font-black text-text-dim uppercase tracking-widest">Tyre Pressure</p>
                    <p className={cn(
                      "text-xs font-bold",
                      vehicle.tirePressure === 'Normal' ? "text-success" : "text-yellow-500"
                    )}>{vehicle.tirePressure || 'Stable'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[8px] font-black text-text-dim uppercase tracking-widest">Hygiene Level</p>
                    <p className={cn(
                      "text-xs font-bold",
                      vehicle.dirtLevel === 'low' ? "text-success" : vehicle.dirtLevel === 'medium' ? "text-yellow-400" : "text-orange-500"
                    )}>{vehicle.dirtLevel || 'Pristine'}</p>
                  </div>
                </div>

                <div className="pt-6 border-t border-border">
                  <AIProactiveSchedule 
                    vehicle={vehicle} 
                    washHistoryCount={0} 
                    onBook={() => setView('marketplace')}
                  />
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        
        {filteredVehicles.length === 0 && (
          <div className="col-span-full py-20 flex flex-col items-center justify-center text-center bento-card border-dashed">
            <div className="w-20 h-20 bg-white/5 rounded-[2rem] flex items-center justify-center mb-6">
              <CarFront className="w-10 h-10 text-white/20" />
            </div>
            <h3 className="text-2xl font-black text-white uppercase italic tracking-tighter">No Units Detected</h3>
            <p className="text-sm text-text-dim mt-2 max-w-xs mx-auto leading-relaxed">
              Your fleet registry is empty. Scan your first vehicle to begin active tracking.
            </p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showAdd && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-bg/95 backdrop-blur-2xl">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-card border border-border w-full max-w-md rounded-[3rem] p-10 space-y-8 relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-accent" />
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-black text-white uppercase italic tracking-tighter">New Fleet Unit</h3>
                <button onClick={() => setShowAdd(false)} className="p-3 bg-white/5 hover:bg-white/10 rounded-full transition-colors"><X size={20} className="text-text-dim" /></button>
              </div>

              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Make</label>
                    <input 
                      type="text"
                      placeholder="e.g. Toyota"
                      value={newVehicle.make}
                      onChange={(e) => setNewVehicle({...newVehicle, make: e.target.value})}
                      className="w-full bg-white/5 border border-border rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-accent/40"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Model</label>
                    <input 
                      type="text"
                      placeholder="e.g. Hilux"
                      value={newVehicle.model}
                      onChange={(e) => setNewVehicle({...newVehicle, model: e.target.value})}
                      className="w-full bg-white/5 border border-border rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-accent/40"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">License Plate</label>
                  <input 
                    type="text"
                    placeholder="ABC-1234"
                    value={newVehicle.plate}
                    onChange={(e) => setNewVehicle({...newVehicle, plate: e.target.value.toUpperCase()})}
                    className="w-full bg-white/5 border border-border rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-accent/40 font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Usage Intensity</label>
                    <select 
                      value={newVehicle.intensity}
                      onChange={(e) => setNewVehicle({...newVehicle, intensity: e.target.value as any})}
                      className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-accent/40 appearance-none"
                    >
                      <option value="low" className="bg-card text-text-main">Low (Commute)</option>
                      <option value="high" className="bg-card text-text-main">High (Commercial)</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Current Dirt Level</label>
                    <select 
                      value={newVehicle.dirtLevel}
                      onChange={(e) => setNewVehicle({...newVehicle, dirtLevel: e.target.value as any})}
                      className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-accent/40 appearance-none"
                    >
                      <option value="low" className="bg-card text-text-main">Low (Clean)</option>
                      <option value="medium" className="bg-card text-text-main">Medium</option>
                      <option value="high" className="bg-card text-text-main">High (Off-road)</option>
                    </select>
                  </div>
                </div>

                <button 
                  onClick={handleAddVehicle}
                  disabled={saving}
                  className="w-full bg-white text-bg py-4 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-accent hover:text-white transition-all shadow-xl shadow-white/5 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {saving ? <RefreshCw className="animate-spin" size={16} /> : <Plus size={16} strokeWidth={3} />}
                  Authorize Registry
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CustomerVehicleView({ profile, setView, onUpdate }: { profile: UserProfile, setView: (v: AppView) => void, onUpdate: (p: UserProfile) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [vehicles, setVehicles] = useState(profile.vehicles || []);
  const [searchTerm, setSearchTerm] = useState('');
  const [newVehicle, setNewVehicle] = useState({ 
    make: '', 
    model: '', 
    year: new Date().getFullYear(), 
    plate: '', 
    intensity: 'low' as 'low' | 'high',
    tirePressure: 'Unknown',
    dirtLevel: 'low' as 'low' | 'medium' | 'high'
  });
  const [saving, setSaving] = useState(false);
  
  // Scanning state
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isProcessingScan, setIsProcessingScan] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const startScanning = async () => {
    setIsScannerOpen(true);
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
      setIsScannerOpen(false);
    }
  };

  const stopScanning = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
    }
    setIsScannerOpen(false);
  };

  const handleCaptureAndIdentify = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    setIsProcessingScan(true);
    const context = canvasRef.current.getContext('2d');
    if (context) {
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      context.drawImage(videoRef.current, 0, 0);
      
      const base64Image = canvasRef.current.toDataURL('image/jpeg', 0.8).split(',')[1];
      
      try {
        const res = await scanVehicleInfo(base64Image);
        if (res.vehicle) {
          // Parse "Year Brand Model" or similar from res.vehicle
          // Gemini returns something like "2022 Toyota Camry"
          const parts = res.vehicle.split(' ');
          let year = new Date().getFullYear();
          let make = '';
          let model = '';

          if (parts[0] && !isNaN(parseInt(parts[0]))) {
            year = parseInt(parts[0]);
            make = parts[1] || '';
            model = parts.slice(2).join(' ') || '';
          } else {
            make = parts[0] || '';
            model = parts.slice(1).join(' ') || '';
          }

          setNewVehicle(prev => ({
            ...prev,
            make: make || prev.make,
            model: model || prev.model,
            year: year || prev.year,
            plate: res.plate || prev.plate,
            tirePressure: res.tirePressure || prev.tirePressure,
            dirtLevel: res.dirtLevel || prev.dirtLevel
          }));
          stopScanning();
        } else {
          alert("Could not identify vehicle. Please try again or clear the view.");
        }
      } catch (error) {
        alert("Scan failed. Ensure good lighting and clear view.");
      } finally {
        setIsProcessingScan(false);
      }
    }
  };

  const filteredVehicles = useMemo(() => {
    if (!searchTerm.trim()) return vehicles;
    const term = searchTerm.toLowerCase();
    return vehicles.filter(v => 
      v.make.toLowerCase().includes(term) || 
      v.model.toLowerCase().includes(term) || 
      v.plate.toLowerCase().includes(term)
    );
  }, [vehicles, searchTerm]);

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
      setNewVehicle({ 
        make: '', 
        model: '', 
        year: new Date().getFullYear(), 
        plate: '', 
        intensity: 'low',
        tirePressure: 'Unknown',
        dirtLevel: 'low'
      });
    } catch (error) {
      console.error("Error adding vehicle:", error);
      alert("Failed to add vehicle.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteVehicle = async (plate: string) => {
    if (!confirm("Are you sure you want to remove this vehicle? This will also delete its AI history.")) return;
    try {
      const updatedVehicles = vehicles.filter(v => v.plate !== plate);
      await updateDoc(doc(db, 'users', profile.uid), { vehicles: updatedVehicles });
      onUpdate({ ...profile, vehicles: updatedVehicles });
      setVehicles(updatedVehicles);
    } catch (error) {
      console.error("Error deleting vehicle:", error);
      alert("Failed to remove vehicle.");
    }
  };

  useEffect(() => {
    if (!showAdd) {
      stopScanning();
    }
  }, [showAdd]);

  return (
    <div className="space-y-8 pb-20">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-4xl font-black text-white uppercase tracking-tighter italic">My Garage</h2>
          <p className="text-text-dim text-sm lowercase mt-1">Manage your fleet and track predictive health metrics.</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full md:w-auto">
          {vehicles.length > 0 && (
            <div className="relative group min-w-[240px]">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-dim group-focus-within:text-accent transition-colors" size={16} />
              <input 
                type="text"
                placeholder="Find match..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-white/5 border border-border rounded-2xl pl-12 pr-4 py-3 text-xs font-medium text-white outline-none focus:border-accent/40 focus:ring-4 focus:ring-accent/5 transition-all"
              />
              {searchTerm && (
                <button 
                  onClick={() => setSearchTerm('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-text-dim hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          
          <button 
            onClick={() => setShowAdd(true)}
            className="bg-white text-bg px-6 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-accent hover:text-white transition flex items-center justify-center gap-2 shadow-xl shadow-white/5 active:scale-95"
          >
             <Plus size={16} strokeWidth={3} /> Add To Garage
          </button>
        </div>
      </header>

      <AnimatePresence>
        {showAdd && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-bg/95 backdrop-blur-2xl">
             <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-card border border-border w-full max-w-md rounded-[3rem] p-10 space-y-8 relative overflow-hidden"
             >
                <div className="absolute top-0 left-0 w-full h-1 bg-accent" />
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-black text-text-main uppercase italic tracking-tighter">Registration</h3>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={isScannerOpen ? stopScanning : startScanning}
                      className={cn(
                        "p-3 rounded-full transition-colors flex items-center justify-center",
                        isScannerOpen ? "bg-accent text-white" : "bg-white/5 text-text-dim hover:bg-white/10 hover:text-white"
                      )}
                      title="AI Auto-Scan"
                    >
                      <Camera size={20} className={cn(isScannerOpen && "animate-pulse")} />
                    </button>
                    <button onClick={() => setShowAdd(false)} className="p-3 bg-white/5 hover:bg-white/10 rounded-full transition-colors"><X size={20} className="text-text-dim" /></button>
                  </div>
                </div>

                {isScannerOpen ? (
                  <div className="space-y-6">
                    <div className="relative aspect-video bg-black rounded-3xl overflow-hidden border border-white/10 shadow-2xl overflow-hidden group">
                      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                      <canvas ref={canvasRef} className="hidden" />
                      
                      <div className="absolute inset-0 border-2 border-accent/30 rounded-3xl pointer-events-none">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-32 border-2 border-accent border-dashed opacity-50 rounded-2xl" />
                      </div>

                      {isProcessingScan && (
                        <div className="absolute inset-0 bg-bg/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                          <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                          <p className="text-[10px] font-black uppercase tracking-widest text-text-main">Analyzing Fleet Data...</p>
                        </div>
                      )}

                      <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center">
                         <p className="text-[8px] font-black text-text-main/50 uppercase tracking-[0.2em]">Auto-Detection Active</p>
                         <button 
                          onClick={handleCaptureAndIdentify}
                          disabled={isProcessingScan}
                          className="bg-accent text-white px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-xl shadow-accent/20"
                         >
                           Analyze Frame
                         </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3">
                      <button 
                        onClick={stopScanning}
                        className="w-full bg-white/5 text-text-dim py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition"
                      >
                        Back to Manual Entry
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                         <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Make</label>
                         <select 
                           value={newVehicle.make} 
                           onChange={e => setNewVehicle(v => ({ ...v, make: e.target.value, model: '' }))} 
                           className="w-full bg-bg border border-border rounded-2xl px-5 py-4 text-sm text-text-main focus:border-accent outline-none appearance-none"
                         >
                           <option value="" className="bg-card">Select Make</option>
                           {Object.keys(VEHICLE_DATA).map(m => (
                             <option key={m} value={m} className="bg-card text-white">{m}</option>
                           ))}
                           <option value="Other" className="bg-card">Other</option>
                         </select>
                      </div>
                      <div className="space-y-2">
                         <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Model</label>
                         {newVehicle.make === 'Other' ? (
                           <input 
                             value={newVehicle.model} 
                             onChange={e => setNewVehicle(v => ({ ...v, model: e.target.value }))} 
                             className="w-full bg-bg border border-border rounded-2xl px-5 py-4 text-sm text-text-main focus:border-accent outline-none" 
                             placeholder="Enter model" 
                           />
                         ) : (
                           <select 
                             value={newVehicle.model} 
                             onChange={e => setNewVehicle(v => ({ ...v, model: e.target.value }))} 
                             disabled={!newVehicle.make}
                             className="w-full bg-bg border border-border rounded-2xl px-5 py-4 text-sm text-text-main focus:border-accent outline-none appearance-none disabled:opacity-50"
                           >
                             <option value="" className="bg-card">Select Model</option>
                             {newVehicle.make && VEHICLE_DATA[newVehicle.make as keyof typeof VEHICLE_DATA]?.map(m => (
                               <option key={m} value={m} className="bg-card text-white">{m}</option>
                             ))}
                           </select>
                         )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                         <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Year</label>
                         <div className="h-32 overflow-y-auto no-scrollbar rounded-2xl bg-bg border border-border px-2 snap-y snap-mandatory relative group hover:border-accent transition-colors">
                            <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-bg to-transparent pointer-events-none z-10" />
                            <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-bg to-transparent pointer-events-none z-10" />
                            {Array.from({ length: 76 }, (_, i) => new Date().getFullYear() - i).map(year => (
                              <button 
                                key={year} 
                                onClick={() => setNewVehicle(v => ({ ...v, year }))}
                                className={cn(
                                  "w-full py-3 text-center text-sm font-bold snap-center transition-all",
                                  newVehicle.year === year ? "text-accent scale-110" : "text-text-dim/40 hover:text-white"
                                )}
                              >
                                {year}
                              </button>
                            ))}
                         </div>
                      </div>
                      <div className="space-y-2">
                         <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Plate Number</label>
                         <input 
                           value={newVehicle.plate} 
                           onChange={e => setNewVehicle(v => ({ ...v, plate: e.target.value.toUpperCase() }))} 
                           className="w-full bg-bg border border-border rounded-2xl px-5 py-4 text-sm text-text-main focus:border-accent outline-none font-mono" 
                           placeholder="ABC-1234" 
                         />
                      </div>
                    </div>
                  <div className="space-y-2">
                     <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Usage Intensity</label>
                     <div className="grid grid-cols-2 gap-3">
                        <button onClick={() => setNewVehicle(v =>({ ...v, intensity: 'low' }))} className={cn("py-4 rounded-2xl text-[10px] font-black uppercase border transition-all", newVehicle.intensity === 'low' ? "bg-accent text-white border-transparent shadow-lg shadow-accent/20" : "bg-bg text-text-dim border-border opacity-60")}>Weekend Driver</button>
                        <button onClick={() => setNewVehicle(v =>({ ...v, intensity: 'high' }))} className={cn("py-4 rounded-2xl text-[10px] font-black uppercase border transition-all", newVehicle.intensity === 'high' ? "bg-accent text-white border-transparent shadow-lg shadow-accent/20" : "bg-bg text-text-dim border-border opacity-60")}>Daily Driven</button>
                     </div>
                  </div>
                </div>

                <button 
                  onClick={handleAddVehicle}
                  disabled={saving}
                  className="w-full bg-white text-bg py-5 rounded-2xl font-black uppercase tracking-widest hover:bg-accent hover:text-white transition shadow-xl active:scale-[0.98] disabled:opacity-50"
                >
                   {saving ? "Registering..." : "Sync To Fleet"}
                </button>
                  </>
                )}
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {vehicles.length === 0 ? (
        <div className="bento-card py-20 text-center border-dashed border-2">
          <CarFront size={64} className="text-text-dim mx-auto mb-6 opacity-10" />
          <h3 className="text-2xl font-black text-text-main mb-4 uppercase tracking-tighter italic">Garage Is Empty</h3>
          <p className="text-text-dim text-sm mb-8 lowercase max-w-xs mx-auto text-balance">Add your car to unlock personal AI tips and usage-based scheduling predictions.</p>
          <button 
            onClick={() => setShowAdd(true)}
            className="bg-white text-bg px-10 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-accent hover:text-white transition shadow-2xl active:scale-95"
          >
             Initialize Registry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <AnimatePresence mode="popLayout">
              {filteredVehicles.map((v) => (
                <VehicleCard key={v.plate} vehicle={v} onDelete={handleDeleteVehicle} />
              ))}
            </AnimatePresence>

            {filteredVehicles.length === 0 && searchTerm && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="py-20 text-center bento-card border-dashed"
              >
                <Search size={40} className="text-text-dim mx-auto mb-4 opacity-20" />
                <p className="text-text-dim font-bold uppercase tracking-widest text-[10px]">No vehicles matching "{searchTerm}"</p>
                <button 
                  onClick={() => setSearchTerm('')}
                  className="mt-4 text-accent text-xs font-black uppercase tracking-widest hover:underline"
                >
                  Clear Search
                </button>
              </motion.div>
            )}
          </div>

          <aside className="space-y-6">
            <div className="bg-accent p-8 rounded-[2.5rem] text-bg shadow-2xl shadow-accent/20">
              <div className="flex items-center gap-2 mb-8">
                <Sparkles size={20} />
                <h3 className="font-black uppercase tracking-widest text-sm">Proactive Scheduling</h3>
              </div>
              
              <AIProactiveSchedule 
                vehicle={vehicles[0]} 
                washHistoryCount={4} 
                onBook={() => setView('marketplace')}
              />
            </div>

            <div className="bg-card p-8 rounded-[2.5rem] border border-border">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} className="text-accent" />
                  <h3 className="font-black uppercase tracking-widest text-xs text-text-main">System Status</h3>
                </div>
                <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              </div>
              <div className="space-y-4">
                <p className="text-xs text-text-dim leading-relaxed lowercase">
                   Your {vehicles[0].model} is within optimal maintenance parameters. <span className="text-text-main font-bold">No issues detected.</span>
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
          <h2 className="text-4xl font-black text-text-main uppercase tracking-tighter mb-2">Build The Trust.</h2>
          <p className="text-text-dim lowercase">Rate your service experience for {wash?.carModel}</p>
        </header>

        <section className="space-y-10">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-text-main uppercase tracking-widest flex items-center gap-2">
                <Users size={16} className="text-accent" /> Rate {wash?.workerName}
              </label>
              <span className="text-[10px] font-bold text-accent uppercase">{ratings.worker} / 5</span>
            </div>
            <StarRating value={ratings.worker} onChange={(v) => setRatings(prev => ({ ...prev, worker: v }))} size={32} />
          </div>

          <div className="space-y-4">
             <div className="flex items-center justify-between">
               <label className="text-xs font-black text-text-main uppercase tracking-widest flex items-center gap-2">
                 <Store size={16} className="text-accent" /> Station Experience
               </label>
               <span className="text-[10px] font-bold text-accent uppercase">{ratings.business} / 5</span>
             </div>
             <StarRating value={ratings.business} onChange={(v) => setRatings(prev => ({ ...prev, business: v }))} size={32} />
          </div>

          <div className="space-y-4">
             <label className="text-xs font-black text-text-main uppercase tracking-widest">Anything to share?</label>
             <textarea 
               value={review}
               onChange={(e) => setReview(e.target.value)}
               placeholder="Tell us what you liked (or what we could improve)..."
               className="w-full bg-bg border border-border text-text-main p-5 rounded-2xl focus:ring-accent focus:border-accent min-h-[120px] text-sm"
             />
          </div>
        </section>

        <button 
          onClick={handleSubmitRating}
          disabled={submitting}
          className="w-full bg-text-main text-bg py-5 rounded-[2rem] font-black uppercase text-xs tracking-[0.3em] shadow-2xl hover:brightness-110 transition active:scale-95 disabled:opacity-50"
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('canceled') === 'true') {
      setError("Payment was canceled or could not be processed. Your card was not charged.");
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleSubscribe = async (plan: string) => {
    if (!profile || loading) return;
    setLoading(plan);
    setError(null);
    try {
      const prices: Record<string, number> = {
        'starter': 1900000, 'standard': 4900000, 'elite': 9900000,
        'basic_wash': 250000, 'premium_wash': 1000000, 'unlimited_wash': 4800000
      };

      const requestedAmount = prices[plan];
      if (!requestedAmount) throw new Error(`Unknown plan: ${plan}`);

      const response = await fetch('/api/paystack/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          email: profile.email,
          amount: requestedAmount,
          userId: profile.uid
        })
      });

      const contentType = response.headers.get("content-type");
      let data: any;
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const rawText = await response.text();
        throw new Error(`Server error (${response.status}): ${rawText.substring(0, 100)}`);
      }

      if (!response.ok) {
        throw new Error(data.error || data.message || `Payment initialization failed (${response.status})`);
      }

      if (data && data.authorization_url) {
        // Use top.location to escape the AI Studio iframe for payments
        if (window.top) {
          window.top.location.href = data.authorization_url;
        } else {
          window.location.href = data.authorization_url;
        }
      } else {
        throw new Error("Invalid response from payment server: missing checkout URL.");
      }
    } catch (error: any) {
      console.error("[PAYSTACK ERROR]", error);
      setError(error.message || "Could not start payment process. Please check your connection.");
    } finally {
      setLoading(null);
    }
  };

  const isCustomer = profile.role === 'customer';

  const ownerTiers = [
    {
      id: 'starter',
      name: 'Starter Node',
      price: '₦19,000',
      description: 'Perfect for solo operators logging basic traffic.',
      features: ['Up to 500 Washes/Mo', 'Basic QR Storefront', 'Standard Support', '7.5% Platform Fee'],
      color: 'bg-white/5',
      icon: <Zap size={24} className="text-white/40" />
    },
    {
      id: 'standard',
      name: 'Pro Accelerator',
      price: '₦49,000',
      description: 'The standard for growing wash stations.',
      features: ['Everything in Starter', 'AI Maintenance Tips', 'Team Performance Ledger', 'Incentive Tracking'],
      color: 'bg-accent/10 border-accent/40',
      icon: <Sparkles size={24} className="text-accent" />,
      popular: true
    },
    {
      id: 'elite',
      name: 'Enterprise Hub',
      price: '₦99,000',
      description: 'Total automation for high-volume enterprises.',
      features: ['Everything in Pro', 'AI License Plate Scanner', 'Advanced Analytics', 'Priority Support'],
      color: 'bg-accent text-white shadow-2xl shadow-accent/20',
      icon: <ShieldCheck size={24} className="text-white" />
    }
  ];

  const customerTiers = [
    {
      id: 'basic_wash',
      name: 'Daily Essential',
      price: '₦2,500',
      description: '2 Professional station washes per month.',
      features: ['2 Wash Credits', 'Digital Maintenance Log', 'Priority Queue', 'AI Health Alerts'],
      color: 'bg-card border border-border text-text-main',
      icon: <Check size={24} className="text-accent" />
    },
    {
      id: 'premium_wash',
      name: 'Premium Bundle',
      price: '₦10,000',
      description: 'High-frequency care for premium vehicles.',
      features: ['5 Wash Credits', '1 Interior Detailing', 'Engine Bay Check', 'Everything in Silver'],
      color: 'bg-accent/10 border-accent/40 text-text-main',
      icon: <Sparkles size={24} className="text-accent" />,
      popular: true
    },
    {
      id: 'unlimited_wash',
      name: 'Elite Pass',
      price: '₦48,000',
      description: 'The ultimate care package for your vehicle.',
      features: ['16 Wash Credits (4x/Week)', 'Full Detailing', 'Ceramic Waxing', 'Gemini AI Diagnostics'],
      color: 'bg-accent text-white shadow-2xl shadow-accent/20',
      icon: <ShieldCheck size={24} className="text-white" />
    }
  ];

  const tiers = isCustomer ? customerTiers : ownerTiers;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto pb-24 px-4 md:px-0">
      <header className="text-center mb-10 md:mb-16">
        <h2 className="text-4xl md:text-5xl font-black text-text-main tracking-tighter uppercase mb-4 italic leading-none">
          {isCustomer ? 'Subscription Joy.' : 'Scale Your Flow.'}
        </h2>
        <p className="text-text-dim text-base md:text-lg lowercase leading-relaxed max-w-xl mx-auto">
          {isCustomer ? 'Premium vehicle care, automated for your peace of mind.' : 'Choose a plan that matches your business velocity.'}
        </p>

        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-8 overflow-hidden"
            >
              <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-left max-w-2xl mx-auto flex items-start gap-4 shadow-2xl relative">
                <div className="w-10 h-10 bg-red-500/20 rounded-xl flex items-center justify-center text-red-500 shrink-0 mt-1">
                  <X size={20} strokeWidth={3} />
                </div>
                <div className="flex-1">
                   <h4 className="text-text-main font-black uppercase tracking-widest text-xs mb-1">Transaction Interrupted.</h4>
                   <p className="text-text-main font-medium text-sm leading-relaxed mb-4">
                     {error}
                   </p>
                   <div className="flex flex-wrap gap-2">
                     <button 
                       onClick={() => setError(null)}
                       className="bg-accent text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition shadow-lg shadow-accent/20"
                     >
                       Retry Selection
                     </button>
                     <button 
                       onClick={() => window.open('https://dashboard.paystack.com/#/login', '_blank')}
                       className="bg-card border border-border text-text-main px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-text-main/5 transition flex items-center gap-2"
                     >
                       Payment Help <Info size={12} />
                     </button>
                   </div>
                </div>
                <button 
                  onClick={() => setError(null)}
                  className="absolute top-4 right-4 text-white/20 hover:text-white transition"
                >
                  <X size={16} />
                </button>
              </div>
              <p className="mt-4 text-[10px] text-text-dim/60 uppercase font-black tracking-widest">
                Tip: Ensure your card has international payments enabled and sufficient balance.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {!error && (
          <div className="mt-8 inline-flex items-center gap-2 bg-accent/10 text-accent px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest border border-accent/20">
            <Sparkles size={14} />
            Your current plan: {profile.plan || 'No Active Subscription'}
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
        {tiers.map((tier) => (
          <div 
            key={tier.id} 
            className={cn(
              "p-8 md:p-10 rounded-[2.5rem] border relative flex flex-col transition-transform hover:scale-[1.02] duration-500",
              tier.color,
              tier.id !== 'elite' && tier.id !== 'unlimited_wash' ? "border-border" : "border-transparent"
            )}
          >
            {tier.popular && (
              <div className="absolute top-0 right-10 -translate-y-1/2 bg-accent text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-xl">
                Most Popular
              </div>
            )}
            
            <div className="mb-8">
              <div className={cn(
                "w-14 h-14 rounded-2xl flex items-center justify-center mb-8",
                (tier.id === 'elite' || tier.id === 'unlimited_wash') ? "bg-bg" : "bg-bg/50"
              )}>
                {tier.icon}
              </div>
              <h3 className={cn("text-2xl md:text-3xl font-black mb-3 uppercase italic tracking-tight", (tier.id === 'elite' || tier.id === 'unlimited_wash') ? "text-bg" : "text-text-main")}>{tier.name}</h3>
              <div className="flex items-baseline gap-1">
                <span className={cn("text-4xl md:text-5xl font-black tracking-tighter", (tier.id === 'elite' || tier.id === 'unlimited_wash') ? "text-bg" : "text-text-main")}>{tier.price}</span>
                <span className={cn("text-sm font-bold opacity-60", (tier.id === 'elite' || tier.id === 'unlimited_wash') ? "text-bg" : "text-text-main")}>/MO</span>
              </div>
              <p className={cn("mt-4 text-sm md:text-base leading-relaxed", (tier.id === 'elite' || tier.id === 'unlimited_wash') ? "text-bg/70" : "text-text-dim lowercase")}>{tier.description}</p>
            </div>

            <ul className="space-y-4 mb-12 flex-1">
              {tier.features.map((feature, i) => (
                <li key={i} className="flex items-center gap-4">
                  <Check size={18} className={cn((tier.id === 'elite' || tier.id === 'unlimited_wash') ? "text-bg" : "text-accent")} />
                  <span className={cn("text-sm md:text-base font-medium", (tier.id === 'elite' || tier.id === 'unlimited_wash') ? "text-bg" : "text-text-main/80")}>{feature}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={() => handleSubscribe(tier.id as any)}
              disabled={loading !== null || profile.plan === tier.id}
              className={cn(
                "w-full py-5 rounded-2xl font-black text-xs uppercase tracking-widest transition active:scale-95 disabled:opacity-50 disabled:active:scale-100 touch-target shadow-2xl",
                (tier.id === 'elite' || tier.id === 'unlimited_wash') 
                  ? "bg-bg text-white hover:bg-accent" 
                  : "bg-white text-bg hover:bg-accent hover:text-white"
              )}
            >
              {loading === tier.id ? "Initialising..." : profile.plan === tier.id ? "Active Infrastructure" : `Deploy ${tier.name}`}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-20 text-center">
        <p className="text-text-dim text-sm max-w-lg mx-auto leading-relaxed">
          Secure billing powered by <span className="text-white font-bold">Paystack</span>. 
          Plans can be cancelled or upgraded at any time from your dashboard.
        </p>
      </div>
    </motion.div>
  );
}
function LogWashForm({ profile, onComplete, setView, preFill }: { profile: UserProfile, onComplete: () => void, setView: (v: AppView) => void, preFill?: { carModel: string, plateNumber: string, bookingId?: string } | null }) {
  const [form, setForm] = useState({ 
    carModel: preFill?.carModel || '', 
    plateNumber: preFill?.plateNumber || '', 
    price: profile.pricing?.sedan?.toString() || '2000' 
  });
  const [submitting, setSubmitting] = useState(false);
  const [lastLoggedId, setLastLoggedId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [recentLogs, setRecentLogs] = useState<WashJob[]>([]);
  
  const [workers, setWorkers] = useState<any[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>(
    profile.role === 'worker' ? profile.uid : profile.uid
  );
  const [loadingWorkers, setLoadingWorkers] = useState(false);

  // Set initial worker selection for workers
  useEffect(() => {
    if (profile.role === 'worker') {
      setSelectedWorkerId(profile.uid);
    }
  }, [profile]);

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const [stationInfo, setStationInfo] = useState<any>(null);

  useEffect(() => {
    if (profile.role === 'worker' && profile.stationId) {
      const unsub = onSnapshot(doc(db, 'users', profile.stationId), (snap) => {
        if (snap.exists()) {
          setStationInfo(snap.data());
        }
      });
      return unsub;
    }
  }, [profile]);

  useEffect(() => {
    // Current user's recent logs for quick verification
    const q = query(collection(db, 'washes'), where('workerId', '==', profile.uid), orderBy('timestamp', 'desc'), limit(5));
    return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      setRecentLogs(snap.docs.map(d => ({ 
        id: d.id, 
        ...d.data(),
        isPending: d.metadata.hasPendingWrites 
      } as WashJob)));
    });
  }, [profile]);

  useEffect(() => {
    if (profile.role === 'owner' || profile.permissions?.canManageTeam) {
      setLoadingWorkers(true);
      const stationId = profile.role === 'owner' ? profile.uid : profile.stationId;
      const unsubUsers = onSnapshot(query(collection(db, 'users'), where('role', '==', 'worker'), where('stationId', '==', stationId)), (userSnap) => {
        const workerProfiles = userSnap.docs.map(d => d.data() as UserProfile);
        
        // Use a more restrictive query for worker stats (last 30 days or similar if possible)
        const unsubWashes = onSnapshot(query(collection(db, 'washes'), where('stationId', '==', stationId), limit(200)), (washSnap) => {
          const washes = washSnap.docs.map(d => d.data() as any);
          
          const workerData = workerProfiles.map(worker => {
            const workerWashes = washes.filter(w => w.workerId === worker.uid);
            const ratings = workerWashes.filter(w => w.workerRating !== undefined).map(w => w.workerRating as number);
            const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
            const efficiency = Math.min(100, (workerWashes.length * (avgRating / 5) * 2));
            
            // Calculate badges
            const badges = [];
            if (avgRating >= 4.7 && ratings.length >= 3) badges.push({ id: 'top-rated', name: 'Top Rated Professional', icon: <Award size={12} />, color: 'text-yellow-400', bg: 'bg-yellow-400/10' });
            if (efficiency >= 70 && workerWashes.length >= 5) badges.push({ id: 'efficient', name: 'Most Efficient Worker', icon: <Zap size={12} />, color: 'text-accent', bg: 'bg-accent/10' });
            if (ratings.length >= 10 && avgRating >= 4.5) badges.push({ id: 'favorite', name: 'Customer Favorite', icon: <Heart size={12} />, color: 'text-red-400', bg: 'bg-red-400/10' });

            return { ...worker, efficiency, totalWashes: workerWashes.length, avgRating, badges };
          });

          setWorkers(workerData);
          setLoadingWorkers(false);
        });
        return () => unsubWashes();
      });
      return () => unsubUsers();
    }
  }, [profile]);

  const startCamera = async () => {
    if (profile.plan !== 'elite' && (!profile.email || !ADMIN_EMAILS.includes(profile.email))) {
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
        if (result.plate && result.vehicle) {
          setForm(prev => ({
            ...prev,
            carModel: result.vehicle,
            plateNumber: result.plate
          }));
          stopCamera();
        } else if (result.vehicle && !result.plate) {
          setForm(prev => ({ ...prev, carModel: result.vehicle }));
          alert("Vehicle identified, but plate was not detected. Please enter the plate number manually.");
          stopCamera();
        } else if (result.plate && !result.vehicle) {
          setForm(prev => ({ ...prev, plateNumber: result.plate }));
          alert("Plate recognized! Please select the vehicle from your records or enter the model manually below.");
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

      // 2. Geofence check
      const baseLat = profile.role === 'owner' ? profile.businessLat : stationInfo?.businessLat;
      const baseLng = profile.role === 'owner' ? profile.businessLng : stationInfo?.businessLng;
      const baseRadius = profile.role === 'owner' ? (profile.businessRadius || 500) : (stationInfo?.businessRadius || 500);

      let geofence = { lat: baseLat, lng: baseLng, radius: baseRadius };
      
      // If it's a booking, check if it's a mobile/home service
      let bookingTarget: Booking | null = null;
      if (preFill?.bookingId) {
        const bDoc = await getDoc(doc(db, 'bookings', preFill.bookingId));
        if (bDoc.exists()) {
          bookingTarget = { id: bDoc.id, ...bDoc.data() } as Booking;
          // If home service and has coords, use those
          if (bookingTarget.serviceType === 'home-service' && bookingTarget.lat && bookingTarget.lng) {
            geofence = { lat: bookingTarget.lat, lng: bookingTarget.lng, radius: 250 }; // Slightly larger radius for urban density
          }
        }
      }

      if (geofence.lat && geofence.lng) {
        const dist = calculateDistance(currentLat!, currentLng!, geofence.lat, geofence.lng);
        if (dist > geofence.radius) {
          const locationLabel = bookingTarget?.serviceType === 'home-service' 
            ? "the customer's service location" 
            : "the business station";
            
          throw new Error(`Geofence Alert: You are currently ${Math.round(dist)}m away from ${locationLabel}. Operational compliance requires you to be within ${geofence.radius}m to log this job.`);
        }
      } else if (profile.role === 'worker' && (!bookingTarget || bookingTarget.serviceType !== 'home-service')) {
        throw new Error("Operational Configuration Error: The business geofence has not been configured. Please contact your manager.");
      }

      const tip = (profile.plan === 'standard' || profile.plan === 'elite')
        ? await getMaintenanceTip(form.carModel)
        : "Regular washing keeps your vehicle looking pristine!";
        
      const selectedWorker = profile.role === 'owner' ? (workers.find(w => w.uid === selectedWorkerId) || profile) : profile;

      // 3. Handle Credits/Commission logic
      let washPrice = parseFloat(form.price);
      let usedCredit = false;

      // Attempt to find customer and deduct credit
      const customerQuery = query(collection(db, 'users'), where('role', '==', 'customer'));
      const customerSnapshot = await getDocs(customerQuery);
      const customerDoc = customerSnapshot.docs.find(d => {
        const vehicles = d.data().vehicles || [];
        return vehicles.some((v: any) => v.plate?.toUpperCase() === form.plateNumber.toUpperCase());
      });

      if (customerDoc) {
        const customerData = customerDoc.data();
        if (customerData.credits > 0) {
          await updateDoc(customerDoc.ref, { 
            credits: customerData.credits - 1 
          });
          usedCredit = true;
          washPrice = 0; // Credit covers it
        }
      }

      // Calculate commission for non-credit washes
      const commission = usedCredit ? 0 : (washPrice * COMMISSION_RATE);
      const stationId = profile.role === 'owner' ? profile.uid : profile.stationId;

      const washData = {
        workerId: selectedWorker.uid,
        workerName: selectedWorker.name,
        stationId: stationId,
        carModel: form.carModel,
        plateNumber: form.plateNumber,
        price: washPrice,
        commission: commission,
        usedCredit: usedCredit,
        timestamp: serverTimestamp(),
        status: 'completed',
        maintenanceTip: tip,
        lat: currentLat,
        lng: currentLng,
        bookingId: preFill?.bookingId || null,
        customerId: customerDoc?.id || null
      };
      
      const docRef = await addDoc(collection(db, 'washes'), washData);
      
      // If there was a booking, mark it as completed
      if (preFill?.bookingId) {
        await updateDoc(doc(db, 'bookings', preFill.bookingId), {
          status: 'completed'
        });
      }

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
          <h2 className="text-4xl font-black text-text-main mb-4 uppercase tracking-tighter">Job Logged.</h2>
          <p className="text-text-dim mb-10 max-w-sm mx-auto">Show this to the customer for their personalized maintenance tip and rating link.</p>
          
          <div className="bg-bg p-6 rounded-2xl border border-border mb-10 text-left">
             <div className="flex items-center gap-2 mb-3">
               <Award size={16} className="text-accent" />
               <span className="text-[10px] font-black text-accent uppercase tracking-widest">AI Tip for Customer</span>
             </div>
             <p className="text-text-main italic font-medium leading-relaxed">"{profile.name} recommends: Get regular waxing for that {form.carModel} to protect the finish."</p>
          </div>

          <div className="flex gap-4">
             <button 
               onClick={() => {
                 navigator.clipboard.writeText(shareLink);
                 alert('Link copied! Paste it into a message or QR generator.');
               }}
               className="flex-1 bg-accent text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 hover:brightness-110 transition shadow-xl shadow-accent/20"
             >
               <Share2 size={20} />
               Rating Link
             </button>
             <button 
               onClick={() => { setLastLoggedId(null); setForm({ carModel: '', plateNumber: '', price: '2000' }); }}
               className="flex-1 bg-card border border-border text-text-main font-black py-4 rounded-xl hover:bg-text-main/5 transition"
             >
               Next Wash
             </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="max-w-xl mx-auto pb-24">
      <header className="mb-8 md:mb-10 text-center">
        <h2 className="text-3xl md:text-4xl font-black text-text-main tracking-tight uppercase italic leading-none">Log Job</h2>
        <p className="text-text-dim mt-2 lowercase font-medium">Capture current vehicle details instantly.</p>
      </header>

      <form onSubmit={handleSubmit} className="bento-card space-y-6 md:space-y-8 p-6 md:p-10">
        {(profile.role === 'owner' || profile.permissions?.canManageTeam) && (
          <div className="bg-bg/50 p-6 rounded-3xl border border-border space-y-5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Assign Operative</label>
              {loadingWorkers && <RefreshCw size={12} className="animate-spin text-accent" />}
            </div>
            
            <div className="space-y-4">
              <select 
                value={selectedWorkerId}
                onChange={(e) => setSelectedWorkerId(e.target.value)}
                className="w-full bg-bg border border-border rounded-2xl px-5 py-4 text-sm font-bold text-text-main outline-none focus:ring-2 focus:ring-accent scrollable-dropdown"
              >
                <option value={profile.uid} className="bg-card text-text-main">Myself ({profile.name})</option>
                {workers.map(w => (
                  <option key={w.uid} value={w.uid} className="bg-card text-text-main">
                    {w.name} — Eff: {w.efficiency.toFixed(0)}% ({w.totalWashes} jobs)
                  </option>
                ))}
              </select>
              
              {workers.length > 0 && (
                <div className="flex items-center gap-3 bg-accent/10 border border-accent/20 p-4 rounded-2xl">
                  <Award size={18} className="text-accent flex-shrink-0" />
                  <p className="text-[9px] text-accent font-black uppercase tracking-tight leading-relaxed">
                    Power Suggestion: <span className="font-bold">
                      AI recommended {workers.find(w => w.uid === selectedWorkerId)?.name || 'best staff member'} 
                      {selectedWorkerId === [...workers].sort((a, b) => b.efficiency - a.efficiency)[0]?.uid ? " (Highest Efficiency)" : ""} to maximize throughput.
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={cameraActive ? stopCamera : startCamera}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition shadow-lg touch-target",
              cameraActive ? "bg-red-500 text-white" : "bg-accent text-white"
            )}
          >
            {cameraActive ? <X size={16} /> : <Camera size={16} />}
            {cameraActive ? "Cancel Scan" : "Scan Plate (AI)"}
          </button>
        </div>

        {cameraActive && (
          <div className="relative rounded-[2.5rem] overflow-hidden bg-black aspect-video border-2 border-accent/20">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              className="w-full h-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />
            
            <div className="absolute inset-0 border-2 border-accent/40 rounded-[2rem] m-6 md:m-8 pointer-events-none">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-accent rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-accent rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-accent rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-accent rounded-br-xl" />
            </div>

            <div className="absolute bottom-6 left-0 right-0 px-6">
              <button
                type="button"
                disabled={isScanning}
                onClick={captureAndScan}
                className="w-full bg-accent text-white font-black py-4 rounded-2xl shadow-2xl flex items-center justify-center gap-3 disabled:opacity-50 touch-target"
              >
                {isScanning ? (
                  <>
                    <RefreshCw className="animate-spin" size={20} />
                    Analyzing Image...
                  </>
                ) : (
                  <>
                    <Camera size={20} />
                    Capture & Identify
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-6">
          <div className="space-y-3">
            <label className="block text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Car Model</label>
            <input 
              required
              placeholder="e.g. Toyota Hilux"
              value={form.carModel}
              onChange={e => setForm({...form, carModel: e.target.value})}
              className="w-full bg-bg px-5 py-4 rounded-2xl border border-border focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition text-text-main font-bold"
            />
          </div>
          <div className="space-y-3">
            <label className="block text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Plate Number</label>
            <input 
              required
              placeholder="ABC-123-XY"
              value={form.plateNumber}
              onChange={e => setForm({...form, plateNumber: e.target.value})}
              className="w-full bg-bg px-5 py-4 rounded-2xl border border-border focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition text-text-main font-mono font-black placeholder:text-text-dim/20"
            />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">Service Tier (₦)</label>
            </div>
            <div className="flex bg-bg rounded-2xl p-1.5 border border-border gap-1">
              <button 
                type="button" 
                onClick={() => setForm({...form, price: String(profile.pricing?.sedan || 2000)})} 
                className={cn(
                  "flex-1 py-3.5 rounded-xl text-[9px] font-black uppercase transition-all duration-300 border",
                  form.price === String(profile.pricing?.sedan || 2000) ? "bg-accent/10 border-accent text-accent" : "bg-text-main/5 border-transparent text-text-dim hover:text-text-main font-bold"
                )}
              >
                Sedan
              </button>
              <button 
                type="button" 
                onClick={() => setForm({...form, price: String(profile.pricing?.suv || 3500)})} 
                className={cn(
                  "flex-1 py-3.5 rounded-xl text-[9px] font-black uppercase transition-all duration-300 border",
                  form.price === String(profile.pricing?.suv || 3500) ? "bg-accent/10 border-accent text-accent" : "bg-text-main/5 border-transparent text-text-dim hover:text-text-main font-bold"
                )}
              >
                SUV
              </button>
              <button 
                type="button" 
                onClick={() => setForm({...form, price: String(profile.pricing?.truck || 5000)})} 
                className={cn(
                  "flex-1 py-3.5 rounded-xl text-[9px] font-black uppercase transition-all duration-300 border",
                  form.price === String(profile.pricing?.truck || 5000) ? "bg-accent/10 border-accent text-accent" : "bg-text-main/5 border-transparent text-text-dim hover:text-text-main font-bold"
                )}
              >
                Heavy
              </button>
            </div>
          </div>
          
          <div className="relative group">
            <div className="absolute left-6 top-1/2 -translate-y-1/2 text-text-dim group-focus-within:text-accent transition-colors font-black text-lg">₦</div>
            <input 
              required
              type="number"
              value={form.price}
              onChange={e => setForm({...form, price: e.target.value})}
              className="w-full bg-bg pl-12 pr-6 py-5 rounded-2xl border border-border focus:border-accent outline-none transition text-text-main text-3xl font-black tracking-tighter"
            />
          </div>
        </div>

        <button 
          type="submit" 
          disabled={submitting || !form.carModel || !form.plateNumber}
          className="w-full py-6 bg-accent text-white rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-2xl shadow-accent/20 hover:brightness-110 transition-all disabled:opacity-50 touch-target mt-4 italic"
        >
          {submitting ? (
            <div className="flex items-center justify-center gap-3">
              <RefreshCw className="animate-spin" size={20} />
              Encrypting Service Log...
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3">
              Broadcast Service Log
              <Zap size={20} className="fill-current" />
            </div>
          )}
        </button>
      </form>

      {/* User's Recent Wash History (Inline Feedback) */}
      <div className="mt-16 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
             <div className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" />
             <h3 className="text-xl font-black text-text-main uppercase italic tracking-tighter">Transmission Registry</h3>
          </div>
          <span className="text-[10px] font-black text-text-dim uppercase tracking-widest">Active Verification Flow</span>
        </div>
        
        <div className="space-y-4">
          {recentLogs.map((log) => (
            <div key={log.id} className={cn(
              "bento-card border-none flex items-center justify-between p-6 transition-all duration-500",
              log.isPending ? "bg-accent/5 opacity-60" : "bg-card hover:bg-white/[0.02]"
            )}>
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 rounded-[1.5rem] bg-bg flex items-center justify-center text-accent shadow-inner">
                  <CarFront size={28} />
                </div>
                <div>
                  <div className="font-black text-text-main uppercase text-sm leading-none flex items-center gap-2">
                    {log.carModel}
                    {log.usedCredit && <div className="bg-success/10 text-success text-[8px] px-1.5 py-0.5 rounded uppercase">Credit</div>}
                  </div>
                  <div className="text-[10px] font-black text-text-dim uppercase tracking-[0.2em] mt-2 font-mono">{log.plateNumber}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-black text-text-main text-xl tracking-tighter">
                  {log.usedCredit ? "0.00" : formatCurrency(log.price)}
                </div>
                <div className="flex items-center justify-end gap-1.5 mt-1.5">
                  {log.isPending ? (
                    <RefreshCw size={10} className="animate-spin text-accent" />
                  ) : (
                    <CheckCircle size={10} className="text-success" />
                  )}
                  <span className={cn(
                    "text-[8px] font-black uppercase tracking-widest",
                    log.isPending ? "text-accent" : "text-success"
                  )}>
                    {log.isPending ? "Syncing Ledger" : log.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {recentLogs.length === 0 && (
            <div className="py-20 text-center bg-white/[0.02] rounded-[3rem] border-2 border-dashed border-white/5 group hover:border-accent/20 transition-colors">
               <p className="text-[10px] font-black text-text-dim uppercase tracking-widest leading-loose opacity-30 group-hover:opacity-60 transition-opacity">
                 Awaiting first service transmission for this operative session.
               </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function OwnerPerformanceView() {
  const [workers, setWorkers] = useState<any[]>([]);
  const [allWashes, setAllWashes] = useState<WashJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    const unsubWashes = onSnapshot(collection(db, 'washes'), (washSnap) => {
      const washes = washSnap.docs.map(d => ({ id: d.id, ...d.data() } as WashJob));
      setAllWashes(washes);
      
      onSnapshot(collection(db, 'incentives'), (incentiveSnap) => {
        const incentives = incentiveSnap.docs.map(d => ({ id: d.id, ...d.data() } as Incentive));
        
        onSnapshot(collection(db, 'users'), (userSnap) => {
          const users = userSnap.docs.map(d => d.data() as UserProfile).filter(u => u.role === 'worker');
          
          const startDate = new Date(dateRange.start);
          const endDate = new Date(dateRange.end);
          endDate.setHours(23, 59, 59);

          const workerData = users.map(worker => {
            const workerWashes = washes.filter(w => {
              const washDate = w.timestamp?.toDate() || new Date();
              return w.workerId === worker.uid && washDate >= startDate && washDate <= endDate;
            });
            const workerIncentives = incentives.filter(i => {
              const incDate = i.timestamp?.toDate() || new Date();
              return i.workerId === worker.uid && incDate >= startDate && incDate <= endDate;
            });
            
            const ratings = workerWashes.filter(w => w.workerRating !== undefined).map(w => w.workerRating as number);
            const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
            const totalIncentives = workerIncentives.reduce((acc, curr) => acc + curr.amount, 0);
            // Normalized efficiency score 0-100
            const efficiencyScore = Math.min(100, (workerWashes.length * (avgRating / 5) * 2) * 5);
            
            // Calculate badges
            const badges = [];
            if (avgRating >= 4.7 && ratings.length >= 3) badges.push({ id: 'top-rated', name: 'Top Rated Professional', icon: <Award size={12} />, color: 'text-yellow-400', bg: 'bg-yellow-400/10' });
            if (efficiencyScore >= 80 && workerWashes.length >= 5) badges.push({ id: 'efficient', name: 'Most Efficient Worker', icon: <Zap size={12} />, color: 'text-accent', bg: 'bg-accent/10' });
            if (ratings.length >= 10 && avgRating >= 4.5) badges.push({ id: 'favorite', name: 'Customer Favorite', icon: <Heart size={12} />, color: 'text-red-400', bg: 'bg-red-400/10' });

            return {
              ...worker,
              totalWashes: workerWashes.length,
              avgRating,
              totalIncentives,
              efficiencyScore,
              badges,
              revenue: workerWashes.reduce((acc, curr) => acc + curr.price, 0)
            };
          });
          
          setWorkers(workerData);
          setLoading(false);
        });
      });
    });

    return () => unsubWashes();
  }, [dateRange]);

  const teamMetrics = useMemo(() => {
    if (workers.length === 0) return null;
    const totalRevenue = workers.reduce((acc, w) => acc + w.revenue, 0);
    const totalWashes = workers.reduce((acc, w) => acc + w.totalWashes, 0);
    const avgTeamRating = workers.reduce((acc, w) => acc + w.avgRating, 0) / workers.length;
    
    // Revenue trend
    const revenueByDay: Record<string, number> = {};
    allWashes.forEach(w => {
      const date = w.timestamp?.toDate().toISOString().split('T')[0];
      if (date && date >= dateRange.start && date <= dateRange.end) {
        revenueByDay[date] = (revenueByDay[date] || 0) + w.price;
      }
    });

    const trendData = Object.entries(revenueByDay)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { totalRevenue, totalWashes, avgTeamRating, trendData };
  }, [workers, allWashes, dateRange]);

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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-6xl mx-auto pb-20">
      <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-text-main tracking-tight">Performance Engine</h2>
          <p className="text-text-dim mt-2 font-medium">Real-time operative analytics and staff efficiency ledger.</p>
        </div>
        <div className="flex items-center gap-3 bg-card p-2 rounded-2xl border border-border shadow-2xl">
          <Calendar size={18} className="text-text-dim ml-2" />
          <input 
            type="date" 
            value={dateRange.start} 
            onChange={e => setDateRange({...dateRange, start: e.target.value})}
            className="bg-bg border border-border rounded-xl px-3 py-2 text-xs text-white outline-none focus:ring-1 focus:ring-accent" 
          />
          <span className="text-text-dim text-xs font-black">TO</span>
          <input 
            type="date" 
            value={dateRange.end} 
            onChange={e => setDateRange({...dateRange, end: e.target.value})}
            className="bg-bg border border-border rounded-xl px-3 py-2 text-xs text-white outline-none focus:ring-1 focus:ring-accent" 
          />
        </div>
      </header>

      {/* Global Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bento-card border-accent/20 bg-accent/5">
          <p className="text-[10px] font-black text-accent uppercase tracking-widest mb-1 leading-none">Global Revenue</p>
          <p className="text-3xl font-black text-text-main tracking-tighter">{formatCurrency(teamMetrics?.totalRevenue || 0)}</p>
        </div>
        <div className="bento-card">
          <p className="text-[10px] font-black text-text-dim uppercase tracking-widest mb-1 leading-none">Team Efficiency</p>
          <p className="text-3xl font-black text-text-main tracking-tighter">
            {(workers.reduce((acc, w) => acc + w.efficiencyScore, 0) / (workers.length || 1)).toFixed(0)}%
          </p>
        </div>
        <div className="bento-card">
          <p className="text-[10px] font-black text-text-dim uppercase tracking-widest mb-1 leading-none">Job Volume</p>
          <p className="text-3xl font-black text-text-main tracking-tighter">{teamMetrics?.totalWashes}</p>
        </div>
        <div className="bento-card">
          <p className="text-[10px] font-black text-text-dim uppercase tracking-widest mb-1 leading-none">CSAT Rating</p>
          <div className="flex items-center gap-2">
            <p className="text-3xl font-black text-text-main tracking-tighter">{teamMetrics?.avgTeamRating.toFixed(1)}</p>
            <Star size={20} fill="currentColor" className="text-yellow-400" />
          </div>
        </div>
      </div>

      {/* Revenue Trajectory - Full Width Top Row */}
      <div className="bento-card min-h-[400px] mb-8">
        <h3 className="text-xs font-black text-text-dim uppercase tracking-[0.2em] mb-8">Revenue Trajectory</h3>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={teamMetrics?.trendData}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
              <XAxis 
                dataKey="date" 
                stroke="#666" 
                fontSize={10} 
                tickFormatter={(val) => new Date(val).toLocaleDateString([], { month: 'short', day: 'numeric' })} 
              />
              <YAxis stroke="#666" fontSize={10} tickFormatter={(val) => `$${val}`} />
              <RechartsTooltip 
                contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '12px' }}
                itemStyle={{ color: '#fff', fontSize: '12px' }}
              />
              <Area type="monotone" dataKey="amount" stroke="var(--color-accent)" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Total Washes Comparison Chart */}
        <div className="bento-card min-h-[400px]">
          <h3 className="text-xs font-black text-text-dim uppercase tracking-[0.2em] mb-8">Workforce Volume Leaderboard</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={workers}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis dataKey="name" stroke="#666" fontSize={10} interval={0} />
                <YAxis stroke="#666" fontSize={10} />
                <RechartsTooltip 
                  cursor={{ fill: '#ffffff05' }}
                  contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '12px' }}
                />
                <Bar dataKey="totalWashes" radius={[4, 4, 0, 0]} barSize={40}>
                  {workers.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index % 2 === 0 ? 'var(--color-accent)' : '#4f46e5'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Worker Comparison - Efficiency Radar */}
        <div className="bento-card min-h-[400px]">
          <h3 className="text-xs font-black text-text-dim uppercase tracking-[0.2em] mb-8">Staff IQ Comparison</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={workers}>
                <PolarGrid stroke="#ffffff10" />
                <PolarAngleAxis dataKey="name" stroke="#666" fontSize={10} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#666" fontSize={8} />
                <Radar
                   name="Efficiency"
                   dataKey="efficiencyScore"
                   stroke="var(--color-accent)"
                   fill="var(--color-accent)"
                   fillOpacity={0.5}
                />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '12px' }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* List of Workers with Cards - Reduced Size or Scrollable */}
        <div className="space-y-4">
          <h3 className="text-xs font-black text-text-dim uppercase tracking-[0.2em] px-2 mb-4">Operative Ledger</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {workers.map(worker => (
              <div key={worker.uid} className="bento-card group hover:border-accent/40 transition-colors p-5">
                <div className="flex items-center gap-4 mb-6">
                  <div className="relative">
                    <img alt={worker.name} src={worker.photoUrl} className="w-12 h-12 rounded-xl border border-border group-hover:scale-105 transition-transform" />
                    <div className={cn(
                      "absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-card",
                      worker.efficiencyScore > 80 ? "bg-success" : "bg-yellow-500"
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-text-main truncate">{worker.name}</h3>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {worker.badges?.slice(0, 2).map((badge: any) => (
                        <div key={badge.id} title={badge.name} className={cn("inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-current text-[7px] font-black uppercase tracking-tighter", badge.color, badge.bg)}>
                          {badge.icon}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-black text-text-main">{worker.efficiencyScore.toFixed(0)}%</p>
                    <p className="text-[8px] text-text-dim uppercase font-black tracking-widest">IQ</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-bg/50 p-2 rounded-xl border border-border/50 text-center">
                    <p className="text-[7px] font-black text-text-dim uppercase tracking-widest mb-0.5">Washes</p>
                    <p className="text-sm font-black text-text-main">{worker.totalWashes}</p>
                  </div>
                  <div className="bg-bg/50 p-2 rounded-xl border border-border/50 text-center">
                    <p className="text-[7px] font-black text-text-dim uppercase tracking-widest mb-0.5">Rating</p>
                    <div className="flex items-center justify-center gap-0.5">
                      <p className="text-sm font-black text-text-main">{worker.avgRating.toFixed(1)}</p>
                      <Star size={8} fill="currentColor" className="text-yellow-400" />
                    </div>
                  </div>
                  <div className="bg-bg/50 p-2 rounded-xl border border-border/50 text-center">
                    <p className="text-[7px] font-black text-text-dim uppercase tracking-widest mb-0.5">Revenue</p>
                    <p className="text-sm font-black text-accent">${worker.revenue.toFixed(0)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          {workers.length === 0 && (
            <div className="bento-card text-center py-10 border-dashed opacity-50">
              <p className="text-xs text-text-dim italic lowercase">No active staff in selected temporal range.</p>
            </div>
          )}
        </div>
      </div>
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
    // Workers should be available for everyone to filter by, but we'll only fetch the relevant ones
    let usersQuery: Query<DocumentData>;
    const stationId = profile.role === 'owner' ? profile.uid : profile.stationId;

    if (profile.role === 'owner' || profile.permissions?.canManageTeam) {
      usersQuery = query(collection(db, 'users'), where('role', '==', 'worker'), where('stationId', '==', stationId));
    } else {
      // For customers/workers, filter workers by station if applicable
      if (stationId) {
        usersQuery = query(collection(db, 'users'), where('role', '==', 'worker'), where('stationId', '==', stationId));
      } else {
        usersQuery = query(collection(db, 'users'), where('role', '==', 'worker'), limit(10));
      }
    }

    const unsubUsers = onSnapshot(usersQuery, (userSnap) => {
      const users = userSnap.docs.map(d => d.data() as UserProfile);
      
      const washesCol = collection(db, 'washes');
      const washSnapQuery = (profile.role === 'owner' || profile.permissions?.canManageTeam)
        ? query(washesCol, where('stationId', '==', stationId))
        : washesCol;

      onSnapshot(washSnapQuery, (washSnap) => {
        const washesData = washSnap.docs.map(d => d.data() as any);
        
        const workerData = users.map(worker => {
          const workerWashes = washesData.filter(w => w.workerId === worker.uid);
          const ratings = workerWashes.filter(w => w.workerRating !== undefined).map(w => w.workerRating as number);
          const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
          const efficiency = Math.min(100, (workerWashes.length * (avgRating / 5) * 2));
          
          // Calculate badges
          const badges = [];
          if (avgRating >= 4.7 && ratings.length >= 3) badges.push({ id: 'top-rated', name: 'Top Rated Professional', icon: <Award size={10} />, color: 'text-yellow-400', bg: 'bg-yellow-400/10' });
          if (efficiency >= 70 && workerWashes.length >= 5) badges.push({ id: 'efficient', name: 'Most Efficient Worker', icon: <Zap size={10} />, color: 'text-accent', bg: 'bg-accent/10' });
          if (ratings.length >= 10 && avgRating >= 4.5) badges.push({ id: 'favorite', name: 'Customer Favorite', icon: <Heart size={10} />, color: 'text-red-400', bg: 'bg-red-400/10' });

          return { ...worker, badges };
        });
        setWorkers(workerData);
      });
    });
    return () => unsubUsers();
  }, [profile]);

  useEffect(() => {
    let q: Query<DocumentData>;
    const washesRef = collection(db, 'washes');
    const stationId = profile.role === 'owner' ? profile.uid : profile.stationId;

    if (profile.role === 'owner' || profile.permissions?.canManageTeam) {
      q = query(washesRef, where('stationId', '==', stationId), orderBy('timestamp', 'desc'));
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto pb-24 md:pb-20 px-4 md:px-0">
      <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6 bg-card p-8 md:p-0 md:bg-transparent rounded-3xl md:rounded-none border border-border md:border-none">
        <div className="text-center md:text-left">
          <h2 className="text-3xl md:text-5xl font-black text-text-main tracking-tighter uppercase italic leading-none">Operational Ledger</h2>
          <p className="text-text-dim mt-3 font-medium lowercase">Full cryptographic history of service transactions.</p>
        </div>
        <button 
          onClick={() => setIsFilterOpen(!isFilterOpen)}
          className={cn(
            "flex items-center justify-center gap-3 px-8 py-5 rounded-2xl transition font-black text-xs uppercase tracking-widest shadow-xl touch-target",
            isFilterOpen ? "bg-accent text-white shadow-accent/20" : "bg-text-main/5 text-text-dim border border-border hover:text-text-main"
          )}
        >
          {isFilterOpen ? <X size={20} /> : <Filter size={20} />}
          {isFilterOpen ? 'CONCEAL CONTROLS' : 'INITIALIZE FILTERS'}
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
            <div className="bento-card bg-card/50 backdrop-blur-xl border-accent/20 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 p-8 md:p-10 mb-8 rounded-[2.5rem]">
              <div className="space-y-4">
                <label className="text-[10px] font-black text-accent uppercase tracking-widest flex items-center gap-2 ml-1">
                  <Calendar size={14} /> Chronological Range
                </label>
                <div className="flex flex-col gap-3">
                  <input 
                    type="date" 
                    value={filters.startDate}
                    onChange={e => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                    className="bg-bg border border-border rounded-xl px-5 py-3 text-sm font-bold text-text-main outline-none focus:ring-1 focus:ring-accent touch-target" 
                  />
                  <input 
                    type="date" 
                    value={filters.endDate}
                    onChange={e => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                    className="bg-bg border border-border rounded-xl px-5 py-3 text-sm font-bold text-text-main outline-none focus:ring-1 focus:ring-accent touch-target" 
                  />
                </div>
              </div>

              {profile.role !== 'worker' && (
                <div className="space-y-4">
                  <label className="text-[10px] font-black text-accent uppercase tracking-widest flex items-center gap-2 ml-1">
                    <Users size={14} /> Personnel Filter
                  </label>
                  <select 
                    value={filters.workerId}
                    onChange={e => setFilters(prev => ({ ...prev, workerId: e.target.value }))}
                    className="w-full bg-bg border border-border rounded-xl px-5 py-4 text-sm font-bold text-text-main outline-none focus:ring-1 focus:ring-accent appearance-none scrollable-dropdown touch-target"
                  >
                    <option value="all" className="bg-card text-text-main italic">ALL OPERATIVES</option>
                    {workers.map(w => <option key={w.uid} value={w.uid} className="bg-card text-text-main font-bold">{w.name.toUpperCase()}</option>)}
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
                  className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text-main font-bold outline-none focus:ring-1 focus:ring-accent appearance-none"
                >
                  <option value="all" className="bg-card text-text-main">Any Status</option>
                  <option value="completed" className="bg-card text-text-main">Completed</option>
                  <option value="pending" className="bg-card text-text-main">Pending</option>
                </select>
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

      {/* Interactive Sort Headers */}
      <div className="hidden md:flex items-center justify-between px-8 py-4 mb-4 bg-text-main/5 rounded-2xl border border-border/50">
        <div className="flex items-center gap-12 font-black text-[10px] uppercase tracking-widest text-text-dim">
          <button 
            onClick={() => toggleSort('timestamp')}
            className={cn(
              "flex items-center gap-2 transition-colors hover:text-text-main group",
              sort.field === 'timestamp' ? "text-accent" : ""
            )}
          >
            Service Timeline
            <div className={cn(
              "flex flex-col -space-y-1.5 transition-opacity",
              sort.field === 'timestamp' ? "opacity-100" : "opacity-20 group-hover:opacity-100"
            )}>
              <ArrowUp size={8} className={cn(sort.field === 'timestamp' && !sort.desc ? "text-accent" : "text-text-main")} />
              <ArrowDown size={8} className={cn(sort.field === 'timestamp' && sort.desc ? "text-accent" : "text-text-main")} />
            </div>
          </button>
        </div>
        <div className="flex items-center gap-12 font-black text-[10px] uppercase tracking-widest text-text-dim">
          <button 
            onClick={() => toggleSort('workerRating')}
            className={cn(
              "flex items-center gap-2 transition-colors hover:text-text-main group font-bold",
              sort.field === 'workerRating' ? "text-accent" : ""
            )}
          >
            Review Index
            <div className={cn(
              "flex flex-col -space-y-1.5 transition-opacity",
              sort.field === 'workerRating' ? "opacity-100" : "opacity-20 group-hover:opacity-100"
            )}>
              <ArrowUp size={8} className={cn(sort.field === 'workerRating' && !sort.desc ? "text-accent" : "text-text-main")} />
              <ArrowDown size={8} className={cn(sort.field === 'workerRating' && sort.desc ? "text-accent" : "text-text-main")} />
            </div>
          </button>
          <button 
            onClick={() => toggleSort('price')}
            className={cn(
              "flex items-center gap-2 transition-colors hover:text-text-main group min-w-[80px] justify-end font-bold",
              sort.field === 'price' ? "text-accent" : ""
            )}
          >
            Price
            <div className={cn(
              "flex flex-col -space-y-1.5 transition-opacity",
              sort.field === 'price' ? "opacity-100" : "opacity-20 group-hover:opacity-100"
            )}>
              <ArrowUp size={8} className={cn(sort.field === 'price' && !sort.desc ? "text-accent" : "text-text-main")} />
              <ArrowDown size={8} className={cn(sort.field === 'price' && sort.desc ? "text-accent" : "text-text-main")} />
            </div>
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {filteredAndSortedWashes.map(wash => (
          <motion.div 
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            key={wash.id} 
            className="bg-card border border-border rounded-[2.5rem] p-8 md:p-10 shadow-xl transition-all hover:border-accent/30 group"
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-10">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 rounded-[1.5rem] bg-accent/10 flex items-center justify-center text-accent shadow-inner">
                  <CarFront size={32} />
                </div>
                <div>
                  <h4 className="font-black text-2xl text-text-main uppercase italic tracking-tighter leading-none mb-1">{wash.carModel}</h4>
                  <p className="text-xs text-text-dim font-black tracking-widest uppercase opacity-60 mb-3">{wash.plateNumber}</p>
                  <div className="flex items-center gap-2 text-[10px] uppercase font-black text-accent tracking-wider">
                    <Calendar size={12} />
                    <span>{wash.timestamp?.toDate().toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center gap-4">
                <p className="text-4xl font-black text-text-main italic tracking-tighter leading-none">{formatCurrency(wash.price)}</p>
                <div className="flex flex-col items-end gap-3">
                  {wash.isPending ? (
                    <div className="flex items-center gap-2 text-accent animate-pulse font-black text-[9px] uppercase tracking-widest bg-accent/5 px-4 py-2 rounded-full border border-accent/20">
                      <RefreshCw size={10} className="animate-spin" /> 
                      INITIALIZING SYNC
                    </div>
                  ) : (
                    <span className={cn(
                      "inline-flex px-5 py-2 text-[10px] font-black uppercase rounded-full tracking-[0.2em] border shadow-lg",
                      wash.status === 'completed' ? "bg-success/10 text-success border-success/20 shadow-success/10" : "bg-accent/10 text-accent border-accent/20 shadow-accent/10"
                    )}>
                      {wash.status}
                    </span>
                  )}
                  {wash.businessRating && (
                    <div className="flex items-center gap-1.5 text-yellow-400">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} size={12} fill={i < wash.businessRating! ? "currentColor" : "none"} strokeWidth={3} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {wash.maintenanceTip && (
              <div className="bg-accent/5 p-6 md:p-8 rounded-[2rem] border border-accent/20 relative overflow-hidden group-hover:bg-accent/10 transition-colors">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-6 h-6 bg-accent rounded-md flex items-center justify-center shadow-lg">
                    <Award size={14} className="text-white" />
                  </div>
                  <span className="text-[10px] font-black text-accent uppercase tracking-[0.2em] italic">PROACTIVE MAINTENANCE CORE</span>
                </div>
                <p className="text-base text-text-main leading-relaxed font-bold italic lowercase italic">"{wash.maintenanceTip}"</p>
                <div className="absolute -right-4 -bottom-4 opacity-5 text-accent group-hover:opacity-10 transition-opacity">
                  <Zap size={80} />
                </div>
              </div>
            )}

            {(profile.role === 'owner' || profile.role === 'admin') && (
              <div className="mt-10 pt-8 border-t border-border flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-6">
                   <div className="flex items-center gap-3">
                     <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-text-dim">
                       <Users size={16} />
                     </div>
                     <span className="text-[10px] font-black text-text-dim uppercase tracking-widest italic">{wash.workerName}</span>
                   </div>
                   <div className="flex gap-2">
                     {workers.find(w => w.uid === wash.workerId)?.badges?.map((badge: any) => (
                       <div key={badge.id} title={badge.name} className={cn("p-2 rounded-full border border-current shadow-lg transform hover:scale-110 transition-transform", badge.color, badge.bg)}>
                         {badge.icon}
                       </div>
                     ))}
                   </div>
                </div>
                <span className="bg-white/5 px-4 py-2 rounded-full text-[10px] font-black text-text-dim uppercase tracking-widest border border-white/5 self-end md:self-auto">NODE: {wash.id.slice(0, 8)}</span>
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
  const [workers, setWorkers] = useState<UserProfile[]>([]);
  const [authorizedEmails, setAuthorizedEmails] = useState<any[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [settings, setSettings] = useState({
    name: profile.name || '',
    phone: profile.phone || '',
    businessName: profile.businessName || '',
    businessAddress: profile.businessAddress || '',
    businessLat: profile.businessLat || 0,
    businessLng: profile.businessLng || 0,
    businessRadius: profile.businessRadius || 500,
    businessImage: profile.businessImage || 'https://images.unsplash.com/photo-1520340356584-f9917d1eea6f?auto=format&fit=crop&q=80&w=800',
    pricing: profile.pricing || { sedan: 2000, suv: 4500, truck: 7000 },
    theme: profile.theme || 'dark'
  });

  useEffect(() => {
    if (profile.role === 'owner') {
      const unsubWorkers = onSnapshot(query(collection(db, 'users'), where('role', '==', 'worker'), where('stationId', '==', profile.uid)), (snap) => {
        setWorkers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
      });
      
      const unsubAuthorized = onSnapshot(query(collection(db, 'authorized_workers'), where('stationId', '==', profile.uid)), (snap) => {
        setAuthorizedEmails(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });

      return () => {
        unsubWorkers();
        unsubAuthorized();
      };
    }
  }, [profile]);

  const handleDeleteInvitation = async (id: string) => {
    if (!confirm("Are you sure you want to revoke this invitation?")) return;
    try {
      await deleteDoc(doc(db, 'authorized_workers', id));
    } catch (error) {
      console.error("Delete error:", error);
    }
  };

  const togglePermission = async (workerUid: string, permission: keyof NonNullable<UserProfile['permissions']>) => {
    const worker = workers.find(w => w.uid === workerUid);
    if (!worker) return;
    
    const newPermissions = {
      ...(worker.permissions || {}),
      [permission]: !worker.permissions?.[permission]
    };
    
    try {
      await updateDoc(doc(db, 'users', workerUid), { permissions: newPermissions });
    } catch (error) {
      console.error("Error updating permissions:", error);
      alert("Failed to update staff permissions.");
    }
  };

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
      
      if (profile.role === 'owner') {
        const q = query(collection(db, 'wash_businesses'), where('ownerUid', '==', profile.uid), limit(1));
        const snap = await getDocs(q);
        const bizData = {
          name: settings.businessName,
          location: settings.businessAddress,
          image: settings.businessImage,
          pricing: settings.pricing,
          latitude: settings.businessLat,
          longitude: settings.businessLng,
          updatedAt: serverTimestamp()
        };
        
        if (!snap.empty) {
          await updateDoc(doc(db, 'wash_businesses', snap.docs[0].id), bizData);
        } else {
          await addDoc(collection(db, 'wash_businesses'), {
            ...bizData,
            ownerUid: profile.uid,
            rating: 5.0,
            ratingCount: 0,
            createdAt: serverTimestamp()
          });
        }
      }
      
      onUpdate({ ...profile, ...settings });
      alert("Operating environment synchronized successfully.");
    } catch (error) {
      console.error("Save error:", error);
      alert("Failed to commit settings to the ledger.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto pb-24 md:pb-20 px-4 md:px-0">
      <header className="mb-10 text-center md:text-left md:mb-12">
        <h2 className="text-3xl md:text-5xl font-black text-white tracking-tighter uppercase italic leading-none mb-4">
          {profile.role === 'owner' ? "Operating Environment." : "Personal Settings."}
        </h2>
        <p className="text-text-main text-base md:text-lg lowercase leading-relaxed font-black italic">
          {profile.role === 'owner' ? "Configure your business identity and boundaries." : "Customize your interface and profile preferences."}
        </p>
      </header>

      <div className="space-y-8">
        <AddWorkerModal 
          isOpen={isAddModalOpen} 
          onClose={() => setIsAddModalOpen(false)} 
          stationId={profile.uid} 
        />
        <div className="bg-card border border-border rounded-[2.5rem] p-8 md:p-12 space-y-12 shadow-2xl">
          <div className="space-y-8">
            <label className="text-xs md:text-sm font-black text-accent uppercase tracking-[0.25em] flex items-center gap-3">
              <User size={20} className="text-accent" />
              Identity Credentials
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-text-main uppercase tracking-widest ml-1 italic">Legal Identity / Display Name</label>
                <input 
                  value={settings.name}
                  onChange={e => setSettings(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-bg border border-border rounded-2xl px-6 py-5 text-base text-text-main outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent shadow-inner touch-target font-black"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-black text-text-main uppercase tracking-widest ml-1 italic">Primary Contact (Phone)</label>
                <input 
                  value={settings.phone}
                  onChange={e => setSettings(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full bg-bg border border-border rounded-2xl px-6 py-5 text-base text-text-main outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent shadow-inner touch-target font-black font-mono"
                />
              </div>
            </div>
          </div>

          {profile.role === 'owner' && (
            <>
              <div className="space-y-8 pt-10 border-t border-border/40">
                <label className="text-xs md:text-sm font-black text-accent uppercase tracking-[0.25em] flex items-center gap-3">
                  <Store size={20} className="text-accent" />
                  Station Identity
                </label>
                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-text-main uppercase tracking-widest ml-1 italic">Business Designation</label>
                    <input 
                      value={settings.businessName}
                      onChange={e => setSettings(prev => ({ ...prev, businessName: e.target.value }))}
                      placeholder="e.g. LAGOS PREMIUM WASH"
                      className="w-full bg-bg border border-border rounded-2xl px-6 py-5 text-base text-text-main outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent shadow-inner touch-target font-black italic uppercase"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-text-main uppercase tracking-widest ml-1 italic">Physical Sector Address</label>
                    <input 
                      value={settings.businessAddress}
                      onChange={e => setSettings(prev => ({ ...prev, businessAddress: e.target.value }))}
                      placeholder="e.g. 123 LEKKI PHASE 1, LAGOS"
                      className="w-full bg-bg border border-border rounded-2xl px-6 py-5 text-base text-text-main outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent shadow-inner touch-target font-black"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-text-main uppercase tracking-widest ml-1 italic">Cover Image (URL)</label>
                    <div className="relative">
                      <ImageIcon size={20} className="absolute left-6 top-1/2 -translate-y-1/2 text-accent" />
                      <input 
                        value={settings.businessImage}
                        onChange={e => setSettings(prev => ({ ...prev, businessImage: e.target.value }))}
                        className="w-full bg-bg border border-border rounded-2xl pl-16 pr-6 py-5 text-base text-text-main outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent shadow-inner touch-target font-black"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-8 pt-10 border-t border-border/40">
                <label className="text-xs md:text-sm font-black text-accent uppercase tracking-[0.25em] flex items-center gap-3">
                  <DollarSign size={20} className="text-accent" />
                  Pricing Engine
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-text-main uppercase tracking-widest italic opacity-70">Sedan (₦)</label>
                    <input 
                      type="number"
                      value={settings.pricing.sedan}
                      onChange={e => setSettings(prev => ({ ...prev, pricing: { ...prev.pricing, sedan: parseFloat(e.target.value) } }))}
                      className="w-full bg-bg border border-border rounded-xl p-4 text-text-main font-black outline-none focus:border-accent shadow-inner"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-text-main uppercase tracking-widest italic opacity-70">SUV (₦)</label>
                    <input 
                      type="number"
                      value={settings.pricing.suv}
                      onChange={e => setSettings(prev => ({ ...prev, pricing: { ...prev.pricing, suv: parseFloat(e.target.value) } }))}
                      className="w-full bg-bg border border-border rounded-xl p-4 text-text-main font-black outline-none focus:border-accent shadow-inner"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-text-main uppercase tracking-widest italic opacity-70">Truck (₦)</label>
                    <input 
                      type="number"
                      value={settings.pricing.truck}
                      onChange={e => setSettings(prev => ({ ...prev, pricing: { ...prev.pricing, truck: parseFloat(e.target.value) } }))}
                      className="w-full bg-bg border border-border rounded-xl p-4 text-text-main font-black outline-none focus:border-accent shadow-inner"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-8 pt-10 border-t border-border/40">
                <label className="text-xs md:text-sm font-black text-accent uppercase tracking-[0.25em] flex items-center gap-3">
                  <MapPin size={20} className="text-accent" />
                  Operational Geofence
                </label>
                <div className="bg-accent/5 p-6 rounded-2xl border border-accent/20">
                  <p className="text-sm text-text-main leading-relaxed font-black italic">
                    Specify exactly where your shop is located. Workers will be blocked from logging washes if they are outside this radius.
                  </p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-text-main uppercase tracking-widest ml-1 italic">Coordinate Latitude</label>
                    <input 
                      type="number"
                      value={settings.businessLat}
                      onChange={e => setSettings(prev => ({ ...prev, businessLat: parseFloat(e.target.value) }))}
                      className="w-full bg-bg border border-border rounded-2xl px-6 py-5 text-base text-text-main outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent shadow-inner touch-target font-black"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-text-main uppercase tracking-widest ml-1 italic">Coordinate Longitude</label>
                    <input 
                      type="number"
                      value={settings.businessLng}
                      onChange={e => setSettings(prev => ({ ...prev, businessLng: parseFloat(e.target.value) }))}
                      className="w-full bg-bg border border-border rounded-2xl px-6 py-5 text-base text-text-main outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent shadow-inner touch-target font-black"
                    />
                  </div>
                </div>

                <button 
                  onClick={handleGetCurrentLocation}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 bg-accent/10 text-accent font-black py-5 rounded-2xl border border-accent/20 hover:bg-accent hover:text-white transition group disabled:opacity-50 touch-target uppercase text-xs tracking-widest shadow-xl"
                >
                  <MapPin size={24} className="group-hover:animate-bounce" />
                  {loading ? "DETECTING COORDINATES..." : "PIN CURRENT GPS DATA"}
                </button>
              </div>
            </>
          )}

          <div className={`space-y-6 ${profile.role === 'owner' ? 'pt-6 border-t border-border' : ''}`}>
            <label className="text-xs font-black text-text-main uppercase tracking-widest flex items-center gap-2 italic">
              <Sparkles size={14} className="text-accent" />
              Visual Interface
            </label>
            <div className="flex items-center justify-between bg-bg/50 p-4 rounded-2xl border border-border">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl transition-colors ${settings.theme === 'light' ? 'bg-accent/20 text-accent' : 'bg-white/5 text-accent'}`}>
                  {settings.theme === 'light' ? <Sun size={20} /> : <Moon size={20} />}
                </div>
                <div>
                  <h4 className="text-sm font-black text-text-main uppercase tracking-tight italic">Interface Theme</h4>
                  <p className="text-[10px] text-text-main font-bold uppercase tracking-widest italic opacity-70">Switch between light and dark modes</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  const newTheme = settings.theme === 'light' ? 'dark' : 'light';
                  setSettings(prev => ({ ...prev, theme: newTheme }));
                  // Immediate preview
                  if (newTheme === 'light') {
                    document.documentElement.classList.add('light');
                  } else {
                    document.documentElement.classList.remove('light');
                  }
                }}
                className={`relative w-14 h-8 rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-accent ${settings.theme === 'light' ? 'bg-accent' : 'bg-white/10'}`}
              >
                <motion.div 
                  animate={{ x: settings.theme === 'light' ? 26 : 4 }}
                  className="absolute top-1 w-6 h-6 bg-white rounded-full shadow-lg flex items-center justify-center"
                >
                   {settings.theme === 'light' ? <Sun size={12} className="text-accent" /> : <Moon size={12} className="text-bg" />}
                </motion.div>
              </button>
            </div>
          </div>

          {profile.role === 'owner' && (
            <div className="space-y-2">
              <label className="text-xs font-black text-text-main uppercase tracking-widest flex items-center justify-between italic">
                <span>Allowed Radius (Meters)</span>
                <span className="text-accent font-black">{settings.businessRadius}m</span>
              </label>
              <input 
                type="range"
                min="50"
                max="2000"
                step="50"
                value={settings.businessRadius}
                onChange={e => setSettings(prev => ({ ...prev, businessRadius: parseInt(e.target.value) }))}
                className="w-full accent-accent h-2 bg-text-main/10 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          )}

          <button 
            onClick={handleSave}
            disabled={loading}
            className="w-full bg-accent text-white font-black py-4 rounded-xl uppercase tracking-widest hover:brightness-110 transition active:scale-95 disabled:opacity-50 shadow-xl shadow-accent/20 italic"
          >
            {loading ? "Processing..." : "Commit Settings"}
          </button>
        </div>

        {/* Team Delegation - Only for Owners */}
        <div className="bg-card border border-border rounded-[2.5rem] p-8 md:p-12 space-y-12 shadow-2xl overflow-hidden relative">
          <header className="flex flex-col md:flex-row md:items-end justify-between gap-8 relative z-10">
            <div className="space-y-4">
              <label className="text-xs md:text-sm font-black text-accent uppercase tracking-[0.25em] flex items-center gap-3">
                <Users size={20} className="text-accent" />
                Staff Registry
              </label>
              <p className="text-sm text-text-main leading-relaxed font-black max-w-md italic">
                Provision new worker accounts and manage existing staff permissions. Workers must be added here before they can access the station dashboard.
              </p>
            </div>
            <button 
              onClick={() => setIsAddModalOpen(true)}
              className="px-10 py-5 bg-accent text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-2xl shadow-accent/20 flex items-center justify-center gap-3 transition-transform hover:scale-105 active:scale-95 touch-target"
            >
              <Plus size={20} /> PROVISION UNIT
            </button>
          </header>

          <div className="space-y-4 relative z-10">
            {/* Active Workers */}
            {workers.map(worker => (
              <div key={worker.uid} className="flex flex-col sm:flex-row sm:items-center justify-between p-6 bg-bg/40 backdrop-blur-md border border-border rounded-[2rem] hover:border-accent/40 transition-all group shadow-lg gap-6">
                <div className="flex items-center gap-5">
                  <div className="relative">
                    {worker.photoUrl ? (
                      <img src={worker.photoUrl} alt={worker.name} className="w-14 h-14 rounded-2xl border border-border group-hover:scale-105 transition-transform object-cover" />
                    ) : (
                      <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center text-accent border border-accent/20 shadow-inner">
                        <Users size={28} />
                      </div>
                    )}
                    {worker.permissions?.canManageTeam && (
                      <div className="absolute -top-2 -right-2 w-6 h-6 bg-accent rounded-full flex items-center justify-center text-white border-2 border-bg shadow-lg">
                        <Zap size={12} fill="currentColor" />
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <p className="text-lg font-black text-text-main uppercase italic tracking-tighter leading-none">{worker.name}</p>
                      <span className="px-3 py-1 bg-success/10 text-success text-[8px] font-black uppercase rounded-full border border-success/20 tracking-widest">ACTIVE</span>
                    </div>
                    <p className="text-[10px] text-text-main/60 uppercase tracking-widest font-black italic">
                      {worker.permissions?.canManageTeam ? "UNIT COMMANDER" : "OPERATIONAL SPECIALIST"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                   <button 
                    onClick={() => togglePermission(worker.uid, 'canManageTeam')}
                    className={cn(
                      "w-full sm:w-auto px-8 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-md touch-target italic",
                      worker.permissions?.canManageTeam 
                        ? "bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500 hover:text-white" 
                        : "bg-accent/10 text-accent border border-accent/20 hover:bg-accent hover:text-white shadow-accent/10"
                    )}
                   >
                     {worker.permissions?.canManageTeam ? "REVOKE LEAD" : "PROMOTE LEAD"}
                   </button>
                </div>
              </div>
            ))}

            {/* Invited but not yet joined */}
            {authorizedEmails.filter(auth => !workers.find(w => w.email === auth.email)).map(auth => (
              <div key={auth.id} className="flex items-center justify-between p-6 bg-text-main/5 border border-dashed border-border/40 rounded-[1.5rem] group transition-opacity">
                <div className="flex items-center gap-5">
                  <div className="w-12 h-12 rounded-xl bg-text-main/5 flex items-center justify-center text-text-main border border-border italic font-black text-sm">
                    ?
                  </div>
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <p className="font-black text-text-main uppercase italic tracking-tighter">{auth.name}</p>
                      <span className="px-2 py-0.5 bg-accent/10 text-accent text-[8px] font-black uppercase rounded tracking-widest border border-accent/20">PENDING INFILTRATION</span>
                    </div>
                    <p className="text-[10px] text-text-main font-black tracking-tighter truncate max-w-[200px] italic">
                      {auth.email}
                    </p>
                  </div>
                </div>

                <button 
                  onClick={() => handleDeleteInvitation(auth.id)}
                  className="p-3 text-text-dim hover:text-red-500 transition-colors touch-target bg-white/5 rounded-full"
                  title="Revoke Invitation"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
          <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-accent/5 rounded-full blur-[100px]" />
        </div>
      </div>
    </motion.div>
  );
}

function AddWorkerModal({ isOpen, onClose, stationId }: { isOpen: boolean, onClose: () => void, stationId: string }) {
  const [form, setForm] = useState({ email: '', name: '' });
  const [loading, setLoading] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.name) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'authorized_workers'), {
        ...form,
        stationId,
        createdAt: serverTimestamp()
      });
      setForm({ email: '', name: '' });
      onClose();
    } catch (error) {
       console.error("Provision error:", error);
       alert("Failed to provision worker.");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-bg/90 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-card border border-white/10 w-full max-w-md rounded-[2.5rem] shadow-2xl relative overflow-hidden"
      >
        <div className="p-8 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-accent/20 rounded-xl flex items-center justify-center text-accent">
               <Plus size={24} />
             </div>
             <div>
               <h3 className="text-xl font-black text-text-main uppercase italic tracking-tighter">Provision Worker</h3>
               <p className="text-[10px] text-accent font-black uppercase tracking-widest">Linked Station Access</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition text-text-dim">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleAdd} className="p-8 space-y-8">
          <div className="space-y-6">
            <div className="space-y-3">
              <label className="text-[10px] font-black text-text-main uppercase tracking-[0.2em] ml-1 italic">Operative Full Name</label>
              <input 
                required
                value={form.name}
                onChange={e => setForm({...form, name: e.target.value})}
                placeholder="e.g. JOHN DOE"
                className="w-full bg-bg border border-border rounded-2xl px-6 py-5 text-base text-text-main outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent shadow-inner touch-target font-black uppercase italic"
              />
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-black text-text-main uppercase tracking-[0.2em] ml-1 italic">Protocol Email Address</label>
              <div className="relative">
                <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-accent" size={20} />
                <input 
                  required
                  type="email"
                  value={form.email}
                  onChange={e => setForm({...form, email: e.target.value})}
                  placeholder="operative@washflow.systems"
                  className="w-full bg-bg pl-16 pr-6 py-5 rounded-2xl border border-border focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none text-text-main text-base font-black touch-target italic uppercase"
                />
              </div>
              <p className="text-[9px] text-text-dim/60 font-black uppercase tracking-widest mt-2 px-2 italic">
                Note: Operative must use this exact Google Email to authenticate.
              </p>
            </div>
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-accent text-white py-6 rounded-3xl font-black uppercase tracking-[0.25em] shadow-xl shadow-accent/20 hover:brightness-110 transition-all disabled:opacity-50 touch-target italic flex items-center justify-center gap-3"
          >
            {loading ? <RefreshCw className="animate-spin" size={18} /> : (
              <>
                <ShieldCheck size={20} />
                CONFIRM REGISTRY DATA →
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function ScannerView({ profile, setView, onLog }: { profile: UserProfile, setView: (v: AppView) => void, onLog: (data: { carModel: string, plateNumber: string }) => void }) {
  const [isScanning, setIsScanning] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [result, setResult] = useState<{ plate: string, vehicle: string } | null>(null);
  const [showGarage, setShowGarage] = useState(false);
  const [feedback, setFeedback] = useState<{
    lighting: 'too-dark' | 'good' | 'too-bright';
    quality: 'low' | 'med' | 'high';
    brightnessLevel: number;
  }>({ lighting: 'good', quality: 'high', brightnessLevel: 150 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const feedbackCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));

  useEffect(() => {
    let animationFrameId: number;
    if (!cameraActive) return;

    const analyzeFrame = () => {
      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        const video = videoRef.current;
        const canvas = feedbackCanvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        if (ctx) {
          // Low res sample for performance
          const sampleWidth = 100;
          const sampleHeight = 100;
          canvas.width = sampleWidth;
          canvas.height = sampleHeight;
          
          // Draw center of video
          const sw = video.videoWidth * 0.5;
          const sh = video.videoHeight * 0.5;
          const sx = (video.videoWidth - sw) / 2;
          const sy = (video.videoHeight - sh) / 2;
          
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sampleWidth, sampleHeight);
          const imageData = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
          const data = imageData.data;
          
          let totalBrightness = 0;
          for (let i = 0; i < data.length; i += 4) {
            totalBrightness += (data[i] + data[i+1] + data[i+2]) / 3;
          }
          const avgBrightness = totalBrightness / (data.length / 4);
          
          // Simplified Sharpness tracking (Variance of brightness)
          let sumSquares = 0;
          for (let i = 0; i < data.length; i += 4) {
             const b = (data[i] + data[i+1] + data[i+2]) / 3;
             sumSquares += Math.pow(b - avgBrightness, 2);
          }
          const variance = sumSquares / (data.length / 4);
          
          setFeedback({
            lighting: avgBrightness < 60 ? 'too-dark' : avgBrightness > 220 ? 'too-bright' : 'good',
            quality: variance < 200 ? 'low' : variance < 800 ? 'med' : 'high',
            brightnessLevel: Math.round(avgBrightness)
          });
        }
      }
      animationFrameId = requestAnimationFrame(analyzeFrame);
    };

    analyzeFrame();
    return () => cancelAnimationFrame(animationFrameId);
  }, [cameraActive]);

  const startCamera = async () => {
    setCameraActive(true);
    setResult(null);
    setShowGarage(false);
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
        const res = await scanVehicleInfo(base64Image);
        if (res.plate && res.vehicle) {
          setResult(res);
          stopCamera();
        } else if (res.vehicle && !res.plate) {
          setResult({ ...res, plate: '' });
          stopCamera();
        } else if (res.plate && !res.vehicle) {
          setResult({ ...res, vehicle: '' });
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

  const handleManualSelection = (vehicle: any) => {
    setResult({ plate: vehicle.plate, vehicle: `${vehicle.make} ${vehicle.model}` });
    setShowGarage(false);
    stopCamera();
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto space-y-8 pb-20 px-4 md:px-0">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-black text-text-main uppercase tracking-tighter">AI Scanner.</h2>
          <p className="text-text-dim lowercase">Elite recognition for plates & models.</p>
        </div>
        <button 
          onClick={() => setView('dashboard')} 
          className="text-text-dim hover:text-text-main uppercase text-[10px] font-black tracking-widest border-b border-border pb-1"
        >
          Exit Scanner
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bento-card p-0 overflow-hidden relative aspect-[4/3] bg-bg shadow-2xl">
          {!cameraActive && !showGarage ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center p-10">
              <div className="w-20 h-20 bg-accent/10 rounded-full flex items-center justify-center text-accent">
                <Camera size={40} />
              </div>
              <h3 className="text-xl font-black text-text-main uppercase tracking-tighter">Ready for Analysis</h3>
              <p className="text-sm text-text-dim lowercase mb-4">Position the vehicle plate clearly in the frame for maximum accuracy.</p>
              
              <div className="flex flex-col w-full max-w-xs gap-3">
                <button 
                  onClick={startCamera}
                  className="bg-text-main text-bg px-8 py-4 rounded-xl font-black uppercase tracking-widest text-[10px] hover:brightness-110 transition shadow-xl"
                >
                  Initiate Lens
                </button>
                
                {profile.vehicles && profile.vehicles.length > 0 && (
                  <button 
                    onClick={() => setShowGarage(true)}
                    className="bg-text-main/5 text-text-dim px-8 py-4 rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-text-main/10 hover:text-text-main transition"
                  >
                    Select From Garage
                  </button>
                )}
              </div>
            </div>
          ) : showGarage ? (
            <div className="absolute inset-0 bg-bg p-8 overflow-y-auto">
               <div className="flex items-center justify-between mb-8">
                 <h3 className="text-lg font-black text-text-main uppercase tracking-tighter">Internal Garage</h3>
                 <button onClick={() => setShowGarage(false)} className="text-accent font-black text-[10px] uppercase">Back to Camera</button>
               </div>
               <div className="space-y-3">
                 {profile.vehicles?.map((v, i) => (
                   <button 
                    key={i} 
                    onClick={() => handleManualSelection(v)}
                    className="w-full flex items-center justify-between p-4 bg-card border border-border rounded-xl hover:border-accent group transition"
                   >
                     <div className="text-left">
                       <p className="text-white font-bold">{v.make} {v.model}</p>
                       <p className="text-xs text-text-dim font-mono">{v.plate}</p>
                     </div>
                     <ChevronRight size={20} className="text-text-dim group-hover:text-accent transition" />
                   </button>
                 ))}
               </div>
            </div>
          ) : (
            <>
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className="w-full h-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-x-8 top-8 flex justify-between gap-4 pointer-events-none">
                <div className="flex flex-col gap-2">
                  <div className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md border text-[10px] font-black uppercase tracking-widest transition-colors",
                    feedback.lighting === 'good' ? "bg-success/20 border-success/40 text-success" : 
                    feedback.lighting === 'too-dark' ? "bg-blue-500/20 border-blue-500/40 text-blue-400" :
                    "bg-orange-500/20 border-orange-500/40 text-orange-400"
                  )}>
                    {feedback.lighting === 'good' ? <Sun size={12} /> : feedback.lighting === 'too-dark' ? <Moon size={12} /> : <Zap size={12} />}
                    {feedback.lighting === 'good' ? 'Optimal Light' : feedback.lighting === 'too-dark' ? 'Low Light' : 'Excessive Light'}
                  </div>
                    <div className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md border text-[10px] font-black uppercase tracking-widest transition-colors",
                      feedback.quality === 'high' ? "bg-accent/20 border-accent/40 text-accent" : 
                      feedback.quality === 'med' ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-400" :
                      "bg-red-500/20 border-red-500/40 text-red-400"
                    )}>
                      <Camera size={12} />
                      {feedback.quality === 'high' ? 'HD Source' : feedback.quality === 'med' ? 'Stable Frame' : 'Blur Detected'}
                    </div>
                </div>
                
                <div className="bg-black/60 backdrop-blur-md border border-white/10 p-3 rounded-2xl flex flex-col items-center justify-center min-w-[60px]">
                  <p className="text-[8px] font-black text-text-dim uppercase mb-1">Index</p>
                  <p className="text-sm font-black text-white">{feedback.brightnessLevel}</p>
                </div>
              </div>

              <div className="absolute inset-0 border-[40px] border-bg/40 pointer-events-none">
                <div className="absolute inset-4 border-2 border-accent/40 rounded-3xl" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className={cn(
                    "w-64 h-32 border-2 rounded-xl transition-all duration-300",
                    feedback.quality === 'high' && feedback.lighting === 'good' ? "border-success scale-105 shadow-[0_0_20px_rgba(48,209,88,0.3)]" : "border-white/20"
                  )} />
                </div>
              </div>
              <div className="absolute bottom-8 inset-x-8">
                 <button 
                  onClick={captureAndScan}
                  disabled={isScanning}
                  className="w-full bg-white text-bg py-4 rounded-2xl font-black uppercase tracking-widest shadow-2xl flex items-center justify-center gap-3 active:scale-95 transition disabled:opacity-50"
                 >
                   {isScanning ? <RefreshCw className="animate-spin" size={18} /> : <Zap size={18} />}
                   {isScanning ? "Processing AI Insight..." : "Analyze Stream"}
                 </button>
              </div>
            </>
          )}
        </div>

        <div className="space-y-6">
          <div className="bento-card border-t-4 border-t-accent h-full flex flex-col">
             <div className="flex items-center justify-between mb-6">
               <div className="flex items-center gap-2">
                 <ShieldCheck size={18} className="text-accent" />
                 <span className="text-[10px] font-black text-accent uppercase tracking-[0.2em]">Recognition Result</span>
               </div>
               {!result && (
                 <button 
                   onClick={() => setResult({ plate: '', vehicle: '' })}
                   className="text-[10px] font-black text-text-dim hover:text-white uppercase tracking-widest"
                 >
                   Manual Entry
                 </button>
               )}
             </div>
             {result ? (
               <div className="space-y-6 flex-1 flex flex-col">
                 <div>
                    <label className="text-[10px] font-black text-text-dim uppercase tracking-widest mb-1 block">Identified Plate</label>
                    <input 
                      value={result.plate}
                      placeholder="ABC-123-XY"
                      onChange={e => setResult({...result, plate: e.target.value.toUpperCase()})}
                      className={cn(
                        "w-full text-4xl font-black tracking-widest font-mono uppercase bg-bg p-4 rounded-xl border outline-none focus:ring-2 focus:ring-accent shadow-inner transition",
                        result.plate ? "text-text-main border-border" : "text-accent border-accent/40 animate-pulse"
                      )}
                    />
                 </div>
                 <div>
                    <label className="text-[10px] font-black text-text-dim uppercase tracking-widest mb-1 block">Vehicle Model</label>
                    <input 
                      value={result.vehicle}
                      placeholder="VEHICLE MODEL"
                      onChange={e => setResult({...result, vehicle: e.target.value})}
                      className={cn(
                        "w-full text-2xl font-black uppercase tracking-tighter bg-bg p-4 rounded-xl border outline-none focus:ring-2 focus:ring-accent transition",
                        result.vehicle ? "text-text-main border-border" : "text-yellow-500 border-yellow-500/40 animate-pulse"
                      )}
                    />
                 </div>
                 
                 <div className="mt-auto pt-6 space-y-3">
                   <button 
                    disabled={!result.plate || !result.vehicle}
                    onClick={() => onLog({ carModel: result.vehicle, plateNumber: result.plate })}
                    className="w-full bg-accent text-white py-4 rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-white hover:text-bg transition disabled:opacity-50"
                   >
                     Log This Wash
                   </button>
                   
                   {profile.vehicles && profile.vehicles.length > 0 && (
                     <button 
                       onClick={() => setShowGarage(true)}
                       className="w-full bg-white/5 text-text-dim py-3 rounded-xl font-black uppercase tracking-widest text-[10px] hover:text-white transition"
                     >
                       Select From Garage
                     </button>
                   )}

                   <button 
                    onClick={() => { startCamera(); }}
                    className="w-full bg-white/5 text-text-dim py-3 rounded-xl font-black uppercase tracking-widest text-[10px] hover:text-white transition"
                   >
                     Scan Again
                   </button>
                 </div>
               </div>
             ) : (
               <div className="flex-1 flex flex-col items-center justify-center py-20 text-center opacity-20">
                 <Search size={40} className="mx-auto mb-4" />
                 <p className="text-xs font-black uppercase tracking-widest">Waiting for data stream...</p>
                 <p className="text-[10px] mt-2 italic lowercase text-text-dim">Initiate the lens or select manually from your records.</p>
               </div>
             )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
