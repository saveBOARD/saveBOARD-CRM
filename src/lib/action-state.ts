// What a form's server action sends back to the form (plain data, safe to pass to the client).

export type DuplicateLink = { id: string; label: string; href: string; reason: string };

export type ActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Possible duplicates: the user can open one, or confirm and save anyway. */
  duplicates?: DuplicateLink[];
  /** What the user submitted, sent back on errors: React resets forms after an action, this refills them. */
  values?: Record<string, string | boolean>;
  /** Bumped on success so forms can reset themselves (e.g. clear the note box). */
  savedAt?: number;
};

export const initialActionState: ActionState = {};
