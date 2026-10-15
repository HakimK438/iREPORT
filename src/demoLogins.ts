/** Development only: the seeded ward authority logins (backend/scripts/seed_area_problems.py), so a ward can be picked from a list
    instead of typing its login. `import.meta.env.DEV` is false in a production build, so nothing here reaches real users: every
    function returns null / [] there. */
const WARDS = ["Andheri West", "Bandra", "Borivali", "Colaba", "Dadar", "Fort", "Ghatkopar", "Goregaon", "Juhu", "Kurla", "Mahim", "Malad", "Powai", "Sion", "Vile Parle", "Worli"];

export const demoWards = (): string[] => (import.meta.env.DEV ? WARDS : []);

export const demoLogin = (area: string): { email: string; password: string } | null =>
  import.meta.env.DEV && WARDS.includes(area) ? { email: `ward.${area.toLowerCase().replace(/\s+/g, "")}@bmc.demo`, password: "ward12345" } : null;
