const presets = {
  solution_e: {
    equation: "Ox (solution) + e⁻ ⇌ Red (solution)",
    interpretation: "A diffusion-controlled solution couple. Peak separation and shape respond to electron-transfer rate, diffusion, and scan rate.",
    defaults: {bulk_concentration:0.001,diffusion_coefficient:1e-5,formal_potential:0,electron_transfer_rate:0.01}
  },
  solution_ec: {
    equation: "Ox + e⁻ ⇌ Red  ·  Red → Product",
    interpretation: "Faster following chemistry consumes Red and increasingly distorts the return wave. For an E-only comparison, set the following rate to zero and save the resulting trace.",
    defaults: {bulk_concentration:0.001,diffusion_coefficient:1e-5,formal_potential:0,electron_transfer_rate:0.01,chemical_rate:5}
  },
  solution_ce: {
    equation: "Precursor → Ox  ·  Ox + e⁻ ⇌ Red",
    interpretation: "A homogeneous reaction generates the electroactive species before electron transfer. The preceding rate controls how quickly Ox becomes available at the electrode.",
    defaults: {bulk_concentration:0.001,diffusion_coefficient:1e-5,preceding_rate:5,formal_potential:0,electron_transfer_rate:0.01}
  },
  solution_ece: {
    equation: "Ox₁ + e⁻ ⇌ Red₁  ·  Red₁ → Ox₂  ·  Ox₂ + e⁻ ⇌ Red₂",
    interpretation: "Two homogeneous solution redox couples are linked by a following chemical conversion. Both electron-transfer steps occur at the electrode.",
    defaults: {bulk_concentration:0.001,diffusion_coefficient:1e-5,formal_potential_1:0.08,electron_transfer_rate_1:0.01,chemical_rate:5,formal_potential_2:-0.08,electron_transfer_rate_2:0.01}
  },
  solution_ececprime: {
    equation: "Ox₁ + e⁻ ⇌ Red₁  ·  Red₁ → Ox₂  ·  Ox₂ + e⁻ ⇌ Red₂  ·  Red₂ + S → Ox₂ + P",
    interpretation: "A fully homogeneous ECEC′ sequence. The second reduced species turns over a dissolved substrate and regenerates Ox₂. Set the catalytic rate to zero and save that result as the non-catalytic comparison.",
    defaults: {bulk_concentration:0.001,substrate_concentration:0.002,diffusion_coefficient:1e-5,formal_potential_1:0.08,electron_transfer_rate_1:0.01,chemical_rate:5,formal_potential_2:-0.08,electron_transfer_rate_2:0.01,catalytic_rate:1e4}
  },
  solution_ecprime: {
    equation: "Ox + e⁻ ⇌ Red  ·  Red + S → Ox + P",
    interpretation: "A homogeneous EC′ catalytic cycle. Electron transfer forms Red, which reacts with excess substrate S and regenerates Ox. The catalytic rate and substrate concentration control the current enhancement.",
    defaults: {bulk_concentration:0.001,substrate_concentration:0.01,diffusion_coefficient:1e-5,formal_potential:0,electron_transfer_rate:0.01,catalytic_rate:1000}
  },
  pnp_e: {
    equation: "Ox⁺ + e⁻ ⇌ Red  ·  K⁺ / A⁻ supporting electrolyte",
    interpretation: "A charged redox couple with explicit migration, diffuse charge, and Stern-layer charging through the Poisson–Nernst–Planck transport model.",
    defaults: {}
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
const simulationSolverNotes = Object.freeze({
  adaptive: "Starts with a small step for fast chemistry, estimates local error by step doubling, and grows the step when the transient relaxes. The browser limit is 12,000 accepted steps per grid solve.",
  adaptive_bdf2: "Uses variable-step, fully implicit second-order BDF2 with an embedded BDF1 error estimate. It restarts safely with BDF1 at the switching potential and may use up to 12,000 accepted steps per grid solve.",
  bdf1: "Best-effort first-order fully implicit stepping for rates beyond the adaptive resolution budget. EchemLab compares the result with a calculation using half as many steps and spatial intervals so the visible numerical sensitivity is reported.",
  bdf2: "Uses automatic fixed resolution with second-order fully implicit stepping after a BDF1 startup step. EchemLab reports the change relative to a calculation using half as many steps and spatial intervals.",
  be_fe: "Backward Euler diffusion with forward-Euler homogeneous chemistry. Fast reactions can violate its explicit reaction-step stability limit.",
  trap_ab2: "Trapezoidal diffusion with Adams–Bashforth homogeneous chemistry. Efficient for smooth nonstiff kinetics, but not recommended for very fast reactions."
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
  const group = name === "fit" ? "data" : name;
  $$(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.viewTarget === group);
  });
  window.scrollTo({top: 0, behavior: "smooth"});
}

function selectPreset(name) {
  if(!Object.hasOwn(presets,name))return;
  currentPreset = name;
  $("#preset-select").value = name;
  const model=name==="pnp_e"
    ? defaultPnpMechanism()
    : window.electrochemBrowserEngine?.presetModel({preset:name,...presets[name].defaults});
  if(!model){showError("The selected mechanism template is unavailable.");return;}
  hydrateCustomModel(model);
  setBuilderTransport(name==="pnp_e"?"pnp":"standard");
  $("#mechanism-equation").textContent = presets[name].equation;
  $("#template-note").textContent = presets[name].interpretation;
  $("#interpretation-text").textContent = presets[name].interpretation;
  $("#enhancement-label").textContent = "Comparison peak ratio";
  clearError();
}

function payloadFromForm() {
  const payload = {};
  $$('[data-key]').forEach(input => {
    if (input.disabled) return;
    payload[input.dataset.key] = input.tagName === "SELECT" ? input.value : Number(input.value);
  });
  return payload;
}

function syncSimulationSolverNote() {
  const solver=$("#simulation-solver").value;
  $("#simulation-solver-note").textContent=simulationSolverNotes[solver]||simulationSolverNotes.bdf2;
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
  if(typeof latestBrowserFit!=="undefined"&&latestBrowserFit)drawFitCharts(latestBrowserFit);
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
  const diffusion=Number(simulationInput?.custom_model?.species?.find(species=>species.phase==="solution")?.D??simulationInput?.diffusion_coefficient);
  if(Number.isFinite(diffusion)&&diffusion>0)$("#electrolyte-diffusion").value=String(diffusion);
  if(result.resolution){
    const retries=Number(result.resolution.rejected_steps||0),refinements=Number(result.resolution.grid_refinements||0);
    if(result.resolution.adaptive){
      $("#numerical-resolution-status").textContent=`Accepted ${Number(result.resolution.timesteps).toLocaleString()} adaptive steps${retries?` after ${retries.toLocaleString()} retries`:""}; used ${result.resolution.grid_points} surface-refined intervals${refinements?` after ${refinements} mesh refinement${refinements===1?"":"s"}`:""}.`;
    }else{
      const limited=result.resolution.timestep_limited_by_budget||result.resolution.grid_limited_by_budget;
      const rrms=Number(result.resolution.refinement_relative_rms),peakDifference=Number(result.resolution.refinement_peak_relative_difference);
      const percent=value=>{const scaled=100*value;return scaled<0.01?`${scaled.toExponential(2)}%`:`${scaled.toPrecision(3)}%`;};
      const comparison=Number.isFinite(rrms)&&Number.isFinite(peakDifference)?` A half-resolution comparison changed the trace by ${percent(rrms)} relative RMS and the peak magnitude by ${percent(peakDifference)}.`:"";
      $("#numerical-resolution-status").textContent=`Used ${Number(result.resolution.timesteps).toLocaleString()} fixed steps and ${result.resolution.grid_points} surface-refined intervals.${limited?" The browser resolution budget was reached, so this is a best-effort result.":""}${comparison}`;
    }
  }
  renderInitialTransientNote(result,simulationInput);
}

function renderInitialTransientNote(result,simulationInput) {
  const note=$("#initial-transient-note"),current=result?.series?.[0]?.current||[],time=result?.time||[];
  const messages=[];
  if(result?.resolution?.adaptive&&current.length>=20&&time.length===current.length){
    const skip=Math.min(10,Math.max(3,Math.floor(current.length*0.01)));
    const initialPeak=current.slice(0,skip).reduce((peak,value)=>Math.max(peak,Math.abs(value)),0);
    const laterPeak=current.slice(skip).reduce((peak,value)=>Math.max(peak,Math.abs(value)),0);
    const totalTime=Number(time.at(-1)||0);
    if(initialPeak>1.1*laterPeak&&Number(time[0])<totalTime*1e-4)messages.push("Initial-condition transient: the starting species amounts do not exactly satisfy electrode equilibrium at Ei, and the adaptive solver is resolving the rapid relaxation. This is not a timestep instability. Move Ei farther from the redox wave or choose starting oxidation states and surface coverages consistent with Ei if the experiment was equilibrated before the scan.");
  }
  if(Number(simulationInput?.double_layer_capacitance)>0)messages.push("Ideal-waveform charging: the triangular scan changes slope instantaneously at the start and switching potential, so an ideal double-layer capacitor produces a current step there. Finite uncompensated resistance smooths that step through the RC response.");
  note.textContent=messages.join(" ");note.hidden=!messages.length;
}

function updateComparisonMetric(){
  if(!latestResult){$("#enhancement").textContent="—";return;}
  if(latestResult.film_coverage?.length){
    $("#enhancement-label").textContent="Final film area coverage";
    $("#enhancement").textContent=`${(100*Number(latestResult.film_coverage.at(-1)||0)).toPrecision(4)}%`;
    return;
  }
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
  const template=latestResult.preset==="custom"?(customMechanism?.name||"Custom reaction setup"):option?.textContent.split(" — ")[0]||"Simulation";
  const id=++savedTraceSequence;
  savedTraces.push({id,name:`${template} · trace ${id}`,potential:[...latestResult.potential],
    current:[...latestResult.series[0].current],runToken:latestResult._runToken});
  $("#save-trace-button").disabled=true;renderSavedTraces();drawChart(latestResult);
}

function clearSavedTraces(){savedTraces=[];renderSavedTraces();if(latestResult)drawChart(latestResult);}

async function runSimulation() {
  clearError(); setLoading(true);
  $("#initial-transient-note").hidden=true;
  $("#numerical-resolution-status").textContent="Selecting resolution for this mechanism…";
  try {
    if (!window.electrochemBrowserEngine) {
      throw new Error("The browser calculation engine did not load. Reload the page and try again.");
    }
    const model=serializeCustomModel();
    await validateBuilder(model);
    const payload={...payloadFromForm(),preset:"custom",solver:$("#simulation-solver").value,custom_model:model};
    if($("#builder-transport").value==="pnp"){
      payload.solver="pnp";
      payload.pnp_stern_capacitance=Number($("#builder-pnp-stern").value);
      payload.pnp_pzc=Number($("#builder-pnp-pzc").value);
      payload.pnp_relative_permittivity=Number($("#builder-pnp-permittivity").value);
    }
    if(!window.electrochemBrowserEngine.supportsCustomSimulation(payload))throw new Error("Choose transport physics compatible with the current reaction setup. PNP accepts solution species and homogeneous or solution electron-transfer steps.");
    const result = await window.electrochemBrowserEngine.simulateCustom(payload);
    displayResult(result, payload);
    $("#interpretation-text").textContent=payload.solver==="pnp"?"This trace solves migration, diffusion, diffuse charge, the Stern layer, and Frumkin electron transfer together in Rust/WebAssembly.":"This trace was generated from the editable species, reactions, and rate laws shown above.";
  } catch (error) {
    showError(error.message);
    $("#numerical-resolution-status").textContent="No under-resolved simulation was run.";
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
  const filmCoverage=latestResult.film_coverage||[];
  const pnpFields=latestResult.concentrations||[];
  const pnpHeaders=latestResult.debye_length?[`faradaic_current_A_${convention.filename}`,`charging_current_A_${convention.filename}`,"surface_solution_potential_V",...pnpFields.map(field=>`${field.name.replaceAll(" ","_")}_at_electrode_M`)]:[];
  const headers = ["time_s","potential_V",...latestResult.series.map(s => `${s.name.replaceAll(" ","_")}_A_${convention.filename}`),...coverages.map(trace=>`${trace.name.replaceAll(" ","_")}_mol_cm-2`),...(filmCoverage.length?["film_area_coverage_fraction"]:[]),...pnpHeaders];
  const rows = [headers.join(",")];
  for (let i=0;i<latestResult.points;i++) rows.push([latestResult.time[i],latestResult.potential[i],...latestResult.series.map(s=>displayedCurrent(s.current[i])),...coverages.map(trace=>trace.coverage[i]),...(filmCoverage.length?[filmCoverage[i]]:[]),...(latestResult.debye_length?[displayedCurrent(latestResult.faradaic_current[i]),displayedCurrent(latestResult.charging_current[i]),latestResult.solution_potential[i+1][0],...pnpFields.map(field=>field.values[i+1][0])]:[])].join(","));
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
$("#simulation-solver").addEventListener("change",syncSimulationSolverNote);
$("#run-button").addEventListener("click", runSimulation);
$("#save-trace-button").addEventListener("click",saveCurrentTrace);
$("#show-saved-traces").addEventListener("change",()=>latestResult&&drawChart(latestResult));
$("#clear-saved-traces").addEventListener("click",clearSavedTraces);
$$('[data-plot-convention]').forEach(button=>button.addEventListener("click",()=>selectVoltammogramConvention(button.dataset.plotConvention)));
$("#download-button").addEventListener("click", downloadCSV);
$("#electrolyte-check-button").addEventListener("click",screenSupportingElectrolyte);
$("#reset-button").addEventListener("click", () => { location.reload(); });
window.addEventListener("resize", () => {if(latestResult)drawChart(latestResult);if(typeof latestBrowserFit!=="undefined"&&latestBrowserFit)drawFitCharts(latestBrowserFit);});
checkEngine();
syncSimulationSolverNote();
