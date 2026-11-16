import './verifiedBadge.css';

export function VerifiedBadge({ verified, kind = 'specialist', compact = false }: {
  verified: boolean; kind?: 'specialist' | 'service' | 'tow' | 'insurer'; compact?: boolean;
}) {
  if (!verified) return null;
  const label = kind === 'service' ? 'Проверенная СТО' : kind === 'insurer' ? 'Проверенный партнёр' : kind === 'tow' ? 'Проверенный эвакуатор' : 'Проверенный мастер';
  return <span className={'traksos-verified' + (compact ? ' traksos-verified-compact' : '')} title="Проверка TrakSOS пройдена">
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="M12 2 20 5v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="1.6"/><path d="m8 12 2.6 2.6L16.5 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
    <span>{compact ? 'Проверен TrakSOS' : label}</span>
  </span>;
}
