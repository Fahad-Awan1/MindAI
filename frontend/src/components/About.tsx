import React, { useState } from 'react';
import {
  Info, MessageSquareText, GraduationCap, FileSignature, Layers, Users, Headphones, Share2, BookOpen,
  Sparkles, Code2, Server, Brain, Smartphone, Database, Heart,
} from 'lucide-react';
import { PageHeader, Reveal } from '../motion';
import { Logo } from './Logo';

/** The people who built MindAI. Photos live in public/team/ (square crops look best). */
const TEAM = [
  { name: 'Fahad Riaz', role: 'Developer', photo: '/team/fahad-riaz.jpg', accent: 'from-violet-500 to-indigo-600' },
  { name: 'Zain Ul Abideen', role: 'Developer', photo: '/team/zain-ul-abideen.jpg', accent: 'from-sky-500 to-blue-600' },
  { name: 'Sahar Sultan', role: 'Developer', photo: '/team/sahar-sultan.jpg', accent: 'from-fuchsia-500 to-rose-500' },
];

const FEATURES = [
  { icon: MessageSquareText, title: 'AI Chat with sources', text: 'Ask anything about your notes and get answers that cite the exact page.' },
  { icon: GraduationCap, title: 'Quiz Generator', text: 'Eight question types, adaptive practice, timed tests and smart retakes.' },
  { icon: FileSignature, title: 'Exam Papers', text: 'University-style papers with sections, mark schemes and AI marking.' },
  { icon: Layers, title: 'Flashcards', text: 'Spaced repetition that schedules each card right before you forget it.' },
  { icon: Users, title: 'Study Rooms', text: 'Study live with classmates: shared documents, chat, quiz battles.' },
  { icon: Headphones, title: 'Audio Overviews', text: 'Turn a chapter into a podcast you can listen to on the go.' },
  { icon: Share2, title: 'Concept Graph & Mind Maps', text: 'See how the ideas across all your documents connect.' },
  { icon: BookOpen, title: 'Smart Reader', text: 'Read, highlight and ask about any passage in place.' },
];

const STACK = [
  { icon: Code2, label: 'React 19 + TypeScript' },
  { icon: Server, label: 'FastAPI (Python)' },
  { icon: Brain, label: 'Groq LLMs + RAG' },
  { icon: Database, label: 'ChromaDB + SQLite' },
  { icon: Smartphone, label: 'Web, PWA & Android' },
];

const initialsOf = (name: string) => name.split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/** A team member's photo, or their initials on a gradient until the photo file exists. */
const Avatar: React.FC<{ name: string; photo: string; accent: string }> = ({ name, photo, accent }) => {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative w-full aspect-square overflow-hidden rounded-[1.6rem] bg-slate-900">
      {failed ? (
        <div className={`absolute inset-0 bg-gradient-to-br ${accent} flex items-center justify-center`}>
          <span className="font-display text-6xl font-bold text-white/95 tracking-tight">{initialsOf(name)}</span>
        </div>
      ) : (
        <img src={photo} alt={name} loading="lazy" onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-700 ease-out-expo group-hover:scale-105" />
      )}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
    </div>
  );
};

export const About: React.FC = () => (
  <div className="max-w-6xl mx-auto p-5 md:p-10 pb-20 space-y-14">
    <PageHeader
      eyebrow="About MindAI"
      title="Study smarter with an AI that knows your notes"
      accent={['smarter']}
      tone="text-primary-600"
      icon={<Info className="w-4 h-4 text-primary-600" />}
      subtitle="MindAI turns your documents, lectures and slides into a personal study companion: cited answers, quizzes, exam papers, flashcards and live study rooms - all grounded in your own material."
    />

    {/* What it does */}
    <section>
      <Reveal className="flex items-center gap-2 mb-5">
        <Sparkles className="w-4 h-4 text-amber-500" />
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">What MindAI does</h2>
      </Reveal>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={i * 60} className="rounded-2xl bg-white/90 border border-slate-100 p-5 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-500">
            <span className="inline-flex w-10 h-10 rounded-xl bg-primary-50 text-primary-600 items-center justify-center mb-3"><f.icon className="w-5 h-5" /></span>
            <h3 className="font-bold text-slate-900">{f.title}</h3>
            <p className="mt-1 text-sm text-slate-500 leading-relaxed">{f.text}</p>
          </Reveal>
        ))}
      </div>
    </section>

    {/* The team */}
    <section className="relative overflow-hidden rounded-[2.5rem] bg-[#0b0a1a] text-white p-6 sm:p-10 grain">
      <div className="mesh-blob w-[30rem] h-[30rem] -top-40 -right-32 bg-violet-600/40" />
      <div className="mesh-blob w-[24rem] h-[24rem] -bottom-40 -left-24 bg-indigo-500/30" style={{ animationDelay: '-8s' }} />
      <div className="relative">
        <Reveal className="flex flex-col items-center text-center mb-10">
          <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-violet-300">The team</span>
          <h2 className="mt-3 font-display text-3xl md:text-4xl font-bold tracking-tight">
            Meet the <span className="font-elegant italic font-normal text-amber-200">developers</span>
          </h2>
          <p className="mt-3 text-white/60 max-w-xl">The three people who designed and built MindAI, from the AI engine to the app in your pocket.</p>
        </Reveal>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {TEAM.map((member, i) => (
            <Reveal key={member.name} delay={120 + i * 120} className="group">
              <div className="rounded-[2rem] bg-white/[0.06] border border-white/10 p-3 backdrop-blur-xl transition-all duration-500 hover:bg-white/[0.1] hover:-translate-y-1">
                <Avatar name={member.name} photo={member.photo} accent={member.accent} />
                <div className="px-2 pt-4 pb-2 text-center">
                  <h3 className="font-display text-xl font-bold">{member.name}</h3>
                  <p className="mt-1 text-sm font-semibold text-violet-300">{member.role}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>

    {/* Built with */}
    <section className="text-center">
      <Reveal className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500 mb-5">Built with</Reveal>
      <div className="flex flex-wrap justify-center gap-3">
        {STACK.map((s, i) => (
          <Reveal key={s.label} delay={i * 60} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white border border-slate-200 text-sm font-semibold text-slate-700 shadow-sm">
            <s.icon className="w-4 h-4 text-primary-600" /> {s.label}
          </Reveal>
        ))}
      </div>
    </section>

    <Reveal className="flex flex-col items-center gap-3 text-sm text-slate-400">
      <Logo size={34} />
      <span className="inline-flex items-center gap-1.5">Made with <Heart className="w-4 h-4 text-rose-500 fill-rose-500" /> by Fahad, Zain &amp; Sahar · © {new Date().getFullYear()} MindAI</span>
    </Reveal>
  </div>
);
