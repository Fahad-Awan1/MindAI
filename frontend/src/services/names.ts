// Titles people often type in front of their name ("Dr. Ayesha Khan"): skipped when we want the first name
const TITLES = new Set(['dr', 'prof', 'professor', 'mr', 'mrs', 'ms', 'miss', 'sir', 'madam', 'engr', 'eng', 'hafiz', 'syed', 'sayed']);

/** The person's first name, skipping a leading title: "Dr. Ayesha Khan" -> "Ayesha". */
export const firstName = (name: string | null | undefined): string => {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const real = words.find(w => !TITLES.has(w.replace(/\.$/, '').toLowerCase()));
  return real ?? words[0] ?? '';
};
