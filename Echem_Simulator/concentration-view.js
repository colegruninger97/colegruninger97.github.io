/* Concentration playback uses the displayed forward result, never the edited form. */
(() => {
  "use strict";
  const palette = ["#2874a6", "#c17731", "#39786b", "#8864a0", "#ad536b", "#67713b", "#53647f"];
  const sampledIndices = length => Array.from({length: Math.min(129, length)}, (_, i) =>
    Math.round(i * (length - 1) / Math.max(1, Math.min(129, length) - 1)));

  function normalizeResult(result) {
    const time = result?.time || [];
    if (!time.length) return null;
    let profiles = result.concentration_profiles;
    let electrode = result.species_at_electrode || [];
    // PNP includes the pre-experiment equilibrium; current/time start at the first solved step.
    if (!profiles && result.grid?.length && result.concentrations?.length) {
      const indices = sampledIndices(time.length);
      profiles = {distance: result.grid, sample_indices: indices, species: result.concentrations.map(field => {
        const offset = field.values.length === time.length + 1 ? 1 : 0;
        return {name: field.name, values: indices.map(i => field.values[i + offset])};
      })};
      electrode = result.concentrations.map(field => {
        const offset = field.values.length === time.length + 1 ? 1 : 0;
        return {name: field.name, concentration: time.map((_, i) => field.values[i + offset][0])};
      });
    }
    const surface = result.surface_coverages || [];
    const spatial = profiles?.species?.length > 0;
    if (!spatial && !electrode.length && !surface.length) return null;
    return {time, potential: result.potential, profiles: spatial ? profiles : null, electrode, surface,
      samples: spatial ? profiles.sample_indices : sampledIndices(time.length)};
  }

  function nearestFrame(data, target) {
    let lo = 0, hi = data.samples.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (data.time[data.samples[mid]] < target) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && target - data.time[data.samples[lo - 1]] < data.time[data.samples[lo]] - target) lo--;
    return lo;
  }

  const number = value => value === 0 ? "0" : Number(value.toPrecision(4)).toString();
  function units(maximum, surface) {
    if (surface) return maximum >= 1e-12 ? {scale: 1e9, label: "nmol cm⁻²"} : {scale: 1e12, label: "pmol cm⁻²"};
    if (maximum >= 0.1) return {scale: 1, label: "M"};
    if (maximum === 0 || maximum >= 1e-4) return {scale: 1e3, label: "mM"};
    if (maximum >= 1e-7) return {scale: 1e6, label: "μM"};
    return {scale: 1e9, label: "nM"};
  }

  function csv(data, mode) {
    const quote = value => `"${String(value).replaceAll('"', '""')}"`;
    const name = value => quote(/^[=+@-]/.test(value) ? `'${value}` : value);
    const rows = [mode === "surface" ? "time_s,potential_V,species,coverage_mol_cm-2"
      : "time_s,potential_V,distance_cm,species,concentration_M"];
    if (mode === "spatial") {
      data.samples.forEach((index, frame) => data.profiles.species.forEach(field => {
        field.values[frame].forEach((value, node) => rows.push([
          data.time[index], data.potential[index], data.profiles.distance[node], name(field.name), value
        ].join(",")));
      }));
    } else {
      const fields = mode === "surface" ? data.surface : data.electrode;
      data.time.forEach((time, i) => fields.forEach(field => rows.push(mode === "surface"
        ? [time, data.potential[i], name(field.name), field.coverage[i]].join(",")
        : [time, data.potential[i], 0, name(field.name), field.concentration[i]].join(","))));
    }
    return rows.join("\n");
  }

  function create({onSample = () => {}} = {}) {
    const el = id => document.getElementById(`concentration-${id}`);
    const canvas = el("chart"), slider = el("time"), play = el("play"), select = el("mode");
    let data = null, frame = 0, animation = null, playing = false, mode = "spatial", fields = [], selected = [], readouts = [];
    let ymin = 0, ymax = 1, unit = units(0, false);

    function pause() {
      if (animation !== null) cancelAnimationFrame(animation);
      animation = null;
      playing = false;
      play.textContent = "Play";
      play.setAttribute("aria-pressed", "false");
    }

    function rescale() {
      let minimum = 0, maximum = 0;
      fields.forEach((field, i) => {
        if (!selected[i]) return;
        const rows = mode === "spatial" ? field.values : [mode === "surface" ? field.coverage : field.concentration];
        for (const row of rows) for (const value of row) {
          minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
        }
      });
      unit = units(Math.max(Math.abs(minimum), maximum), mode === "surface");
      // A fixed scale throughout playback makes depletion and accumulation visible.
      const span = Math.max(maximum - minimum, 1 / unit.scale);
      ymin = minimum < 0 ? minimum - 0.04 * span : 0;
      ymax = maximum > 0 ? maximum + 0.08 * span : span;
    }

    function draw() {
      if (!data) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
      const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
      const w = rect.width, h = rect.height, pad = {left: 78, right: 28, top: 28, bottom: 58};
      const pw = w - pad.left - pad.right, ph = h - pad.top - pad.bottom;
      const coordinate = mode === "spatial" ? data.profiles.distance : data.time;
      const minX = coordinate[0], maxX = coordinate.at(-1), spanX = Math.max(maxX - minX, 1e-20);
      const xScale = mode === "spatial" ? (maxX < 1e-4 ? 1e7 : 1e4) : 1;
      const xLabel = mode === "spatial" ? `Distance from electrode (${xScale === 1e7 ? "nm" : "μm"})` : "Time (s)";
      const yLabel = `${mode === "surface" ? "Surface coverage" : "Concentration"} (${unit.label})`;
      const xpx = x => pad.left + (x - minX) / spanX * pw;
      const ypx = y => pad.top + (ymax - y) / (ymax - ymin) * ph;
      ctx.clearRect(0, 0, w, h); ctx.fillStyle = "#fbfcfd"; ctx.fillRect(0, 0, w, h);
      ctx.font = "11px Inter, sans-serif";
      for (let i = 0; i <= 4; i++) {
        const x = minX + spanX * i / 4, y = ymin + (ymax - ymin) * i / 4;
        ctx.strokeStyle = "#e1e7ed"; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(xpx(x), pad.top); ctx.lineTo(xpx(x), pad.top + ph);
        ctx.moveTo(pad.left, ypx(y)); ctx.lineTo(pad.left + pw, ypx(y)); ctx.stroke();
        ctx.fillStyle = "#596c7a"; ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillText(number(x * xScale), xpx(x), pad.top + ph + 10);
        ctx.textAlign = "right"; ctx.textBaseline = "middle";
        ctx.fillText(number(y * unit.scale), pad.left - 9, ypx(y));
      }
      ctx.save(); ctx.beginPath(); ctx.rect(pad.left, pad.top, pw, ph); ctx.clip();
      fields.forEach((field, i) => {
        if (!selected[i]) return;
        const values = mode === "spatial" ? field.values[frame] : mode === "surface" ? field.coverage : field.concentration;
        ctx.strokeStyle = palette[i % palette.length]; ctx.lineWidth = 2.4;
        ctx.setLineDash(i < palette.length ? [] : [7, 4]); ctx.beginPath();
        values.forEach((y, index) => index ? ctx.lineTo(xpx(coordinate[index]), ypx(y)) : ctx.moveTo(xpx(coordinate[index]), ypx(y)));
        ctx.stroke();
      });
      ctx.setLineDash([]);
      if (mode !== "spatial") {
        const sample = data.samples[frame], px = xpx(data.time[sample]);
        ctx.strokeStyle = "#526a7c"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath();
        ctx.moveTo(px, pad.top); ctx.lineTo(px, pad.top + ph); ctx.stroke(); ctx.setLineDash([]);
        fields.forEach((field, i) => {
          if (!selected[i]) return;
          const value = (mode === "surface" ? field.coverage : field.concentration)[sample];
          ctx.fillStyle = palette[i % palette.length]; ctx.beginPath(); ctx.arc(px, ypx(value), 4, 0, Math.PI * 2); ctx.fill();
        });
      }
      ctx.restore(); ctx.fillStyle = "#304b60"; ctx.font = "12px Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText(xLabel, pad.left + pw / 2, h - 7);
      ctx.save(); ctx.translate(17, pad.top + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore();
      if (!selected.some(Boolean)) { ctx.fillText("Select a species below to show its concentration.", pad.left + pw / 2, pad.top + ph / 2); }
      canvas.setAttribute("aria-label", `${yLabel} versus ${xLabel}; selected time ${number(data.time[data.samples[frame]])} seconds. Values are listed below.`);
    }

    function showFrame(next) {
      if (!data) return;
      frame = Math.min(data.samples.length - 1, Math.max(0, next));
      slider.value = String(frame);
      const index = data.samples[frame];
      const label = `${number(data.time[index])} s · ${number(data.potential[index])} V`;
      el("position").textContent = label;
      slider.setAttribute("aria-valuetext", `${number(data.time[index])} seconds, ${number(data.potential[index])} volts`);
      fields.forEach((field, i) => {
        const value = mode === "spatial" ? field.values[frame][0] : mode === "surface" ? field.coverage[index] : field.concentration[index];
        readouts[i].textContent = `${number(value * unit.scale)} ${unit.label}`;
      });
      draw(); onSample(index);
    }

    function chooseMode() {
      mode = select.value;
      fields = mode === "spatial" ? data.profiles.species : mode === "surface" ? data.surface : data.electrode;
      selected = fields.map(() => true); readouts = [];
      el("species").replaceChildren();
      fields.forEach((field, i) => {
        const label = document.createElement("label"), checkbox = document.createElement("input"), swatch = document.createElement("i");
        const name = document.createElement("span"), value = document.createElement("strong");
        checkbox.type = "checkbox"; checkbox.checked = true;
        checkbox.setAttribute("aria-label", `Show ${field.name}`);
        checkbox.addEventListener("change", () => { selected[i] = checkbox.checked; rescale(); showFrame(frame); });
        swatch.style.backgroundColor = palette[i % palette.length]; swatch.setAttribute("aria-hidden", "true");
        name.textContent = field.name; label.append(checkbox, swatch, name, value);
        el("species").append(label); readouts.push(value);
      });
      el("values-label").textContent = mode === "surface" ? "Surface coverages at the selected time" : "Solution concentrations at the electrode at the selected time";
      el("note").textContent = mode === "spatial"
        ? "The electrode is at distance zero. Watch depletion and product formation spread into the solution. The vertical scale stays fixed during playback."
        : mode === "surface" ? "Surface-bound species are reported as amount per electrode area. The time marker follows the current trace above."
          : "These are solution concentrations immediately next to the electrode, not the average throughout the sample. The time marker follows the current trace above.";
      rescale(); showFrame(frame);
    }

    function setResult(result) {
      pause(); data = normalizeResult(result); frame = 0;
      el("empty").hidden = Boolean(data); el("content").hidden = !data;
      if (!data) { onSample(null); return; }
      el("run").textContent = `Displayed run ${result._runToken} · ${result.experiment_type === "chronoamperometry" ? "Chronoamperometry" : "Cyclic voltammetry"}`;
      const available = [["spatial", "Across the solution", Boolean(data.profiles)], ["electrode", "Solution at electrode", data.electrode.length > 0], ["surface", "Surface coverage", data.surface.length > 0]];
      select.replaceChildren();
      available.filter(item => item[2]).forEach(([value, text]) => { const option = document.createElement("option"); option.value = value; option.textContent = text; select.append(option); });
      select.value = available.find(item => item[2])[0];
      slider.min = "0"; slider.max = String(data.samples.length - 1); slider.step = "1";
      slider.disabled = play.disabled = data.samples.length < 2;
      el("start").textContent = `${number(data.time[data.samples[0]])} s`;
      el("end").textContent = `${number(data.time[data.samples.at(-1)])} s`;
      chooseMode();
    }

    slider.addEventListener("input", () => { pause(); showFrame(Number(slider.value)); });
    select.addEventListener("change", () => { pause(); chooseMode(); });
    play.addEventListener("click", () => {
      if (playing) { pause(); return; }
      if (!data || data.samples.length < 2) return;
      if (frame === data.samples.length - 1) showFrame(0);
      playing = true; play.textContent = "Pause"; play.setAttribute("aria-pressed", "true");
      const from = data.time[data.samples[frame]], end = data.time[data.samples.at(-1)];
      const duration = data.time[data.samples.at(-1)] - data.time[data.samples[0]];
      const start = performance.now();
      function tick(now) {
        const target = Math.min(end, from + (now - start) / 10000 * duration);
        const next = nearestFrame(data, target);
        if (next !== frame) showFrame(next);
        if (target >= end) { showFrame(data.samples.length - 1); pause(); }
        else animation = requestAnimationFrame(tick);
      }
      animation = requestAnimationFrame(tick);
    });
    el("export").addEventListener("click", () => {
      if (!data) return;
      const url = URL.createObjectURL(new Blob([csv(data, mode)], {type: "text/csv"}));
      const link = document.createElement("a"); link.href = url; link.download = `concentrations_${mode}.csv`; link.click(); URL.revokeObjectURL(url);
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(draw).observe(canvas);
    return {setResult, pause, draw};
  }
  window.ElectrochemConcentrations = {create, normalizeResult, nearestFrame, csv};
})();
