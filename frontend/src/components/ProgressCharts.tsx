import React, { useState } from 'react';
import { useInView } from '../motion';
import { DailyActivity, DocumentMastery, QuizTrendPoint } from '../types';

// Single-series charts use one hue; text always uses ink colors, never the series color
const SERIES = '#6366f1';   // indigo-500
const GRID = '#e2e8f0';     // slate-200, one step off the white surface
const SURFACE = '#ffffff';

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface TooltipBoxProps {
  leftPct: number;
  children: React.ReactNode;
}

/** Tooltip positioned above the hovered mark; clamped so it stays inside the chart. */
const TooltipBox: React.FC<TooltipBoxProps> = ({ leftPct, children }) => (
  <div
    className="absolute -top-2 z-10 -translate-y-full pointer-events-none bg-slate-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap"
    style={{ left: `${Math.min(Math.max(leftPct, 12), 88)}%`, transform: 'translate(-50%, -100%)' }}
    role="tooltip"
  >
    {children}
  </div>
);

/* ------------------------------------------------------------------ */
/* Daily activity: column chart (magnitude over days, one hue)          */
/* ------------------------------------------------------------------ */

export const ActivityChart: React.FC<{ days: DailyActivity[] }> = ({ days }) => {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map(d => d.total));
  const total = days.reduce((sum, d) => sum + d.total, 0);
  const activeDays = days.filter(d => d.total > 0).length;

  const W = 560, H = 160, PAD_B = 22, PAD_T = 8;
  const plotH = H - PAD_B - PAD_T;
  const slot = W / days.length;
  const barW = Math.min(24, slot - 6);

  return (
    <div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-40"
          role="img"
          aria-label={`Study activity over the last ${days.length} days: ${plural(total, 'activity')} on ${plural(activeDays, 'day')}.`}
          onMouseLeave={() => setHover(null)}
        >
          {/* Baseline */}
          <line x1={0} x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke={GRID} strokeWidth={1} />
          {days.map((d, i) => {
            const h = d.total === 0 ? 0 : Math.max(4, (d.total / max) * plotH);
            const x = i * slot + (slot - barW) / 2;
            const y = H - PAD_B - h;
            const r = Math.min(4, h);
            const isToday = i === days.length - 1;
            return (
              <g key={d.date}>
                {h > 0 && (
                  // Rounded data-end, square at the baseline
                  <path
                    d={`M${x},${H - PAD_B} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${H - PAD_B} Z`}
                    fill={SERIES}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                    className="bar-grow"
                    style={{ animationDelay: `${i * 45}ms`, transition: 'opacity 0.3s' }}
                  />
                )}
                {/* Labels every other day + today, to avoid crowding */}
                {(i % 2 === days.length % 2 || isToday) && (
                  <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#94a3b8" fontWeight={isToday ? 700 : 400}>
                    {isToday ? 'Today' : shortDate(d.date)}
                  </text>
                )}
                {/* Hit target: the whole slot, taller than the bar */}
                <rect
                  x={i * slot} y={0} width={slot} height={H - PAD_B}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <TooltipBox leftPct={((hover + 0.5) / days.length) * 100}>
            <p className="font-bold mb-1">{shortDate(days[hover].date)}</p>
            {days[hover].total === 0 ? (
              <p className="text-slate-300">No study activity</p>
            ) : (
              <>
                <p className="text-slate-300">{plural(days[hover].quizzes, 'quiz')}</p>
                <p className="text-slate-300">{plural(days[hover].flashcard_sessions, 'flashcard session')}</p>
                <p className="text-slate-300">{plural(days[hover].chat_messages, 'chat question')}</p>
                {days[hover].tutor_sessions > 0 && <p className="text-slate-300">{plural(days[hover].tutor_sessions, 'tutor session')}</p>}
              </>
            )}
          </TooltipBox>
        )}
      </div>
      <table className="sr-only">
        <caption>Daily study activity</caption>
        <thead><tr><th>Date</th><th>Quizzes</th><th>Flashcard sessions</th><th>Chat questions</th><th>Tutor sessions</th></tr></thead>
        <tbody>
          {days.map(d => (
            <tr key={d.date}><td>{d.date}</td><td>{d.quizzes}</td><td>{d.flashcard_sessions}</td><td>{d.chat_messages}</td><td>{d.tutor_sessions}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Quiz accuracy trend: line chart (0-100%)                             */
/* ------------------------------------------------------------------ */

export const AccuracyTrend: React.FC<{ points: QuizTrendPoint[] }> = ({ points }) => {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-sm text-slate-400 text-center px-6">
        Take a quiz to start tracking your accuracy.
      </div>
    );
  }

  const W = 560, H = 160, PAD_L = 34, PAD_R = 14, PAD_T = 12, PAD_B = 12;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const xAt = (i: number) => PAD_L + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yAt = (pct: number) => PAD_T + (1 - pct / 100) * plotH;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(p.score_pct)}`).join(' ');
  const area = `${path} L${xAt(points.length - 1)},${yAt(0)} L${xAt(0)},${yAt(0)} Z`;
  const latest = points[points.length - 1];

  return (
    <div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-40"
          role="img"
          aria-label={`Quiz accuracy over your last ${plural(points.length, 'quiz')}. Latest score ${latest.score_pct}%.`}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 50, 100].map(v => (
            <g key={v}>
              <line x1={PAD_L} x2={W - PAD_R} y1={yAt(v)} y2={yAt(v)} stroke={GRID} strokeWidth={1} />
              <text x={PAD_L - 8} y={yAt(v) + 3} textAnchor="end" fontSize={10} fill="#94a3b8">{v}%</text>
            </g>
          ))}
          {points.length > 1 && <path d={area} fill={SERIES} opacity={0.1} className="area-fade" />}
          {points.length > 1 && <path d={path} pathLength={1} className="line-draw" fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {hover !== null && (
            <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD_T} y2={yAt(0)} stroke="#cbd5e1" strokeWidth={1} />
          )}
          {points.map((p, i) => (
            <circle
              key={`${p.created_at}-${i}`}
              cx={xAt(i)} cy={yAt(p.score_pct)}
              r={hover === i ? 6 : 4}
              fill={SERIES} stroke={SURFACE} strokeWidth={2}
              className="dot-pop"
              style={{ animationDelay: `${300 + (i / Math.max(1, points.length - 1)) * 1300}ms` }}
            />
          ))}
          {/* Hit targets: vertical bands around each point */}
          {points.map((p, i) => {
            const half = points.length === 1 ? plotW / 2 : plotW / (points.length - 1) / 2;
            return (
              <rect
                key={`hit-${p.created_at}-${i}`}
                x={xAt(i) - half} y={0} width={half * 2} height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            );
          })}
        </svg>
        {hover !== null && (
          <TooltipBox leftPct={(xAt(hover) / W) * 100}>
            <p className="font-bold">{points[hover].score_pct}%</p>
            <p className="text-slate-300 max-w-[14rem] truncate">{points[hover].study_set_title || 'Quiz'}</p>
            <p className="text-slate-400">{points[hover].document_title} · {new Date(points[hover].created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</p>
          </TooltipBox>
        )}
      </div>
      <table className="sr-only">
        <caption>Quiz scores</caption>
        <thead><tr><th>Date</th><th>Quiz</th><th>Document</th><th>Score</th></tr></thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}><td>{new Date(p.created_at).toLocaleString()}</td><td>{p.study_set_title}</td><td>{p.document_title}</td><td>{p.score_pct}%</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Mastery per document: meters (value against 100%)                    */
/* ------------------------------------------------------------------ */

export const MasteryList: React.FC<{ items: DocumentMastery[] }> = ({ items }) => {
  const [ref, inView] = useInView<HTMLUListElement>();
  if (items.length === 0) {
    return <p className="text-sm text-slate-400 py-6 text-center">Upload a document to start tracking mastery.</p>;
  }

  return (
    <ul ref={ref} className="space-y-4">
      {items.map((item, index) => (
        <li key={item.document_id}>
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <span className="font-semibold text-slate-800 truncate">{item.document_title}</span>
            <span className={`text-sm font-bold whitespace-nowrap ${item.mastery_pct === null ? 'text-slate-400' : 'text-slate-900'}`}>
              {item.mastery_pct === null ? 'Not started' : `${item.mastery_pct}%`}
            </span>
          </div>
          <div
            className="h-2 w-full rounded-full bg-indigo-50 overflow-hidden"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={item.mastery_pct ?? 0}
            aria-label={`${item.document_title} mastery`}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: inView ? `${item.mastery_pct ?? 0}%` : '0%',
                background: SERIES,
                transition: `width 1.4s cubic-bezier(0.16, 1, 0.3, 1) ${index * 90}ms`,
              }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {plural(item.quiz_attempts, 'assessment')} · {plural(item.flashcard_sessions, 'flashcard session')}
            {item.last_studied_at && ` · last studied ${new Date(item.last_studied_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}`}
          </p>
          {item.weak_topics.length > 0 && (
            <p className="text-xs mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-slate-500 font-semibold">Needs work:</span>
              {item.weak_topics.map(t => (
                <span key={t.topic} className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium">
                  {t.topic} {t.accuracy_pct}%
                </span>
              ))}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
};
