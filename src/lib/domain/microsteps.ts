import type { CategoryKind } from '@/lib/types/database';

/**
 * The Start-Friction Killer's "I'm stuck" decomposition.
 *
 * This is a *deterministic* rule engine, not a model call. It works offline,
 * costs nothing, and produces the same answer every time so the user can trust
 * it. An AI provider can be layered on top later without changing this
 * contract, but the feature must never depend on one.
 *
 * The shape of every suggestion is the same and is the point: four steps, each
 * small enough that starting it takes less effort than avoiding it, and only
 * the first one visible at a time.
 */

export const MAX_MICRO_STEPS = 4;

export interface MicroStepTemplate {
  id: string;
  label: string;
  match: RegExp;
  steps: (title: string) => string[];
}

const CAP = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const MICRO_STEP_TEMPLATES: MicroStepTemplate[] = [
  {
    id: 'application',
    label: 'Application or form',
    match: /\b(apply|application|form|enrol|enroll|register|admission|visa)\b/i,
    steps: () => [
      'Open the form. Do not read it yet.',
      'Fill in the factual fields only — name, dates, contact details.',
      'Write one answer, in whatever words come first.',
      'Read it once, then submit it or leave it saved.',
    ],
  },
  {
    id: 'writing',
    label: 'Writing',
    match: /\b(essay|write|writing|report|draft|article|blog|thesis|dissertation|chapter)\b/i,
    steps: () => [
      'Open a blank page and type the title.',
      'Write three bullet points of what it needs to say. No sentences yet.',
      'Turn the easiest bullet into one paragraph.',
      'Stop. Note what the next paragraph should do.',
    ],
  },
  {
    id: 'reading',
    label: 'Reading',
    match: /\b(read|reading|paper|textbook|article|chapter|notes)\b/i,
    steps: () => [
      'Open the material at the right page.',
      'Read only the headings and the first sentence of each section.',
      'Read one section properly, and mark anything unclear.',
      'Write one sentence: what was that section about?',
    ],
  },
  {
    id: 'revision',
    label: 'Revision',
    match: /\b(revis|memoris|memoriz|flashcard|anki|recall|exam prep)\b/i,
    steps: () => [
      'Pick the smallest topic you could be tested on.',
      'Close the book and write everything you already remember about it.',
      'Check what you missed and correct it in a different colour.',
      'Do one more topic, or stop here.',
    ],
  },
  {
    id: 'coding',
    label: 'Code',
    match: /\b(code|coding|bug|debug|implement|refactor|function|feature|deploy|build|test)\b/i,
    steps: () => [
      'Open the file you already know is involved.',
      'Write down, in one line, what should happen that is not happening.',
      'Make the smallest change that moves it. It does not have to be right.',
      'Run it and read the output, even if it fails.',
    ],
  },
  {
    id: 'problem-set',
    label: 'Problem set',
    match: /\b(problem set|problems|assignment|homework|exercise|questions|pset|worksheet)\b/i,
    steps: () => [
      'Number a page 1 to 5.',
      'Write down the first question, exactly as given.',
      'Write what is known and what is being asked. Do not solve it yet.',
      'Solve only the easiest part.',
    ],
  },
  {
    id: 'slides',
    label: 'Presentation',
    match: /\b(slide|slides|presentation|deck|pitch|talk|seminar)\b/i,
    steps: () => [
      'Write the one sentence your audience must remember.',
      'List the five points that support it.',
      'Make a rough title slide only.',
      'Fill in the easiest point as one slide.',
    ],
  },
  {
    id: 'email',
    label: 'Message',
    match: /\b(email|e-mail|reply|respond|message|dm|follow up|follow-up|call)\b/i,
    steps: () => [
      'Open a draft and put the recipient in. Nothing else.',
      'Write one sentence saying what you want.',
      'Add the one detail they actually need.',
      'Send it, or save it and set a time to send.',
    ],
  },
  {
    id: 'job-search',
    label: 'Career',
    match: /\b(cv|resume|portfolio|linkedin|job|internship|interview|network)\b/i,
    steps: () => [
      'Open the document or profile.',
      'Change or add exactly one line.',
      'Save it.',
      'Identify one place to send it, and write the name down.',
    ],
  },
  {
    id: 'exercise',
    label: 'Movement',
    match: /\b(gym|run|running|workout|exercise|walk|yoga|stretch|swim|cycle)\b/i,
    steps: () => [
      'Put the clothes or shoes on.',
      'Leave the room you are in.',
      'Move for two minutes only.',
      'Decide at two minutes whether to continue.',
    ],
  },
  {
    id: 'tidy',
    label: 'Tidy or prepare',
    match: /\b(tidy|clean|organis|organiz|sort|declutter|prepare|pack|laundry|dishes)\b/i,
    steps: () => [
      'Set a two-minute timer.',
      'Pick up the first five things you can see.',
      'Put them where they belong.',
      'Stop when the timer ends, or reset it once.',
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    match: /\b(pay|bill|tax|invoice|budget|expense|insurance|renew|paperwork|form)\b/i,
    steps: () => [
      'Find the document or login you need.',
      'Answer only the question you already know the answer to.',
      'Look up the single thing you do not know. Only that one.',
      'Complete the next field.',
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    match: /\b(plan|planning|review|reflect|organise the week|organize the week|roadmap)\b/i,
    steps: () => [
      'Write today’s date at the top of a page.',
      'List everything currently on your mind. No order.',
      'Circle the one thing that matters most.',
      'Give that one thing a time and a length.',
    ],
  },
  {
    id: 'study-session',
    label: 'Study session',
    match: /\b(study|learn|course|lecture|tutorial|module|practice)\b/i,
    steps: () => [
      'Open the material and nothing else.',
      'Write the topic name and today’s date on a page.',
      'Work through one example or one page.',
      'Write down one thing you did not understand.',
    ],
  },
];

const GENERIC_STEPS = (title: string): string[] => [
  `Open whatever "${truncate(title, 48)}" needs — the file, page, form or app.`,
  'Put the smallest possible piece of it in front of you.',
  'Work on just that piece for two minutes.',
  'Note where you got to. Then stop, or carry on.',
];

/**
 * Suggests four steps for a task.
 *
 * Templates are tried in order and the first match wins, so the list is
 * ordered from most specific to most general, and a deterministic generic
 * fallback always produces something usable.
 */
export function suggestMicroSteps(
  title: string,
  options: { description?: string | null; category?: CategoryKind | null } = {},
): { templateId: string; label: string; steps: string[] } {
  const haystack = `${title} ${options.description ?? ''}`.trim();

  for (const template of MICRO_STEP_TEMPLATES) {
    if (template.match.test(haystack)) {
      return { templateId: template.id, label: template.label, steps: template.steps(title).slice(0, MAX_MICRO_STEPS) };
    }
  }

  return { templateId: 'generic', label: 'General', steps: GENERIC_STEPS(title).slice(0, MAX_MICRO_STEPS) };
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * The UI reveals one step at a time: step N is only reachable once steps
 * 1…N-1 have been resolved. This is the whole mechanism — four visible steps
 * at once is a new plan to avoid, one visible step is a thing to do.
 */
export function visibleMicroSteps<T extends { ordinal: number; state: 'pending' | 'done' | 'skipped' }>(
  steps: T[],
): T[] {
  const sorted = [...steps].sort((a, b) => a.ordinal - b.ordinal);
  const revealed: T[] = [];
  for (const step of sorted) {
    revealed.push(step);
    if (step.state === 'pending') break;
  }
  return revealed;
}

export function nextMicroStep<T extends { ordinal: number; state: 'pending' | 'done' | 'skipped' }>(
  steps: T[],
): T | null {
  const sorted = [...steps].sort((a, b) => a.ordinal - b.ordinal);
  return sorted.find((s) => s.state === 'pending') ?? null;
}

export function microStepProgress(steps: Array<{ state: 'pending' | 'done' | 'skipped' }>): {
  done: number;
  skipped: number;
  total: number;
  percent: number;
} {
  const total = steps.length;
  const done = steps.filter((s) => s.state === 'done').length;
  const skipped = steps.filter((s) => s.state === 'skipped').length;
  return {
    done,
    skipped,
    total,
    // Skipped steps still count as "resolved" — the user moved past them,
    // and a plan that punishes skipping is a plan that gets abandoned.
    percent: total === 0 ? 0 : Math.round(((done + skipped) / total) * 100),
  };
}

export function describeMicroStepTemplate(id: string): string {
  return MICRO_STEP_TEMPLATES.find((t) => t.id === id)?.label ?? 'General';
}

export { CAP };
