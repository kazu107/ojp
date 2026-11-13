const paths = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  problems: "M8 4H5a2 2 0 0 0-2 2v14h18V6a2 2 0 0 0-2-2h-3 M8 2h8v5H8z M7 12h10 M7 16h6",
  learn: "M12 5C8 2 4 3 2 4v15c3-1 6-1 10 1 4-2 7-2 10-1V4c-2-1-6-2-10 1z M12 5v15",
  contests: "M8 3h8v6a4 4 0 0 1-8 0z M8 5H4v3a4 4 0 0 0 4 4 M16 5h4v3a4 4 0 0 1-4 4 M12 13v6 M7 21h10 M9 19h6",
  submissions: "m8 5-6 7 6 7 M16 5l6 7-6 7 M14 3l-4 18",
  ratings: "M4 20V10 M12 20V4 M20 20v-6 M2 21h20",
  review: "M6 3h12v18l-6-4-6 4z",
  profile: "M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2 M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  admin: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M9 12l2 2 4-4",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  external: "M14 3h7v7 M21 3l-9 9 M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5",
  plus: "M12 5v14 M5 12h14",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  close: "m6 6 12 12 M6 18 18 6",
} as const;

export type SiteIconName = keyof typeof paths;

export function SiteIcon({ name, className }: { name: SiteIconName; className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}
