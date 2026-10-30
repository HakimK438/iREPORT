/** Development only: the seeded ward authority logins (backend/scripts/seed_area_problems.py, one per area), so choosing a ward fills in
    its email and password. `import.meta.env.DEV` is false in a production build, so nothing here reaches real users. */


export const demoLogin = (area: string): { email: string; password: string } | null =>
  import.meta.env.DEV && area.length > 0 ? { email: `ward.${area.toLowerCase().replace(/\s+/g, "")}@bmc.demo`, password: "ward12345" } : null;
