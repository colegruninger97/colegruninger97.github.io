const presets = {
  solution_e: {
    equation: "Ox (solution) + e⁻ ⇌ Red (solution)",
    interpretation: "A diffusion-controlled solution couple. Peak separation and shape respond to electron-transfer rate, diffusion, and scan rate.",
    fields: [
      ["bulk_concentration", "Ox bulk concentration", "M", 0.001, 0.0001],
      ["diffusion_coefficient", "Diffusion coefficient", "cm² s⁻¹", 1e-5, 1e-6],
      ["formal_potential", "Formal potential E⁰", "V", 0, 0.01],
      ["electron_transfer_rate", "Electron-transfer rate k⁰", "cm s⁻¹", 0.01, 0.001]
    ]
  },
  solution_ec: {
    equation: "Ox + e⁻ ⇌ Red  ·  Red → Product",
    interpretation: "Faster following chemistry consumes Red and increasingly distorts the return wave. For an E-only comparison, set the following rate to zero and save the resulting trace.",
    fields: [
      ["bulk_concentration", "Ox bulk concentration", "M", 0.001, 0.0001],
      ["diffusion_coefficient", "Diffusion coefficient", "cm² s⁻¹", 1e-5, 1e-6],
      ["formal_potential", "Formal potential E⁰", "V", 0, 0.01],
      ["electron_transfer_rate", "Electron-transfer rate k⁰", "cm s⁻¹", 0.01, 0.001],
      ["chemical_rate", "Following reaction rate k", "s⁻¹", 5, 1]
    ]
  },
  solution_ce: {
    equation: "Precursor → Ox  ·  Ox + e⁻ ⇌ Red",
    interpretation: "A homogeneous reaction generates the electroactive species before electron transfer. The preceding rate controls how quickly Ox becomes available at the electrode.",
    fields: [
      ["bulk_concentration", "Precursor concentration", "M", 0.001, 0.0001],
      ["diffusion_coefficient", "Diffusion coefficient", "cm² s⁻¹", 1e-5, 1e-6],
      ["preceding_rate", "Preceding reaction rate", "s⁻¹", 5, 1],
      ["formal_potential", "Formal potential E⁰", "V", 0, 0.01],
      ["electron_transfer_rate", "Electron-transfer rate k⁰", "cm s⁻¹", 0.01, 0.001]
    ]
  },
  solution_ece: {
    equation: "Ox₁ + e⁻ ⇌ Red₁  ·  Red₁ → Ox₂  ·  Ox₂ + e⁻ ⇌ Red₂",
    interpretation: "Two homogeneous solution redox couples are linked by a following chemical conversion. Both electron-transfer steps occur at the electrode.",
    fields: [
      ["bulk_concentration", "Ox₁ concentration", "M", 0.001, 0.0001],
      ["diffusion_coefficient", "Shared diffusion coefficient", "cm² s⁻¹", 1e-5, 1e-6],
      ["formal_potential_1", "First formal potential", "V", 0.08, 0.01],
      ["electron_transfer_rate_1", "First electron-transfer rate", "cm s⁻¹", 0.01, 0.001],
      ["chemical_rate", "Intermediate conversion rate", "s⁻¹", 5, 1],
      ["formal_potential_2", "Second formal potential", "V", -0.08, 0.01],
      ["electron_transfer_rate_2", "Second electron-transfer rate", "cm s⁻¹", 0.01, 0.001]
    ]
  },
  solution_ececprime: {
    equation: "Ox₁ + e⁻ ⇌ Red₁  ·  Red₁ → Ox₂  ·  Ox₂ + e⁻ ⇌ Red₂  ·  Red₂ + S → Ox₂ + P",
    interpretation: "A fully homogeneous ECEC′ sequence. The second reduced species turns over a dissolved substrate and regenerates Ox₂. Set the catalytic rate to zero and save that result as the non-catalytic comparison.",
    fields: [
      ["bulk_concentration", "Ox₁ concentration", "M", 0.001, 0.0001],
      ["substrate_concentration", "Dissolved substrate concentration", "M", 0.002, 0.0001],
      ["diffusion_coefficient", "Shared diffusion coefficient", "cm² s⁻¹", 1e-5, 1e-6],
      ["formal_potential_1", "First formal potential", "V", 0.08, 0.01],
      ["electron_transfer_rate_1", "First electron-transfer rate", "cm s⁻¹", 0.01, 0.001],
      ["chemical_rate", "Intermediate conversion rate", "s⁻¹", 5, 1],
      ["formal_potential_2", "Second formal potential", "V", -0.08, 0.01],
      ["electron_transfer_rate_2", "Second electron-transfer rate", "cm s⁻¹", 0.01, 0.001],
      ["catalytic_rate", "Homogeneous catalytic rate", "M⁻¹ s⁻¹", 1e4, 1e3]
    ]
  },
  solution_ecprime: {
    equation: "Ox + e⁻ ⇌ Red  ·  Red + S → Ox + P",
    interpretation: "A homogeneous EC′ catalytic cycle. Electron transfer forms Red, which reacts with excess substrate S and regenerates Ox. The catalytic rate and substrate concentration control the current enhancement.",
    fields: [
      ["bulk_concentration", "Catalyst concentration", "M", 0.001, 0.0001],
      ["substrate_concentration", "Substrate concentration", "M", 0.01, 0.001],
      ["diffusion_coefficient", "Shared diffusion coefficient", "cm² s⁻¹", 1e-5, 1e-6],
      ["formal_potential", "Formal potential E⁰", "V", 0, 0.01],
      ["electron_transfer_rate", "Electron-transfer rate k⁰", "cm s⁻¹", 0.01, 0.001],
      ["catalytic_rate", "Catalytic rate kcat", "M⁻¹ s⁻¹", 1000, 100]
    ]
  }
};

const colors = ["#4d82a7", "#7bafd4", "#75848e", "#a9bac5"];
const voltammogramConventions = Object.freeze({
  us: Object.freeze({
    currentMultiplier: 1,
    reversePotentialAxis: true,
    label: "U.S.",
    filename: "us",
    note: "U.S. convention: cathodic current is positive and more negative potentials appear to the right."
  }),
  iupac: Object.freeze({
    currentMultiplier: -1,
    reversePotentialAxis: false,
    label: "IUPAC",
    filename: "iupac",
    note: "IUPAC convention: anodic current is positive and more positive potentials appear to the right."
  })
});
let latestResult = null;
let currentPreset = "solution_e";
let voltammogramConvention = "us";
let savedTraces = [];
let simulationRun = 0;
let savedTraceSequence = 0;
let datasetSequence = 0;
let experimentalDatasets = [];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;"
  })[character]);
}

function switchView(name) {
  $$(".workbench-view").forEach(view => {
    view.classList.toggle("active", view.id === `view-${name}`);
  });
  const group = name === "builder" ? "simulate" : name === "fit" ? "data" : name;
  $$(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.viewTarget === group);
  });
  window.scrollTo({top: 0, behavior: "smooth"});
}

function fieldMarkup([key, label, unit, value, step]) {
  return `<label class="field"><span>${label} <b>${unit}</b></span>
    <input data-key="${key}" type="number" step="${step}" value="${value}" required></label>`;
}

function selectPreset(name) {
  currentPreset = name;
  $("#preset-select").value = name;
  $("#kinetic-fields").innerHTML = presets[name].fields.map(fieldMarkup).join("");
  $("#mechanism-equation").textContent = presets[name].equation;
  $("#template-note").textContent = presets[name].interpretation;
  $("#interpretation-text").textContent = presets[name].interpretation;
  $("#enhancement-label").textContent = "Comparison peak ratio";
  clearError();
}

function payloadFromForm() {
  const payload = {preset: currentPreset};
  $$('[data-key]').forEach(input => {
    payload[input.dataset.key] = input.tagName === "SELECT" ? input.value : Number(input.value);
  });
  return payload;
}

function setLoading(loading) {
  const button = $("#run-button");
  button.disabled = loading;
  button.classList.toggle("loading", loading);
  button.setAttribute("aria-busy", String(loading));
}

function clearError() {
  $("#form-error").hidden = true;
  $("#form-error").textContent = "";
}

function showError(message) {
  const box = $("#form-error");
  box.textContent = message;
  box.hidden = false;
}

function currentUnit(maxAbs) {
  if (maxAbs >= 1e-3) return {scale: 1e3, label: "mA"};
  if (maxAbs >= 1e-6) return {scale: 1e6, label: "μA"};
  if (maxAbs >= 1e-9) return {scale: 1e9, label: "nA"};
  return {scale: 1, label: "A"};
}

function formatCurrent(value) {
  const unit = currentUnit(Math.abs(value));
  return `${(value * unit.scale).toPrecision(4)} ${unit.label}`;
}

function activeVoltammogramConvention() {
  return voltammogramConventions[voltammogramConvention];
}

function displayedCurrent(value) {
  return activeVoltammogramConvention().currentMultiplier * value;
}

function updatePeakCurrentDisplay() {
  if (!latestResult) return;
  $("#peak-current").textContent = formatCurrent(displayedCurrent(latestResult.summary.peak_current));
}

function selectVoltammogramConvention(name) {
  if (!Object.hasOwn(voltammogramConventions, name)) return;
  voltammogramConvention = name;
  $$('[data-plot-convention]').forEach(button => {
    const selected = button.dataset.plotConvention === name;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $("#plot-convention-note").textContent = activeVoltammogramConvention().note;
  if (latestResult) {
    drawChart(latestResult);
    updatePeakCurrentDisplay();
  }
}

function chartSeries(result) {
  const series=result.series.map((item,index)=>({name:item.name,current:item.current.map(displayedCurrent),potential:result.potential,
    color:colors[index%colors.length],saved:false}));
  if($("#show-saved-traces")?.checked){
    const savedColors=["#7f8d96","#9aa7af","#6f8290","#adb8be","#879ba8"];
    savedTraces.filter(trace=>trace.runToken!==result._runToken).forEach((trace,index)=>series.push({...trace,current:trace.current.map(displayedCurrent),color:savedColors[index%savedColors.length],saved:true}));
  }
  return series;
}

function drawChart(result) {
  const canvas = $("#cv-chart");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const width = rect.width, height = rect.height;
  const pad = {left: 68, right: 24, top: 24, bottom: 54};
  const plotW = width - pad.left - pad.right, plotH = height - pad.top - pad.bottom;
  const visibleSeries=chartSeries(result);
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for(const series of visibleSeries){
    for(const x of series.potential){xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);}
    for(const y of series.current){ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
  }
  const yspan = Math.max(ymax-ymin, Math.max(Math.abs(ymin),Math.abs(ymax))*0.1, 1e-12);
  ymin -= .08*yspan; ymax += .08*yspan;
  const unit = currentUnit(Math.max(Math.abs(ymin), Math.abs(ymax)));
  const reversePotentialAxis = activeVoltammogramConvention().reversePotentialAxis;
  const xpx = x => pad.left + (reversePotentialAxis ? (xmax-x) : (x-xmin))/(xmax-xmin)*plotW;
  const ypx = y => pad.top + (ymax-y)/(ymax-ymin)*plotH;

  ctx.clearRect(0,0,width,height);
  ctx.fillStyle = "#fbfcfb"; ctx.fillRect(0,0,width,height);
  ctx.font = "11px Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let i=0;i<=5;i++) {
    const x = reversePotentialAxis ? xmax-(xmax-xmin)*i/5 : xmin+(xmax-xmin)*i/5, px = xpx(x);
    ctx.strokeStyle = "#e2e8e5"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px,pad.top); ctx.lineTo(px,pad.top+plotH); ctx.stroke();
    ctx.fillStyle = "#60747b"; ctx.fillText(x.toFixed(2),px,pad.top+plotH+10);
  }
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let i=0;i<=5;i++) {
    const y = ymin + (ymax-ymin)*i/5, py = ypx(y);
    ctx.strokeStyle = "#e2e8e5"; ctx.beginPath(); ctx.moveTo(pad.left,py); ctx.lineTo(pad.left+plotW,py); ctx.stroke();
    ctx.fillStyle = "#60747b"; ctx.fillText((y*unit.scale).toPrecision(3),pad.left-10,py);
  }
  if (ymin < 0 && ymax > 0) {
    ctx.strokeStyle = "#aebcb8"; ctx.beginPath(); ctx.moveTo(pad.left,ypx(0)); ctx.lineTo(pad.left+plotW,ypx(0)); ctx.stroke();
  }
  visibleSeries.forEach((series,index) => {
    ctx.strokeStyle=series.color;ctx.lineWidth=series.saved?1.55:(index===0?2.4:1.8);
    ctx.setLineDash(series.saved?[6,4]:[]);ctx.globalAlpha=series.saved?.85:1;
    ctx.beginPath();
    series.current.forEach((y,i)=>i?ctx.lineTo(xpx(series.potential[i]),ypx(y)):ctx.moveTo(xpx(series.potential[i]),ypx(y)));
    ctx.stroke();
  });
  ctx.setLineDash([]);ctx.globalAlpha=1;
  ctx.fillStyle = "#304b53"; ctx.font = "12px Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("Potential vs reference (V)", pad.left+plotW/2, height-8);
  ctx.save(); ctx.translate(16,pad.top+plotH/2); ctx.rotate(-Math.PI/2); ctx.fillText(`Current (${unit.label})`,0,0); ctx.restore();
  $("#legend").innerHTML=visibleSeries.map(series=>`<span class="legend-item"><i class="legend-line ${series.saved?"saved":""}" style="background:${series.color};color:${series.color}"></i>${series.name}</span>`).join("");
}

function displayResult(result, simulationInput = null) {
  result._runToken=++simulationRun;
  result._simulationInput=simulationInput;
  latestResult = result;
  drawChart(result);
  updatePeakCurrentDisplay();
  $("#peak-potential").textContent = `${result.summary.peak_potential.toFixed(4)} V`;
  updateComparisonMetric();
  $("#solver-time").textContent = `${result.elapsed_seconds.toFixed(3)} s`;
  $("#download-button").disabled = false;
  $("#save-trace-button").disabled = false;
  $("#electrolyte-check-button").disabled = false;
  $("#electrolyte-report").innerHTML = "";
  $("#electrolyte-error").hidden = true;
  const diffusion=Number(simulationInput?.diffusion_coefficient);
  if(Number.isFinite(diffusion)&&diffusion>0)$("#electrolyte-diffusion").value=String(diffusion);
}

function updateComparisonMetric(){
  if(!latestResult){$("#enhancement").textContent="—";return;}
  if(latestResult.surface_coverages?.length){
    const total=latestResult.surface_coverages.reduce((sum,trace)=>sum+Number(trace.coverage.at(-1)||0),0);
    $("#enhancement-label").textContent="Final surface coverage";
    $("#enhancement").textContent=`${total.toExponential(3)} mol cm⁻²`;
    return;
  }
  if(Number.isFinite(latestResult.debye_length)){
    $("#enhancement-label").textContent="Debye length";
    $("#enhancement").textContent=`${Number(latestResult.debye_length).toExponential(3)} cm`;
    return;
  }
  const comparison=[...savedTraces].reverse().find(trace=>trace.runToken!==latestResult._runToken);
  if(!comparison){$("#enhancement").textContent="—";return;}
  const currentPeak=latestResult.series[0].current.reduce((peak,value)=>Math.max(peak,Math.abs(value)),0);
  const savedPeak=comparison.current.reduce((peak,value)=>Math.max(peak,Math.abs(value)),0);
  $("#enhancement").textContent=savedPeak>0?`${(currentPeak/savedPeak).toFixed(2)}×`:"—";
}

function renderSavedTraces(){
  const bar=$("#saved-trace-bar");bar.hidden=savedTraces.length===0;
  $("#save-trace-button").disabled=!latestResult||savedTraces.some(trace=>trace.runToken===latestResult._runToken);
  $("#saved-trace-list").innerHTML=savedTraces.map(trace=>`<span class="saved-trace-chip">${trace.name}<button type="button" data-remove-saved-trace="${trace.id}" aria-label="Remove ${trace.name}">×</button></span>`).join("");
  $$('[data-remove-saved-trace]').forEach(button=>button.addEventListener("click",()=>{savedTraces=savedTraces.filter(trace=>trace.id!==+button.dataset.removeSavedTrace);renderSavedTraces();if(latestResult)drawChart(latestResult);}));
  updateComparisonMetric();
}

function saveCurrentTrace(){
  if(!latestResult||!latestResult.series.length)return;
  const option=$(`#preset-select option[value="${latestResult.preset}"]`);
  const template=latestResult.preset==="custom"?"Custom mechanism":option?.textContent.split(" — ")[0]||"Simulation";
  const id=++savedTraceSequence;
  savedTraces.push({id,name:`${template} · trace ${id}`,potential:[...latestResult.potential],
    current:[...latestResult.series[0].current],runToken:latestResult._runToken});
  $("#save-trace-button").disabled=true;renderSavedTraces();drawChart(latestResult);
}

function clearSavedTraces(){savedTraces=[];renderSavedTraces();if(latestResult)drawChart(latestResult);}

async function runSimulation() {
  clearError(); setLoading(true);
  try {
    const payload = payloadFromForm();
    if (!window.electrochemBrowserEngine) {
      throw new Error("The browser calculation engine did not load. Reload the page and try again.");
    }
    const result = await window.electrochemBrowserEngine.simulate(payload);
    displayResult(result, payload);
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

function scientific(value, digits=4){
  return Number(value).toExponential(digits-1);
}

function renderElectrolyteReport(report){
  const surfaceStatus=report.surface_partition_passed==null?"":`<span class="result-badge ${report.surface_partition_passed?"success":""}">Surface partition ${report.surface_partition_passed?"passed":"needs review"}</span>`;
  const warnings=[];
  if(!report.bulk_migration_passed)warnings.push("The estimated migrative flux contribution exceeds the 5% screening tolerance. Add supporting electrolyte or use a transport model that includes migration.");
  if(!report.thin_double_layer_passed)warnings.push("The Debye length is not negligible relative to the diffusion layer. A locally electroneutral diffusion model may be inadequate.");
  if(report.surface_partition_passed===false)warnings.push("The supplied diffuse-layer potential predicts appreciable electrostatic partitioning of the charged reactant at the surface.");
  const warningMarkup=warnings.map(message=>`<div class="model-warning"><strong>Validity review:</strong> ${escapeHTML(message)}</div>`).join("");
  const partition=report.surface_partition_factor==null?"—":Number(report.surface_partition_factor).toPrecision(4);
  $("#electrolyte-report").innerHTML=`<div class="result-badges"><span class="result-badge ${report.bulk_migration_passed?"success":""}">Bulk migration ${report.bulk_migration_passed?"passed":"needs review"}</span><span class="result-badge ${report.thin_double_layer_passed?"success":""}">Thin double layer ${report.thin_double_layer_passed?"passed":"needs review"}</span>${surfaceStatus}</div>${warningMarkup}<table class="result-table"><tbody><tr><th>Peak current density</th><td>${scientific(report.peak_current_density)} A cm⁻²</td></tr><tr><th>Ohmic drop across diffusion layer</th><td>${scientific(report.potential_drop_across_diffusion_layer)} V</td></tr><tr><th>Maximum migration-flux error</th><td>${(100*report.maximum_migration_flux_relative_error).toPrecision(3)}%</td></tr><tr><th>Debye length</th><td>${scientific(report.debye_length)} cm</td></tr><tr><th>Debye / diffusion-layer ratio</th><td>${scientific(report.debye_to_diffusion_ratio)}</td></tr><tr><th>Surface partition factor</th><td>${partition}</td></tr></tbody></table>`;
}

async function screenSupportingElectrolyte(){
  const errorBox=$("#electrolyte-error");errorBox.hidden=true;errorBox.textContent="";
  if(!latestResult) return;
  const input=latestResult._simulationInput||payloadFromForm();
  const diffuseText=$("#electrolyte-diffuse-potential").value.trim();
  const payload={
    current:latestResult.series[0].current,
    electrode_area:Number(input.electrode_area),
    conductivity:Number($("#electrolyte-conductivity").value),
    ionic_strength:Number($("#electrolyte-ionic-strength").value),
    diffusion_coefficient:Number($("#electrolyte-diffusion").value),
    reactant_charge:Number($("#electrolyte-charge").value),
    scan_rate:Number(input.scan_rate),
    electron_count:1,
    temperature:Number(input.temperature),
    relative_permittivity:Number($("#electrolyte-permittivity").value),
    relative_error_tolerance:0.05,
    thin_double_layer_tolerance:0.01
  };
  if(diffuseText!=="")payload.diffuse_layer_potential=Number(diffuseText);
  const button=$("#electrolyte-check-button");button.disabled=true;
  try{
    const report=await window.electrochemBrowserEngine.screenSupportingElectrolyte(payload);
    renderElectrolyteReport(report);
  }catch(error){errorBox.textContent=error.message;errorBox.hidden=false;}
  finally{button.disabled=false;}
}

function downloadCSV() {
  if (!latestResult) return;
  const convention=activeVoltammogramConvention();
  const coverages=latestResult.surface_coverages||[];
  const pnpFields=latestResult.concentrations||[];
  const pnpHeaders=latestResult.debye_length?[`faradaic_current_A_${convention.filename}`,`charging_current_A_${convention.filename}`,"surface_solution_potential_V",...pnpFields.map(field=>`${field.name.replaceAll(" ","_")}_at_electrode_M`)]:[];
  const headers = ["time_s","potential_V",...latestResult.series.map(s => `${s.name.replaceAll(" ","_")}_A_${convention.filename}`),...coverages.map(trace=>`${trace.name.replaceAll(" ","_")}_mol_cm-2`),...pnpHeaders];
  const rows = [headers.join(",")];
  for (let i=0;i<latestResult.points;i++) rows.push([latestResult.time[i],latestResult.potential[i],...latestResult.series.map(s=>displayedCurrent(s.current[i])),...coverages.map(trace=>trace.coverage[i]),...(latestResult.debye_length?[displayedCurrent(latestResult.faradaic_current[i]),displayedCurrent(latestResult.charging_current[i]),latestResult.solution_potential[i+1][0],...pnpFields.map(field=>field.values[i+1][0])]:[])].join(","));
  const blob = new Blob([rows.join("\n")], {type:"text/csv"});
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${latestResult.preset}_voltammogram_${convention.filename}.csv`; link.click();
  URL.revokeObjectURL(link.href);
}

async function checkEngine() {
  try {
    const browser = await window.electrochemBrowserEngine?.ready();
    if (browser?.status === "ready") {
      const status = $("#engine-status"); status.classList.add("ready"); status.lastChild.textContent = " Rust/Wasm solution engine ready";
      return;
    }
  } catch {}
  $("#engine-status").lastChild.textContent = " Browser calculation engine unavailable";
}

$$('[data-view-target]').forEach(button => {
  button.addEventListener("click", () => switchView(button.dataset.viewTarget));
});
$("#preset-select").addEventListener("change",event=>selectPreset(event.target.value));
$("#run-button").addEventListener("click", runSimulation);
$("#save-trace-button").addEventListener("click",saveCurrentTrace);
$("#show-saved-traces").addEventListener("change",()=>latestResult&&drawChart(latestResult));
$("#clear-saved-traces").addEventListener("click",clearSavedTraces);
$$('[data-plot-convention]').forEach(button=>button.addEventListener("click",()=>selectVoltammogramConvention(button.dataset.plotConvention)));
$("#download-button").addEventListener("click", downloadCSV);
$("#electrolyte-check-button").addEventListener("click",screenSupportingElectrolyte);
$("#reset-button").addEventListener("click", () => { location.reload(); });
window.addEventListener("resize", () => latestResult && drawChart(latestResult));
selectPreset(currentPreset);
checkEngine();
