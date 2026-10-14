
import React, { useState } from 'react';
import { Eye, EyeOff, ArrowRight, Mail, Lock, User, BrainCircuit, Github } from 'lucide-react';

interface AuthProps {
  onLogin: (user: { name: string; email: string }) => void;
}

export const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(false); // Default to Signup as per request
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    if (!isLogin && !name) {
      setError('Please enter your name');
      return;
    }

    // Simulate Auth storage
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    
    if (isLogin) {
      const user = users.find((u: any) => u.email === email && u.password === password);
      if (user) {
        const userData = { name: user.name, email: user.email };
        localStorage.setItem('currentUser', JSON.stringify(userData));
        onLogin(userData);
      } else {
        setError('Invalid email or password');
      }
    } else {
      if (users.find((u: any) => u.email === email)) {
        setError('User already exists');
        return;
      }
      const newUser = { name, email, password };
      localStorage.setItem('users', JSON.stringify([...users, newUser]));
      setIsLogin(true);
      alert('Account created successfully! Please log in.');
      setName('');
      setPassword('');
    }
  };

  const handleSocialLogin = (provider: string) => {
    if (provider === 'Google') {
        window.location.href = 'https://accounts.google.com/signin';
    } else if (provider === 'GitHub') {
        window.location.href = 'https://github.com/login';
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-900 relative overflow-hidden p-4">
      {/* Animated Background */}
      <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5"></div>
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary-600/20 rounded-full blur-[120px] animate-pulse-slow"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-600/20 rounded-full blur-[120px] animate-pulse-slow" style={{ animationDelay: '2s' }}></div>

      <div className="w-full max-w-md bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl overflow-hidden relative z-10 animate-scale-in">
        <div className="p-8 md:p-10">
          {/* Header */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-primary-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg mb-4 animate-float">
              <BrainCircuit className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-display font-bold text-white text-center">
              {isLogin ? 'Welcome Back' : 'Join MindAI'}
            </h1>
            <p className="text-slate-300 text-center mt-2 text-sm leading-relaxed">
              {isLogin ? 'Enter your credentials to access your workspace.' : 'Create your student account to start your learning journey.'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300 uppercase ml-1">Full Name</label>
                <div className="relative group">
                  <User className="absolute left-4 top-3.5 w-5 h-5 text-slate-400 group-focus-within:text-primary-400 transition-colors" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full bg-slate-800/50 border border-slate-700 rounded-xl py-3 pl-12 pr-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-all"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase ml-1">Email Address</label>
              <div className="relative group">
                <Mail className="absolute left-4 top-3.5 w-5 h-5 text-slate-400 group-focus-within:text-primary-400 transition-colors" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="student@example.com"
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-xl py-3 pl-12 pr-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase ml-1">Password</label>
              <div className="relative group">
                <Lock className="absolute left-4 top-3.5 w-5 h-5 text-slate-400 group-focus-within:text-primary-400 transition-colors" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-xl py-3 pl-12 pr-12 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-3.5 text-slate-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm text-center font-medium animate-bounce-slight">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-primary-600/30 hover:shadow-primary-600/50 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 group"
            >
              {isLogin ? 'Sign In' : 'Create Account'}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </form>

          {/* Social Login Section */}
          <div className="my-6 flex items-center gap-4">
            <div className="h-px bg-slate-700 flex-1 opacity-50"></div>
            <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Or continue with</span>
            <div className="h-px bg-slate-700 flex-1 opacity-50"></div>
          </div>

          <div className="grid grid-cols-2 gap-4">
             <button 
                type="button" 
                onClick={() => handleSocialLogin('Google')}
                className="flex items-center justify-center gap-2 bg-white text-slate-800 py-3 rounded-xl font-bold text-sm hover:bg-slate-100 transition-colors shadow-md"
             >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        style={{ fill: "#4285F4" }}
                    />
                    <path
                        fill="currentColor"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        style={{ fill: "#34A853" }}
                    />
                    <path
                        fill="currentColor"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        style={{ fill: "#FBBC05" }}
                    />
                    <path
                        fill="currentColor"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        style={{ fill: "#EA4335" }}
                    />
                </svg>
                Google
             </button>
             <button 
                type="button" 
                onClick={() => handleSocialLogin('GitHub')}
                className="flex items-center justify-center gap-2 bg-[#24292F] text-white py-3 rounded-xl font-bold text-sm hover:bg-[#24292F]/90 transition-colors shadow-md"
             >
                <Github className="w-5 h-5" />
                GitHub
             </button>
          </div>

          {/* Footer */}
          <div className="mt-6 text-center">
            <p className="text-slate-400 text-sm">
              {isLogin ? "Don't have an account?" : "Already have an account?"}
              <button
                onClick={() => { setIsLogin(!isLogin); setError(''); }}
                className="ml-2 text-primary-400 font-bold hover:text-white transition-colors"
              >
                {isLogin ? 'Sign Up' : 'Log In'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
