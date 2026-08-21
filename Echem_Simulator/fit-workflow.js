"use strict";

const solutionFitDefinitions = [
  {name:"formal_potential",label:"Formal potential E⁰",unit:"V",initial:0,transform:"identity",lower:-0.5,upper:0.5,fit:true},
  {name:"electron_transfer_rate",label:"Electron-transfer rate k⁰",unit:"cm s⁻¹",initial:0.01,transform:"log",lower:1e-9,upper:100,fit:true},
  {name:"diffusion_coefficient",label:"Diffusion coefficient D",unit:"cm² s⁻¹",initial:1e-5,transform:"log",lower:1e-9,upper:1e-3,fit:false}
];
let latestBrowserFit = null;
let latestBrowserFitPayload = null;
let latestBrowserUncertaintyTarget = null;
let dataQualitySequence = 0;
let latestDataQualityReport = null;

function fitSelectOptions(values,current) {
  return values.map(([value,label])=>`<option value="${value}" ${String(value)===String(current)?"selected":""}>${escapeHTML(label)}</option>`).join("");
}

function fitImportEditor(dataset,index) {
  if(!dataset.raw_import)return "";
  const settings=dataset.import_settings;
  const columns=dataset.raw_import.headers.map((header,column)=>[column,header]);
  const audit=dataset.preprocessing;
  return `<details class="dataset-conditions"><summary>Import normalization · ${audit.rows_used.toLocaleString()} rows used${audit.rows_dropped?` · ${audit.rows_dropped.toLocaleString()} dropped`:""}</summary><p class="helper-text">Confirm column mapping, units, current sign, and reference-potential shift before fitting.</p><div class="custom-condition-grid"><label class="field"><span>Time column</span><select data-fit-import="${index}" data-fit-import-key="time_column">${fitSelectOptions(columns,settings.time_column)}</select></label><label class="field"><span>Time unit</span><select data-fit-import="${index}" data-fit-import-key="time_unit">${fitSelectOptions([["s","s"],["ms","ms"],["min","min"]],settings.time_unit)}</select></label><label class="field"><span>Potential column</span><select data-fit-import="${index}" data-fit-import-key="potential_column">${fitSelectOptions(columns,settings.potential_column)}</select></label><label class="field"><span>Potential unit</span><select data-fit-import="${index}" data-fit-import-key="potential_unit">${fitSelectOptions([["V","V"],["mV","mV"]],settings.potential_unit)}</select></label><label class="field"><span>Current column</span><select data-fit-import="${index}" data-fit-import-key="current_column">${fitSelectOptions(columns,settings.current_column)}</select></label><label class="field"><span>Current unit</span><select data-fit-import="${index}" data-fit-import-key="current_unit">${fitSelectOptions([["A","A"],["mA","mA"],["uA","μA"],["nA","nA"]],settings.current_unit)}</select></label><label class="field"><span>Current sign</span><select data-fit-import="${index}" data-fit-import-key="current_sign">${fitSelectOptions([[1,"As recorded"],[-1,"Invert sign"]],settings.current_sign)}</select></label><label class="field"><span>Reference shift <b>V</b></span><input data-fit-import="${index}" data-fit-import-key="reference_offset" type="number" step="any" value="${settings.reference_offset}"></label></div></details>`;
}

function formatInitialConcentrations(concentrations) {
  return Object.entries(concentrations||{}).map(([name,value])=>`${name}=${value}`).join("; ");
}

function parseInitialAmounts(text,quantity) {
  const concentrations={};
  for(const entry of text.split(/[;,]/).map(value=>value.trim()).filter(Boolean)){
    const separator=entry.indexOf("=");
    if(separator<1||entry.indexOf("=",separator+1)!==-1)throw new Error(`Use species=value entries; “${entry}” is not valid.`);
    const name=entry.slice(0,separator).trim(),rawValue=entry.slice(separator+1).trim(),value=Number(rawValue);
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))throw new Error(`“${name}” is not a valid species name.`);
    if(Object.hasOwn(concentrations,name))throw new Error(`Species “${name}” is listed more than once.`);
    if(!rawValue||!Number.isFinite(value)||value<0)throw new Error(`${name} ${quantity} must be finite and nonnegative.`);
    concentrations[name]=value;
  }
  return concentrations;
}

function parseInitialConcentrations(text) {return parseInitialAmounts(text,"concentration");}
function parseInitialCoverages(text) {return parseInitialAmounts(text,"coverage");}

function dataQualityHTML(report,index) {
  const metrics=report.datasets[index],issues=report.issues.filter(issue=>issue.dataset===index+1);
  const errors=issues.filter(issue=>issue.severity==="error").length,warnings=issues.filter(issue=>issue.severity==="warning").length;
  const issueRows=issues.map(issue=>`<div class="model-warning"><strong>${issue.severity==="error"?"Data error":"Data review"}:</strong> ${escapeHTML(issue.message)}</div>`).join("");
  const status=errors?`${errors} error${errors===1?"":"s"}`:warnings?`${warnings} warning${warnings===1?"":"s"}`:"Preflight passed";
  return `<div class="result-badges"><span class="result-badge ${errors||warnings?"":"success"}">${status}</span><span class="result-badge">Estimated ${fitNumber(metrics.estimated_scan_rate,4)} V s⁻¹</span><span class="result-badge">Largest gap ${fitNumber(metrics.maximum_gap_ratio,3)}× median</span></div>${issueRows}<details class="advanced-settings"><summary>Data preflight details</summary><div><table class="result-table"><tbody><tr><th>Duration</th><td>${fitNumber(metrics.duration,5)} s</td></tr><tr><th>Potential span</th><td>${fitNumber(metrics.potential_span,5)} V</td></tr><tr><th>Switching position</th><td>${(100*metrics.switching_fraction).toFixed(1)}%</td></tr><tr><th>Initial scan</th><td>${escapeHTML(metrics.initial_scan_direction)}</td></tr><tr><th>Duration mismatch</th><td>${(100*metrics.duration_relative_error).toFixed(2)}%</td></tr></tbody></table></div></details>`;
}

async function refreshDataQuality() {
  const sequence=++dataQualitySequence;
  if(!experimentalDatasets.length)return;
  try{
    const report=await window.electrochemBrowserEngine.inspectData(browserFitDatasets());
    if(sequence!==dataQualitySequence)return;
    latestDataQualityReport=report;
    report.datasets.forEach((_,index)=>{const target=document.querySelector(`[data-quality-index="${index}"]`);if(target)target.innerHTML=dataQualityHTML(report,index);});
  }catch(problem){
    if(sequence!==dataQualitySequence)return;
    latestDataQualityReport=null;
    $$('[data-quality-index]').forEach(target=>{target.innerHTML=`<div class="model-warning"><strong>Data preflight failed:</strong> ${escapeHTML(problem.message)}</div>`;});
  }
}

function renderBrowserDatasets() {
  const output=$("#dataset-list");
  $("#dataset-count").textContent=`${experimentalDatasets.length} loaded`;
  if(!experimentalDatasets.length){output.innerHTML='<div class="empty-state">No experimental files loaded yet.</div>';return;}
  output.innerHTML=experimentalDatasets.map((dataset,index)=>{
    let low=Infinity,high=-Infinity;for(const potential of dataset.potential){low=Math.min(low,potential);high=Math.max(high,potential);}
    const overrides=Object.keys(dataset.initial_concentrations||{}).length+Object.keys(dataset.initial_coverages||{}).length;
    return `<article class="dataset-card browser-fit-dataset"><div class="dataset-name"><strong>${escapeHTML(dataset.name)}</strong><span>${dataset.time.length.toLocaleString()} points · ${low.toFixed(3)} to ${high.toFixed(3)} V</span></div><label class="field"><span>Scan rate <b>V s⁻¹</b></span><input data-fit-dataset="${index}" type="number" min="1e-8" step="any" value="${dataset.scan_rate}"></label><button class="remove-dataset" data-remove-fit-dataset="${index}" type="button" aria-label="Remove ${escapeHTML(dataset.name)}">×</button><div class="dataset-conditions" data-quality-index="${index}"><span class="helper-text">Checking waveform…</span></div><details class="dataset-conditions"><summary>Experiment conditions${overrides?` · ${overrides} override${overrides===1?"":"s"}`:""}</summary><p class="helper-text">Override this experiment’s initial solution concentrations or surface coverages. Names must match the selected mechanism; blank uses its shared values.</p><div class="custom-condition-grid"><label class="field"><span>Initial concentrations <b>M</b></span><input data-fit-concentrations="${index}" type="text" placeholder="Ox=0.001; Catalyst=0.0002" value="${escapeHTML(formatInitialConcentrations(dataset.initial_concentrations))}"></label><label class="field"><span>Initial surface coverages <b>mol cm⁻²</b></span><input data-fit-coverages="${index}" type="text" placeholder="GammaOx=1e-10" value="${escapeHTML(formatInitialConcentrations(dataset.initial_coverages))}"></label></div></details>${fitImportEditor(dataset,index)}</article>`;
  }).join("");
  $$('[data-fit-dataset]').forEach(input=>input.addEventListener("change",()=>{experimentalDatasets[+input.dataset.fitDataset].scan_rate=Number(input.value);void refreshDataQuality();}));
  $$('[data-fit-concentrations]').forEach(input=>input.addEventListener("change",()=>{
    const error=$("#data-error");
    try{experimentalDatasets[+input.dataset.fitConcentrations].initial_concentrations=parseInitialConcentrations(input.value);error.hidden=true;renderBrowserDatasets();}
    catch(problem){error.textContent=problem.message;error.hidden=false;}
  }));
  $$('[data-fit-coverages]').forEach(input=>input.addEventListener("change",()=>{
    const error=$("#data-error");
    try{experimentalDatasets[+input.dataset.fitCoverages].initial_coverages=parseInitialCoverages(input.value);error.hidden=true;renderBrowserDatasets();}
    catch(problem){error.textContent=problem.message;error.hidden=false;}
  }));
  $$('[data-remove-fit-dataset]').forEach(button=>button.addEventListener("click",()=>{experimentalDatasets.splice(+button.dataset.removeFitDataset,1);renderBrowserDatasets();}));
  $$('[data-fit-import]').forEach(input=>input.addEventListener("change",()=>{
    const error=$("#data-error"),dataset=experimentalDatasets[+input.dataset.fitImport],key=input.dataset.fitImportKey;
    dataset.import_settings[key]=key.endsWith("_column")||key==="current_sign"||key==="reference_offset"?Number(input.value):input.value;
    try{ElectrochemImport.normalizeImportedDataset(dataset);error.hidden=true;renderBrowserDatasets();}
    catch(problem){error.textContent=problem.message;error.hidden=false;}
  }));
  void refreshDataQuality();
}

function solutionFitParameterCards() {
  const cards=solutionFitDefinitions.map(definition=>`<article class="parameter-estimate-card"><label class="parameter-estimate-toggle"><input data-solution-fit="${definition.name}" type="checkbox" ${definition.fit?"checked":""}><span><strong>Estimate ${escapeHTML(definition.label)}</strong><small>${escapeHTML(definition.transform)} coordinate</small></span></label><label class="parameter-start-value"><span>Starting / fixed value <b>${escapeHTML(definition.unit)}</b></span><input data-fit-value="${definition.name}" type="number" step="any" value="${definition.initial}"></label><label class="parameter-start-value"><span>Lower bound</span><input data-fit-lower="${definition.name}" type="number" step="any" value="${definition.lower}"></label><label class="parameter-start-value"><span>Upper bound</span><input data-fit-upper="${definition.name}" type="number" step="any" value="${definition.upper}"></label></article>`).join("");
  return cards+`<article class="parameter-estimate-card"><div class="parameter-fixed-value"><span>Default Ox bulk concentration</span><strong><input id="fit-bulk-concentration" type="number" min="0" step="any" value="0.001"> <small>M</small></strong></div><small>Each loaded experiment can override Ox in its Experiment conditions.</small></article>`;
}

function customFitParameterCards() {
  let entries=[];
  try{entries=customFitParameterEntries();}catch(error){return `<div class="model-warning">${escapeHTML(error.message)}</div>`;}
  if(!entries.length)return '<div class="empty-state">Define a supported mechanism in the builder first.</div>';
  return `<div class="fit-explainer"><strong>Mechanism-builder selection</strong><span>These checkboxes update the same fit flags shown in the builder. Bounds and starting values remain attached to the mechanism JSON.</span></div>`+entries.map(entry=>`<article class="parameter-estimate-card"><label class="parameter-estimate-toggle"><input data-custom-fit="${escapeHTML(entry.id)}" type="checkbox" ${entry.fit?"checked":""}><span><strong>Estimate ${escapeHTML(entry.label)}</strong><small>${escapeHTML(entry.id)}</small></span></label><div class="parameter-fixed-value"><span>Starting / fixed value</span><strong>${Number(entry.value).toPrecision(5)} <small>${escapeHTML(entry.unit)}</small></strong></div></article>`).join("");
}

function renderBrowserFitParameters() {
  const custom=$("#fit-preset").value==="custom";
  $("#fit-parameter-list").innerHTML=custom?customFitParameterCards():solutionFitParameterCards();
  $$('[data-custom-fit]').forEach(input=>input.addEventListener("change",()=>setCustomFitSelection(input.dataset.customFit,input.checked)));
}

function browserFitDatasets() {
  return experimentalDatasets.map(dataset=>({
    time:[...dataset.time],potential:[...dataset.potential],current:[...dataset.current],
    scan_rate:Number(dataset.scan_rate),initial_concentrations:{...(dataset.initial_concentrations||{})},
    initial_coverages:{...(dataset.initial_coverages||{})}
  }));
}

function fitSettings() {
  return {
    solver:$("#fit-solver").value,
    grid_points:Number($("#fit-grid").value),
    temperature:Number($('[data-key="temperature"]').value),
    electrode_area:Number($('[data-key="electrode_area"]').value),
    solution_resistance:Number($('[data-key="solution_resistance"]').value),
    double_layer_capacitance:Number($('[data-key="double_layer_capacitance"]').value),
    datasets:browserFitDatasets(),minimum_steps:Number($("#fit-steps").value),
    maximum_iterations:Number($("#fit-iterations").value),multistart:Number($("#fit-multistart").value),
    loss:$("#fit-loss").value,student_t_dof:Number($("#fit-student-dof").value),
    robust_scale:Number($("#fit-robust-scale").value)
  };
}

function solutionFitPayload() {
  const values=Object.fromEntries(solutionFitDefinitions.map(definition=>[definition.name,Number($(`[data-fit-value="${definition.name}"]`).value)]));
  const parameters=solutionFitDefinitions.filter(definition=>$(`[data-solution-fit="${definition.name}"]`).checked).map(definition=>({
    name:definition.name,initial:values[definition.name],transform:definition.transform,
    lower:Number($(`[data-fit-lower="${definition.name}"]`).value),
    upper:Number($(`[data-fit-upper="${definition.name}"]`).value)
  }));
  return {preset:"solution_e",...fitSettings(),bulk_concentration:Number($("#fit-bulk-concentration").value),
    diffusion_coefficient:values.diffusion_coefficient,formal_potential:values.formal_potential,
    electron_transfer_rate:values.electron_transfer_rate,parameters};
}

function customFitPayload() {
  return {preset:"custom",...fitSettings(),custom_model:serializeCustomModel()};
}

function fitNumber(value,digits=5) {
  return value!==null&&value!==undefined&&Number.isFinite(Number(value))?Number(value).toPrecision(digits):"—";
}

function renderBrowserNumericalCertification(certification) {
  if(!certification)return "";
  const labels={baseline:"Reproduction",temporal:"Finer time",spatial:"Finer grid",combined:"Both refined"};
  const rows=Object.entries(certification.checks).map(([key,check])=>`<tr><td>${labels[key]}</td><td>${check.grid_points}</td><td>${Number(check.minimum_steps).toLocaleString()}</td><td>${Number.isFinite(check.relative_rms_change)?`${(100*check.relative_rms_change).toPrecision(3)}%`:"failed"}</td><td>${Number.isFinite(check.noise_normalized_rms)?Number(check.noise_normalized_rms).toPrecision(3):"failed"}</td><td>${check.passed?"Pass":"Review"}</td></tr>`).join("");
  const warnings=certification.warnings.map(message=>`<div class="model-warning"><strong>Numerical certification:</strong> ${escapeHTML(message)}</div>`).join("");
  return `<div class="result-badges"><span class="result-badge ${certification.passed?"success":""}">Numerical certification ${certification.passed?"passed":"needs review"}</span><span class="result-badge">Residual model AR(1), ρ=${fitNumber(certification.residual_noise.correlation,3)}</span></div>${warnings}<details class="advanced-settings"><summary>Numerical refinement details</summary><div><p class="helper-text">Parameters remain fixed while the time step, spatial grid, or both are refined.</p><table class="result-table"><thead><tr><th>Check</th><th>Grid</th><th>Min. steps</th><th>RMS change</th><th>Noise SD</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function renderOptimizerRobustness(report) {
  if(!report)return "";
  const issues=report.issues.map(issue=>`<div class="model-warning"><strong>${issue.severity==="warning"?"Optimizer review":"Optimizer note"}:</strong> ${escapeHTML(issue.message)}</div>`).join("");
  const boundaries=report.boundary_parameters.length?report.boundary_parameters.map(escapeHTML).join(", "):"None";
  return `<div class="result-badges"><span class="result-badge ${report.passed?"success":""}">Multistart robustness ${report.passed?"passed":"needs review"}</span><span class="result-badge">${report.successful_attempts}/${report.attempts_requested} starts completed</span><span class="result-badge">${report.near_optimal_attempts.length} near-optimal</span></div>${issues}<details class="advanced-settings"><summary>Optimizer trust details</summary><div><p class="helper-text">Objective agreement and parameter agreement are checked separately. Equally good but different parameter values indicate practical non-identifiability.</p><table class="result-table"><tbody><tr><th>Successful fraction</th><td>${(100*report.success_fraction).toFixed(1)}%</td></tr><tr><th>Converged fraction</th><td>${(100*report.convergence_fraction).toFixed(1)}%</td></tr><tr><th>Near-optimal fraction</th><td>${(100*report.near_optimal_fraction).toFixed(1)}%</td></tr><tr><th>Objective spread</th><td>${fitNumber(report.objective_relative_spread,4)}</td></tr><tr><th>Maximum scaled parameter deviation</th><td>${fitNumber(report.maximum_scaled_parameter_deviation,4)}</td></tr><tr><th>Parameters near bounds</th><td>${boundaries}</td></tr></tbody></table></div></details>`;
}

function renderDetailedResidualDiagnostics(report) {
  if(!report)return "";
  const issues=report.issues.map(issue=>{const name=issue.dataset?experimentalDatasets[issue.dataset-1]?.name||`Dataset ${issue.dataset}`:"Study";return `<div class="model-warning"><strong>Residuals · ${escapeHTML(name)}:</strong> ${escapeHTML(issue.message)}</div>`;}).join("");
  const rows=report.datasets.map((metrics,index)=>`<tr><td>${escapeHTML(experimentalDatasets[index]?.name||`Dataset ${index+1}`)}</td><td>${Number(metrics.rms).toExponential(3)}</td><td>${Number(metrics.mean_bias_ratio).toFixed(3)}</td><td>${Number(metrics.lag_one_correlation).toFixed(3)}</td><td>${Number(metrics.branch_bias_ratio).toFixed(3)}</td><td>${Number(metrics.signal_scale_ratio).toFixed(2)}×</td><td>${Number(metrics.potential_correlation).toFixed(3)}</td><td>${(100*Number(metrics.outlier_fraction)).toFixed(2)}%</td></tr>`).join("");
  return `<div class="result-badges"><span class="result-badge ${report.passed?"success":""}">Residual diagnostics ${report.passed?"passed":"need review"}</span><span class="result-badge">AR(1) ρ=${fitNumber(report.residual_noise.correlation,3)}</span></div>${issues}<details class="advanced-settings"><summary>Residual trust details</summary><div><p class="helper-text">Weighted residual screens are descriptive checks for model inadequacy, not formal hypothesis tests.</p><table class="result-table"><thead><tr><th>Dataset</th><th>RMS</th><th>Bias / RMS</th><th>Lag-1</th><th>Branch / RMS</th><th>Scale ratio</th><th>Potential corr.</th><th>Outliers</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function renderFitResult(result) {
  const diagnostics=result.diagnostics;
  const warnings=diagnostics.warnings.length?diagnostics.warnings.map(message=>`<div class="model-warning"><strong>Review:</strong> ${escapeHTML(message)}</div>`).join(""):'<div class="result-badges"><span class="result-badge success">No automatic fit warning triggered</span></div>';
  const estimates=`<table class="result-table"><thead><tr><th>Parameter</th><th>Estimate</th><th>Standard error</th><th>Approx. 95% interval</th></tr></thead><tbody>${result.estimates.map(estimate=>`<tr><td>${escapeHTML(estimate.name)}</td><td>${fitNumber(estimate.value)}</td><td>${fitNumber(estimate.standard_error)}</td><td>${fitNumber(estimate.confidence_lower)} – ${fitNumber(estimate.confidence_upper)}</td></tr>`).join("")}</tbody></table>`;
  const robust=result.loss==="student_t";
  const attempts=`<details class="advanced-settings"><summary>Multistart details</summary><div>${diagnostics.adaptive_fallbacks?`<p class="helper-text">${diagnostics.adaptive_fallbacks} start${diagnostics.adaptive_fallbacks===1?"":"s"} used a bounded derivative-free rescue pass before LM polishing.</p>`:""}<table class="result-table"><thead><tr><th>Start</th><th>Status</th><th>${robust?"Robust objective":"Weighted RSS"}</th><th>Iterations</th></tr></thead><tbody>${result.attempts.map((attempt,index)=>`<tr><td>${index+1}</td><td>${attempt.error?"Failed":attempt.converged?"Converged":"Stopped"}</td><td>${(robust?attempt.objective:attempt.weighted_rss)==null?"—":Number(robust?attempt.objective:attempt.weighted_rss).toExponential(3)}</td><td>${attempt.iterations}</td></tr>`).join("")}</tbody></table></div></details>`;
  $("#fit-summary").className="";
  $("#fit-summary").innerHTML=`<div class="result-badges"><span class="result-badge ${result.converged?"success":""}">${result.converged?"Best start converged":"Best start stopped"}</span><span class="result-badge">${result.loss==="student_t"?"Robust Student-t":"Least squares"}</span><span class="result-badge">Forward-sensitivity Jacobian</span><span class="result-badge">${diagnostics.converged_attempts}/${result.attempts.length} starts converged</span><span class="result-badge">${diagnostics.distinct_solutions} competitive solution${diagnostics.distinct_solutions===1?"":"s"}</span><span class="result-badge">AICc ${result.aicc==null?"—":Number(result.aicc).toFixed(2)}</span><span class="result-badge">${Number(result.elapsed_seconds||0).toFixed(2)} s</span></div>${warnings}${estimates}${attempts}${renderOptimizerRobustness(result.optimizer_robustness)}${renderDetailedResidualDiagnostics(result.residual_diagnostics)}${renderBrowserNumericalCertification(result.numerical_certification)}`;
}

async function runBrowserFit() {
  const error=$("#fit-error"),button=$("#fit-button");error.hidden=true;
  if(!experimentalDatasets.length){error.textContent="Load at least one voltammogram first.";error.hidden=false;return;}
  button.disabled=true;button.textContent="Estimating parameters…";
  try{
    const custom=$("#fit-preset").value==="custom",payload=custom?customFitPayload():solutionFitPayload();
    const engine=window.electrochemBrowserEngine;
    const preflight=await engine.inspectData(payload.datasets);
    latestDataQualityReport=preflight;
    if(!preflight.passed)throw new Error(`Data preflight found ${preflight.error_count} blocking error${preflight.error_count===1?"":"s"}. Review the loaded voltammogram cards before fitting.`);
    let result;
    if(custom){if(!engine.supportsCustomFit(payload))throw new Error("Select at least one continuous mechanism parameter for custom fitting.");result=await engine.fitCustom(payload);}
    else{if(!engine.supportsFit(payload))throw new Error("Select at least one solution-E parameter.");result=await engine.fitSolutionE(payload);}
    latestBrowserFit=result;latestBrowserFitPayload=payload;
    latestBrowserUncertaintyTarget={kind:custom?"custom":"solution_e",payload};
    if(typeof renderKnownInputOptions==="function")renderKnownInputOptions();
    $("#uncertainty-parameter").innerHTML=result.estimates.map(estimate=>`<option value="${escapeHTML(estimate.name)}">${escapeHTML(estimate.name)}</option>`).join("");
    renderFitResult(result);
  }catch(problem){error.textContent=problem.message;error.hidden=false;}
  finally{button.disabled=false;button.textContent="Estimate selected parameters";}
}

$("#data-files").addEventListener("change",async event=>{
  const error=$("#data-error");error.hidden=true;
  for(const file of event.target.files){
    try{if(file.size>20_000_000)throw new Error(`${file.name}: file exceeds the 20 MB browser limit`);experimentalDatasets.push(ElectrochemImport.parseVoltammogram(await file.text(),file.name,++datasetSequence));}
    catch(problem){error.textContent=problem.message;error.hidden=false;}
  }
  event.target.value="";renderBrowserDatasets();
});
$("#use-simulation-button").addEventListener("click",()=>{
  const error=$("#data-error");error.hidden=true;
  if(!latestResult){error.textContent="Run a simulation first.";error.hidden=false;return;}
  experimentalDatasets.push({id:++datasetSequence,name:`${latestResult.preset} simulation`,time:[...latestResult.time],potential:[...latestResult.potential],current:[...latestResult.series[0].current],scan_rate:Number($('[data-key="scan_rate"]').value),initial_concentrations:{},initial_coverages:{}});
  renderBrowserDatasets();
});
$("#clear-data-button").addEventListener("click",()=>{experimentalDatasets.length=0;renderBrowserDatasets();});
$("#fit-preset").addEventListener("change",renderBrowserFitParameters);
$("#fit-loss").addEventListener("change",()=>{$$(".robust-fit-setting").forEach(field=>{field.hidden=$("#fit-loss").value!=="student_t";});});
$("#fit-button").addEventListener("click",runBrowserFit);
renderBrowserDatasets();
renderBrowserFitParameters();
