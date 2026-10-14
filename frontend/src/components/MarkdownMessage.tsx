import React from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Source } from '../types';

interface MarkdownMessageProps {
  text: string;
  /** Sources the text may cite as [n]; citations become clickable badges */
  sources?: Source[] | null;
  onCite?: (source: Source) => void;
}

const CITE_PREFIX = '#cite-';

/** Normalize citation styles some models use (【1】, 【1†source】, [^1]) to [n]. */
export const normalizeCitations = (text: string) =>
  text.replace(/【\s*(\d+)[^】]*】/g, '[$1]').replace(/\[\^(\d+)\]/g, '[$1]');

/** Turn [n] markers that match a source into links the renderer shows as citation badges. */
const linkCitations = (text: string, sources: Source[]) => {
  const valid = new Set(sources.map(s => s.n));
  // Skip fenced code blocks so code like arr[1] isn't touched
  return text.split(/(```[\s\S]*?```)/g).map(part =>
    part.startsWith('```')
      ? part
      : part.replace(/\[(\d+)\](?!\()/g, (match, n) => (valid.has(Number(n)) ? `[${n}](${CITE_PREFIX}${n})` : match))
  ).join('');
};

// Raw HTML in the AI output is not rendered by react-markdown, which keeps this XSS-safe
export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ text, sources, onCite }) => {
  const normalized = normalizeCitations(text);
  const content = sources?.length ? linkCitations(normalized, sources) : normalized;

  const components: Components = {
    a: ({ node: _node, href, children, ...props }) => {
      if (href?.startsWith(CITE_PREFIX)) {
        const source = sources?.find(s => s.n === Number(href.slice(CITE_PREFIX.length)));
        if (!source) return <>{children}</>;
        const where = [source.document_title, source.location].filter(Boolean).join(' · ');
        return (
          <button
            type="button"
            onClick={() => onCite?.(source)}
            title={where ? `Source ${source.n}: ${where}` : `Source ${source.n}`}
            aria-label={`Show source ${source.n}`}
            className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 mx-0.5 align-text-top rounded-md bg-indigo-50 text-indigo-700 text-[11px] font-bold no-underline hover:bg-indigo-600 hover:text-white transition-colors"
          >
            {source.n}
          </button>
        );
      }
      // Only real web links open (in a new tab / the phone's browser); a relative or "#" link from the model
      // would navigate the app itself, so it is shown as plain text
      if (!href || !/^(https?:|mailto:)/i.test(href)) return <span>{children}</span>;
      return <a {...props} href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline hover:text-indigo-800 [overflow-wrap:anywhere]">{children}</a>;
    },
    table: ({ node: _node, ...props }) => (
      <div className="overflow-x-auto my-3">
        <table {...props} className="min-w-full text-sm" />
      </div>
    ),
  };

  return (
    <div className="prose prose-sm md:prose-base prose-slate max-w-none break-words prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2 prose-li:my-0.5 prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-code:before:content-none prose-code:after:content-none prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-medium">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
};
