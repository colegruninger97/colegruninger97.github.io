(function (root) {
  "use strict";

  const unitScales = Object.freeze({
    time: Object.freeze({s: 1, ms: 1e-3, min: 60}),
    potential: Object.freeze({V: 1, mV: 1e-3}),
    current: Object.freeze({A: 1, mA: 1e-3, uA: 1e-6, nA: 1e-9})
  });

  function splitCSVLine(line, delimiter) {
    const cells = [];
    let value = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const character = line[i];
      if (character === '"') {
        if (quoted && line[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (character === delimiter && !quoted) {
        cells.push(value.trim());
        value = "";
      } else {
        value += character;
      }
    }
    cells.push(value.trim());
    return cells;
  }

  function inferScanRate(time, potential) {
    const slopes = [];
    for (let i = 1; i < time.length; i++) {
      const dt = time[i] - time[i - 1];
      const slope = Math.abs((potential[i] - potential[i - 1]) / dt);
      if (dt > 0 && Number.isFinite(slope) && slope > 1e-8) slopes.push(slope);
    }
    slopes.sort((a, b) => a - b);
    return slopes.length ? slopes[Math.floor(slopes.length / 2)] : 0.1;
  }

  function inferredUnit(header, kind) {
    const normalized = String(header).toLowerCase().replace(/μ/g, "u");
    if (kind === "time") {
      return /(^|[^a-z])ms([^a-z]|$)|millisecond/.test(normalized) ? "ms" :
        /min/.test(normalized) ? "min" : "s";
    }
    if (kind === "potential") return /mv|millivolt/.test(normalized) ? "mV" : "V";
    return /na|nanoamp/.test(normalized) ? "nA" :
      /ua|microamp/.test(normalized) ? "uA" :
      /ma|milliamp/.test(normalized) ? "mA" : "A";
  }

  function inferredColumn(headers, kind) {
    const normalized = headers.map(value => value.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const patterns = kind === "time" ? ["time", "seconds", "elapsed"] :
      kind === "potential" ? ["potential", "voltage", "ewe", "workingelectrode"] :
      ["current", "amps", "imeasured"];
    const strongMatch = normalized.findIndex(header =>
      patterns.some(pattern => header.includes(pattern)));
    if (strongMatch >= 0 || kind !== "current") return strongMatch;
    // Common potentiostat labels "I" and "I/A" normalize to very short tokens.
    // Match them exactly so the "ia" sequence in "potential" is not mistaken
    // for the current column.
    return normalized.findIndex(header => header === "i" || header === "ia");
  }

  function unitScale(kind, unit, datasetName) {
    const scale = unitScales[kind]?.[unit];
    if (!Number.isFinite(scale)) throw new Error(`${datasetName}: unsupported ${kind} unit`);
    return scale;
  }

  function normalizeImportedDataset(dataset) {
    if (!dataset.raw_import) return dataset;
    const settings = dataset.import_settings;
    const indices = [settings.time_column, settings.potential_column, settings.current_column].map(Number);
    if (new Set(indices).size !== 3 || indices.some(index =>
      !Number.isInteger(index) || index < 0 || index >= dataset.raw_import.headers.length)) {
      throw new Error(`${dataset.name}: choose three different valid data columns`);
    }
    const scales = {
      time: unitScale("time", settings.time_unit, dataset.name),
      potential: unitScale("potential", settings.potential_unit, dataset.name),
      current: unitScale("current", settings.current_unit, dataset.name)
    };
    const currentSign = Number(settings.current_sign);
    const referenceOffset = Number(settings.reference_offset || 0);
    if (![1, -1].includes(currentSign)) throw new Error(`${dataset.name}: current sign must be +1 or -1`);
    if (!Number.isFinite(referenceOffset)) throw new Error(`${dataset.name}: reference-potential shift must be finite`);

    const time = [], potential = [], current = [];
    for (const row of dataset.raw_import.rows) {
      const values = indices.map(index => row[index]);
      if (values.every(Number.isFinite)) {
        time.push(values[0] * scales.time);
        potential.push(values[1] * scales.potential + referenceOffset);
        current.push(values[2] * scales.current * currentSign);
      }
    }
    if (time.length < 10) {
      throw new Error(`${dataset.name}: fewer than 10 numeric rows remain after column mapping`);
    }
    dataset.time = time;
    dataset.potential = potential;
    dataset.current = current;
    dataset.scan_rate = inferScanRate(time, potential);
    const inferred = dataset.raw_import.inferred_columns;
    dataset.preprocessing = {
      schema_version: 1,
      source_name: dataset.name,
      delimiter: dataset.raw_import.delimiter === "\t" ? "tab" :
        dataset.raw_import.delimiter === ";" ? "semicolon" : "comma",
      columns: {
        time: dataset.raw_import.headers[indices[0]],
        potential: dataset.raw_import.headers[indices[1]],
        current: dataset.raw_import.headers[indices[2]]
      },
      units: {
        time: settings.time_unit,
        potential: settings.potential_unit,
        current: settings.current_unit
      },
      scale_to_SI: scales,
      current_sign: currentSign,
      reference_offset_V: referenceOffset,
      rows_read: dataset.raw_import.rows.length,
      rows_used: time.length,
      rows_dropped: dataset.raw_import.rows.length - time.length,
      column_mapping_inferred: indices.every((value, index) =>
        value === [inferred.time, inferred.potential, inferred.current][index])
    };
    return dataset;
  }

  function parseVoltammogram(text, name, id) {
    const lines = text.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (lines.length < 11) throw new Error(`${name}: not enough rows`);
    const candidates = [",", "\t", ";"];
    const delimiter = candidates.reduce((best, candidate) =>
      (lines[0].split(candidate).length > lines[0].split(best).length ? candidate : best), ",");
    const headers = splitCSVLine(lines[0], delimiter).map(value => value.trim());
    if (headers.length < 3) throw new Error(`${name}: at least three columns are required`);
    const rows = lines.slice(1).map(line => {
      const cells = splitCSVLine(line, delimiter);
      return headers.map((_, index) => {
        const value = cells[index]?.trim();
        return value === undefined || value === "" ? NaN : Number(value);
      });
    });
    const inferred = {
      time: inferredColumn(headers, "time"),
      potential: inferredColumn(headers, "potential"),
      current: inferredColumn(headers, "current")
    };
    const used = new Set();
    const fallback = preferred => {
      if (preferred >= 0 && !used.has(preferred)) {
        used.add(preferred);
        return preferred;
      }
      const index = headers.findIndex((_, candidate) => !used.has(candidate));
      used.add(index);
      return index;
    };
    const timeColumn = fallback(inferred.time);
    const potentialColumn = fallback(inferred.potential);
    const currentColumn = fallback(inferred.current);
    const dataset = {
      id,
      name,
      raw_import: {headers, rows, delimiter, inferred_columns: inferred},
      import_settings: {
        time_column: timeColumn,
        potential_column: potentialColumn,
        current_column: currentColumn,
        time_unit: inferredUnit(headers[timeColumn], "time"),
        potential_unit: inferredUnit(headers[potentialColumn], "potential"),
        current_unit: inferredUnit(headers[currentColumn], "current"),
        current_sign: 1,
        reference_offset: 0
      },
      concentration: 1e-3,
      coverage: 1e-10,
      concentration_uncertainty_percent: 0,
      concentration_group: `solution_${id}`,
      coverage_uncertainty_percent: 0,
      coverage_group: `electrode_${id}`
    };
    return normalizeImportedDataset(dataset);
  }

  root.ElectrochemImport = Object.freeze({
    unitScales,
    splitCSVLine,
    inferScanRate,
    inferredUnit,
    inferredColumn,
    normalizeImportedDataset,
    parseVoltammogram
  });
})(globalThis);
