/** The 24 BMC ward offices, from the "Wardwise Address and Telephone Nos." list (BMC), and which ward each of our areas falls in. */
export interface WardOffice { ward: string; address: string; phone: string }

export const WARD_OFFICES: Record<string, WardOffice> = {
  "A": { ward: "A", address: "5th floor, 134-E Shahid Bhagatsing Road, near Reserve Bank, Fort, Mumbai 400001", phone: "022 2260 7000" },
  "B": { ward: "B", address: "1st floor, 121 Ramchandra Bhatt Marg, opp. J.J. Hospital, Mumbai 400009", phone: "022 2373 6622" },
  "C": { ward: "C", address: "5th floor, 76 Shrikant Palekar Marg, opp. Chandanwadi, Mumbai 400002", phone: "022 2201 4022" },
  "D": { ward: "D", address: "Ground floor, Jobanputra Compound, Nana Chowk, Mumbai 400007", phone: "022 2386 1426" },
  "E": { ward: "E", address: "2nd floor, 10 Shaikh Hafizuddin Marg, Byculla, Mumbai 400008", phone: "022 2308 1471" },
  "F/S": { ward: "F/South", address: "2nd floor, Dr. Babasaheb Ambedkar Marg and Jagannath Bhatankar Marg junction, Parel, Mumbai 400012", phone: "022 2413 4545" },
  "F/N": { ward: "F/North", address: "Plot 96, 4th floor, Bhau Daji Marg, Matunga, Mumbai 400019", phone: "022 2401 4275" },
  "G/S": { ward: "G/South", address: "2nd floor, N.M. Joshi Marg, Mumbai 400013", phone: "022 2430 5031" },
  "G/N": { ward: "G/North", address: "Ground floor, Harishchandra Yelwe Marg, Dadar, Mumbai 400028", phone: "022 2439 7800" },
  "H/E": { ward: "H/East", address: "Plot 137, Terrace Room, TPS-5, Prabhat Colony, Santacruz (E), Mumbai 400055", phone: "022 2618 2217" },
  "H/W": { ward: "H/West", address: "2nd Hasnabad Lane, Khar (W), Mumbai 400052", phone: "022 2600 7367" },
  "K/E": { ward: "K/East", address: "3rd floor, Gundavali Gaonthan, Azad Road, Andheri (E), Mumbai 400069", phone: "022 2681 6730" },
  "K/W": { ward: "K/West", address: "1st floor, Paliram Road, Andheri (W), Mumbai 400058", phone: "022 2623 9499" },
  "P/S": { ward: "P/South", address: "3rd floor, CTS No. 746, S.V. Road, Goregaon (W), Mumbai 400104", phone: "022 2873 7000" },
  "P/N": { ward: "P/North", address: "11th floor, near Liberty Garden, B.J. Patel Marg, Malad (W), Mumbai 400064", phone: "022 2999 4000" },
  "R/S": { ward: "R/South", address: "2nd floor, M.G.X. Road No. 2, Kandivali (W), Mumbai 400067", phone: "022 2805 6000" },
  "R/C": { ward: "R/Central", address: "FP No. 4, TPS No. 1, Chandavarkar Road, Borivali (W), Mumbai 400092", phone: "022 2894 6000" },
  "R/N": { ward: "R/North", address: "CS No. 921/7, Dahisar Gaon, Rustomji Colony, Raganath Keskar Marg, Dahisar (W), Mumbai 400068", phone: "022 2892 0242" },
  "L": { ward: "L", address: "Yadav Market Bldg., 2nd floor, S.G. Barve Marg, Kurla (W), Mumbai 400070", phone: "022 2650 7250" },
  "M/E": { ward: "M/East", address: "Mahanagar Palika Bldg, Madhukar Tukaram Marg and Phera Pheri Road, Deonar, Govandi (W), Mumbai 400043", phone: "022 2550 2270" },
  "M/W": { ward: "M/West", address: "Sharadbhau Acharya Marg, near Natraj Cinema, Chembur, Mumbai 400071", phone: "022 2522 5000" },
  "N": { ward: "N", address: "2nd floor, Javahar Road, Ghatkopar (E), Mumbai 400077", phone: "022 2501 0161" },
  "S": { ward: "S", address: "2nd floor, LBS Road, near Mangatram Petrol Pump, Bhandup (W), Mumbai 400078", phone: "022 2594 7570" },
  "T": { ward: "T", address: "1st floor, Lala Devidayal Road, Mulund (W), Mumbai 400080", phone: "022 2564 5289" },
};

/** Area (as used in iREPORT) to BMC ward. The server cuts each ward's official boundary between its areas (migration 0017), so an
    area never crosses a ward border. Dongri, Kalbadevi, Parel and Govandi stand for wards B, C, F/S and M/E. */
export const AREA_WARD: Record<string, string> = {
  "Fort": "A", "Colaba": "A", "Dongri": "B", "Kalbadevi": "C", "Parel": "F/S", "Govandi": "M/E", "Byculla": "E", "Malabar Hill": "D", "Lower Parel": "G/S", "Worli": "G/S", "Dadar": "G/N", "Mahim": "G/N", "Sion": "F/N",
  "Bandra": "H/W", "Santacruz": "H/E", "Vile Parle": "K/W", "Juhu": "K/W", "Versova": "K/W", "Andheri West": "K/W", "Jogeshwari": "K/W", "Andheri East": "K/E",
  "Goregaon": "P/S", "Malad": "P/N", "Kandivali": "R/S", "Borivali": "R/C", "Dahisar": "R/N", "Kurla": "L", "Chembur": "M/W", "Ghatkopar": "N",
  "Powai": "S", "Vikhroli": "S", "Bhandup": "S", "Mulund": "T",
};

export const wardOfArea = (area: string): WardOffice | null => WARD_OFFICES[AREA_WARD[area] ?? ""] ?? null;
