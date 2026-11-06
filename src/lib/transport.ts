// Sites OFFICIELS des transporteurs et des pass, choisis à la main : un lien n'est jamais écrit par l'IA (elle peut en
// inventer). Biirbou ne cite que ces noms ; le planning affiche ces liens selon les pays du voyage. Pages d'accueil
// seulement (les liens profonds changent souvent). Ajouter un pays = vérifier le domaine sur le site du transporteur.

export type TransportLink = { key: string; name: string; url: string; kind: "pass" | "rail" | "bus" };

// Pays couverts par Interrail / Eurail (33 pays).
const INTERRAIL_COUNTRIES = new Set(
  "AT BE BA BG HR CZ DK EE FI FR DE GB GR HU IE IT LV LT LU ME NL MK NO PL PT RO RS SK SI ES SE CH TR".split(" "),
);

const EUROPE_PASSES: TransportLink[] = [
  { key: "interrail", name: "Pass Interrail (résidents en Europe)", url: "https://www.interrail.eu", kind: "pass" },
  { key: "eurail", name: "Pass Eurail (résidents hors d'Europe)", url: "https://www.eurail.com", kind: "pass" },
];

// FlixBus : réseau de bus longue distance dans toute l'Europe.
const FLIXBUS: TransportLink = { key: "flixbus", name: "FlixBus (bus longue distance)", url: "https://www.flixbus.com", kind: "bus" };

const BY_COUNTRY: Record<string, TransportLink[]> = {
  FR: [{ key: "sncf", name: "SNCF Connect (trains en France)", url: "https://www.sncf-connect.com", kind: "rail" }],
  DE: [{ key: "db", name: "Deutsche Bahn (trains en Allemagne)", url: "https://www.bahn.com", kind: "rail" }],
  IT: [{ key: "trenitalia", name: "Trenitalia (trains en Italie)", url: "https://www.trenitalia.com", kind: "rail" }],
  ES: [{ key: "renfe", name: "Renfe (trains en Espagne)", url: "https://www.renfe.com", kind: "rail" }],
  PT: [{ key: "cp", name: "CP – Comboios de Portugal", url: "https://www.cp.pt", kind: "rail" }],
  BE: [{ key: "sncb", name: "SNCB (trains en Belgique)", url: "https://www.belgiantrain.be", kind: "rail" }],
  NL: [{ key: "ns", name: "NS (trains aux Pays-Bas)", url: "https://www.ns.nl", kind: "rail" }],
  LU: [{ key: "cfl", name: "CFL (trains au Luxembourg)", url: "https://www.cfl.lu", kind: "rail" }],
  CH: [{ key: "sbb", name: "CFF / SBB (trains en Suisse, Swiss Travel Pass)", url: "https://www.sbb.ch", kind: "rail" }],
  AT: [{ key: "oebb", name: "ÖBB (trains en Autriche)", url: "https://www.oebb.at", kind: "rail" }],
  GB: [{ key: "nationalrail", name: "National Rail (trains au Royaume-Uni)", url: "https://www.nationalrail.co.uk", kind: "rail" }],
  IE: [{ key: "irishrail", name: "Iarnród Éireann (trains en Irlande)", url: "https://www.irishrail.ie", kind: "rail" }],
  CZ: [{ key: "cd", name: "České dráhy (trains en Tchéquie)", url: "https://www.cd.cz", kind: "rail" }],
  PL: [{ key: "pkp", name: "PKP Intercity (trains en Pologne)", url: "https://www.intercity.pl", kind: "rail" }],
  DK: [{ key: "dsb", name: "DSB (trains au Danemark)", url: "https://www.dsb.dk", kind: "rail" }],
  SE: [{ key: "sj", name: "SJ (trains en Suède)", url: "https://www.sj.se", kind: "rail" }],
  NO: [{ key: "vy", name: "Vy (trains en Norvège)", url: "https://www.vy.no", kind: "rail" }],
  FI: [{ key: "vr", name: "VR (trains en Finlande)", url: "https://www.vr.fi", kind: "rail" }],
  GR: [{ key: "hellenictrain", name: "Hellenic Train (trains en Grèce)", url: "https://www.hellenictrain.gr", kind: "rail" }],
  JP: [{ key: "jrpass", name: "Japan Rail Pass (site officiel des JR)", url: "https://japanrailpass.net", kind: "pass" }],
  KR: [{ key: "korail", name: "Korail (trains en Corée, Korail Pass)", url: "https://www.letskorail.com", kind: "rail" }],
  TW: [{ key: "thsr", name: "THSR (TGV de Taïwan)", url: "https://en.thsrc.com.tw", kind: "rail" }],
  CN: [{ key: "12306", name: "China Railway 12306 (trains en Chine)", url: "https://www.12306.cn", kind: "rail" }],
  IN: [{ key: "irctc", name: "IRCTC (trains en Inde)", url: "https://www.irctc.co.in", kind: "rail" }],
  US: [{ key: "amtrak", name: "Amtrak (trains aux États-Unis)", url: "https://www.amtrak.com", kind: "rail" }],
  CA: [{ key: "viarail", name: "VIA Rail (trains au Canada)", url: "https://www.viarail.ca", kind: "rail" }],
  MA: [{ key: "oncf", name: "ONCF (trains au Maroc)", url: "https://www.oncf.ma", kind: "rail" }],
};

// Liens utiles pour les pays d'un voyage (codes ISO), sans doublon, dans l'ordre des pays.
export function transportLinks(countryCodes: string[]): TransportLink[] {
  const links = new Map<string, TransportLink>();
  for (const code of countryCodes) for (const link of BY_COUNTRY[code] ?? []) links.set(link.key, link);
  if (countryCodes.some((code) => INTERRAIL_COUNTRIES.has(code))) {
    for (const link of [...EUROPE_PASSES, FLIXBUS]) links.set(link.key, link);
  }
  return [...links.values()];
}
