import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, Lock, ArrowRight, AlertCircle, Eye, EyeOff, KeyRound } from 'lucide-react';
import api from '@/lib/api';
import { setSession } from '@/lib/auth';
import { normalizeFromLogin } from '@/lib/permissions';
import { AppUser, LoginResponseData } from '@/types/permissions';

interface LoginResponse { status: string; message?: string; accessToken?: string; data?: LoginResponseData; }

interface LoginProps {
  onLogin: (user: AppUser) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exchangingXAuth = useRef(false);

  // Staff360 redirects to this SPA with an opaque token. Exchange it immediately with our
  // backend; the backend is the only place that knows the XAuth app secret.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token || exchangingXAuth.current) return;
    exchangingXAuth.current = true;
    setIsLoading(true);
    window.history.replaceState({}, document.title, window.location.pathname);

    api.post<LoginResponse>('/xauth/exchange', { token })
      .then(({ data }) => {
        if (data.status !== '200' || !data.accessToken || !data.data) throw new Error('Authentication failed');
        const appUser = normalizeFromLogin(data.data);
        setSession(data.accessToken, appUser);
        onLogin(appUser);
      })
      .catch((err: any) => {
        const message = err?.response?.data?.message;
        setError(message || 'Staff single sign-on failed. Please try again.');
      })
      .finally(() => setIsLoading(false));
  }, [onLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.post<LoginResponse>('/login', { email: email.trim(), password });
      const { status, accessToken, data } = response.data;
      if (status !== '200' || !accessToken || !data) {
        setError('Invalid email or password.');
        return;
      }
      const appUser = normalizeFromLogin(data);
      setSession(accessToken, appUser);
      onLogin(appUser);
    } catch (err: any) {
      const serverMsg: string = err?.response?.data?.message ?? '';
      // Never expose token/session internals to the user on the login screen
      const isInternalError = /token|session|unauthorized|refresh/i.test(serverMsg);
      setError(isInternalError ? 'Something went wrong. Please try again.' : (serverMsg || 'Invalid email or password.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full relative overflow-hidden font-sans bg-cover bg-center bg-[#0b0f19]"
      style={{ backgroundImage: `url('${import.meta.env.BASE_URL}hr2.jpg')` }}
    >
      {/* Dark-to-transparent overlay: strong on the left where the card sits, fading out to the right */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#0b0f19] via-[#0b0f19]/80 to-[#0b0f19]/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0b0f19]/80 via-transparent to-[#0b0f19]/40" />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-8 sm:px-12 pt-8">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-gradient-to-br from-[#0066b3] to-[#0099ff] flex items-center justify-center shadow-lg border border-white/20">
            <span className="text-white font-bold text-[15px] tracking-tight">HR</span>
          </div>
          <span className="text-[19px] font-bold text-white tracking-wide">
            RCB <span className="font-normal text-slate-400">Portal</span>
          </span>
        </div>
        {/* <div className="hidden sm:flex items-center gap-8 text-sm font-semibold text-slate-300">
          <span className="text-white">Sign In</span>
          <a href="#" className="hover:text-white transition-colors">Help</a>
        </div> */}
      </div>

      {/* Card */}
      <div className="relative z-10 flex items-center ml-32 min-h-[calc(100vh-96px)] px-6 sm:px-12">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-[440px] bg-slate-900/40 p-8 sm:p-10 rounded-[24px] shadow-[0_8px_30px_rgba(0,0,0,0.3)] border border-white/5 backdrop-blur-lg"
        >
          <div className="mb-10">
            <p className="text-xs font-bold tracking-[0.2em] text-blue-400 mb-3 uppercase">Welcome back</p>
            <h2 className="text-3xl font-bold text-white tracking-tight mb-3">Sign in to your account</h2>
            <p className="text-slate-400 text-[15px] font-medium">Please enter your details to sign in.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-4">
              {/* Email / Username Input */}
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-1.5 ml-0.5 tracking-wide">Email or Username</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-500 transition-colors z-10">
                    <User className="h-5 w-5" />
                  </div>
                  <input
                    type="text"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="username"
                    className="w-full !pl-11 !pr-4 !py-2 bg-slate-950/40 border border-white/10 rounded-lg text-white font-medium text-[14px] placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="admin@usg.com or EMP-00004"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5 ml-0.5">
                  <label className="block text-sm font-semibold text-slate-300 tracking-wide">Password</label>
                  <a href="#" className="text-sm font-bold text-blue-400 hover:text-blue-300 transition-colors">
                    Forgot password?
                  </a>
                </div>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-500 transition-colors z-10">
                    <Lock className="h-5 w-5" />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full !pl-11 !pr-10 !py-2 bg-slate-950/40 border border-white/10 rounded-lg text-white font-medium text-[14px] placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white transition-colors focus:outline-none"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/30 border border-red-800/50 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Remember Me */}
            <div className="flex items-center mt-5">
              <input
                id="remember-me"
                name="remember-me"
                type="checkbox"
                className="h-4 w-4 rounded border-white/10 bg-slate-950/40 text-blue-600 focus:ring-blue-500/40 cursor-pointer accent-blue-600"
              />
              <label htmlFor="remember-me" className="ml-2 block text-sm font-medium text-slate-300 cursor-pointer">
                Remember me for 30 days
              </label>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center py-2 border border-transparent rounded-[8px] shadow-[0_4px_14px_rgba(37,99,235,0.4)] text-[15px] font-semibold text-white bg-blue-600 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all disabled:opacity-70 mt-6 relative overflow-hidden group"
            >
              <AnimatePresence mode="wait">
                {isLoading ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex justify-center items-center"
                  >
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="text"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2"
                  >
                    Sign In
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </motion.div>
                )}
              </AnimatePresence>
            </button>

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10" /></div>
              <div className="relative flex justify-center"><span className="bg-slate-900 px-3 text-xs text-slate-400">or</span></div>
            </div>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => { window.location.assign('/v1/api/hr/xauth/login'); }}
              className="w-full flex items-center justify-center gap-2 py-2 border border-white/15 rounded-[8px] text-[15px] font-semibold text-white bg-white/5 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all disabled:opacity-70"
            >
              <KeyRound className="w-4 h-4" />
              Sign in with Staff360
            </button>
          </form>

          {/* Footer Text */}
          <p className="mt-10 text-center text-sm text-slate-400">
            Don't have an account?{' '}
            <a href="#" className="font-semibold text-blue-400 hover:text-blue-300 transition-colors">
              Contact Your Administrator
            </a>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
