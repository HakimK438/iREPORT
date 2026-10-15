import type { ResolutionProof } from "./api";
import { LOCALE } from "./facts";
import { tr, trf, type Lang } from "./i18n";

/** The photo an officer took at the site when marking a complaint resolved, with where the phone was. Shown to officers, the admin and the reporting citizen. */
export default function ProofCard({ p, lang, staff = false }: { p: ResolutionProof; lang: Lang; staff?: boolean }) {
  const when = new Date(p.at).toLocaleString(LOCALE[lang], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return <figure className="proof-card">
    <a href={p.url} target="_blank" rel="noreferrer"><img src={p.thumb_url} alt={tr(lang, "v_proofSection")} loading="lazy" /></a>
    <figcaption><b>{tr(lang, "v_proofSection")}</b><span>{trf(lang, "v_proofBy", { name: p.officer, m: p.distance_m, when })}</span>
      {staff && p.flags.includes("too_fast") && <em>{tr(lang, "v_proofFast")}</em>}</figcaption>
  </figure>;
}
