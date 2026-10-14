import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { authAPI, getErrorMessage } from '../services/api';
import { googleEnabled, nativeGoogleSignIn, renderGoogleButton, useNativeGoogle } from '../auth/google';
import { Logo, LogoMark } from './Logo';
import { RevealText, Reveal, Marquee, Magnetic, RollText, useTilt } from '../motion';
import {
  Mail, Lock, User as UserIcon, Eye, EyeOff, ArrowRight, Loader2,
  MessageSquareText, Layers, Headphones, Share2, Check, AlertCircle,
  Flame, Sparkles, GraduationCap, Users, BookOpen, Brain, ShieldCheck, ArrowLeft, MailCheck, KeyRound, RotateCw,
} from 'lucide-react';

type Mode = 'login' | 'signup';
/** The form, or one of the emailed-code steps */
type Step = 'form' | 'verify' | 'forgot' | 'reset';
const RESEND_SECONDS = 60;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const passwordChecks = (password: string) => [
  { label: 'At least 8 characters', ok: password.length >= 8 },
  { label: 'Contains a letter', ok: /[A-Za-z]/.test(password) },
  { label: 'Contains a number', ok: /\d/.test(password) },
];

/** 0-4: length, letters + numbers, mixed case, symbols */
const passwordStrength = (password: string) => {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Za-z]/.test(password) && /\d/.test(password)) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password) || password.length >= 14) score++;
  return score;
};

const STRENGTH = [
  { label: 'Too weak', bar: 'bg-rose-500' },
  { label: 'Weak', bar: 'bg-rose-500' },
  { label: 'Fair', bar: 'bg-amber-500' },
  { label: 'Good', bar: 'bg-emerald-500' },
  { label: 'Strong', bar: 'bg-emerald-600' },
];

const FEATURES = [
  { icon: MessageSquareText, text: 'Cited AI chat' },
  { icon: Layers, text: 'Spaced-repetition flashcards' },
  { icon: GraduationCap, text: 'Adaptive quizzes' },
  { icon: Headphones, text: 'Audio overviews' },
  { icon: Share2, text: 'Concept graphs' },
  { icon: Users, text: 'Live study rooms' },
  { icon: BookOpen, text: 'Smart reader' },
  { icon: Brain, text: 'AI study group' },
];

const ROTATING = ['notes.', 'lectures.', 'slides.', 'textbooks.'];

interface FieldProps {
  id: string;
  label: string;
  icon: React.ElementType;
  error?: string | null;
  children: React.ReactNode;
  delay?: number;
}

const Field: React.FC<FieldProps> = ({ id, label, icon: Icon, error, children, delay = 0 }) => (
  <div className="animate-rise" style={{ animationDelay: `${delay}ms` }}>
    <label htmlFor={id} className="block text-[11px] font-bold text-slate-500 uppercase tracking-[0.14em] mb-1.5">{label}</label>
    <div className="relative group">
      <Icon className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none transition-colors duration-300 ${error ? 'text-rose-400' : 'text-slate-400 group-focus-within:text-primary-600'}`} />
      {children}
    </div>
    {error && <p className="text-xs text-rose-600 mt-1.5 font-medium animate-slide-up" id={`${id}-error`}>{error}</p>}
  </div>
);

/** Floating preview cards on the brand panel: a glimpse of what the app does. */
const PreviewCards: React.FC = () => {
  const tilt = useTilt(8);
  return (
    <div className="relative h-[300px] w-full max-w-[460px]" aria-hidden="true">
      {/* Chat answer with citation */}
      <div {...tilt} className="tilt absolute left-0 top-4 w-[78%] float-a">
        <div className="rounded-2xl bg-white/[0.07] border border-white/10 backdrop-blur-xl p-4 shadow-2xl animate-rise" style={{ animationDelay: '900ms' }}>
          <div className="flex items-center gap-2 mb-2">
            <LogoMark size={22} />
            <span className="text-xs font-semibold text-white/80">MindAI</span>
            <span className="ml-auto text-[10px] text-white/40">just now</span>
          </div>
          <p className="text-sm text-white/85 leading-relaxed">
            Photosynthesis turns light into chemical energy in the chloroplasts
            <span className="inline-flex items-center justify-center mx-1 px-1.5 rounded-md bg-violet-500/40 text-[10px] font-bold text-violet-100 align-middle">1</span>
            and releases oxygen as a by-product.
          </p>
          <div className="mt-3 text-[11px] text-violet-200/80 flex items-center gap-1.5"><BookOpen className="w-3 h-3" /> Biology_Ch4.pdf · page 12</div>
        </div>
      </div>
      {/* Streak */}
      <div className="absolute right-0 top-0 float-b">
        <div className="rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 p-4 shadow-2xl shadow-orange-500/30 text-white w-36 animate-pop" style={{ animationDelay: '1200ms' }}>
          <Flame className="w-6 h-6 mb-2" />
          <div className="font-display text-3xl font-bold leading-none">12</div>
          <div className="text-xs font-semibold text-white/85 mt-1">day streak</div>
        </div>
      </div>
      {/* Flashcard */}
      <div className="absolute right-6 bottom-0 w-[62%] float-a" style={{ animationDelay: '-2s' }}>
        <div className="rounded-2xl bg-white text-slate-900 p-4 shadow-2xl animate-rise" style={{ animationDelay: '1400ms' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-violet-600">Flashcard · due today</span>
            <Sparkles className="w-4 h-4 text-amber-500" />
          </div>
          <p className="font-semibold text-sm">What does the Krebs cycle produce?</p>
          <div className="mt-3 grid grid-cols-4 gap-1.5 text-[10px] font-bold text-center">
            <span className="py-1 rounded-md bg-rose-50 text-rose-600">Again</span>
            <span className="py-1 rounded-md bg-amber-50 text-amber-600">Hard</span>
            <span className="py-1 rounded-md bg-emerald-50 text-emerald-600">Good</span>
            <span className="py-1 rounded-md bg-sky-50 text-sky-600">Easy</span>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Six single-digit boxes for an emailed code: typing moves along, backspace moves back, pasting fills all. */
const CodeInput: React.FC<{ value: string; onChange: (code: string) => void; disabled?: boolean; invalid?: boolean }> = ({ value, onChange, disabled, invalid }) => {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => { refs.current[0]?.focus(); }, []);
  const setAt = (index: number, digits: string) => {
    const chars = value.padEnd(6, ' ').split('');
    let i = index;
    for (const d of digits) { if (i > 5) break; chars[i++] = d; }
    onChange(chars.join('').replace(/\s+$/, '').replace(/ /g, ''));
    refs.current[Math.min(i, 5)]?.focus();
  };
  return (
    <div className="flex justify-between gap-2" role="group" aria-label="6-digit code">
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el; }}
          value={value[i] || ''}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={6}
          aria-label={`Digit ${i + 1}`}
          onChange={e => { const d = e.target.value.replace(/\D/g, ''); if (d) setAt(i, d); }}
          onKeyDown={e => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              if (value[i]) onChange(value.slice(0, i) + value.slice(i + 1));
              else if (i > 0) { onChange(value.slice(0, i - 1) + value.slice(i)); refs.current[i - 1]?.focus(); }
            } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            else if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
          }}
          onPaste={e => { e.preventDefault(); const d = e.clipboardData.getData('text').replace(/\D/g, ''); if (d) setAt(0, d.slice(0, 6)); }}
          onFocus={e => e.target.select()}
          className={`w-full aspect-[4/5] max-w-[3.4rem] rounded-2xl border text-center text-2xl font-display font-bold text-slate-900 bg-white/90 transition-all duration-300 focus:outline-none focus:ring-4 disabled:opacity-60
            ${invalid ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : value[i] ? 'border-primary-300 focus:border-primary-500 focus:ring-primary-100' : 'border-slate-200 focus:border-primary-500 focus:ring-primary-100'}`}
        />
      ))}
    </div>
  );
};

/** Countdown before another code may be requested. */
const useCooldown = () => {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const id = window.setTimeout(() => setLeft(l => l - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left]);
  return [left, () => setLeft(RESEND_SECONDS)] as const;
};

/** "Continue with Google" - Google's own button on the web, the native account picker in the Android app. */
const GoogleButton: React.FC<{ onToken: (idToken: string) => void; onError: (message: string) => void; disabled?: boolean }> = ({ onToken, onError, disabled }) => {
  const holder = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const tokenRef = useRef(onToken);
  tokenRef.current = onToken;

  useEffect(() => {
    if (useNativeGoogle || !holder.current) return;
    renderGoogleButton(holder.current, t => tokenRef.current(t), holder.current.offsetWidth).catch(err => onError(getErrorMessage(err, 'Google sign-in is unavailable right now.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!useNativeGoogle) return <div ref={holder} className={`flex justify-center min-h-[44px] ${disabled ? 'pointer-events-none opacity-60' : ''}`} />;

  return (
    <button type="button" disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try {
          const token = await nativeGoogleSignIn();
          if (token) onToken(token);
        } catch (err) {
          // Show Google's own reason (e.g. the app isn't registered yet) - it is what tells us what to fix
          const reason = err instanceof Error && err.message ? err.message : String(err || '');
          onError(reason ? `Google sign-in failed: ${reason}` : 'Google sign-in failed. Please try again.');
        } finally {
          setBusy(false);
        }
      }}
      className="w-full flex items-center justify-center gap-3 py-3.5 rounded-full border border-slate-200 bg-white text-slate-700 font-semibold hover:bg-slate-50 transition-colors disabled:opacity-60">
      {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : (
        <svg viewBox="0 0 48 48" className="w-5 h-5" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
      )}
      Continue with Google
    </button>
  );
};

export const AuthPage: React.FC = () => {
  const { login, signup, completeAuth, sessionExpired } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [step, setStep] = useState<Step>('form');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, startCooldown] = useCooldown();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setWordIndex(i => (i + 1) % ROTATING.length), 2400);
    return () => window.clearInterval(id);
  }, []);

  const isSignup = mode === 'signup';
  const checks = passwordChecks(password);
  const strength = passwordStrength(password);

  const errors = {
    name: isSignup && !name.trim() ? 'Enter your name.' : null,
    email: !email.trim() ? 'Enter your email.' : !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : null,
    password: !password
      ? 'Enter your password.'
      : isSignup && !checks.every(c => c.ok) ? 'Your password doesn\'t meet the requirements yet.' : null,
    confirm: isSignup && confirm !== password ? 'Passwords don\'t match.' : null,
  };
  const visibleError = (field: keyof typeof errors) => (touched[field] ? errors[field] : null);
  const isValid = Object.values(errors).every(e => !e);

  const goTo = (next: Step) => {
    setStep(next);
    setCode('');
    setServerError(null);
    setNotice(null);
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setServerError(null);
    setTouched({});
    setPassword('');
    setConfirm('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, email: true, password: true, confirm: true });
    if (!isValid) return;
    setIsSubmitting(true);
    setServerError(null);
    try {
      const outcome = isSignup ? await signup(name.trim(), email.trim(), password) : await login(email.trim(), password);
      if (outcome.verifyEmail) {
        setEmail(outcome.verifyEmail);
        goTo('verify');
        startCooldown();
      }
    } catch (err) {
      setServerError(getErrorMessage(err, isSignup ? 'Could not create your account. Please try again.' : 'Could not sign you in. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Run one of the code-step requests with the shared busy/error handling
  const run = async (action: () => Promise<void>, fallback: string) => {
    setIsSubmitting(true);
    setServerError(null);
    try {
      await action();
    } catch (err) {
      setServerError(getErrorMessage(err, fallback));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitVerify = (value = code) => {
    if (value.length !== 6 || isSubmitting) return;
    run(async () => completeAuth(await authAPI.verifyEmail(email.trim(), value)), 'Could not confirm your email. Please try again.')
      .then(() => setCode(c => (c === value ? '' : c)));
  };

  const resendCode = () => run(async () => {
    if (step === 'verify') await authAPI.resendVerification(email.trim());
    else await authAPI.forgotPassword(email.trim());
    startCooldown();
    setCode('');
    setNotice('A new code is on its way - check your inbox (and spam folder).');
  }, 'Could not send a new code. Please try again.');

  const sendResetCode = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(t => ({ ...t, email: true }));
    if (errors.email) return;
    run(async () => {
      await authAPI.forgotPassword(email.trim());
      goTo('reset');
      startCooldown();
      setPassword('');
      setConfirm('');
      setTouched({});
    }, 'Could not send the reset code. Please try again.');
  };

  const resetValid = code.length === 6 && checks.every(c => c.ok) && confirm === password;
  const submitReset = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ password: true, confirm: true });
    if (!resetValid) return;
    run(async () => completeAuth(await authAPI.resetPassword(email.trim(), code, password)), 'Could not reset your password. Please try again.');
  };

  const signInWithGoogle = (idToken: string) =>
    run(async () => completeAuth(await authAPI.google(idToken)), 'Google sign-in failed. Please try again.');

  const inputClass = (field: keyof typeof errors) =>
    `w-full rounded-2xl border bg-white/80 py-3.5 pl-12 pr-4 text-slate-900 placeholder-slate-400 transition-all duration-300 focus:outline-none focus:ring-4 focus:bg-white hover:border-slate-300
     ${visibleError(field) ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : 'border-slate-200 focus:border-primary-500 focus:ring-primary-100'}`;

  // Field entrance delays (re-played when switching between sign in / create account)
  let delayStep = 0;
  const nextDelay = () => 120 + (delayStep++) * 70;

  return (
    <div className="min-h-[100dvh] w-full flex bg-[#faf9ff]">
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden bg-[#0b0a1a] text-white flex-col justify-between grain">
        <div className="mesh-bg">
          <div className="mesh-blob w-[560px] h-[560px] -top-40 -left-32 bg-violet-600/50" />
          <div className="mesh-blob w-[480px] h-[480px] -bottom-48 -right-24 bg-indigo-500/40" style={{ animationDelay: '-6s' }} />
          <div className="mesh-blob w-[320px] h-[320px] top-1/3 right-1/4 bg-fuchsia-500/20" style={{ animationDelay: '-12s' }} />
        </div>
        <div className="absolute inset-0 dot-grid opacity-[0.12]" />

        <div className="relative z-10 p-12 pb-0 flex items-center justify-between">
          <Reveal><Logo size={46} tone="light" /></Reveal>
          <Reveal delay={150} className="hidden xl:flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-white/50">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> AI study companion
          </Reveal>
        </div>

        <div className="relative z-10 px-12 max-w-2xl">
          <RevealText
            text="Study smarter with an AI that truly knows your"
            accent={['smarter']}
            delay={200}
            className="text-[3.4rem] xl:text-[4.2rem] font-display font-bold leading-[1.02] tracking-tight"
            accentClassName="font-elegant italic font-normal text-violet-300"
          />
          <div className="h-[4.6rem] xl:h-[5.4rem] overflow-hidden text-[3.4rem] xl:text-[4.2rem] leading-[1.15]">
            <span key={wordIndex} className="inline-block font-elegant italic text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-300 to-orange-400 animate-rise">
              {ROTATING[wordIndex]}
            </span>
          </div>
          <Reveal delay={700} className="mt-8">
            <PreviewCards />
          </Reveal>
        </div>

        <div className="relative z-10 pb-10">
          <Marquee duration={36} className="py-5 border-y border-white/[0.07]">
            {FEATURES.map(({ icon: Icon, text }) => (
              <span key={text} className="flex items-center gap-3 px-6 text-white/70 text-sm font-medium whitespace-nowrap">
                <Icon className="w-4 h-4 text-violet-300" />
                {text}
                <span className="ml-6 w-1.5 h-1.5 rotate-45 bg-amber-300/70" />
              </span>
            ))}
          </Marquee>
          <p className="px-12 mt-6 text-sm text-white/40 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Your documents and progress are private to your account.
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 relative flex items-center justify-center p-6 sm:p-12 overflow-hidden">
        <div className="mesh-bg lg:hidden">
          <div className="mesh-blob w-80 h-80 -top-24 -right-24 bg-violet-300/50" />
          <div className="mesh-blob w-72 h-72 -bottom-24 -left-24 bg-indigo-200/60" style={{ animationDelay: '-8s' }} />
        </div>
        <div className="absolute inset-0 dot-grid opacity-50 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />

        <div className="relative w-full max-w-md">
          <Reveal><Logo size={44} className="lg:hidden mb-10" /></Reveal>

          {step === 'form' && (<>
          <div key={mode}>
            <RevealText
              as="h2"
              text={isSignup ? 'Create your account' : 'Welcome back'}
              accent={isSignup ? ['account'] : ['back']}
              className="text-[2.6rem] font-display font-bold text-slate-900 tracking-tight leading-[1.05]"
            />
            <p className="text-slate-500 mt-3 mb-7 animate-rise" style={{ animationDelay: '200ms' }}>
              {isSignup ? 'Start building your personal study space.' : 'Sign in to continue studying.'}
            </p>
          </div>

          {/* Mode tabs with a sliding indicator */}
          <div className="relative grid grid-cols-2 p-1.5 bg-slate-100/80 backdrop-blur rounded-2xl mb-7 ring-1 ring-slate-200/60" role="tablist">
            <span
              className="absolute top-1.5 bottom-1.5 left-1.5 w-[calc(50%-0.375rem)] rounded-xl bg-white shadow-md shadow-slate-900/5 transition-transform duration-500 ease-out-expo"
              style={{ transform: isSignup ? 'translateX(100%)' : 'translateX(0)' }}
              aria-hidden="true"
            />
            {(['login', 'signup'] as const).map(m => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={`roll-host relative z-10 py-2.5 rounded-xl text-sm font-bold transition-colors duration-300 ${mode === m ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
              >
                <RollText text={m === 'login' ? 'Sign in' : 'Create account'} />
              </button>
            ))}
          </div>

          {sessionExpired && !serverError && (
            <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-amber-50 border border-amber-100 text-sm text-amber-800 animate-slide-up">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> Your session expired. Please sign in again.
            </div>
          )}
          {serverError && (
            <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-rose-50 border border-rose-100 text-sm text-rose-700 animate-slide-up" role="alert">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {serverError}
            </div>
          )}

          <form key={`form-${mode}`} onSubmit={handleSubmit} noValidate className="space-y-4">
            {isSignup && (
              <Field id="auth-name" label="Full name" icon={UserIcon} error={visibleError('name')} delay={nextDelay()}>
                <input
                  id="auth-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onBlur={() => setTouched(t => ({ ...t, name: true }))}
                  autoComplete="name"
                  maxLength={80}
                  placeholder="Jane Student"
                  aria-invalid={!!visibleError('name')}
                  className={inputClass('name')}
                />
              </Field>
            )}

            <Field id="auth-email" label="Email" icon={Mail} error={visibleError('email')} delay={nextDelay()}>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onBlur={() => setTouched(t => ({ ...t, email: true }))}
                autoComplete="email"
                placeholder="you@example.com"
                aria-invalid={!!visibleError('email')}
                className={inputClass('email')}
              />
            </Field>

            <Field id="auth-password" label="Password" icon={Lock} error={visibleError('password')} delay={nextDelay()}>
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onBlur={() => setTouched(t => ({ ...t, password: true }))}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                placeholder={isSignup ? 'Create a password' : 'Your password'}
                aria-invalid={!!visibleError('password')}
                className={`${inputClass('password')} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </Field>

            {!isSignup && (
              <div className="-mt-2 flex justify-end">
                <button type="button" onClick={() => { goTo('forgot'); setTouched({}); }} className="text-sm font-semibold text-primary-600 hover:text-primary-700 link-draw pb-0.5">
                  Forgot password?
                </button>
              </div>
            )}

            {isSignup && password && (
              <div className="space-y-2 -mt-1 animate-slide-up">
                <div className="flex items-center gap-3">
                  <div className="flex-1 grid grid-cols-4 gap-1" aria-hidden="true">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                        <div className={`h-full rounded-full transition-transform duration-500 ease-out-expo origin-left ${STRENGTH[strength].bar}`} style={{ transform: `scaleX(${strength >= i ? 1 : 0})` }} />
                      </div>
                    ))}
                  </div>
                  <span className="text-xs font-bold text-slate-500 w-16 text-right">{STRENGTH[strength].label}</span>
                </div>
                <ul className="grid grid-cols-1 sm:grid-cols-3 gap-1">
                  {checks.map(c => (
                    <li key={c.label} className={`flex items-center gap-1.5 text-xs transition-colors duration-300 ${c.ok ? 'text-emerald-600' : 'text-slate-400'}`}>
                      <Check className={`w-3.5 h-3.5 transition-transform duration-500 ease-out-expo ${c.ok ? 'scale-110' : 'scale-75'}`} /> {c.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isSignup && (
              <Field id="auth-confirm" label="Confirm password" icon={Lock} error={visibleError('confirm')} delay={nextDelay()}>
                <input
                  id="auth-confirm"
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  onBlur={() => setTouched(t => ({ ...t, confirm: true }))}
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  aria-invalid={!!visibleError('confirm')}
                  className={inputClass('confirm')}
                />
              </Field>
            )}

            <div className="animate-rise pt-2" style={{ animationDelay: `${nextDelay()}ms` }}>
              <Magnetic strength={0.12} className="w-full">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  data-cursor={isSignup ? 'Join' : 'Enter'}
                  className="roll-host btn-shine group w-full bg-gradient-to-r from-primary-600 via-violet-600 to-indigo-600 bg-[length:200%_100%] hover:bg-[position:100%_0] text-white font-bold py-4 rounded-2xl shadow-xl shadow-primary-600/25 hover:shadow-primary-600/40 transition-all duration-700 ease-out-expo flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {isSubmitting
                    ? <><Loader2 className="w-5 h-5 animate-spin" /> {isSignup ? 'Creating account...' : 'Signing in...'}</>
                    : <>
                        <RollText text={isSignup ? 'Create account' : 'Sign in'} />
                        <span className="relative w-5 h-5 overflow-hidden">
                          <ArrowRight className="absolute inset-0 w-5 h-5 transition-transform duration-500 ease-out-expo group-hover:translate-x-6" />
                          <ArrowRight className="absolute inset-0 w-5 h-5 -translate-x-6 transition-transform duration-500 ease-out-expo group-hover:translate-x-0" />
                        </span>
                      </>}
                </button>
              </Magnetic>
            </div>
          </form>

          {googleEnabled && (
            <div className="animate-rise" style={{ animationDelay: `${nextDelay()}ms` }}>
              <div className="flex items-center gap-3 my-5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                <span className="flex-1 h-px bg-slate-200" /> or <span className="flex-1 h-px bg-slate-200" />
              </div>
              <GoogleButton onToken={signInWithGoogle} onError={setServerError} disabled={isSubmitting} />
            </div>
          )}

          <p className="text-sm text-slate-500 text-center mt-7 animate-fade-in">
            {isSignup ? 'Already have an account?' : 'New to MindAI?'}{' '}
            <button onClick={() => switchMode(isSignup ? 'login' : 'signup')} className="font-bold text-primary-600 hover:text-primary-700 link-draw pb-0.5">
              {isSignup ? 'Sign in' : 'Create an account'}
            </button>
          </p>
          </>)}

          {step !== 'form' && (
            <div key={step}>
              <button onClick={() => goTo('form')} className="mb-6 flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 animate-fade-in">
                <ArrowLeft className="w-4 h-4" /> {step === 'verify' ? 'Use a different email' : 'Back to sign in'}
              </button>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-indigo-600 text-white flex items-center justify-center shadow-xl shadow-primary-600/25 mb-5 animate-pop">
                {step === 'verify' ? <MailCheck className="w-7 h-7" /> : <KeyRound className="w-7 h-7" />}
              </div>
              <RevealText
                as="h2"
                text={step === 'verify' ? 'Check your email' : step === 'forgot' ? 'Forgot your password?' : 'Choose a new password'}
                accent={step === 'verify' ? ['email'] : step === 'forgot' ? ['password?'] : ['password']}
                className="text-[2.3rem] font-display font-bold text-slate-900 tracking-tight leading-[1.08]"
              />
              <p className="text-slate-500 mt-3 mb-7 animate-rise" style={{ animationDelay: '200ms' }}>
                {step === 'forgot'
                  ? "Enter your account email and we'll send you a 6-digit code to reset it."
                  : <>We sent a 6-digit code to <span className="font-semibold text-slate-800 break-all">{email.trim()}</span>. It expires in 15 minutes.</>}
              </p>

              {serverError && (
                <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-rose-50 border border-rose-100 text-sm text-rose-700 animate-slide-up" role="alert">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {serverError}
                </div>
              )}
              {notice && !serverError && (
                <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-emerald-50 border border-emerald-100 text-sm text-emerald-800 animate-slide-up" role="status">
                  <Check className="w-4 h-4 flex-shrink-0" /> {notice}
                </div>
              )}

              {step === 'verify' && (
                <div className="space-y-6 animate-rise" style={{ animationDelay: '260ms' }}>
                  <CodeInput value={code} disabled={isSubmitting} invalid={!!serverError}
                    onChange={next => { setCode(next); setServerError(null); if (next.length === 6) submitVerify(next); }} />
                  <button onClick={() => submitVerify()} disabled={isSubmitting || code.length !== 6}
                    className="btn-shine w-full bg-gradient-to-r from-primary-600 via-violet-600 to-indigo-600 text-white font-bold py-4 rounded-2xl shadow-xl shadow-primary-600/25 flex items-center justify-center gap-2 disabled:opacity-60">
                    {isSubmitting ? <><Loader2 className="w-5 h-5 animate-spin" /> Checking...</> : <>Confirm email <ArrowRight className="w-5 h-5" /></>}
                  </button>
                </div>
              )}

              {step === 'forgot' && (
                <form onSubmit={sendResetCode} noValidate className="space-y-4">
                  <Field id="auth-email" label="Email" icon={Mail} error={visibleError('email')} delay={260}>
                    <input id="auth-email" type="email" value={email} autoFocus
                      onChange={e => setEmail(e.target.value)} onBlur={() => setTouched(t => ({ ...t, email: true }))}
                      autoComplete="email" placeholder="you@example.com" aria-invalid={!!visibleError('email')} className={inputClass('email')} />
                  </Field>
                  <button type="submit" disabled={isSubmitting}
                    className="btn-shine w-full bg-gradient-to-r from-primary-600 via-violet-600 to-indigo-600 text-white font-bold py-4 rounded-2xl shadow-xl shadow-primary-600/25 flex items-center justify-center gap-2 disabled:opacity-60 animate-rise" style={{ animationDelay: '330ms' }}>
                    {isSubmitting ? <><Loader2 className="w-5 h-5 animate-spin" /> Sending...</> : <>Send reset code <ArrowRight className="w-5 h-5" /></>}
                  </button>
                </form>
              )}

              {step === 'reset' && (
                <form onSubmit={submitReset} noValidate className="space-y-5">
                  <div className="animate-rise" style={{ animationDelay: '260ms' }}>
                    <span className="block text-[11px] font-bold text-slate-500 uppercase tracking-[0.14em] mb-2">Code from the email</span>
                    <CodeInput value={code} disabled={isSubmitting} invalid={!!serverError} onChange={next => { setCode(next); setServerError(null); }} />
                  </div>
                  <Field id="auth-password" label="New password" icon={Lock} error={touched.password && !checks.every(c => c.ok) ? "Your password doesn't meet the requirements yet." : null} delay={320}>
                    <input id="auth-password" type={showPassword ? 'text' : 'password'} value={password}
                      onChange={e => setPassword(e.target.value)} onBlur={() => setTouched(t => ({ ...t, password: true }))}
                      autoComplete="new-password" placeholder="Create a new password" className={`${inputClass('password')} pr-12`} />
                    <button type="button" onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </Field>
                  {password && (
                    <ul className="grid grid-cols-1 sm:grid-cols-3 gap-1 -mt-2">
                      {checks.map(c => (
                        <li key={c.label} className={`flex items-center gap-1.5 text-xs transition-colors duration-300 ${c.ok ? 'text-emerald-600' : 'text-slate-400'}`}>
                          <Check className="w-3.5 h-3.5" /> {c.label}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Field id="auth-confirm" label="Confirm new password" icon={Lock} error={touched.confirm && confirm !== password ? "Passwords don't match." : null} delay={380}>
                    <input id="auth-confirm" type={showPassword ? 'text' : 'password'} value={confirm}
                      onChange={e => setConfirm(e.target.value)} onBlur={() => setTouched(t => ({ ...t, confirm: true }))}
                      autoComplete="new-password" placeholder="Repeat the new password" className={inputClass('confirm')} />
                  </Field>
                  <button type="submit" disabled={isSubmitting || !resetValid}
                    className="btn-shine w-full bg-gradient-to-r from-primary-600 via-violet-600 to-indigo-600 text-white font-bold py-4 rounded-2xl shadow-xl shadow-primary-600/25 flex items-center justify-center gap-2 disabled:opacity-60">
                    {isSubmitting ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving...</> : <>Reset password &amp; sign in <ArrowRight className="w-5 h-5" /></>}
                  </button>
                </form>
              )}

              {step !== 'forgot' && (
                <p className="text-sm text-slate-500 text-center mt-6">
                  Didn't get it? Check your spam folder or{' '}
                  {cooldown > 0
                    ? <span className="font-semibold text-slate-400">resend in {cooldown}s</span>
                    : <button onClick={resendCode} disabled={isSubmitting} className="inline-flex items-center gap-1 font-bold text-primary-600 hover:text-primary-700 link-draw pb-0.5"><RotateCw className="w-3.5 h-3.5" /> send a new code</button>}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
