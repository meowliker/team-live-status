// ─────────────────────────────────────────────────────────────
//  TEAM ROSTER — the only people shown on the board.
//  Edit names / departments here. Names are matched to Jibble
//  (case doesn't matter). If someone's Jibble name is different,
//  add it in `aliases` (e.g. their full name or email in Jibble).
//  `clickup: false` = track Jibble only (no ClickUp timer checks).
// ─────────────────────────────────────────────────────────────

export type Member = { name: string; department: string; aliases?: string[]; clickup?: false };

export const TEAM: Member[] = [
  { name: 'Nitin', department: 'Creative Strategist', aliases: ['nitin@gividreams.com'] },
  { name: 'Aryan Dewangan', department: 'Creative Strategist', aliases: ['aryan.d@gividreams.com'] },
  { name: 'Apurwa', department: 'Creative Strategist', aliases: ['apurwa@gividreams.com'] },
  { name: 'Shivam', department: 'Creative Strategist', aliases: ['shivam@gividreams.com'] },
  { name: 'Aryan Rathore', department: 'Creative Strategist', aliases: ['aryan.r@gividreams.com'] },

  { name: 'Chirayu', department: 'Media Buyer', aliases: ['chirayu@gividreams.com'] },
  { name: 'Nischay', department: 'Media Buyer', aliases: ['nischay@gividreams.com'] },
  // Jibble only, matched by their Jibble email (plus WorkNexus email)
  { name: 'Ryan Munene', department: 'Media Buyer', clickup: false, aliases: ['ryan@gividreams.com', 'ryanmunene.n@gmail.com'] },
  { name: 'Salman', department: 'Media Buyer', clickup: false, aliases: ['salman@gividreams.com', 'salmanjaved5558@gmail.com'] },
  { name: 'Shakthi', department: 'Media Buyer', clickup: false, aliases: ['shakthi@gividreams.com', 'shakthi.official1@gmail.com'] },

  { name: 'Deepti', department: 'Editor', aliases: ['deepti@gividreams.com'] },
  { name: 'Armaan Ali', department: 'Editor', aliases: ['Arman Ali', 'armaan@gividreams.com'] },
  { name: 'Pankaj Kumar', department: 'Editor', aliases: ['pankaj@gividreams.com'] },
  { name: 'Tamim Ahmad', department: 'Editor', aliases: ['tamim@gividreams.com'] },
  { name: 'Harish Kumar', department: 'Editor', aliases: ['harish@gividreams.com'] },
  { name: 'Prince Vaishnav', department: 'Editor', aliases: ['prince@gividreams.com'] },

  { name: 'Samriddhi', department: 'Graphic Designer', aliases: ['samriddhi@gividreams.com'] },
  { name: 'Kirti Verma', department: 'Graphic Designer', aliases: ['kirti@gividreams.com'] },

  { name: 'Vidit', department: 'Website Designer', aliases: ['vidit@gividreams.com'] },
  { name: 'Anay', department: 'Website Designer', aliases: ['anay@gividreams.com'] },
  { name: 'Pragati Shukla', department: 'Website Designer', aliases: ['Pragati', 'pragati@gividreams.com'] },

  { name: 'Kazeem', department: 'Email Marketing', aliases: ['kazeem@gividreams.com'] },

  { name: 'Mahesh', department: 'Finance', aliases: ['mahesh@gividreams.com'] },

  { name: 'Santushti', department: 'HR', aliases: ['santushti@gividreams.com'] },
];

// Order of department lanes on the board
export const DEPARTMENTS = ['Creative Strategist', 'Media Buyer', 'Editor', 'Graphic Designer', 'Website Designer', 'Email Marketing', 'Finance', 'HR', 'Other'];
