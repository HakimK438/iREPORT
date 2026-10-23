/** Development only: the seeded ward authority logins (backend/scripts/seed_area_problems.py), so choosing a ward fills in
    its email and password. `import.meta.env.DEV` is false in a production build, so nothing here reaches real users. */
const WARDS = ["Andheri West", "Bandra", "Borivali", "Colaba", "Dadar", "Fort", "Ghatkopar", "Goregaon", "Juhu", "Kurla", "Mahim", "Malad", "Powai", "Sion", "Vile Parle", "Worli"];

export const demoLogin = (area: string): { email: string; password: string } | null =>
  import.meta.env.DEV && WARDS.includes(area) ? { email: `ward.${area.toLowerCase().replace(/\s+/g, "")}@bmc.demo`, password: "ward12345" } : null;
