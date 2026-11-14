const paths={library:'M5 12l4 4L19 6',discover:'M12 5v14M5 12h14',requested:'M12 7v5l3 2',managed:'M5 8h14M5 16h14M8 5v6M16 13v6'};
const labels={library:'On server',discover:'Discover',requested:'Requested',managed:'Managed by Seerr'};
export function availabilityBadge(kind){
  if(!labels[kind])kind='discover';
  return `<span class="availability availability-${kind}" data-availability="${kind}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="${paths[kind]}"/></svg><span>${labels[kind]}</span></span>`;
}
