export type IconName =
  | "home" | "community" | "reports" | "profile" | "plus" | "camera"
  | "mic" | "pin" | "spark" | "check" | "arrow" | "search" | "share"
  | "heart" | "light" | "waste" | "water" | "road" | "bolt" | "help"
  | "logout" | "alert" | "clock" | "filter" | "bell" | "shield" | "language" | "phone" | "map";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>,
    community: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2" /><path d="M3 20c0-4 2-6 6-6s6 2 6 6M15 15c3 0 5 2 5 5" /></>,
    reports: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    plus: <path d="M12 5v14M5 12h14" />, camera: <><path d="M5 7h2l2-3h6l2 3h2v12H5z" /><circle cx="12" cy="13" r="3.5" /></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    spark: <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" /><path d="m19 17 .7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z" /></>,
    check: <path d="m5 12 4 4L19 6" />, arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></>, share: <><circle cx="18" cy="5" r="2" /><circle cx="6" cy="12" r="2" /><circle cx="18" cy="19" r="2" /><path d="m8 11 8-5M8 13l8 5" /></>,
    heart: <path d="M20 5c-2-2-5-1-8 2-3-3-6-4-8-2-3 3-1 8 8 15 9-7 11-12 8-15Z" />,
    light: <><path d="M9 18h6M10 22h4" /><path d="M8 15a7 7 0 1 1 8 0l-2 3h-4z" /></>,
    waste: <><path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14" /></>,
    water: <path d="M12 3S6 10 6 15a6 6 0 0 0 12 0c0-5-6-12-6-12Z" />,
    road: <><path d="m8 3-3 18M16 3l3 18M12 4v4m0 4v4m0 4v1" /></>, bolt: <path d="m13 2-8 12h7l-1 8 8-12h-7z" />,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.2 2.3c-1 .4-1 1.2-1 2.2M12 18h.01" /></>,
    bell: <><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z" /><path d="M10 20h4" /></>, shield: <><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z" /><path d="m9 12 2 2 4-4" /></>,
    language: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
    phone: <path d="M6 3h4l1 5-2 1c1 3 3 5 6 6l1-2 5 1v4c0 2-2 3-4 3C9 20 4 15 3 7c0-2 1-4 3-4Z" />,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" /></>,
    logout: <><path d="M9 4H5v16h4" /><path d="m16 8 4 4-4 4M20 12H9" /></>,
    alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v5M12 18h.01" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    filter: <path d="M4 5h16l-6 8v6l-4-2v-4z" />,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
