export type CopdMedicationClass = "SABA" | "SAMA" | "SABA/SAMA" | "LAMA" | "LABA" | "LABA/LAMA" | "ICS/LABA" | "LABA/LAMA/ICS" | "PDE4 inhibitor" | "Other COPD therapy" | "Systemic corticosteroid" | "Exacerbation antibiotic";
export type MedicationTherapyRole = "maintenance" | "rescue" | "exacerbation-treatment" | "advanced/add-on" | "other";

export interface CopdMedicationMatch {
  genericName: string;
  medicationClass: CopdMedicationClass;
  therapyRole: MedicationTherapyRole;
  brandName?: string;
}

const MATCHES: Array<{ names: string[]; match: CopdMedicationMatch }> = [
  { names: ["albuterol", "salbutamol", "ventolin", "proair", "proventil"], match: { genericName: "albuterol", medicationClass: "SABA", therapyRole: "rescue", brandName: "Ventolin" } },
  { names: ["ipratropium", "atrovent"], match: { genericName: "ipratropium", medicationClass: "SAMA", therapyRole: "rescue", brandName: "Atrovent" } },
  { names: ["albuterol/ipratropium", "ipratropium/albuterol", "salbutamol/ipratropium", "combivent"], match: { genericName: "albuterol/ipratropium", medicationClass: "SABA/SAMA", therapyRole: "rescue", brandName: "Combivent" } },
  { names: ["tiotropium", "spiriva"], match: { genericName: "tiotropium", medicationClass: "LAMA", therapyRole: "maintenance", brandName: "Spiriva" } },
  { names: ["umeclidinium", "incruse"], match: { genericName: "umeclidinium", medicationClass: "LAMA", therapyRole: "maintenance", brandName: "Incruse" } },
  { names: ["aclidinium", "tudorza"], match: { genericName: "aclidinium", medicationClass: "LAMA", therapyRole: "maintenance", brandName: "Tudorza" } },
  { names: ["glycopyrrolate", "glycopyrronium", "seebri", "lonhala"], match: { genericName: "glycopyrrolate", medicationClass: "LAMA", therapyRole: "maintenance" } },
  { names: ["revefenacin", "yupelri"], match: { genericName: "revefenacin", medicationClass: "LAMA", therapyRole: "maintenance", brandName: "Yupelri" } },
  { names: ["formoterol", "perforomist"], match: { genericName: "formoterol", medicationClass: "LABA", therapyRole: "maintenance", brandName: "Perforomist" } },
  { names: ["salmeterol", "serevent"], match: { genericName: "salmeterol", medicationClass: "LABA", therapyRole: "maintenance", brandName: "Serevent" } },
  { names: ["olodaterol", "striverdi"], match: { genericName: "olodaterol", medicationClass: "LABA", therapyRole: "maintenance", brandName: "Striverdi" } },
  { names: ["indacaterol", "arcapta"], match: { genericName: "indacaterol", medicationClass: "LABA", therapyRole: "maintenance", brandName: "Arcapta" } },
  { names: ["umeclidinium/vilanterol", "umeclidinium vilanterol", "anoro"], match: { genericName: "umeclidinium/vilanterol", medicationClass: "LABA/LAMA", therapyRole: "maintenance", brandName: "Anoro" } },
  { names: ["tiotropium/olodaterol", "tiotropium olodaterol", "stiolto"], match: { genericName: "tiotropium/olodaterol", medicationClass: "LABA/LAMA", therapyRole: "maintenance", brandName: "Stiolto" } },
  { names: ["glycopyrrolate/formoterol", "glycopyrrolate formoterol", "bevespi"], match: { genericName: "glycopyrrolate/formoterol", medicationClass: "LABA/LAMA", therapyRole: "maintenance", brandName: "Bevespi" } },
  { names: ["indacaterol/glycopyrrolate", "indacaterol glycopyrrolate", "utibron"], match: { genericName: "indacaterol/glycopyrrolate", medicationClass: "LABA/LAMA", therapyRole: "maintenance", brandName: "Utibron" } },
  { names: ["aclidinium/formoterol", "aclidinium formoterol", "duaklir"], match: { genericName: "aclidinium/formoterol", medicationClass: "LABA/LAMA", therapyRole: "maintenance", brandName: "Duaklir" } },
  { names: ["budesonide/formoterol", "budesonide formoterol", "symbicort"], match: { genericName: "budesonide/formoterol", medicationClass: "ICS/LABA", therapyRole: "maintenance", brandName: "Symbicort" } },
  { names: ["fluticasone/salmeterol", "fluticasone salmeterol", "advair"], match: { genericName: "fluticasone/salmeterol", medicationClass: "ICS/LABA", therapyRole: "maintenance", brandName: "Advair" } },
  { names: ["fluticasone/vilanterol", "fluticasone vilanterol", "breo"], match: { genericName: "fluticasone/vilanterol", medicationClass: "ICS/LABA", therapyRole: "maintenance", brandName: "Breo" } },
  { names: ["fluticasone/umeclidinium/vilanterol", "fluticasone umeclidinium vilanterol", "trelegy"], match: { genericName: "fluticasone/umeclidinium/vilanterol", medicationClass: "LABA/LAMA/ICS", therapyRole: "maintenance", brandName: "Trelegy" } },
  { names: ["budesonide/glycopyrrolate/formoterol", "budesonide glycopyrrolate formoterol", "breztri"], match: { genericName: "budesonide/glycopyrrolate/formoterol", medicationClass: "LABA/LAMA/ICS", therapyRole: "maintenance", brandName: "Breztri" } },
  { names: ["roflumilast", "daliresp"], match: { genericName: "roflumilast", medicationClass: "PDE4 inhibitor", therapyRole: "advanced/add-on", brandName: "Daliresp" } },
  { names: ["ensifentrine", "ohtuvayre"], match: { genericName: "ensifentrine", medicationClass: "Other COPD therapy", therapyRole: "advanced/add-on", brandName: "Ohtuvayre" } },
  { names: ["azithromycin"], match: { genericName: "azithromycin", medicationClass: "Other COPD therapy", therapyRole: "advanced/add-on" } },
  { names: ["dupilumab", "dupixent"], match: { genericName: "dupilumab", medicationClass: "Other COPD therapy", therapyRole: "advanced/add-on", brandName: "Dupixent" } },
  { names: ["mepolizumab", "nucala"], match: { genericName: "mepolizumab", medicationClass: "Other COPD therapy", therapyRole: "advanced/add-on", brandName: "Nucala" } },
  { names: ["prednisone", "prednisolone", "methylprednisolone", "dexamethasone"], match: { genericName: "systemic corticosteroid", medicationClass: "Systemic corticosteroid", therapyRole: "exacerbation-treatment" } },
];

export function classifyCopdMedication(text: string): CopdMedicationMatch | undefined {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return MATCHES.find(entry => entry.names.some(name => normalized.includes(name)))?.match;
}
