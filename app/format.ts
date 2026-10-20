// Small display helpers shared by the board and the person panel
export const mins = (iso: string | null | undefined) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60e3)) : 0);
export const fm = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);
export const dur = (iso: string | null | undefined) => fm(mins(iso));
export const initials = (n: string) => n.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();
export const ago = (iso: string) => (mins(iso) < 1 ? 'just now' : `${dur(iso)} ago`);
export const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
// Avatar gradients, one per department
export const DEPT_COLORS = [
  'linear-gradient(135deg,#7c5cff,#5b8cff)',
  'linear-gradient(135deg,#ff5c8a,#ff8a5c)',
  'linear-gradient(135deg,#20c997,#22d3ee)',
  'linear-gradient(135deg,#c084fc,#f472b6)',
  'linear-gradient(135deg,#f59e0b,#f97316)',
  'linear-gradient(135deg,#06b6d4,#3b82f6)',
  'linear-gradient(135deg,#a3e635,#10b981)',
  'linear-gradient(135deg,#94a3b8,#64748b)',
];
