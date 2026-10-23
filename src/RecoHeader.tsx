import { tr, type Lang, type StrKey } from "./i18n";

const LEVELS: [string, StrKey, StrKey, string][] = [
  ["critical", "resp_Emergency", "rh_s_Emergency", "critical.png"], ["high", "resp_Urgent", "rh_s_Urgent", "high_risk.png"],
  ["moderate", "resp_Routine", "rh_s_Routine", "moderate_risk.png"], ["routine", "resp_Planned", "rh_s_Planned", "daily_routine.png"],
];

/** Shown once above the complaint cards: what each priority label means, in a few words, with its symbol. */
export default function RecoHeader({ lang, title }: { lang: Lang; title?: string }) {
  return <header className="reco-head">
    <h3>{title ?? tr(lang, "rh_title")}</h3>
    <p>{tr(lang, "rh_why")}</p>
    <ul className="reco-levels">{LEVELS.map(([cls, name, short, img]) => <li key={cls} className={`lv-${cls}`}>
      <img src={`${import.meta.env.BASE_URL}symbols/${img}`} alt="" width={30} height={30} /><span><b>{tr(lang, name)}</b><small>{tr(lang, short)}</small></span></li>)}</ul>
  </header>;
}
