// Screens in the sidebar. `phase` = the build phase that brings it to life.
export const WORK = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home', phase: 1 },
  { id: 'deals', label: 'Deals', icon: 'board', phase: 3, blurb: 'Your deal board: Lead → Talking → Offer Sent → Under Contract → Closed, with notes and follow-up dates on every card.' },
  { id: 'contacts', label: 'Contacts', icon: 'people', phase: 3, blurb: 'Agents, sellers, buyers and JV partners, tagged and searchable, with click-to-call through Google Voice.' },
  { id: 'lists', label: 'Lead Lists', icon: 'phone', phase: 3, blurb: '' },
  { id: 'tasks', label: 'Tasks', icon: 'check', phase: 3, blurb: 'A task list and board, each task linked to a deal or contact.' },
  { id: 'calculator', label: 'Underwriting', icon: 'calc', phase: 4, blurb: 'Single family, multifamily, commercial, STR, business and land. Subject-To, seller finance, hybrid, wrap, cash, DSCR and BRRRR, with an ⓘ on every number.' },
  { id: 'lookup', label: 'Property Lookup', icon: 'pin', phase: 5, blurb: 'Type an address once and open Zillow, Redfin, Crexi, LoopNet, Propwire, DealSauce, county records, rent comps and STR sites like AirDNA in tabs.' },
  { id: 'search', label: 'Search & Docs', icon: 'search', phase: 6, blurb: 'One search across your txt, Excel, Word and PDF files plus the CRM. Pulls out phones, emails, links and addresses.' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', phase: 7, blurb: 'Your Google Calendar with SubTo calls highlighted, an alert before each call, and a one-click Join button.' },
];

export const ZOOM_ITEM = { id: 'zoomorg', label: 'Zoom Chat Organizer', icon: 'video', phase: 9, kind: 'zoom' };
export const DIRECTORY_ITEM = { id: 'directory', label: 'SubTo Directory', icon: 'people', phase: 3, kind: 'page' };

export function buildNav(sites) {
  const web = (group) => sites.filter((s) => s.group === group).map((s) => ({ ...s, kind: 'web', phase: 2 }));
  const nav = [
    { group: 'Work', items: WORK },
    { group: 'Community', items: [...web('Community'), DIRECTORY_ITEM, ZOOM_ITEM] },
    { group: 'Tools', items: web('Tools') },
  ];
  const mine = web('My Sites');
  if (mine.length) nav.push({ group: 'My Sites', items: mine });
  return nav;
}
