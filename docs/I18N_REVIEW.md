# Hindi and Marathi drafts for native-speaker review

All hi / mr strings in `src/i18n.ts`, `src/questions.ts` and the `copy` table in `src/App.tsx` were written by an AI assistant and have **not** been reviewed by a native speaker. Please check tone, spelling and terminology.

Newest drafts (this change), in `src/i18n.ts`:

- My reports: keys `rpOnlyYours` ... `rpLoading`
- Status and severity names: `st_Reported`, `st_UnderReview`, `st_InProgress`, `st_Resolved`, `sev_Low` ... `sev_Critical`
  (check "दर्ज / नोंदवले", "हल हुआ / निराकरण झाले")
- Community: keys `cmChoose` ... `cmNoLocation`

Not yet translated (English only): Auth page, Profile details, FAQ, reply box, authority and admin screens (officers, by decision).

Check: `node scripts/check-i18n.mjs` (empty strings and key parity only; it cannot judge translation quality).
