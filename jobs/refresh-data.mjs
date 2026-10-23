// scripts/pages-refresh-entry.ts
import { readFile as readFile5 } from "node:fs/promises";

// src/ingest-public.ts
import { readFile as readFile3, writeFile as writeFile3 } from "node:fs/promises";
import { createHash as createHash3 } from "node:crypto";

// src/connectors/transport.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
var exec = promisify(execFile);
var Transport = class {
  records = [];
  offline;
  acquiredAt;
  rawRoot;
  constructor(offline, acquiredAt = (/* @__PURE__ */ new Date()).toISOString(), rawRoot = "data/raw") {
    this.offline = offline;
    this.acquiredAt = acquiredAt;
    this.rawRoot = rawRoot;
  }
  async get(name, url) {
    return this.request(name, url);
  }
  async post(name, url, payload) {
    return this.request(name, url, JSON.stringify(payload));
  }
  async request(name, url, requestBody) {
    const alias = `${this.rawRoot}/${name}`;
    let body;
    let ingested_at = this.acquiredAt;
    if (this.offline) {
      body = await readFile(alias, "utf8");
      const records = JSON.parse(
        await readFile(`${this.rawRoot}/manifest.json`, "utf8")
      );
      const original = records.find((r) => (r.alias ?? r.path) === alias);
      if (!original) throw Error(`Sin procedencia para ${name}`);
      if (original.url !== url || (original.method ?? "GET") !== (requestBody === void 0 ? "GET" : "POST") || original.request_body !== requestBody)
        throw Error(`La solicitud no coincide con la procedencia: ${name}`);
      if (createHash("sha256").update(body).digest("hex") !== original.sha256)
        throw Error(`Integridad fallida: ${name}`);
      ingested_at = original.ingested_at;
    } else {
      const result2 = await exec(
        "curl",
        [
          "--fail",
          "--location",
          "--silent",
          "--show-error",
          "--max-time",
          "45",
          "--retry",
          "2",
          "--retry-delay",
          "1",
          "--retry-max-time",
          "135",
          ...requestBody === void 0 ? [] : [
            "--request",
            "POST",
            "--header",
            "Content-Type: application/json; charset=utf-8",
            "--data-binary",
            requestBody
          ],
          url
        ],
        { maxBuffer: 40 * 1024 * 1024 }
      );
      body = result2.stdout;
    }
    const sha256 = createHash("sha256").update(body).digest("hex");
    const path = `${this.rawRoot}/objects/${sha256}`;
    await mkdir(`${this.rawRoot}/objects`, { recursive: true });
    try {
      await writeFile(path, body, { flag: "wx" });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (createHash("sha256").update(await readFile(path)).digest("hex") !== sha256)
        throw Error(`Objeto original alterado: ${name}`);
    }
    const record = {
      url,
      path,
      alias,
      sha256,
      ingested_at,
      ...requestBody === void 0 ? {} : { method: "POST", request_body: requestBody }
    };
    this.records.push(record);
    return { body, record };
  }
  async saveAliases() {
    for (const r of this.records) {
      await writeFile(r.alias, await readFile(r.path));
    }
    await writeFile(
      `${this.rawRoot}/manifest.json`,
      JSON.stringify(this.records, null, 2) + "\n"
    );
  }
};

// src/domain.ts
function status(value, alert, evacuation) {
  return evacuation !== null && value >= evacuation ? "evacuaci\xF3n" : alert !== null && value >= alert ? "alerta" : alert === null ? "umbral desconocido" : "bajo alerta";
}
function numberOrNull(v) {
  if (v === null || v === void 0 || v === "") return null;
  if (typeof v !== "number" && typeof v !== "string")
    throw Error("Tipo num\xE9rico inv\xE1lido");
  if (typeof v === "string" && !v.trim()) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw Error("Valor num\xE9rico inv\xE1lido");
  return n;
}
function validateMeasurement(m) {
  if (!Number.isFinite(m.value) || !Number.isFinite(Date.parse(m.observed_at)) || !m.station_id || !m.source)
    throw Error("Medici\xF3n inv\xE1lida");
}
function deduplicate(rows3) {
  const out = /* @__PURE__ */ new Map();
  for (const r of rows3) {
    validateMeasurement(r);
    const k = [r.station_id, r.series_id, r.observed_at].join("|");
    const old = out.get(k);
    if (old && old.value !== r.value) throw Error("Duplicado contradictorio");
    out.set(k, r);
  }
  return [...out.values()].sort(
    (a, b) => a.observed_at.localeCompare(b.observed_at)
  );
}

// src/analysis.ts
function isDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && (/* @__PURE__ */ new Date(value + "T00:00:00Z")).toISOString().slice(0, 10) === value;
}
function addDays(day, n) {
  if (!isDay(day)) throw Error("Fecha inv\xE1lida");
  return new Date(Date.parse(day + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
}

// src/connectors/snih.ts
var SNIH_CATALOG = "https://snih.hidricosargentina.gob.ar/Filtros.aspx/LeerEstaciones";
var SNIH_CODES = "https://snih.hidricosargentina.gob.ar/MuestraDatos.aspx/LeerCodigosMedicion";
var SNIH_LEVELS = "https://snih.hidricosargentina.gob.ar/MuestraDatos.aspx/LeerUltimosRegistros";
var SNIH_TERMS = "https://snih.hidricosargentina.gob.ar/Terminos.aspx";
var IGN_PORTS = "https://wms.ign.gob.ar/geoserver/ign_riesgo/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=ign_riesgo%3Apuertos_alturas_riesgo&outputFormat=application%2Fjson";
var IGN_LICENSE = "https://riesgo.ign.gob.ar/metadatos/puertos_alturas_riesgo.pdf";
var rows = (body) => {
  const d = JSON.parse(body).d;
  if (!Array.isArray(d)) throw Error("Cat\xE1logo SNIH sin lista de registros.");
  return d;
};
function normalizeSnihRosario(catalogBody, codesBody, levelsBody, start, end, ingestedAt, rawFile) {
  if (!isDay(start) || !isDay(end) || start >= end)
    throw Error("Intervalo SNIH inv\xE1lido.");
  const entry = rows(catalogBody).find((r) => r.Codigo === 13311);
  const code = rows(codesBody).find((r) => r.Codigo === 1);
  if (!entry || entry.Red !== 1 || entry.Descripcion !== "Rosario" || entry.Rio !== "Paran\xE1" || code?.Unidad !== "m" || code?.Descripcion !== "Altura")
    throw Error(
      "Estaci\xF3n, red o unidad SNIH no coinciden con el registro verificado."
    );
  if (typeof entry.Latitud !== "number" || typeof entry.Longitud !== "number" || entry.Latitud <= 0 || entry.Latitud >= 90 || entry.Longitud <= 0 || entry.Longitud >= 180)
    throw Error("Coordenadas SNIH inv\xE1lidas.");
  const station = {
    id: "snih:13311",
    external_id: "13311",
    name: "Rosario",
    river: "Paran\xE1",
    country: "Argentina",
    region: null,
    // The provider's Mapa.js explicitly negates these southern/western coordinate magnitudes.
    latitude: -entry.Latitud,
    longitude: -entry.Longitud,
    gauge_zero: null,
    alert: null,
    evacuation: null,
    source: "https://snih.hidricosargentina.gob.ar/Filtros.aspx"
  };
  const response = JSON.parse(levelsBody).d;
  if (!response || response.RespuestaOK !== true || !Array.isArray(response.Mediciones))
    throw Error("Consulta SNIH sin respuesta v\xE1lida.");
  const measurements = [];
  let outside = 0, missing = 0, otherTimes = 0;
  for (const row of response.Mediciones) {
    const match = typeof row.FechaHora === "string" ? /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(row.FechaHora) : null;
    if (!match || !Number.isFinite(Number(match[1])))
      throw Error("Timestamp SNIH inv\xE1lido.");
    const timestamp2 = Number(match[1]), date = new Date(timestamp2);
    if (!Number.isFinite(date.getTime()))
      throw Error("Timestamp SNIH fuera de rango.");
    const observed_at = date.toISOString(), day = observed_at.slice(0, 10);
    if (day < start || day >= end || observed_at > ingestedAt) {
      outside++;
      continue;
    }
    if (!Array.isArray(row.Mediciones)) throw Error("Valores SNIH ausentes.");
    const values = row.Mediciones.filter(
      (m) => m.Codigo === 1
    );
    if (!values.length) {
      missing++;
      continue;
    }
    for (const m of values) {
      if (m.Valor === null || typeof m.Valor === "number" && m.Valor <= -998.999) {
        missing++;
        continue;
      }
      if (typeof m.Valor !== "number" || !Number.isFinite(m.Valor) || Math.abs(m.Valor) > 1e6)
        throw Error("Altura SNIH no v\xE1lida.");
      if (observed_at.slice(11) !== "03:00:00.000Z") {
        otherTimes++;
        continue;
      }
      measurements.push({
        station_id: station.id,
        series_id: "snih-rhn-height-1-at-03utc",
        observed_at,
        value: m.Valor,
        unit: "m",
        kind: "observation",
        source: SNIH_LEVELS,
        source_updated_at: null,
        published_at: null,
        ingested_at: ingestedAt,
        raw_file: rawFile,
        quality: [
          "SNIH_telemetry_unvalidated",
          "actual_observation_at_fixed_03utc",
          "serialized_epoch_utc",
          "gauge_datum_unverified",
          "no_verified_station_threshold"
        ],
        trend_m_per_day: null,
        status: "umbral desconocido"
      });
    }
  }
  return {
    station,
    measurements: deduplicate(measurements),
    report: {
      raw_blocks: response.Mediciones.length,
      outside_requested_interval_or_future: outside,
      missing_sentinel_values: missing,
      other_times_preserved_in_raw: otherTimes,
      sampling: "actual_03utc_observation_only"
    }
  };
}
function rosarioPortReference(body, retrievedAt) {
  const collection = JSON.parse(body);
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features))
    throw Error("Capa IGN inv\xE1lida.");
  const f = collection.features.find(
    (f2) => f2.id === "puertos_alturas_riesgo.58" && f2.properties?.nam === "Puerto Rosario"
  );
  const raw = f?.properties?.cota_a;
  const value = typeof raw === "string" && /^\d+(?:[,.]\d+)?$/.test(raw) ? Number(raw.replace(",", ".")) : NaN;
  if (!Number.isFinite(value) || value <= 0 || value > 100)
    throw Error("Referencia IGN de Rosario no verificable.");
  return {
    value_m: value,
    label: "Puerto Rosario \xB7 referencia IGN/PNA",
    source: IGN_PORTS,
    license_url: IGN_LICENSE,
    retrieved_at: retrievedAt,
    gauge_equivalence: "unverified",
    validity: "unverified"
  };
}
async function ingestSnihRosario(t, start, end) {
  const terms = await t.get("snih-terms.html", SNIH_TERMS);
  if (!/Se permite cualquier utilizaci[\s\S]{0,1200}finalidad comercial/i.test(
    terms.body
  ))
    throw Error(
      "No se pudo verificar la cl\xE1usula de reutilizaci\xF3n SNIH; no se publica un corte nuevo."
    );
  const catalog = await t.post("snih-stations.json", SNIH_CATALOG, {});
  const codes = await t.post("snih-codes.json", SNIH_CODES, {});
  const levels = await t.post(`snih-13311-${start}-${end}.json`, SNIH_LEVELS, {
    fechaDesde: start,
    fechaHasta: addDays(end, -1),
    estacion: "13311",
    codigo: "1"
  });
  const result2 = normalizeSnihRosario(
    catalog.body,
    codes.body,
    levels.body,
    start,
    end,
    levels.record.ingested_at,
    levels.record.path
  );
  if (!result2.measurements.length)
    throw Error(
      "SNIH no devolvi\xF3 observaciones reales a la hora de referencia."
    );
  const ports = await t.get("ign-port-thresholds.geojson", IGN_PORTS);
  result2.station.scenario_reference = rosarioPortReference(
    ports.body,
    ports.record.ingested_at
  );
  return result2;
}

// src/connectors/pna.ts
var PNA_CURRENT = "https://contenidosweb.prefecturanaval.gob.ar/alturas/index.php";
var clean = (s) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").trim();
function number(s) {
  if (!/^-?\d+(?:[.,]\d+)?$/.test(s)) throw Error("Altura PNA inv\xE1lida.");
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n) || n <= -999 || Math.abs(n) > 1e6)
    throw Error("Altura PNA fuera de rango.");
  return n;
}
function timestamp(s) {
  const m = /^(\d{2})\/([A-Z]{3})\/(\d{2})\s*-\s*(\d{2})(\d{2})$/.exec(s);
  const months = [
    "ENE",
    "FEB",
    "MAR",
    "ABR",
    "MAY",
    "JUN",
    "JUL",
    "AGO",
    "SEP",
    "OCT",
    "NOV",
    "DIC"
  ];
  if (!m || !months.includes(m[2]) || +m[4] > 23 || +m[5] > 59)
    throw Error("Fecha/hora PNA inv\xE1lida.");
  const day = `20${m[3]}-${String(months.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1]}`;
  if (!isDay(day)) throw Error("Fecha PNA inexistente.");
  return (/* @__PURE__ */ new Date(`${day}T${m[4]}:${m[5]}:00-03:00`)).toISOString();
}
function normalizePnaRosario(body, station, prior, start, end, acquiredAt, raw) {
  if (station.id !== "ina:34" || station.external_id !== "280" || station.name !== "Rosario")
    throw Error("Identidad PNA/INA de Rosario no verificada.");
  const rows3 = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]).filter(
    (r) => /<th\b[^>]*data-label="Puerto:"[^>]*>\s*ROSARIO\s*<\/th>/i.test(r)
  );
  if (rows3.length !== 1 || !/href="\/alturas\/\?page=historico&tiempo=7&id=280\s*"/.test(rows3[0]))
    throw Error("Fila o identificador de puerto Rosario PNA cambiaron.");
  const cells = new Map(
    [
      ...rows3[0].matchAll(
        /<td\b[^>]*data-label="([^"]+)"[^>]*>([\s\S]*?)<\/td>/gi
      )
    ].map((m) => [m[1], clean(m[2])])
  );
  const value = number(cells.get("Ultimo Registro:") ?? ""), observed_at = timestamp(cells.get("Fecha Hora:") ?? "");
  const previousValue = number(cells.get("Registro Anterior:") ?? ""), previousAt = timestamp(cells.get("Fecha Anterior:") ?? "");
  if (observed_at < previousAt || observed_at > acquiredAt)
    throw Error("Cronolog\xEDa PNA inv\xE1lida o futura.");
  const last = prior.filter((m) => m.station_id === station.id).toSorted((a, b) => a.observed_at.localeCompare(b.observed_at)).at(-1);
  const day = observed_at.slice(0, 10);
  const measurements = [];
  if (day >= start && day < end && (!last || observed_at > last.observed_at))
    measurements.push({
      station_id: station.id,
      series_id: "34",
      observed_at,
      value,
      unit: "m",
      kind: "observation",
      source: PNA_CURRENT,
      source_updated_at: null,
      published_at: null,
      ingested_at: acquiredAt,
      raw_file: raw,
      quality: [
        "source_quality_unverified",
        "pna_port_id_matches_ina_external_id",
        "normalized_series_ina_34_pna_port_280",
        "pna_latest_direct_observation",
        "pna_civil_time_converted_argentina_utc_minus_03",
        "threshold_validity_unknown"
      ],
      trend_m_per_day: null,
      status: status(value, station.alert, station.evacuation)
    });
  return {
    measurements,
    report: {
      port_id: "280",
      latest_observed_at: observed_at,
      latest_value_m: value,
      added: measurements.length,
      previous_matches_ina: prior.some(
        (m) => m.station_id === station.id && m.observed_at === previousAt && m.value === previousValue
      ),
      thresholds_policy: "INA catalogue references retained; PNA page thresholds not substituted"
    }
  };
}
async function ingestPnaRosario(t, stations, prior, start, end) {
  const station = stations.find((s) => s.id === "ina:34");
  if (!station)
    throw Error("Falta estaci\xF3n Rosario INA para vincular puerto PNA.");
  const { body, record } = await t.get("pna-current.html", PNA_CURRENT);
  return normalizePnaRosario(
    body,
    station,
    prior,
    start,
    end,
    record.ingested_at,
    record.path
  );
}

// config/stations.json
var stations_default = [
  {
    series_id: 14,
    name: "Posadas",
    network: "alturas_prefe"
  },
  {
    series_id: 15,
    name: "Ituzaing\xF3",
    network: "alturas_prefe"
  },
  {
    series_id: 16,
    name: "It\xE1 Ibat\xE9",
    network: "alturas_prefe"
  },
  {
    series_id: 17,
    name: "Itat\xED",
    network: "alturas_prefe"
  },
  {
    series_id: 18,
    name: "Paso de la Patria",
    network: "alturas_prefe"
  },
  {
    series_id: 19,
    name: "Corrientes",
    network: "alturas_prefe"
  },
  {
    series_id: 20,
    name: "Barranqueras",
    network: "alturas_prefe"
  },
  {
    series_id: 21,
    name: "Empedrado",
    network: "alturas_prefe"
  },
  {
    series_id: 22,
    name: "Bella Vista",
    network: "alturas_prefe"
  },
  {
    series_id: 23,
    name: "Goya",
    network: "alturas_prefe"
  },
  {
    series_id: 24,
    name: "Reconquista",
    network: "alturas_prefe"
  },
  {
    series_id: 25,
    name: "Esquina",
    network: "alturas_prefe"
  },
  {
    series_id: 26,
    name: "La Paz",
    network: "alturas_prefe"
  },
  {
    series_id: 27,
    name: "Santa Elena",
    network: "alturas_prefe"
  },
  {
    series_id: 28,
    name: "Hernandarias",
    network: "alturas_prefe"
  },
  {
    series_id: 29,
    name: "Paran\xE1",
    network: "alturas_prefe"
  },
  {
    series_id: 30,
    name: "Santa Fe",
    network: "alturas_prefe"
  },
  {
    series_id: 31,
    name: "Diamante",
    network: "alturas_prefe"
  },
  {
    series_id: 32,
    name: "Victoria",
    network: "alturas_prefe"
  },
  {
    series_id: 33,
    name: "San Lorenzo (San Mart\xEDn)",
    network: "alturas_prefe"
  },
  {
    series_id: 34,
    name: "Rosario",
    network: "alturas_prefe"
  },
  {
    series_id: 35,
    name: "Villa Constituci\xF3n",
    network: "alturas_prefe"
  },
  {
    series_id: 36,
    name: "San Nicol\xE1s",
    network: "alturas_prefe"
  },
  {
    series_id: 37,
    name: "Ramallo",
    network: "alturas_prefe"
  },
  {
    series_id: 38,
    name: "San Pedro",
    network: "alturas_prefe"
  },
  {
    series_id: 39,
    name: "Baradero",
    network: "alturas_prefe"
  },
  {
    series_id: 40,
    name: "Z\xE1rate",
    network: "alturas_prefe"
  },
  {
    series_id: 41,
    name: "Campana",
    network: "alturas_prefe"
  },
  {
    series_id: 42,
    name: "Escobar",
    network: "alturas_prefe"
  },
  {
    series_id: 43,
    name: "Villa Paranacito",
    network: "alturas_prefe"
  },
  {
    series_id: 44,
    name: "Canal Nuevo",
    network: "alturas_prefe"
  },
  {
    series_id: 45,
    name: "Ibicuy",
    network: "alturas_prefe"
  },
  {
    series_id: 46,
    name: "Puerto Ruiz",
    network: "alturas_prefe"
  },
  {
    series_id: 47,
    name: "Mart\xEDn Garc\xEDa",
    network: "alturas_prefe"
  },
  {
    series_id: 48,
    name: "Guazucito",
    network: "alturas_prefe"
  },
  {
    series_id: 49,
    name: "Tigre",
    network: "alturas_prefe"
  },
  {
    series_id: 50,
    name: "Dique Luj\xE1n",
    network: "alturas_prefe"
  },
  {
    series_id: 51,
    name: "Chan\xE1 Min\xED",
    network: "alturas_prefe"
  }
];

// src/connectors/ina.ts
var base = "https://alerta.ina.gob.ar/a5";
function object(x) {
  if (!x || typeof x !== "object" || Array.isArray(x))
    throw Error("Objeto INA inv\xE1lido");
  return x;
}
function rows2(x) {
  if (Array.isArray(x)) return x;
  const o = object(x);
  if (!Array.isArray(o.rows)) throw Error("Respuesta INA sin filas");
  return o.rows;
}
function text(x) {
  if (typeof x !== "string") throw Error("Texto INA inv\xE1lido");
  return x;
}
async function ingestIna(t, start, end) {
  const catalog = rows2(
    JSON.parse(
      (await t.get(
        "ina-catalog.json",
        `${base}/obs/puntual/series?format=json`
      )).body
    )
  );
  const stations = [];
  const measurements = [];
  for (const entry of stations_default) {
    const s = object(catalog.find((x) => object(x).id === entry.series_id));
    const e = object(s.estacion), v = object(s.var), proc = object(s.procedimiento), units = object(s.unidades), geom = object(e.geom);
    if (e.tabla !== entry.network || e.nombre !== entry.name || v.id !== 2 || proc.id !== 1 || units.abrev !== "m")
      throw Error(`Metadatos cambiaron para ${entry.name}`);
    if (!Array.isArray(geom.coordinates) || geom.coordinates.length !== 2)
      throw Error("Coordenadas ausentes");
    const longitude = numberOrNull(geom.coordinates[0]), latitude = numberOrNull(geom.coordinates[1]);
    if (longitude === null || latitude === null || Math.abs(longitude) > 180 || Math.abs(latitude) > 90)
      throw Error("Coordenadas inv\xE1lidas");
    const station = {
      id: `ina:${e.id}`,
      name: text(e.nombre),
      river: text(e.rio),
      country: text(e.pais),
      region: null,
      longitude,
      latitude,
      external_id: text(e.id_externo),
      source: base,
      gauge_zero: numberOrNull(e.cero_ign),
      alert: numberOrNull(e.nivel_alerta),
      evacuation: numberOrNull(e.nivel_evacuacion)
    };
    stations.push(station);
    const file = `ina-${s.id}-${start}-${end}.json`, url = `${base}/obs/puntual/series/${s.id}/observaciones?timestart=${start}&timeend=${end}&format=json`;
    const { body, record } = await t.get(file, url);
    for (const item of rows2(JSON.parse(body))) {
      const o = object(item);
      if (o.series_id !== s.id) throw Error("Serie INA incorrecta");
      const value = numberOrNull(o.valor);
      if (value === null) continue;
      const observed_at = text(o.timestart);
      if (!/Z$|[+-]\d{2}:\d{2}$/.test(observed_at) || !Number.isFinite(Date.parse(observed_at)))
        throw Error("Timestamp INA sin zona v\xE1lida");
      const day = observed_at.slice(0, 10);
      if (day < start || day >= end || Date.parse(observed_at) > Date.parse(t.acquiredAt))
        continue;
      measurements.push({
        station_id: station.id,
        series_id: String(s.id),
        observed_at,
        value,
        unit: "m",
        kind: "observation",
        source: url,
        source_updated_at: typeof o.timeupdate === "string" ? o.timeupdate : null,
        published_at: null,
        ingested_at: record.ingested_at,
        quality: ["source_quality_unverified", "threshold_validity_unknown"],
        raw_file: record.path,
        trend_m_per_day: null,
        status: status(value, station.alert, station.evacuation)
      });
    }
  }
  const levels = deduplicate(measurements);
  for (const s of stations) {
    const points = levels.filter((m) => m.station_id === s.id);
    for (let i = 1; i < points.length; i++) {
      const days = (Date.parse(points[i].observed_at) - Date.parse(points[i - 1].observed_at)) / 864e5;
      if (days > 0 && days <= 1.5)
        points[i].trend_m_per_day = (points[i].value - points[i - 1].value) / days;
    }
  }
  return { stations, measurements: levels, catalogRows: catalog.length };
}

// node_modules/csv-parse/lib/api/CsvError.js
var CsvError = class _CsvError extends Error {
  constructor(code, message, options, ...contexts) {
    if (Array.isArray(message)) message = message.join(" ").trim();
    super(message);
    if (Error.captureStackTrace !== void 0) {
      Error.captureStackTrace(this, _CsvError);
    }
    this.code = code;
    for (const context of contexts) {
      for (const key in context) {
        const value = context[key];
        this[key] = Buffer.isBuffer(value) ? value.toString(options.encoding) : value == null ? value : JSON.parse(JSON.stringify(value));
      }
    }
  }
};

// node_modules/csv-parse/lib/utils/is_object.js
var is_object = function(obj) {
  return typeof obj === "object" && obj !== null && !Array.isArray(obj);
};

// node_modules/csv-parse/lib/api/normalize_columns_array.js
var normalize_columns_array = function(columns) {
  const normalizedColumns = [];
  for (let i = 0, l = columns.length; i < l; i++) {
    const column = columns[i];
    if (column === void 0 || column === null || column === false) {
      normalizedColumns[i] = { disabled: true };
    } else if (typeof column === "string" || typeof column === "number") {
      normalizedColumns[i] = { name: `${column}` };
    } else if (is_object(column)) {
      if (typeof column.name !== "string") {
        throw new CsvError("CSV_OPTION_COLUMNS_MISSING_NAME", [
          "Option columns missing name:",
          `property "name" is required at position ${i}`,
          "when column is an object literal"
        ]);
      }
      normalizedColumns[i] = column;
    } else {
      throw new CsvError("CSV_INVALID_COLUMN_DEFINITION", [
        "Invalid column definition:",
        "expect a string or a literal object,",
        `got ${JSON.stringify(column)} at position ${i}`
      ]);
    }
  }
  return normalizedColumns;
};

// node_modules/csv-parse/lib/utils/ResizeableBuffer.js
var ResizeableBuffer = class {
  constructor(size = 100) {
    this.size = size;
    this.length = 0;
    this.buf = Buffer.allocUnsafe(size);
  }
  prepend(val) {
    if (Buffer.isBuffer(val)) {
      const length = this.length + val.length;
      if (length >= this.size) {
        this.resize();
        if (length >= this.size) {
          throw Error("INVALID_BUFFER_STATE");
        }
      }
      const buf = this.buf;
      this.buf = Buffer.allocUnsafe(this.size);
      val.copy(this.buf, 0);
      buf.copy(this.buf, val.length);
      this.length += val.length;
    } else {
      const length = this.length++;
      if (length === this.size) {
        this.resize();
      }
      const buf = this.clone();
      this.buf[0] = val;
      buf.copy(this.buf, 1, 0, length);
    }
  }
  append(val) {
    const length = this.length++;
    if (length === this.size) {
      this.resize();
    }
    this.buf[length] = val;
  }
  clone() {
    return Buffer.from(this.buf.slice(0, this.length));
  }
  resize() {
    const length = this.length;
    this.size = this.size * 2;
    const buf = Buffer.allocUnsafe(this.size);
    this.buf.copy(buf, 0, 0, length);
    this.buf = buf;
  }
  toString(encoding) {
    if (encoding) {
      return this.buf.toString(encoding, 0, this.length);
    } else {
      return Uint8Array.prototype.slice.call(this.buf.slice(0, this.length));
    }
  }
  toJSON() {
    return this.toString("utf8");
  }
  reset() {
    this.length = 0;
  }
};
var ResizeableBuffer_default = ResizeableBuffer;

// node_modules/csv-parse/lib/api/init_state.js
var init_state = function(options) {
  const timchars = [
    // Basic Latin
    32,
    // [Space](https://www.fileformat.info/info/unicode/char/0020/index.htm)
    9,
    // [CHARACTER TABULATION (HT)](https://www.fileformat.info/info/unicode/char/0009/index.htm)
    10,
    // [LINE FEED (LF)](https://www.fileformat.info/info/unicode/char/000a/index.htm)
    13,
    // [CARRIAGE RETURN (CR)](https://www.fileformat.info/info/unicode/char/000d/index.htm)
    12,
    // [FORM FEED (FF)](https://www.fileformat.info/info/unicode/char/000c/index.htm)
    11,
    // [LINE TABULATION (VT)](https://www.fileformat.info/info/unicode/char/000b/index.htm)
    // Latin-1 Supplement
    160,
    // [NO-BREAK SPACE (NBSP)](https://www.fileformat.info/info/unicode/char/00a0/index.htm)
    // Ogham
    5760,
    // [OGHAM SPACE MARK](https://www.fileformat.info/info/unicode/char/1680/index.htm)
    // General Punctuation
    8192,
    // [EN QUAD](https://www.fileformat.info/info/unicode/char/2000/index.htm)
    8193,
    // [EM QUAD](https://www.fileformat.info/info/unicode/char/2001/index.htm)
    8194,
    // [EN SPACE](https://www.fileformat.info/info/unicode/char/2002/index.htm)
    8195,
    // [EM SPACE](https://www.fileformat.info/info/unicode/char/2003/index.htm)
    8196,
    // [THREE-PER-EM SPACE](https://www.fileformat.info/info/unicode/char/2004/index.htm)
    8197,
    // [FOUR-PER-EM SPACE](https://www.fileformat.info/info/unicode/char/2005/index.htm)
    8198,
    // [SIX-PER-EM SPACE](https://www.fileformat.info/info/unicode/char/2006/index.htm)
    8199,
    // [FIGURE SPACE](https://www.fileformat.info/info/unicode/char/2007/index.htm)
    8200,
    // [PUNCTUATION SPACE](https://www.fileformat.info/info/unicode/char/2008/index.htm)
    8201,
    // [THIN SPACE](https://www.fileformat.info/info/unicode/char/2009/index.htm)
    8202,
    // [HAIR SPACE](https://www.fileformat.info/info/unicode/char/200a/index.htm)
    8232,
    // [LINE SEPARATOR](https://www.fileformat.info/info/unicode/char/2028/index.htm)
    8233,
    // [PARAGRAPH SEPARATOR](https://www.fileformat.info/info/unicode/char/2029/index.htm)
    8239,
    // [NARROW NO-BREAK SPACE (NNBSP)](https://www.fileformat.info/info/unicode/char/202f/index.htm)
    8287,
    // [MEDIUM MATHEMATICAL SPACE (MMSP)](https://www.fileformat.info/info/unicode/char/205f/index.htm)
    12288,
    // [IDEOGRAPHIC SPACE](https://www.fileformat.info/info/unicode/char/3000/index.htm)
    65279
    // [ZERO WIDTH NO-BREAK SPACE (BOM)](https://www.fileformat.info/info/unicode/char/feff/index.htm)
  ].reduce((acc, codepoint) => {
    const encoded = Buffer.from(
      String.fromCharCode(codepoint),
      options.encoding
    );
    if (codepoint !== 63 && encoded.length === 1 && encoded[0] === 63) {
      return acc;
    }
    acc.push(encoded);
    return acc;
  }, []);
  const timcharFirstBytes = new Uint8Array(256);
  for (const t of timchars) timcharFirstBytes[t[0]] = 1;
  return {
    bomSkipped: false,
    bufBytesStart: 0,
    castField: options.cast_function,
    commenting: false,
    delimiterBufPrevious: void 0,
    delimiterDiscovered: false,
    // Current error encountered by a record
    error: void 0,
    enabled: options.from_line === 1,
    escaping: false,
    escapeIsQuote: Buffer.isBuffer(options.escape) && Buffer.isBuffer(options.quote) && Buffer.compare(options.escape, options.quote) === 0,
    // columns can be `false`, `true`, `Array`
    expectedRecordLength: Array.isArray(options.columns) ? options.columns.length : void 0,
    field: new ResizeableBuffer_default(20),
    firstLineToHeaders: options.cast_first_line_to_header,
    needMoreDataSize: Math.max(
      // Skip if the remaining buffer smaller than comment
      options.comment !== null ? options.comment.length : 0,
      ...options.delimiter ? options.delimiter.map((delimiter) => delimiter.length) : [],
      // Auto discovery of delimiter is limited to 1 character
      options.delimiter_auto ? 1 : 0,
      // Skip if the remaining buffer can be escape sequence
      options.quote !== null ? options.quote.length : 0,
      ...timchars.map((t) => t.length)
    ),
    previousBuf: void 0,
    quoting: false,
    stop: false,
    rawBuffer: new ResizeableBuffer_default(100),
    record: [],
    recordHasError: false,
    record_length: 0,
    recordDelimiterMaxLength: options.record_delimiter.length === 0 ? 0 : Math.max(...options.record_delimiter.map((v) => v.length)),
    trimChars: [
      Buffer.from(" ", options.encoding)[0],
      Buffer.from("	", options.encoding)[0]
    ],
    wasQuoting: false,
    wasRowDelimiter: false,
    timchars,
    timcharFirstBytes
  };
};

// node_modules/csv-parse/lib/utils/underscore.js
var underscore = function(str) {
  return str.replace(/([A-Z])/g, function(_, match) {
    return "_" + match.toLowerCase();
  });
};

// node_modules/csv-parse/lib/api/normalize_options.js
var normalize_options = function(opts) {
  const options = {};
  for (const opt in opts) {
    options[underscore(opt)] = opts[opt];
  }
  if (options.encoding === void 0 || options.encoding === true) {
    options.encoding = "utf8";
  } else if (options.encoding === null || options.encoding === false) {
    options.encoding = null;
  } else if (typeof options.encoding !== "string" && options.encoding !== null) {
    throw new CsvError(
      "CSV_INVALID_OPTION_ENCODING",
      [
        "Invalid option encoding:",
        "encoding must be a string or null to return a buffer,",
        `got ${JSON.stringify(options.encoding)}`
      ],
      options
    );
  }
  if (options.bom === void 0 || options.bom === null || options.bom === false) {
    options.bom = false;
  } else if (options.bom !== true) {
    throw new CsvError(
      "CSV_INVALID_OPTION_BOM",
      [
        "Invalid option bom:",
        "bom must be true,",
        `got ${JSON.stringify(options.bom)}`
      ],
      options
    );
  }
  options.cast_function = null;
  if (options.cast === void 0 || options.cast === null || options.cast === false || options.cast === "") {
    options.cast = void 0;
  } else if (typeof options.cast === "function") {
    options.cast_function = options.cast;
    options.cast = true;
  } else if (options.cast !== true) {
    throw new CsvError(
      "CSV_INVALID_OPTION_CAST",
      [
        "Invalid option cast:",
        "cast must be true or a function,",
        `got ${JSON.stringify(options.cast)}`
      ],
      options
    );
  }
  if (options.cast_date === void 0 || options.cast_date === null || options.cast_date === false || options.cast_date === "") {
    options.cast_date = false;
  } else if (options.cast_date === true) {
    options.cast_date = function(value) {
      const date = Date.parse(value);
      return !isNaN(date) ? new Date(date) : value;
    };
  } else if (typeof options.cast_date !== "function") {
    throw new CsvError(
      "CSV_INVALID_OPTION_CAST_DATE",
      [
        "Invalid option cast_date:",
        "cast_date must be true or a function,",
        `got ${JSON.stringify(options.cast_date)}`
      ],
      options
    );
  }
  options.cast_first_line_to_header = void 0;
  if (options.columns === true) {
    options.cast_first_line_to_header = void 0;
  } else if (typeof options.columns === "function") {
    options.cast_first_line_to_header = options.columns;
    options.columns = true;
  } else if (Array.isArray(options.columns)) {
    options.columns = normalize_columns_array(options.columns);
  } else if (options.columns === void 0 || options.columns === null || options.columns === false) {
    options.columns = false;
  } else {
    throw new CsvError(
      "CSV_INVALID_OPTION_COLUMNS",
      [
        "Invalid option columns:",
        "expect an array, a function or true,",
        `got ${JSON.stringify(options.columns)}`
      ],
      options
    );
  }
  if (options.group_columns_by_name === void 0 || options.group_columns_by_name === null || options.group_columns_by_name === false) {
    options.group_columns_by_name = false;
  } else if (options.group_columns_by_name !== true) {
    throw new CsvError(
      "CSV_INVALID_OPTION_GROUP_COLUMNS_BY_NAME",
      [
        "Invalid option group_columns_by_name:",
        "expect an boolean,",
        `got ${JSON.stringify(options.group_columns_by_name)}`
      ],
      options
    );
  } else if (options.columns === false) {
    throw new CsvError(
      "CSV_INVALID_OPTION_GROUP_COLUMNS_BY_NAME",
      [
        "Invalid option group_columns_by_name:",
        "the `columns` mode must be activated."
      ],
      options
    );
  }
  if (options.comment === void 0 || options.comment === null || options.comment === false || options.comment === "") {
    options.comment = null;
  } else {
    if (typeof options.comment === "string") {
      options.comment = Buffer.from(options.comment, options.encoding);
    }
    if (!Buffer.isBuffer(options.comment)) {
      throw new CsvError(
        "CSV_INVALID_OPTION_COMMENT",
        [
          "Invalid option comment:",
          "comment must be a buffer or a string,",
          `got ${JSON.stringify(options.comment)}`
        ],
        options
      );
    }
  }
  if (options.comment_no_infix === void 0 || options.comment_no_infix === null || options.comment_no_infix === false) {
    options.comment_no_infix = false;
  } else if (options.comment_no_infix !== true) {
    throw new CsvError(
      "CSV_INVALID_OPTION_COMMENT",
      [
        "Invalid option comment_no_infix:",
        "value must be a boolean,",
        `got ${JSON.stringify(options.comment_no_infix)}`
      ],
      options
    );
  }
  if (options.delimiter_auto === void 0 || options.delimiter_auto === null || options.delimiter_auto === false) {
    options.delimiter_auto = false;
  } else if (options.delimiter_auto === true) {
    options.delimiter_auto = {};
  } else if (!is_object(options.delimiter_auto)) {
    throw new CsvError(
      "CSV_INVALID_OPTION_DELIMITER_AUTO",
      [
        "Invalid option delimiter_auto:",
        "delimiter_auto must be a boolean or a configuration object,",
        `got ${JSON.stringify(options.delimiter_auto)}`
      ],
      options
    );
  }
  if (options.delimiter_auto) {
    if (options.delimiter_auto.preferred === void 0)
      options.delimiter_auto.preferred = {
        [",".charCodeAt(0)]: 1.8,
        ["	".charCodeAt(0)]: 1.8,
        [";".charCodeAt(0)]: 1.6,
        [" ".charCodeAt(0)]: 1.6,
        [":".charCodeAt(0)]: 1.5,
        [".".charCodeAt(0)]: 1.4,
        ["/".charCodeAt(0)]: 1.4
      };
    else if (!is_object(options.delimiter_auto.preferred)) {
      throw new CsvError(
        "CSV_INVALID_OPTION_DELIMITER_AUTO",
        [
          "Invalid option delimiter_auto:",
          "preferred must be an object,",
          `got ${JSON.stringify(options.delimiter_auto.preferred)}`
        ],
        options
      );
    }
    if (options.delimiter_auto.score === void 0)
      options.delimiter_auto.score = (info, options2) => {
        return (info.total - info.std) * (options2.preferred[info.char_code] || 1);
      };
    else if (typeof options.delimiter_auto.score !== "function") {
      throw new CsvError(
        "CSV_INVALID_OPTION_DELIMITER_AUTO",
        [
          "Invalid option delimiter_auto:",
          "score must be a function,",
          `got ${JSON.stringify(options.delimiter_auto.score)}`
        ],
        options
      );
    }
    if (options.delimiter_auto.size === void 0)
      options.delimiter_auto.size = 2048;
    else if (typeof options.delimiter_auto.size !== "number") {
      throw new CsvError(
        "CSV_INVALID_OPTION_DELIMITER_AUTO",
        [
          "Invalid option delimiter_auto:",
          "size must be a number,",
          `got ${JSON.stringify(options.delimiter_auto.size)}`
        ],
        options
      );
    }
  }
  const delimiter_json = JSON.stringify(options.delimiter);
  if (options.delimiter_auto !== false) {
    options.delimiter = [];
  }
  if (!Array.isArray(options.delimiter)) {
    if (options.delimiter === void 0 || options.delimiter === null || options.delimiter === false) {
      options.delimiter = Buffer.from(",", options.encoding);
    }
    options.delimiter = [options.delimiter];
  }
  options.delimiter = options.delimiter.map(function(delimiter) {
    if (typeof delimiter === "string") {
      delimiter = Buffer.from(delimiter, options.encoding);
    }
    if (!Buffer.isBuffer(delimiter) || delimiter.length === 0) {
      throw new CsvError(
        "CSV_INVALID_OPTION_DELIMITER",
        [
          "Invalid option delimiter:",
          "delimiter must be a non empty string or buffer or array of string|buffer,",
          `got ${delimiter_json}`
        ],
        options
      );
    }
    return delimiter;
  });
  if (options.escape === void 0 || options.escape === true) {
    options.escape = Buffer.from('"', options.encoding);
  } else if (typeof options.escape === "string") {
    options.escape = Buffer.from(options.escape, options.encoding);
  } else if (options.escape === null || options.escape === false) {
    options.escape = null;
  }
  if (options.escape !== null) {
    if (!Buffer.isBuffer(options.escape)) {
      throw new Error(
        `Invalid Option: escape must be a buffer, a string or a boolean, got ${JSON.stringify(options.escape)}`
      );
    }
  }
  if (options.from === void 0 || options.from === null) {
    options.from = 1;
  } else {
    if (typeof options.from === "string" && /\d+/.test(options.from)) {
      options.from = parseInt(options.from);
    }
    if (Number.isInteger(options.from)) {
      if (options.from < 0) {
        throw new Error(
          `Invalid Option: from must be a positive integer, got ${JSON.stringify(opts.from)}`
        );
      }
    } else {
      throw new Error(
        `Invalid Option: from must be an integer, got ${JSON.stringify(options.from)}`
      );
    }
  }
  if (options.from_line === void 0 || options.from_line === null) {
    options.from_line = 1;
  } else {
    if (typeof options.from_line === "string" && /\d+/.test(options.from_line)) {
      options.from_line = parseInt(options.from_line);
    }
    if (Number.isInteger(options.from_line)) {
      if (options.from_line <= 0) {
        throw new Error(
          `Invalid Option: from_line must be a positive integer greater than 0, got ${JSON.stringify(opts.from_line)}`
        );
      }
    } else {
      throw new Error(
        `Invalid Option: from_line must be an integer, got ${JSON.stringify(opts.from_line)}`
      );
    }
  }
  if (options.ignore_last_delimiters === void 0 || options.ignore_last_delimiters === null) {
    options.ignore_last_delimiters = false;
  } else if (typeof options.ignore_last_delimiters === "number") {
    options.ignore_last_delimiters = Math.floor(options.ignore_last_delimiters);
    if (options.ignore_last_delimiters === 0) {
      options.ignore_last_delimiters = false;
    }
  } else if (typeof options.ignore_last_delimiters !== "boolean") {
    throw new CsvError(
      "CSV_INVALID_OPTION_IGNORE_LAST_DELIMITERS",
      [
        "Invalid option `ignore_last_delimiters`:",
        "the value must be a boolean value or an integer,",
        `got ${JSON.stringify(options.ignore_last_delimiters)}`
      ],
      options
    );
  }
  if (options.ignore_last_delimiters === true && options.columns === false) {
    throw new CsvError(
      "CSV_IGNORE_LAST_DELIMITERS_REQUIRES_COLUMNS",
      [
        "The option `ignore_last_delimiters`",
        "requires the activation of the `columns` option"
      ],
      options
    );
  }
  if (options.info === void 0 || options.info === null || options.info === false) {
    options.info = false;
  } else if (options.info !== true) {
    throw new Error(
      `Invalid Option: info must be true, got ${JSON.stringify(options.info)}`
    );
  }
  if (options.max_record_size === void 0 || options.max_record_size === null || options.max_record_size === false) {
    options.max_record_size = 0;
  } else if (Number.isInteger(options.max_record_size) && options.max_record_size >= 0) {
  } else if (typeof options.max_record_size === "string" && /\d+/.test(options.max_record_size)) {
    options.max_record_size = parseInt(options.max_record_size);
  } else {
    throw new Error(
      `Invalid Option: max_record_size must be a positive integer, got ${JSON.stringify(options.max_record_size)}`
    );
  }
  if (options.objname === void 0 || options.objname === null || options.objname === false) {
    options.objname = void 0;
  } else if (Buffer.isBuffer(options.objname)) {
    if (options.objname.length === 0) {
      throw new Error(`Invalid Option: objname must be a non empty buffer`);
    }
    if (options.encoding === null) {
    } else {
      options.objname = options.objname.toString(options.encoding);
    }
  } else if (typeof options.objname === "string") {
    if (options.objname.length === 0) {
      throw new Error(`Invalid Option: objname must be a non empty string`);
    }
  } else if (typeof options.objname === "number") {
  } else {
    throw new Error(
      `Invalid Option: objname must be a string or a buffer, got ${options.objname}`
    );
  }
  if (options.objname !== void 0) {
    if (typeof options.objname === "number") {
      if (options.columns !== false) {
        throw Error(
          "Invalid Option: objname index cannot be combined with columns or be defined as a field"
        );
      }
    } else {
      if (options.columns === false) {
        throw Error(
          "Invalid Option: objname field must be combined with columns or be defined as an index"
        );
      }
    }
  }
  if (options.on_record === void 0 || options.on_record === null) {
    options.on_record = void 0;
  } else if (typeof options.on_record !== "function") {
    throw new CsvError(
      "CSV_INVALID_OPTION_ON_RECORD",
      [
        "Invalid option `on_record`:",
        "expect a function,",
        `got ${JSON.stringify(options.on_record)}`
      ],
      options
    );
  }
  if (options.on_skip !== void 0 && options.on_skip !== null && typeof options.on_skip !== "function") {
    throw new Error(
      `Invalid Option: on_skip must be a function, got ${JSON.stringify(options.on_skip)}`
    );
  }
  if (options.quote === null || options.quote === false || options.quote === "") {
    options.quote = null;
  } else {
    if (options.quote === void 0 || options.quote === true) {
      options.quote = Buffer.from('"', options.encoding);
    } else if (typeof options.quote === "string") {
      options.quote = Buffer.from(options.quote, options.encoding);
    }
    if (!Buffer.isBuffer(options.quote)) {
      throw new Error(
        `Invalid Option: quote must be a buffer or a string, got ${JSON.stringify(options.quote)}`
      );
    }
  }
  if (options.raw === void 0 || options.raw === null || options.raw === false) {
    options.raw = false;
  } else if (options.raw !== true) {
    throw new Error(
      `Invalid Option: raw must be true, got ${JSON.stringify(options.raw)}`
    );
  }
  if (options.record_delimiter === void 0) {
    options.record_delimiter = [];
  } else if (typeof options.record_delimiter === "string" || Buffer.isBuffer(options.record_delimiter)) {
    if (options.record_delimiter.length === 0) {
      throw new CsvError(
        "CSV_INVALID_OPTION_RECORD_DELIMITER",
        [
          "Invalid option `record_delimiter`:",
          "value must be a non empty string or buffer,",
          `got ${JSON.stringify(options.record_delimiter)}`
        ],
        options
      );
    }
    options.record_delimiter = [options.record_delimiter];
  } else if (!Array.isArray(options.record_delimiter)) {
    throw new CsvError(
      "CSV_INVALID_OPTION_RECORD_DELIMITER",
      [
        "Invalid option `record_delimiter`:",
        "value must be a string, a buffer or array of string|buffer,",
        `got ${JSON.stringify(options.record_delimiter)}`
      ],
      options
    );
  }
  options.record_delimiter = options.record_delimiter.map(function(rd, i) {
    if (typeof rd !== "string" && !Buffer.isBuffer(rd)) {
      throw new CsvError(
        "CSV_INVALID_OPTION_RECORD_DELIMITER",
        [
          "Invalid option `record_delimiter`:",
          "value must be a string, a buffer or array of string|buffer",
          `at index ${i},`,
          `got ${JSON.stringify(rd)}`
        ],
        options
      );
    } else if (rd.length === 0) {
      throw new CsvError(
        "CSV_INVALID_OPTION_RECORD_DELIMITER",
        [
          "Invalid option `record_delimiter`:",
          "value must be a non empty string or buffer",
          `at index ${i},`,
          `got ${JSON.stringify(rd)}`
        ],
        options
      );
    }
    if (typeof rd === "string") {
      rd = Buffer.from(rd, options.encoding);
    }
    return rd;
  });
  if (typeof options.relax_column_count === "boolean") {
  } else if (options.relax_column_count === void 0 || options.relax_column_count === null) {
    options.relax_column_count = false;
  } else {
    throw new Error(
      `Invalid Option: relax_column_count must be a boolean, got ${JSON.stringify(options.relax_column_count)}`
    );
  }
  if (typeof options.relax_column_count_less === "boolean") {
  } else if (options.relax_column_count_less === void 0 || options.relax_column_count_less === null) {
    options.relax_column_count_less = false;
  } else {
    throw new Error(
      `Invalid Option: relax_column_count_less must be a boolean, got ${JSON.stringify(options.relax_column_count_less)}`
    );
  }
  if (typeof options.relax_column_count_more === "boolean") {
  } else if (options.relax_column_count_more === void 0 || options.relax_column_count_more === null) {
    options.relax_column_count_more = false;
  } else {
    throw new Error(
      `Invalid Option: relax_column_count_more must be a boolean, got ${JSON.stringify(options.relax_column_count_more)}`
    );
  }
  if (typeof options.relax_quotes === "boolean") {
  } else if (options.relax_quotes === void 0 || options.relax_quotes === null) {
    options.relax_quotes = false;
  } else {
    throw new Error(
      `Invalid Option: relax_quotes must be a boolean, got ${JSON.stringify(options.relax_quotes)}`
    );
  }
  if (typeof options.skip_empty_lines === "boolean") {
  } else if (options.skip_empty_lines === void 0 || options.skip_empty_lines === null) {
    options.skip_empty_lines = false;
  } else {
    throw new Error(
      `Invalid Option: skip_empty_lines must be a boolean, got ${JSON.stringify(options.skip_empty_lines)}`
    );
  }
  if (typeof options.skip_records_with_empty_values === "boolean") {
  } else if (options.skip_records_with_empty_values === void 0 || options.skip_records_with_empty_values === null) {
    options.skip_records_with_empty_values = false;
  } else {
    throw new Error(
      `Invalid Option: skip_records_with_empty_values must be a boolean, got ${JSON.stringify(options.skip_records_with_empty_values)}`
    );
  }
  if (typeof options.skip_records_with_error === "boolean") {
  } else if (options.skip_records_with_error === void 0 || options.skip_records_with_error === null) {
    options.skip_records_with_error = false;
  } else {
    throw new Error(
      `Invalid Option: skip_records_with_error must be a boolean, got ${JSON.stringify(options.skip_records_with_error)}`
    );
  }
  if (options.rtrim === void 0 || options.rtrim === null || options.rtrim === false) {
    options.rtrim = false;
  } else if (options.rtrim !== true) {
    throw new Error(
      `Invalid Option: rtrim must be a boolean, got ${JSON.stringify(options.rtrim)}`
    );
  }
  if (options.ltrim === void 0 || options.ltrim === null || options.ltrim === false) {
    options.ltrim = false;
  } else if (options.ltrim !== true) {
    throw new Error(
      `Invalid Option: ltrim must be a boolean, got ${JSON.stringify(options.ltrim)}`
    );
  }
  if (options.trim === void 0 || options.trim === null || options.trim === false) {
    options.trim = false;
  } else if (options.trim !== true) {
    throw new Error(
      `Invalid Option: trim must be a boolean, got ${JSON.stringify(options.trim)}`
    );
  }
  if (options.trim === true && opts.ltrim !== false) {
    options.ltrim = true;
  } else if (options.ltrim !== true) {
    options.ltrim = false;
  }
  if (options.trim === true && opts.rtrim !== false) {
    options.rtrim = true;
  } else if (options.rtrim !== true) {
    options.rtrim = false;
  }
  if (options.to === void 0 || options.to === null) {
    options.to = -1;
  } else if (options.to !== -1) {
    if (typeof options.to === "string" && /\d+/.test(options.to)) {
      options.to = parseInt(options.to);
    }
    if (Number.isInteger(options.to)) {
      if (options.to <= 0) {
        throw new Error(
          `Invalid Option: to must be a positive integer greater than 0, got ${JSON.stringify(opts.to)}`
        );
      }
    } else {
      throw new Error(
        `Invalid Option: to must be an integer, got ${JSON.stringify(opts.to)}`
      );
    }
  }
  if (options.to_line === void 0 || options.to_line === null) {
    options.to_line = -1;
  } else if (options.to_line !== -1) {
    if (typeof options.to_line === "string" && /\d+/.test(options.to_line)) {
      options.to_line = parseInt(options.to_line);
    }
    if (Number.isInteger(options.to_line)) {
      if (options.to_line <= 0) {
        throw new Error(
          `Invalid Option: to_line must be a positive integer greater than 0, got ${JSON.stringify(opts.to_line)}`
        );
      }
    } else {
      throw new Error(
        `Invalid Option: to_line must be an integer, got ${JSON.stringify(opts.to_line)}`
      );
    }
  }
  return options;
};

// node_modules/csv-parse/lib/utils/delimiter_discover.js
var delimiter_discover = function(records, options) {
  if (!options) {
    ({ delimiter_auto: options } = normalize_options({ delimiter_auto: true }));
  }
  if (typeof records === "string") {
    records = Buffer.from(records);
  }
  if (Buffer.isBuffer(records)) {
    records = ((data) => {
      const records2 = [];
      const parser = transform({ delimiter: [] });
      const push = (record) => records2.push(record);
      const close = () => {
      };
      const error = parser.parse(data, true, push, close);
      if (error !== void 0) throw error;
      return records2;
    })(records);
  }
  const info = Array(127).fill().map(() => ({ lines: [] }));
  records.map(([record], line) => {
    for (let i = 0, l = record.length; i < l; i++) {
      const code = record.charCodeAt(i);
      if (info[code].lines[line] === void 0) info[code].lines[line] = 0;
      info[code].lines[line]++;
    }
  });
  info.map((info2, i) => {
    info2.char_code = i;
    info2.std = std(info2.lines);
    info2.total = info2.lines.reduce((acc, val) => acc + val, 0);
    info2.preferred = !!options.preferred[i];
    info2.score = options.score(info2, options);
  });
  const result2 = info.reduce(
    (acc, info2) => acc.score > info2.score ? acc : info2,
    {}
  );
  return String.fromCharCode(result2.char_code);
};
var std = function(array) {
  const n = array.length;
  if (n === 0) return 0;
  const mean = array.reduce((a, b) => a + b) / n;
  return Math.sqrt(
    array.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n
  );
};

// node_modules/csv-parse/lib/api/index.js
var isRecordEmpty = function(record) {
  return record.every(
    (field) => field == null || field.toString && field.toString().trim() === ""
  );
};
var cr = 13;
var nl = 10;
var boms = {
  // Note, the following are equals:
  // Buffer.from("\ufeff")
  // Buffer.from([239, 187, 191])
  // Buffer.from('EFBBBF', 'hex')
  utf8: Buffer.from([239, 187, 191]),
  // Note, the following are equals:
  // Buffer.from "\ufeff", 'utf16le
  // Buffer.from([255, 254])
  utf16le: Buffer.from([255, 254])
};
var transform = function(original_options = {}) {
  const info = {
    bytes: 0,
    bytes_records: 0,
    comment_lines: 0,
    empty_lines: 0,
    invalid_field_length: 0,
    lines: 1,
    records: 0
  };
  const options = normalize_options(original_options);
  return {
    info,
    original_options,
    options,
    state: init_state(options),
    __needMoreData: function(i, bufLen, end) {
      if (end) return false;
      const { encoding, escape, quote } = this.options;
      const { quoting, needMoreDataSize, recordDelimiterMaxLength } = this.state;
      const numOfCharLeft = bufLen - i - 1;
      const requiredLength = Math.max(
        needMoreDataSize,
        // Skip if the remaining buffer smaller than record delimiter
        // If "record_delimiter" is yet to be discovered:
        // 1. It is equals to `[]` and "recordDelimiterMaxLength" equals `0`
        // 2. We set the length to windows line ending in the current encoding
        // Note, that encoding is known from user or bom discovery at that point
        // recordDelimiterMaxLength,
        recordDelimiterMaxLength === 0 ? Buffer.from("\r\n", encoding).length : recordDelimiterMaxLength,
        // Skip if remaining buffer can be an escaped quote
        quoting ? (escape === null ? 0 : escape.length) + quote.length : 0,
        // Skip if remaining buffer can be record delimiter following the closing quote
        quoting ? quote.length + recordDelimiterMaxLength : 0
      );
      return numOfCharLeft < requiredLength;
    },
    // Central parser implementation
    parse: function(nextBuf, end, push, close) {
      const {
        bom,
        comment_no_infix,
        delimiter_auto,
        encoding,
        from_line,
        ltrim,
        max_record_size,
        raw,
        relax_quotes,
        rtrim,
        skip_empty_lines,
        to,
        to_line
      } = this.options;
      let { comment, escape, quote, record_delimiter } = this.options;
      const {
        bomSkipped,
        delimiterDiscovered,
        delimiterBufPrevious,
        rawBuffer,
        escapeIsQuote
      } = this.state;
      if (!delimiterDiscovered && delimiter_auto) {
        let delimiterBuf;
        if (delimiterBufPrevious === void 0) {
          delimiterBuf = nextBuf;
        } else if (delimiterBufPrevious !== void 0 && nextBuf === void 0) {
          delimiterBuf = delimiterBufPrevious;
        } else {
          delimiterBuf = Buffer.concat([delimiterBufPrevious, nextBuf]);
        }
        nextBuf = void 0;
        if (end || delimiterBuf.length > delimiter_auto.size) {
          this.options.delimiter = [
            Buffer.from(
              delimiter_discover(delimiterBuf, this.options.delimiter_auto)
            )
          ];
          this.state.previousBuf = delimiterBuf;
          this.state.delimiterBufPrevious = void 0;
          this.state.delimiterDiscovered = true;
        } else {
          this.state.delimiterBufPrevious = delimiterBuf;
          return;
        }
      }
      const { previousBuf } = this.state;
      let buf;
      if (previousBuf === void 0) {
        if (nextBuf === void 0) {
          close();
          return;
        } else {
          buf = nextBuf;
        }
      } else if (previousBuf !== void 0 && nextBuf === void 0) {
        buf = previousBuf;
      } else {
        buf = Buffer.concat([previousBuf, nextBuf]);
      }
      if (bomSkipped === false) {
        if (bom === false) {
          this.state.bomSkipped = true;
        } else if (buf.length < 3) {
          if (end === false) {
            this.state.previousBuf = buf;
            return;
          }
        } else {
          for (const encoding2 in boms) {
            if (boms[encoding2].compare(buf, 0, boms[encoding2].length) === 0) {
              const bomLength = boms[encoding2].length;
              this.state.bufBytesStart += bomLength;
              buf = buf.slice(bomLength);
              const options2 = normalize_options({
                ...this.original_options,
                encoding: encoding2
              });
              for (const key in options2) {
                this.options[key] = options2[key];
              }
              ({ comment, escape, quote } = this.options);
              break;
            }
          }
          this.state.bomSkipped = true;
        }
      }
      const bufLen = buf.length;
      let pos;
      for (pos = 0; pos < bufLen; pos++) {
        if (this.__needMoreData(pos, bufLen, end)) {
          break;
        }
        if (this.state.wasRowDelimiter === true) {
          this.info.lines++;
          this.state.wasRowDelimiter = false;
        }
        if (to_line !== -1 && this.info.lines > to_line) {
          this.state.stop = true;
          close();
          return;
        }
        if (this.state.quoting === false && record_delimiter.length === 0) {
          const record_delimiterCount = this.__autoDiscoverRecordDelimiter(
            buf,
            pos
          );
          if (record_delimiterCount) {
            record_delimiter = this.options.record_delimiter;
          }
        }
        const chr = buf[pos];
        if (raw === true) {
          rawBuffer.append(chr);
        }
        if ((chr === cr || chr === nl) && this.state.wasRowDelimiter === false) {
          this.state.wasRowDelimiter = true;
        }
        if (this.state.escaping === true) {
          this.state.escaping = false;
        } else {
          if (escape !== null && this.state.quoting === true && this.__isEscape(buf, pos, chr) && pos + escape.length < bufLen) {
            if (escapeIsQuote) {
              if (this.__isQuote(buf, pos + escape.length)) {
                this.state.escaping = true;
                pos += escape.length - 1;
                continue;
              }
            } else {
              this.state.escaping = true;
              pos += escape.length - 1;
              continue;
            }
          }
          if (this.state.commenting === false && this.__isQuote(buf, pos)) {
            if (this.state.quoting === true) {
              const nextChr = buf[pos + quote.length];
              const isNextChrTrimable = rtrim && this.__isCharTrimable(buf, pos + quote.length);
              const isNextChrComment = comment !== null && this.__compareBytes(comment, buf, pos + quote.length, nextChr);
              const isNextChrDelimiter = this.__isDelimiter(
                buf,
                pos + quote.length,
                nextChr
              );
              const isNextChrRecordDelimiter = record_delimiter.length === 0 ? this.__autoDiscoverRecordDelimiter(buf, pos + quote.length) : this.__isRecordDelimiter(nextChr, buf, pos + quote.length);
              if (escape !== null && this.__isEscape(buf, pos, chr) && this.__isQuote(buf, pos + escape.length)) {
                pos += escape.length - 1;
              } else if (!nextChr || isNextChrDelimiter || isNextChrRecordDelimiter || isNextChrComment || isNextChrTrimable) {
                this.state.quoting = false;
                this.state.wasQuoting = true;
                pos += quote.length - 1;
                continue;
              } else if (relax_quotes === false) {
                const err = this.__error(
                  new CsvError(
                    "CSV_INVALID_CLOSING_QUOTE",
                    [
                      "Invalid Closing Quote:",
                      `got "${String.fromCharCode(nextChr)}"`,
                      `at line ${this.info.lines}`,
                      "instead of delimiter, record delimiter, trimable character",
                      "(if activated) or comment"
                    ],
                    this.options,
                    this.__infoField()
                  )
                );
                if (err !== void 0) return err;
              } else {
                this.state.quoting = false;
                this.state.wasQuoting = true;
                this.state.field.prepend(quote);
                pos += quote.length - 1;
              }
            } else {
              if (this.state.field.length !== 0) {
                if (relax_quotes === false) {
                  const info2 = this.__infoField();
                  const bom2 = Object.keys(boms).map(
                    (b) => boms[b].equals(this.state.field.toString()) ? b : false
                  ).filter(Boolean)[0];
                  const err = this.__error(
                    new CsvError(
                      "INVALID_OPENING_QUOTE",
                      [
                        "Invalid Opening Quote:",
                        `a quote is found on field ${JSON.stringify(info2.column)} at line ${info2.lines}, value is ${JSON.stringify(this.state.field.toString(encoding))}`,
                        bom2 ? `(${bom2} bom)` : void 0
                      ],
                      this.options,
                      info2,
                      {
                        field: this.state.field
                      }
                    )
                  );
                  if (err !== void 0) return err;
                }
              } else {
                this.state.quoting = true;
                pos += quote.length - 1;
                continue;
              }
            }
          }
          if (this.state.quoting === false) {
            const recordDelimiterLength = this.__isRecordDelimiter(
              chr,
              buf,
              pos
            );
            if (recordDelimiterLength !== 0) {
              const skipCommentLine = this.state.commenting && this.state.wasQuoting === false && this.state.record.length === 0 && this.state.field.length === 0;
              if (skipCommentLine) {
                this.info.comment_lines++;
              } else {
                if (this.state.enabled === false && this.info.lines + (this.state.wasRowDelimiter === true ? 1 : 0) >= from_line) {
                  this.state.enabled = true;
                  this.__resetField();
                  this.__resetRecord();
                  pos += recordDelimiterLength - 1;
                  continue;
                }
                if (skip_empty_lines === true && this.state.wasQuoting === false && this.state.record.length === 0 && this.state.field.length === 0) {
                  this.info.empty_lines++;
                  pos += recordDelimiterLength - 1;
                  continue;
                }
                this.info.bytes = this.state.bufBytesStart + pos;
                const errField = this.__onField();
                if (errField !== void 0) return errField;
                this.info.bytes = this.state.bufBytesStart + pos + recordDelimiterLength;
                const errRecord = this.__onRecord(push);
                if (errRecord !== void 0) return errRecord;
                if (to !== -1 && this.info.records >= to) {
                  this.state.stop = true;
                  close();
                  return;
                }
              }
              this.state.commenting = false;
              pos += recordDelimiterLength - 1;
              continue;
            }
            if (this.state.commenting) {
              continue;
            }
            if (comment !== null && (comment_no_infix === false || this.state.record.length === 0 && this.state.field.length === 0)) {
              const commentCount = this.__compareBytes(comment, buf, pos, chr);
              if (commentCount !== 0) {
                this.state.commenting = true;
                continue;
              }
            }
            const delimiterLength = this.__isDelimiter(buf, pos, chr);
            if (delimiterLength !== 0) {
              this.info.bytes = this.state.bufBytesStart + pos;
              const errField = this.__onField();
              if (errField !== void 0) return errField;
              pos += delimiterLength - 1;
              continue;
            }
          }
        }
        if (this.state.commenting === false) {
          if (max_record_size !== 0 && this.state.record_length + this.state.field.length > max_record_size) {
            return this.__error(
              new CsvError(
                "CSV_MAX_RECORD_SIZE",
                [
                  "Max Record Size:",
                  "record exceed the maximum number of tolerated bytes",
                  `of ${max_record_size}`,
                  `at line ${this.info.lines}`
                ],
                this.options,
                this.__infoField()
              )
            );
          }
        }
        const lappend = ltrim === false || this.state.quoting === true || this.state.field.length !== 0 || !this.__isCharTrimable(buf, pos);
        const rappend = rtrim === false || this.state.wasQuoting === false;
        if (lappend === true && rappend === true) {
          this.state.field.append(chr);
        } else if (rtrim === true && !this.__isCharTrimable(buf, pos)) {
          return this.__error(
            new CsvError(
              "CSV_NON_TRIMABLE_CHAR_AFTER_CLOSING_QUOTE",
              [
                "Invalid Closing Quote:",
                "found non trimable byte after quote",
                `at line ${this.info.lines}`
              ],
              this.options,
              this.__infoField()
            )
          );
        } else {
          if (lappend === false) {
            pos += this.__isCharTrimable(buf, pos) - 1;
          }
          continue;
        }
      }
      if (end === true) {
        if (this.state.quoting === true) {
          const err = this.__error(
            new CsvError(
              "CSV_QUOTE_NOT_CLOSED",
              [
                "Quote Not Closed:",
                `the parsing is finished with an opening quote at line ${this.info.lines}`
              ],
              this.options,
              this.__infoField()
            )
          );
          if (err !== void 0) return err;
        } else {
          if (this.state.wasQuoting === true || this.state.record.length !== 0 || this.state.field.length !== 0) {
            this.info.bytes = this.state.bufBytesStart + pos;
            const errField = this.__onField();
            if (errField !== void 0) return errField;
            const errRecord = this.__onRecord(push);
            if (errRecord !== void 0) return errRecord;
          } else if (this.state.wasRowDelimiter === true) {
            this.info.empty_lines++;
          } else if (this.state.commenting === true) {
            this.info.comment_lines++;
          }
        }
      } else {
        this.state.bufBytesStart += pos;
        this.state.previousBuf = buf.slice(pos);
      }
      if (this.state.wasRowDelimiter === true) {
        this.info.lines++;
        this.state.wasRowDelimiter = false;
      }
    },
    __onRecord: function(push) {
      const {
        columns,
        group_columns_by_name,
        encoding,
        info: info2,
        from,
        relax_column_count,
        relax_column_count_less,
        relax_column_count_more,
        raw,
        skip_records_with_empty_values
      } = this.options;
      const { enabled, record } = this.state;
      if (enabled === false) {
        return this.__resetRecord();
      }
      const recordLength = record.length;
      if (columns === true) {
        if (skip_records_with_empty_values === true && isRecordEmpty(record)) {
          this.__resetRecord();
          return;
        }
        return this.__firstLineToColumns(record);
      }
      if (columns === false && this.info.records === 0) {
        this.state.expectedRecordLength = recordLength;
      }
      if (recordLength !== this.state.expectedRecordLength) {
        const err = columns === false ? new CsvError(
          "CSV_RECORD_INCONSISTENT_FIELDS_LENGTH",
          [
            "Invalid Record Length:",
            `expect ${this.state.expectedRecordLength},`,
            `got ${recordLength} on line ${this.info.lines}`
          ],
          this.options,
          this.__infoField(),
          {
            record
          }
        ) : new CsvError(
          "CSV_RECORD_INCONSISTENT_COLUMNS",
          [
            "Invalid Record Length:",
            `columns length is ${columns.length},`,
            // rename columns
            `got ${recordLength} on line ${this.info.lines}`
          ],
          this.options,
          this.__infoField(),
          {
            record
          }
        );
        if (relax_column_count === true || relax_column_count_less === true && recordLength < this.state.expectedRecordLength || relax_column_count_more === true && recordLength > this.state.expectedRecordLength) {
          this.info.invalid_field_length++;
          this.state.error = err;
        } else {
          const finalErr = this.__error(err);
          if (finalErr) return finalErr;
        }
      }
      if (skip_records_with_empty_values === true && isRecordEmpty(record)) {
        this.__resetRecord();
        return;
      }
      if (this.state.recordHasError === true) {
        this.__resetRecord();
        this.state.recordHasError = false;
        return;
      }
      this.info.records++;
      if (from === 1 || this.info.records >= from) {
        const { objname } = this.options;
        if (columns !== false) {
          const obj = {};
          for (let i = 0, l = record.length; i < l; i++) {
            if (columns[i] === void 0 || columns[i].disabled) continue;
            if (group_columns_by_name === true && Object.hasOwn(obj, columns[i].name)) {
              if (Array.isArray(obj[columns[i].name])) {
                obj[columns[i].name] = obj[columns[i].name].concat(record[i]);
              } else {
                obj[columns[i].name] = [obj[columns[i].name], record[i]];
              }
            } else {
              Object.defineProperty(obj, columns[i].name, {
                value: record[i],
                enumerable: true,
                writable: true,
                configurable: true
              });
            }
          }
          if (raw === true || info2 === true) {
            const extRecord = Object.assign(
              { record: obj },
              raw === true ? { raw: this.state.rawBuffer.toString(encoding) } : {},
              info2 === true ? { info: this.__infoRecord() } : {}
            );
            const err = this.__push(
              objname === void 0 ? extRecord : [obj[objname], extRecord],
              push
            );
            if (err) {
              return err;
            }
          } else {
            const err = this.__push(
              objname === void 0 ? obj : [obj[objname], obj],
              push
            );
            if (err) {
              return err;
            }
          }
        } else {
          if (raw === true || info2 === true) {
            const extRecord = Object.assign(
              { record },
              raw === true ? { raw: this.state.rawBuffer.toString(encoding) } : {},
              info2 === true ? { info: this.__infoRecord() } : {}
            );
            const err = this.__push(
              objname === void 0 ? extRecord : [record[objname], extRecord],
              push
            );
            if (err) {
              return err;
            }
          } else {
            const err = this.__push(
              objname === void 0 ? record : [record[objname], record],
              push
            );
            if (err) {
              return err;
            }
          }
        }
      }
      this.__resetRecord();
    },
    __firstLineToColumns: function(record) {
      const { firstLineToHeaders } = this.state;
      try {
        const headers = firstLineToHeaders === void 0 ? record : firstLineToHeaders.call(null, record);
        if (!Array.isArray(headers)) {
          return this.__error(
            new CsvError(
              "CSV_INVALID_COLUMN_MAPPING",
              [
                "Invalid Column Mapping:",
                "expect an array from column function,",
                `got ${JSON.stringify(headers)}`
              ],
              this.options,
              this.__infoField(),
              {
                headers
              }
            )
          );
        }
        const normalizedHeaders = normalize_columns_array(headers);
        this.state.expectedRecordLength = normalizedHeaders.length;
        this.options.columns = normalizedHeaders;
        this.__resetRecord();
        return;
      } catch (err) {
        return err;
      }
    },
    __resetRecord: function() {
      if (this.options.raw === true) {
        this.state.rawBuffer.reset();
      }
      this.state.error = void 0;
      this.state.record = [];
      this.state.record_length = 0;
    },
    __onField: function() {
      const { cast, encoding, rtrim, max_record_size } = this.options;
      const { enabled, wasQuoting } = this.state;
      if (enabled === false) {
        return this.__resetField();
      }
      let field = this.state.field.toString(encoding);
      if (rtrim === true && wasQuoting === false) {
        field = field.trimRight();
      }
      if (cast === true) {
        const [err, f] = this.__cast(field);
        if (err !== void 0) return err;
        field = f;
      }
      this.state.record.push(field);
      if (max_record_size !== 0 && typeof field === "string") {
        this.state.record_length += field.length;
      }
      this.__resetField();
    },
    __resetField: function() {
      this.state.field.reset();
      this.state.wasQuoting = false;
    },
    __push: function(record, push) {
      const { on_record } = this.options;
      if (on_record !== void 0) {
        const info2 = this.__infoRecord();
        try {
          record = on_record.call(null, record, info2);
        } catch (err) {
          return err;
        }
        if (record === void 0 || record === null) {
          return;
        }
      }
      this.info.bytes_records += this.info.bytes;
      push(record);
    },
    // Return a tuple with the error and the casted value
    __cast: function(field) {
      const { columns, relax_column_count } = this.options;
      const isColumns = Array.isArray(columns);
      if (isColumns === true && relax_column_count && this.options.columns.length <= this.state.record.length) {
        return [void 0, void 0];
      }
      if (this.state.castField !== null) {
        try {
          const info2 = this.__infoField();
          return [void 0, this.state.castField.call(null, field, info2)];
        } catch (err) {
          return [err];
        }
      }
      if (this.__isFloat(field)) {
        return [void 0, parseFloat(field)];
      } else if (this.options.cast_date !== false) {
        const info2 = this.__infoField();
        return [void 0, this.options.cast_date.call(null, field, info2)];
      }
      return [void 0, field];
    },
    __compareBytes: function(sourceBuf, targetBuf, targetPos, firstByte) {
      if (sourceBuf[0] !== firstByte) return 0;
      const sourceLength = sourceBuf.length;
      for (let i = 1; i < sourceLength; i++) {
        if (sourceBuf[i] !== targetBuf[targetPos + i]) return 0;
      }
      return sourceLength;
    },
    // Helper to test if a character is trimable
    __isCharTrimable: function(buf, pos) {
      const { timchars, timcharFirstBytes } = this.state;
      const first = buf[pos];
      if (first === void 0 || timcharFirstBytes[first] === 0) return 0;
      loop1: for (let i = 0; i < timchars.length; i++) {
        const timchar = timchars[i];
        for (let j = 0; j < timchar.length; j++) {
          if (timchar[j] !== buf[pos + j]) continue loop1;
        }
        return timchar.length;
      }
      return 0;
    },
    __isDelimiter: function(buf, pos, chr) {
      const { delimiter, ignore_last_delimiters } = this.options;
      if (ignore_last_delimiters === true && this.state.record.length === this.options.columns.length - 1) {
        return 0;
      } else if (ignore_last_delimiters !== false && typeof ignore_last_delimiters === "number" && this.state.record.length === ignore_last_delimiters - 1) {
        return 0;
      }
      loop1: for (let i = 0; i < delimiter.length; i++) {
        const del = delimiter[i];
        if (del[0] === chr) {
          for (let j = 1; j < del.length; j++) {
            if (del[j] !== buf[pos + j]) continue loop1;
          }
          return del.length;
        }
      }
      return 0;
    },
    __isEscape: function(buf, pos, chr) {
      const { escape } = this.options;
      if (escape === null) return false;
      const l = escape.length;
      if (escape[0] === chr) {
        for (let i = 0; i < l; i++) {
          if (escape[i] !== buf[pos + i]) {
            return false;
          }
        }
        return true;
      }
      return false;
    },
    __isFloat: function(value) {
      return value - parseFloat(value) + 1 >= 0;
    },
    // Keep it in case we implement the `cast_int` option
    // __isInt(value){
    //   // return Number.isInteger(parseInt(value))
    //   // return !isNaN( parseInt( obj ) );
    //   return /^(\-|\+)?[1-9][0-9]*$/.test(value)
    // }
    __isQuote: function(buf, pos) {
      const { quote } = this.options;
      if (quote === null) return false;
      const l = quote.length;
      for (let i = 0; i < l; i++) {
        if (quote[i] !== buf[pos + i]) {
          return false;
        }
      }
      return true;
    },
    __isRecordDelimiter: function(chr, buf, pos) {
      const { record_delimiter } = this.options;
      const recordDelimiterLength = record_delimiter.length;
      loop1: for (let i = 0; i < recordDelimiterLength; i++) {
        const rd = record_delimiter[i];
        const rdLength = rd.length;
        if (rd[0] !== chr) {
          continue;
        }
        for (let j = 1; j < rdLength; j++) {
          if (rd[j] !== buf[pos + j]) {
            continue loop1;
          }
        }
        return rd.length;
      }
      return 0;
    },
    __autoDiscoverRecordDelimiter: function(buf, pos) {
      const { encoding } = this.options;
      const rds = [
        // Important, the windows line ending must be before mac os 9
        Buffer.from("\r\n", encoding),
        Buffer.from("\n", encoding),
        Buffer.from("\r", encoding)
      ];
      loop: for (let i = 0; i < rds.length; i++) {
        const l = rds[i].length;
        for (let j = 0; j < l; j++) {
          if (rds[i][j] !== buf[pos + j]) {
            continue loop;
          }
        }
        this.options.record_delimiter.push(rds[i]);
        this.state.recordDelimiterMaxLength = rds[i].length;
        return rds[i].length;
      }
      return 0;
    },
    __error: function(msg) {
      const { encoding, raw, skip_records_with_error } = this.options;
      const err = typeof msg === "string" ? new Error(msg) : msg;
      if (skip_records_with_error) {
        this.state.recordHasError = true;
        if (this.options.on_skip !== void 0) {
          try {
            this.options.on_skip(
              err,
              raw ? this.state.rawBuffer.toString(encoding) : void 0
            );
          } catch (err2) {
            return err2;
          }
        }
        return void 0;
      } else {
        return err;
      }
    },
    __infoDataSet: function() {
      return {
        ...this.info,
        columns: this.options.columns
      };
    },
    __infoRecord: function() {
      const { columns, raw, encoding } = this.options;
      return {
        ...this.__infoDataSet(),
        bytes_records: this.info.bytes,
        error: this.state.error,
        header: columns === true,
        index: this.state.record.length,
        raw: raw ? this.state.rawBuffer.toString(encoding) : void 0
      };
    },
    __infoField: function() {
      const { columns } = this.options;
      const isColumns = Array.isArray(columns);
      const bytes_records = this.info.bytes_records;
      return {
        ...this.__infoRecord(),
        bytes_records,
        column: isColumns === true ? columns.length > this.state.record.length ? columns[this.state.record.length].name : null : this.state.record.length,
        quoting: this.state.wasQuoting
      };
    }
  };
};

// node_modules/csv-parse/lib/sync.js
var parse = function(data, opts = {}) {
  if (typeof data === "string") {
    data = Buffer.from(data);
  }
  const records = opts && opts.objname ? /* @__PURE__ */ Object.create(null) : [];
  const parser = transform(opts);
  const push = (record) => {
    if (parser.options.objname === void 0) records.push(record);
    else {
      records[record[0]] = record[1];
    }
  };
  const close = () => {
  };
  const error = parser.parse(data, true, push, close);
  if (error !== void 0) throw error;
  return records;
};

// src/connectors/ons.ts
async function ingestOns(t, start, end) {
  const catalog = JSON.parse(
    (await t.get(
      "ons-catalog.json",
      "https://dados.ons.org.br/api/3/action/package_show?id=dados-hidrologicos-res"
    )).body
  );
  if (!catalog.success || !Array.isArray(catalog.result?.resources))
    throw Error("Cat\xE1logo ONS inv\xE1lido");
  const years = Array.from(
    { length: Number(end.slice(0, 4)) - Number(start.slice(0, 4)) + 1 },
    (_, i) => Number(start.slice(0, 4)) + i
  );
  const results = [];
  for (const year of years) {
    const resource = catalog.result.resources.find(
      (r) => r.name.includes(String(year)) && r.format.toUpperCase() === "CSV"
    );
    if (!resource || typeof resource.url !== "string" || !resource.url.startsWith("https://"))
      throw Error(`CSV ONS ${year} no disponible`);
    const { body, record } = await t.get(`ons-${year}.csv`, resource.url);
    const rows3 = parse(body, {
      columns: true,
      delimiter: ";",
      bom: true,
      skip_empty_lines: true
    });
    for (const r of rows3) {
      if (!r.din_instante || !r.nom_reservatorio)
        throw Error("Columnas ONS ausentes");
      if (r.din_instante < start || r.din_instante >= end || !r.nom_reservatorio.toUpperCase().includes("ITAIPU"))
        continue;
      results.push({
        dam_id: r.id_reservatorio,
        dam_name: r.nom_reservatorio,
        date: r.din_instante,
        temporal_resolution: "daily",
        inflow_m3_s: numberOrNull(r.val_vazaoafluente),
        outflow_m3_s: numberOrNull(r.val_vazaodefluente),
        turbined_m3_s: numberOrNull(r.val_vazaoturbinada),
        spilled_m3_s: numberOrNull(r.val_vazaovertida),
        reservoir_level_m: numberOrNull(r.val_nivelmontante),
        kind: "observation",
        quality: "ONS_verified_daily;not_gate_operation_time",
        source: resource.url,
        published_at: null,
        ingested_at: record.ingested_at,
        raw_file: record.path
      });
    }
  }
  const unique = /* @__PURE__ */ new Map();
  for (const r of results) {
    const key = r.dam_id + "|" + r.date;
    if (unique.has(key)) throw Error("Duplicado ONS");
    unique.set(key, r);
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// src/storage.ts
import { readFile as readFile2, writeFile as writeFile2, mkdir as mkdir2, rename, rm } from "node:fs/promises";
import { createHash as createHash2 } from "node:crypto";
function csv(records, headers) {
  const rows3 = records;
  return [
    headers,
    ...rows3.map(
      (r) => headers.map(
        (h) => r[h] == null ? "" : typeof r[h] === "object" ? JSON.stringify(r[h]) : String(r[h])
      )
    )
  ].map(
    (row) => row.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(",")
  ).join("\n") + "\n";
}
async function publishSnapshot(dataset2, report2, manifest, sources, base2 = "data") {
  const body = JSON.stringify(dataset2);
  const files = {
    stations: {
      rows: dataset2.stations,
      headers: [
        "id",
        "name",
        "river",
        "country",
        "region",
        "longitude",
        "latitude",
        "external_id",
        "source",
        "gauge_zero",
        "alert",
        "evacuation"
      ]
    },
    water_levels: {
      rows: dataset2.measurements,
      headers: [
        "station_id",
        "series_id",
        "observed_at",
        "value",
        "unit",
        "kind",
        "source",
        "source_updated_at",
        "published_at",
        "ingested_at",
        "quality",
        "raw_file",
        "trend_m_per_day",
        "status"
      ]
    },
    discharges: {
      rows: dataset2.discharges,
      headers: [
        "dam_id",
        "dam_name",
        "date",
        "temporal_resolution",
        "inflow_m3_s",
        "outflow_m3_s",
        "turbined_m3_s",
        "spilled_m3_s",
        "reservoir_level_m",
        "kind",
        "quality",
        "source",
        "published_at",
        "ingested_at",
        "raw_file"
      ]
    },
    dam_events: {
      rows: dataset2.events,
      headers: [
        "dam_id",
        "event_at",
        "operation",
        "official_statement_url",
        "confidence"
      ]
    },
    thresholds: {
      rows: dataset2.stations.flatMap(
        (s) => [
          { type: "alert", value: s.alert },
          { type: "evacuation", value: s.evacuation }
        ].filter((x) => x.value !== null).map((x) => ({
          station_id: s.id,
          ...x,
          unit: "m",
          valid_from: null,
          valid_to: null,
          source: s.source,
          quality: "validity_period_unknown"
        }))
      ),
      headers: [
        "station_id",
        "type",
        "value",
        "unit",
        "valid_from",
        "valid_to",
        "source",
        "quality"
      ]
    }
  };
  const contents = {
    "processed/dataset.json": body,
    "processed/report.json": JSON.stringify(report2, null, 2),
    "processed/manifest.json": JSON.stringify(manifest, null, 2),
    "exports/sources.csv": sources
  };
  for (const [name, { rows: rows3, headers }] of Object.entries(files))
    contents[`exports/${name}.csv`] = csv(rows3, headers);
  if (Object.values(contents).some((v) => typeof v !== "string"))
    throw Error("Contenido de snapshot inv\xE1lido");
  const id = createHash2("sha256").update(JSON.stringify(contents)).digest("hex").slice(0, 16);
  const root = `${base2}/snapshots/${id}`, staging = `${base2}/snapshots/.stage-${id}-${process.pid}`;
  await mkdir2(`${staging}/processed`, { recursive: true });
  await mkdir2(`${staging}/exports`, { recursive: true });
  try {
    for (const [path, content] of Object.entries(contents))
      await writeFile2(`${staging}/${path}`, content);
    try {
      await rename(staging, root);
    } catch (e) {
      if (!["EEXIST", "ENOTEMPTY"].includes(
        e.code ?? ""
      ))
        throw e;
      for (const [path, content] of Object.entries(contents))
        if (await readFile2(`${root}/${path}`, "utf8") !== content)
          throw Error("Snapshot existente alterado");
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  await writeFile2(
    `${base2}/current.json.tmp`,
    JSON.stringify({ version: 1, root, id }, null, 2)
  );
  await rename(`${base2}/current.json.tmp`, `${base2}/current.json`);
  return root;
}
async function lockIngest(base2 = "data") {
  await mkdir2(base2, { recursive: true });
  try {
    await mkdir2(`${base2}/.ingest-lock`);
  } catch (e) {
    if (e.code === "EEXIST")
      throw Error(
        `Otra ingesta est\xE1 activa o qued\xF3 un lock tras interrupci\xF3n. Verific\xE1 los procesos antes de eliminar ${base2}/.ingest-lock.`
      );
    throw e;
  }
  return async () => rm(`${base2}/.ingest-lock`, { recursive: true, force: true });
}

// src/publication.ts
function publicationDataset(d, options = {}) {
  const includeIna = options.includeIna === true || d.metadata.distribution_mode === "public_observations";
  const inaStations = includeIna && d.metadata.distribution_mode !== "browser_import" ? d.stations.filter(
    (station2) => stations_default.some(
      (entry) => station2.id === `ina:${entry.series_id}` && station2.name === entry.name
    ) && station2.source === "https://alerta.ina.gob.ar/a5"
  ) : [];
  const inaIds = new Set(inaStations.map((s) => s.id));
  const inaMeasurements = d.measurements.filter((m) => {
    if (!inaIds.has(m.station_id) || m.kind !== "observation" || m.unit !== "m" || !m.quality.includes("source_quality_unverified"))
      return false;
    if (m.station_id === "ina:34" && inaStations.some((s) => s.id === "ina:34" && s.external_id === "280") && m.series_id === "34" && m.source === PNA_CURRENT && m.quality.includes("pna_port_id_matches_ina_external_id"))
      return true;
    if (m.series_id !== m.station_id.slice(4)) return false;
    try {
      const url = new URL(m.source);
      return !url.username && !url.password && url.protocol === "https:" && url.hostname === "alerta.ina.gob.ar" && url.pathname === `/a5/obs/puntual/series/${m.series_id}/observaciones`;
    } catch {
      return false;
    }
  }).map((m) => ({
    ...m,
    raw_file: "Original INA/PNA preservado por ingesta; consultar source",
    quality: [
      .../* @__PURE__ */ new Set([
        ...m.quality,
        "public_factual_data_user_authorized",
        "specific_redistribution_license_unconfirmed"
      ])
    ]
  }));
  const station = {
    id: "ons:itaipu-reservoir",
    name: "Itaip\xFA \xB7 nivel de embalse",
    river: "Embalse de Itaip\xFA \xB7 datum del proveedor",
    country: "Brasil / Paraguay",
    region: null,
    longitude: null,
    latitude: null,
    external_id: "ITAIPU",
    source: "https://dados.ons.org.br/dataset/dados-hidrologicos-res",
    gauge_zero: null,
    alert: null,
    evacuation: null
  };
  const discharges = d.discharges.filter(
    (x) => x.source.startsWith(
      "https://ons-aws-prod-opendata.s3.amazonaws.com/"
    ) && x.dam_name.includes("ITAIPU")
  ).map((x) => ({ ...x, raw_file: "Original ONS enlazado en source" }));
  const onsMeasurements = discharges.filter((x) => x.reservoir_level_m !== null).map((x) => ({
    station_id: station.id,
    series_id: "ons-daily-reservoir-level",
    observed_at: x.date + "T00:00:00.000Z",
    value: x.reservoir_level_m,
    unit: "m",
    kind: "observation",
    source: x.source,
    source_updated_at: null,
    published_at: null,
    ingested_at: x.ingested_at,
    quality: [
      "ONS_verified_daily",
      "daily_date_no_observation_time",
      "reservoir_datum_unverified",
      "no_alert_threshold"
    ],
    raw_file: "Original ONS enlazado en source",
    trend_m_per_day: null,
    status: "umbral desconocido"
  }));
  const snihStation = d.stations.find(
    (s) => s.id === "snih:13311" && s.external_id === "13311" && s.source === "https://snih.hidricosargentina.gob.ar/Filtros.aspx"
  );
  const snihMeasurements = snihStation ? d.measurements.filter(
    (m) => m.station_id === snihStation.id && m.series_id === "snih-rhn-height-1-at-03utc" && m.source === "https://snih.hidricosargentina.gob.ar/MuestraDatos.aspx/LeerUltimosRegistros" && m.kind === "observation" && m.unit === "m" && m.quality.includes("SNIH_telemetry_unvalidated") && m.observed_at.slice(11) === "03:00:00.000Z"
  ).map((m) => ({
    ...m,
    raw_file: "Original SNIH preservado por ingesta; consultar fuente",
    status: "umbral desconocido"
  })) : [];
  const measurements = [
    ...inaMeasurements,
    ...snihMeasurements,
    ...onsMeasurements
  ].toSorted((a, b) => a.observed_at.localeCompare(b.observed_at));
  if (!onsMeasurements.length)
    throw Error(
      "No hay niveles ONS con licencia identificada para el build alojado."
    );
  return {
    stations: [
      ...inaStations,
      ...snihStation && snihMeasurements.length ? [
        {
          ...snihStation,
          name: inaStations.length ? "Rosario \xB7 RHN/SNIH (serie independiente)" : snihStation.name,
          gauge_zero: null,
          alert: null,
          evacuation: null
        }
      ] : [],
      station
    ],
    measurements,
    discharges,
    events: [],
    metadata: {
      start: measurements[0].observed_at.slice(0, 10),
      end: measurements.at(-1).observed_at.slice(0, 10),
      generated_at: d.metadata.generated_at,
      date_basis: "INA/PNA: timestamp original; \xFAltima lectura directa PNA Rosario en hora civil argentina convertida a UTC. SNIH: medici\xF3n real a 03:00 UTC (00:00 Argentina), sin promediar ni interpolar. ONS: fecha diaria; 00:00 UTC es normalizaci\xF3n t\xE9cnica, no hora observada.",
      license_notice: (inaStations.length ? "INA/PNA: observaciones factuales de acceso p\xFAblico publicadas por autorizaci\xF3n expresa del responsable de PULSO, con atribuci\xF3n; licencia espec\xEDfica de redistribuci\xF3n no confirmada. " : "") + "SNIH/RHN \xB7 Secretar\xEDa de Infraestructura y Pol\xEDtica H\xEDdrica: reutilizaci\xF3n seg\xFAn sus t\xE9rminos, telemetr\xEDa sin validar; actualizaci\xF3n de origen no informada, fecha de extracci\xF3n en generated_at. Referencia portuaria: IGN/PNA, libre uso con cita IGN, vigencia y equivalencia de escala sin confirmar. ONS \xB7 Creative Commons Atribui\xE7\xE3o. Natural Earth \xB7 dominio p\xFAblico. Los archivos importados por usuarios permanecen privados.",
      distribution_mode: inaStations.length ? "public_observations" : "licensed_public"
    }
  };
}

// src/ingest-public.ts
async function refreshPublicData(options = {}) {
  const acquiredAt = options.acquiredAt ?? (/* @__PURE__ */ new Date()).toISOString();
  const start = options.start ?? process.env.PULSO_START ?? "2026-08-01";
  const end = options.end ?? process.env.PULSO_END ?? addDays(acquiredAt.slice(0, 10), 1);
  if (!isDay(start) || !isDay(end) || start >= end)
    throw Error("Intervalo p\xFAblico inv\xE1lido.");
  const base2 = "data/licensed";
  const unlock = await lockIngest(base2);
  try {
    const t = new Transport(
      options.offline ?? false,
      acquiredAt,
      `${base2}/raw`
    );
    const ina = await ingestIna(t, start, end);
    const pna = await ingestPnaRosario(
      t,
      ina.stations,
      ina.measurements,
      start,
      end
    );
    const snih = await ingestSnihRosario(t, start, end);
    const discharges = await ingestOns(t, start, end);
    const onsRecord = t.records.find(
      (r) => r.alias.endsWith("ons-catalog.json")
    );
    const onsCatalog = JSON.parse(await readFile3(onsRecord.path, "utf8"));
    if (!/Creative Commons Atribui/i.test(onsCatalog.result?.license_title ?? ""))
      throw Error("Licencia ONS no verificada; no se publica el corte.");
    const generatedAt = t.records.map((r) => r.ingested_at).sort().at(-1);
    const dataset2 = publicationDataset({
      stations: [...ina.stations, snih.station],
      measurements: [
        ...ina.measurements,
        ...pna.measurements,
        ...snih.measurements
      ],
      discharges,
      events: [],
      metadata: {
        start,
        end: addDays(end, -1),
        generated_at: generatedAt,
        date_basis: "INA/PNA: timestamp de la observaci\xF3n; SNIH: 03:00 UTC; ONS: fecha diaria",
        license_notice: "Fuentes p\xFAblicas con procedencia y autorizaci\xF3n registradas.",
        distribution_mode: "public_observations"
      }
    });
    for (const r of t.records)
      if (createHash3("sha256").update(await readFile3(r.path)).digest("hex") !== r.sha256)
        throw Error("Original p\xFAblico alterado.");
    const report2 = {
      requested_start: start,
      requested_end_exclusive: end,
      observation_cut: dataset2.metadata.end,
      stations: dataset2.stations.length,
      measurements: dataset2.measurements.length,
      discharges: dataset2.discharges.length,
      ina_stations: ina.stations.length,
      ina_measurements: ina.measurements.length,
      pna: pna.report,
      snih: snih.report
    };
    const sources = options.sourcesCSV ?? await readFile3("config/sources.csv", "utf8");
    await t.saveAliases();
    const root = await publishSnapshot(
      dataset2,
      report2,
      t.records,
      sources,
      base2
    );
    return { root, dataset: dataset2, report: report2 };
  } catch (error) {
    await writeFile3(
      `${base2}/last-failure.json`,
      JSON.stringify({ failed_at: acquiredAt, error: String(error) }, null, 2)
    );
    throw error;
  } finally {
    await unlock();
  }
}

// src/static-public-site.ts
import { readdir, readFile as readFile4, writeFile as writeFile4, mkdir as mkdir3, rm as rm2 } from "node:fs/promises";
import { createHash as createHash4 } from "node:crypto";
async function writePublicSiteData(input, options) {
  const { directory, basePath, sourcesCSV: sourcesCSV2, workerTemplate } = options;
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath))
    throw Error("Prefijo de publicaci\xF3n inv\xE1lido.");
  const dataset2 = publicationDataset(input);
  if (dataset2.measurements.some((m) => m.station_id.startsWith("local:")))
    throw Error("Se impide publicar una serie restringida.");
  const body = JSON.stringify(dataset2), id = createHash4("sha256").update(body).digest("hex").slice(0, 16), root = `data/snapshots/${id}`;
  await rm2(`${directory}/data/snapshots`, { recursive: true, force: true });
  await mkdir3(`${directory}/${root}/processed`, { recursive: true });
  await mkdir3(`${directory}/${root}/exports`, { recursive: true });
  await writeFile4(`${directory}/${root}/processed/dataset.json`, body);
  const tables = {
    stations: dataset2.stations,
    water_levels: dataset2.measurements,
    discharges: dataset2.discharges,
    dam_events: [],
    thresholds: dataset2.stations.flatMap(
      (station) => [
        { type: "alert", value: station.alert },
        { type: "evacuation", value: station.evacuation }
      ].filter((row) => row.value !== null).map((row) => ({
        station_id: station.id,
        ...row,
        unit: "m",
        valid_from: null,
        valid_to: null,
        source: station.source,
        quality: "validity_period_unknown"
      }))
    )
  };
  for (const [name, rows3] of Object.entries(tables))
    await writeFile4(
      `${directory}/${root}/exports/${name}.csv`,
      csv(rows3, rows3.length ? Object.keys(rows3[0]) : ["no_verified_records"])
    );
  await writeFile4(`${directory}/${root}/exports/sources.csv`, sourcesCSV2);
  await writeFile4(
    `${directory}/data/current.json`,
    JSON.stringify({ version: 1, id, root })
  );
  let dataOrigin = options.dataOrigin || null;
  if (dataOrigin !== null) {
    const u = new URL(dataOrigin);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || !u.pathname.endsWith("/"))
      throw Error("Origen p\xFAblico de datos inv\xE1lido.");
    dataOrigin = u.href;
  }
  await writeFile4(
    `${directory}/runtime.json`,
    JSON.stringify({ data_origin: dataOrigin })
  );
  const paths = [], digests = [];
  async function walk(relative) {
    const dir = relative ? `${directory}/${relative}` : directory;
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name)
    )) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else if (!["sw.js", "precache.json"].includes(entry.name)) {
        paths.push(basePath + path);
        digests.push(
          path + ":" + createHash4("sha256").update(await readFile4(`${directory}/${path}`)).digest("hex")
        );
      }
    }
  }
  await walk("");
  paths.push(basePath);
  const scope = "pulso-" + createHash4("sha256").update(basePath).digest("hex").slice(0, 8) + "-";
  const revision = createHash4("sha256").update(JSON.stringify({ digests, basePath, workerTemplate, dataOrigin })).digest("hex").slice(0, 12);
  const worker = workerTemplate.replace("__PULSO_CACHE_VERSION__", scope + revision).replace("__PULSO_CACHE_SCOPE__", scope).replace("__PULSO_DATA_ORIGIN__", JSON.stringify(dataOrigin));
  await writeFile4(`${directory}/sw.js`, worker);
  await writeFile4(`${directory}/precache.json`, JSON.stringify(paths));
  return {
    root,
    id,
    stations: dataset2.stations.length,
    measurements: dataset2.measurements.length
  };
}

// scripts/pages-refresh-entry.ts
var config = JSON.parse(await readFile5("jobs/config.json", "utf8"));
if (config.site_directory !== "site" || !/^\/[a-zA-Z0-9_-]+\/$/.test(config.base_path))
  throw Error("Configuraci\xF3n de Pages inv\xE1lida.");
var sourcesCSV = await readFile5("jobs/sources.csv", "utf8");
var { dataset, report } = await refreshPublicData({
  sourcesCSV,
  offline: process.argv.includes("--offline")
});
var latest = dataset.measurements.filter((m) => m.station_id === "ina:34").at(-1)?.observed_at.slice(0, 10);
var today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
if (dataset.stations.filter((s) => s.id.startsWith("ina:")).length !== 38 || !latest || latest < addDays(today, -2))
  throw Error(
    "Falta cobertura de las 38 estaciones originales o una lectura reciente de Rosario; se conserva la web publicada anterior."
  );
var result = await writePublicSiteData(dataset, {
  directory: config.site_directory,
  basePath: config.base_path,
  sourcesCSV,
  workerTemplate: await readFile5("jobs/sw.template.js", "utf8")
});
console.log(
  JSON.stringify(
    {
      ...report,
      ...result,
      model: "constant_rate_scenario",
      warning: "Fechas hipot\xE9ticas; observaciones INA/PNA atribuidas y autorizadas por el responsable de PULSO, licencia espec\xEDfica no confirmada. Series RHN independientes."
    },
    null,
    2
  )
);
