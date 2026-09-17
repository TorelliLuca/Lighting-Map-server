/**
 * Unità di misura prezziario.
 * Canonico a DB: mq / mc. Display UI: m² / m³ (lato client).
 */

const UDM_VALUES = Object.freeze([
  "cad",
  "m",
  "mq",
  "mc",
  "ml",
  "kg",
  "h",
  "n",
  "corpo",
  "%",
])

const UDM_ALIASES = Object.freeze({
  cad: "cad",
  "cad.": "cad",
  cadauno: "cad",
  "c.adauno": "cad",
  pz: "cad",
  "pz.": "cad",
  pezzo: "cad",
  pezzi: "cad",
  "n.": "n",
  nr: "n",
  "n°": "n",
  n: "n",
  m: "m",
  ml: "ml",
  "m.l.": "ml",
  "m/l": "ml",
  kg: "kg",
  h: "h",
  ora: "h",
  ore: "h",
  corpo: "corpo",
  "corpo.": "corpo",
  acorpo: "corpo",
  "a.corpo": "corpo",
  "%": "%",
  perc: "%",
  mq: "mq",
  "mq.": "mq",
  m2: "mq",
  "m^2": "mq",
  "m²": "mq",
  "m².": "mq",
  mc: "mc",
  "mc.": "mc",
  m3: "mc",
  "m^3": "mc",
  "m³": "mc",
  "m³.": "mc",
})

function normalizeKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
}

function normalizeUdm(raw, { fallback = "cad" } = {}) {
  const key = normalizeKey(raw)
  if (!key) {
    return fallback === undefined ? null : fallback
  }
  if (Object.prototype.hasOwnProperty.call(UDM_ALIASES, key)) {
    return UDM_ALIASES[key]
  }
  if (UDM_VALUES.includes(key)) return key
  if (fallback === undefined) return null
  return fallback
}

/** Vuoto = ammissibile (diventa cad). Rifiuta solo unità non riconosciute. */
function isValidUdm(raw) {
  const key = normalizeKey(raw)
  if (!key) return true
  return normalizeUdm(raw, { fallback: null }) != null
}

module.exports = {
  UDM_VALUES,
  normalizeUdm,
  isValidUdm,
}
