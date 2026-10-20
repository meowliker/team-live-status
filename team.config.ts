// ─────────────────────────────────────────────────────────────
//  TEAM ROSTER — the only people shown on the board.
//  Edit names / departments here. Names are matched to Jibble
//  (case doesn't matter). If someone's Jibble name is different,
//  add it in `aliases` (e.g. their full name or email in Jibble).
//  `clickup: false` = track Jibble only (no ClickUp timer checks).
// ─────────────────────────────────────────────────────────────

export type Member = { name: string; department: string; aliases?: string[]; clickup?: false };

export const TEAM: Member[] = [
  { name: 'Nitin', department: 'Creative Strategist' },
  { name: 'Aryan Dewangan', department: 'Creative Strategist' },
  { name: 'Apurwa', department: 'Creative Strategist' },
  { name: 'Shivam', department: 'Creative Strategist' },
  { name: 'Aryan Rathore', department: 'Creative Strategist' },

  { name: 'Deepti', department: 'Editor' },
  { name: 'Armaan Ali', department: 'Editor' },
  { name: 'Pankaj Kumar', department: 'Editor' },
  { name: 'Tamim Ahmad', department: 'Editor' },
  { name: 'Harish Kumar', department: 'Editor' },
  { name: 'Prince Vaishnav', department: 'Editor' },

  { name: 'Samriddhi', department: 'Graphic Designer' },
  { name: 'Kirti Verma', department: 'Graphic Designer' },

  { name: 'Pragati Shukla', department: 'Website Designer' },

  // Jibble only, matched by their Jibble email
  { name: 'Ryan Munene', department: 'Other', clickup: false, aliases: ['ryanmunene.n@gmail.com'] },
  { name: 'Salman', department: 'Other', clickup: false, aliases: ['salmanjaved5558@gmail.com'] },
  { name: 'Shakthi', department: 'Other', clickup: false, aliases: ['shakthi.official1@gmail.com'] },
];

// Order of department lanes on the board
export const DEPARTMENTS = ['Editor', 'Creative Strategist', 'Graphic Designer', 'Website Designer', 'Media Buyer', 'Finance', 'HR', 'Other'];
