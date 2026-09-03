"use strict";

let latestBrowserFit = null;
let latestBrowserFitPayload = null;
let latestBrowserUncertaintyTarget = null;
let dataQualitySequence = 0;
let latestDataQualityReport = null;
let customFitParameterState = {};
let customFitParameterRevision = -1;
let fitSharedDiffusionEnabled = false;

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
  $("#fit-next-button").disabled=!experimentalDatasets.length;
  if(!experimentalDatasets.length){output.innerHTML='<div class="empty-state">No experimental files loaded yet.</div>';renderBrowserFitParameters();return;}
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
  renderBrowserFitParameters();
  void refreshDataQuality();
}

function customFitParameterCards() {
  let entries=[];
  try{entries=customFitParameterEntries();}catch(error){return `<div class="model-warning">${escapeHTML(error.message)}</div>`;}
  if(!entries.length)return '<div class="empty-state">Define at least one continuous parameter in the active reaction setup first.</div>';
  if(customFitParameterRevision!==customMechanismRevision){
    customFitParameterState=Object.fromEntries(entries.map(entry=>[entry.id,{fit:Boolean(entry.fit),value:Number(entry.value),lower:Number(entry.lower),upper:Number(entry.upper),transform:entry.transform}]));
    customFitParameterRevision=customMechanismRevision;
    fitSharedDiffusionEnabled=false;
  }
  const diffusionEntries=entries.filter(entry=>/^s\d+_D$/.test(entry.id));
  const canShareDiffusion=diffusionEntries.length>=2;
  if(!canShareDiffusion)fitSharedDiffusionEnabled=false;
  if(fitSharedDiffusionEnabled&&!customFitParameterState.shared_D){
    const diffusionStates=diffusionEntries.map(entry=>customFitParameterState[entry.id]||entry);
    customFitParameterState.shared_D={
      fit:false,value:Number(diffusionStates[0].value),
      lower:Math.max(...diffusionStates.map(entry=>Number(entry.lower))),
      upper:Math.min(...diffusionStates.map(entry=>Number(entry.upper))),transform:"log"
    };
  }
  if(fitSharedDiffusionEnabled){
    entries=entries.filter(entry=>!/^s\d+_D$/.test(entry.id));
    entries.unshift({id:"shared_D",label:"shared solution diffusion coefficient",unit:"cm² s⁻¹",advanced:true,...customFitParameterState.shared_D});
  }
  entries=entries.map(entry=>({...entry,...customFitParameterState[entry.id]}));
  const sharing=canShareDiffusion?`<label class="fit-link-toggle"><input id="fit-link-diffusion" type="checkbox" ${fitSharedDiffusionEnabled?"checked":""}><span><strong>Use one diffusion coefficient for all solution species</strong><small>This reduces correlation when equal diffusion is chemically reasonable. Leave it off when independently measured diffusion coefficients differ.</small></span></label>`:"";
  return `<div class="fit-explainer"><strong>Active editable reaction setup</strong><span>The simulation values supply the initial guesses below. Select only parameters that the loaded experiments can constrain. Diffusion fitting is advanced: normally fix D independently unless multiple scan rates and known concentrations and electrode area constrain it.</span></div>${sharing}`+entries.map(entry=>`<article class="parameter-estimate-card"><label class="parameter-estimate-toggle"><input data-custom-fit="${escapeHTML(entry.id)}" data-custom-fit-key="fit" type="checkbox" ${entry.fit?"checked":""}><span><strong>Estimate ${escapeHTML(entry.label)}</strong><small>${escapeHTML(entry.transform)} coordinate${entry.advanced?" · advanced":""}</small></span></label><label class="parameter-start-value"><span>Starting / fixed value <b>${escapeHTML(entry.unit)}</b></span><input data-custom-fit="${escapeHTML(entry.id)}" data-custom-fit-key="value" type="number" step="any" value="${entry.value}"></label><label class="parameter-start-value"><span>Lower bound</span><input data-custom-fit="${escapeHTML(entry.id)}" data-custom-fit-key="lower" type="number" step="any" value="${entry.lower}"></label><label class="parameter-start-value"><span>Upper bound</span><input data-custom-fit="${escapeHTML(entry.id)}" data-custom-fit-key="upper" type="number" step="any" value="${entry.upper}"></label></article>`).join("");
}

function renderBrowserFitParameters() {
  if(!experimentalDatasets.length){$("#fit-parameter-list").innerHTML='<div class="empty-state">Load at least one voltammogram before choosing parameters to estimate.</div>';$("#fit-button").disabled=true;return;}
  $("#fit-parameter-list").innerHTML=customFitParameterCards();
  $("#fit-button").disabled=false;
  $("#fit-link-diffusion")?.addEventListener("change",event=>{fitSharedDiffusionEnabled=event.target.checked;renderBrowserFitParameters();});
  $$('[data-custom-fit]').forEach(input=>input.addEventListener("change",()=>{const state=customFitParameterState[input.dataset.customFit];if(state)state[input.dataset.customFitKey]=input.dataset.customFitKey==="fit"?input.checked:Number(input.value);}));
}

function browserFitDatasets() {
  const backgroundModel=$("#fit-background-model")?.value||"none";
  return experimentalDatasets.map(dataset=>({
    time:[...dataset.time],potential:[...dataset.potential],current:[...dataset.current],
    scan_rate:Number(dataset.scan_rate),initial_concentrations:{...(dataset.initial_concentrations||{})},
    initial_coverages:{...(dataset.initial_coverages||{})},background_model:backgroundModel
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

function customFitPayload() {
  const model=serializeCustomModel();
  for(const [id,settings] of Object.entries(customFitParameterState)){
    if(id==="shared_D"||(fitSharedDiffusionEnabled&&/^s\d+_D$/.test(id)))continue;
    applyCustomFitParameter(model,id,settings);
  }
  let shared_diffusion=null;
  if(fitSharedDiffusionEnabled){
    const settings=customFitParameterState.shared_D;
    model.species.filter(species=>species.phase==="solution").forEach(species=>{species.D=Number(settings.value);species.fit_D=false;});
    shared_diffusion={value:Number(settings.value),fit:Boolean(settings.fit),transform:settings.transform,lower:Number(settings.lower),upper:Number(settings.upper)};
  }
  return {preset:"custom",...fitSettings(),custom_model:model,shared_diffusion};
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

function drawFitCanvas(canvasId,legendId,series) {
  const canvas=$(canvasId);if(!canvas||!series.length)return;
  const rect=canvas.getBoundingClientRect(),ratio=window.devicePixelRatio||1;
  canvas.width=Math.max(1,Math.round(rect.width*ratio));canvas.height=Math.max(1,Math.round(rect.height*ratio));
  const ctx=canvas.getContext("2d");ctx.scale(ratio,ratio);
  const width=rect.width,height=rect.height,pad={left:68,right:24,top:22,bottom:52},plotW=width-pad.left-pad.right,plotH=height-pad.top-pad.bottom;
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  series.forEach(trace=>{trace.potential.forEach(value=>{xmin=Math.min(xmin,value);xmax=Math.max(xmax,value);});trace.current.forEach(value=>{ymin=Math.min(ymin,value);ymax=Math.max(ymax,value);});});
  const xspan=Math.max(xmax-xmin,1e-12),yspan=Math.max(ymax-ymin,Math.max(Math.abs(ymin),Math.abs(ymax))*0.1,1e-15);
  ymin-=.08*yspan;ymax+=.08*yspan;
  const unit=currentUnit(Math.max(Math.abs(ymin),Math.abs(ymax))),reverse=activeVoltammogramConvention().reversePotentialAxis;
  const xpx=x=>pad.left+(reverse?(xmax-x):(x-xmin))/xspan*plotW,ypx=y=>pad.top+(ymax-y)/(ymax-ymin)*plotH;
  ctx.clearRect(0,0,width,height);ctx.fillStyle="#fbfcfb";ctx.fillRect(0,0,width,height);
  ctx.font="11px Inter, sans-serif";ctx.textAlign="center";ctx.textBaseline="top";
  for(let index=0;index<=5;index++){
    const x=reverse?xmax-xspan*index/5:xmin+xspan*index/5,px=xpx(x);ctx.strokeStyle="#e2e8e5";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(px,pad.top);ctx.lineTo(px,pad.top+plotH);ctx.stroke();ctx.fillStyle="#60747b";ctx.fillText(x.toFixed(2),px,pad.top+plotH+9);
  }
  ctx.textAlign="right";ctx.textBaseline="middle";
  for(let index=0;index<=5;index++){
    const y=ymin+(ymax-ymin)*index/5,py=ypx(y);ctx.strokeStyle="#e2e8e5";ctx.beginPath();ctx.moveTo(pad.left,py);ctx.lineTo(pad.left+plotW,py);ctx.stroke();ctx.fillStyle="#60747b";ctx.fillText((y*unit.scale).toPrecision(3),pad.left-9,py);
  }
  if(ymin<0&&ymax>0){ctx.strokeStyle="#aebcb8";ctx.beginPath();ctx.moveTo(pad.left,ypx(0));ctx.lineTo(pad.left+plotW,ypx(0));ctx.stroke();}
  series.forEach(trace=>{
    ctx.strokeStyle=trace.color;ctx.lineWidth=trace.dashed?2:1.4;ctx.setLineDash(trace.dashed?[7,4]:[]);ctx.globalAlpha=trace.dashed?1:.72;ctx.beginPath();
    trace.current.forEach((value,index)=>index?ctx.lineTo(xpx(trace.potential[index]),ypx(value)):ctx.moveTo(xpx(trace.potential[index]),ypx(value)));ctx.stroke();
  });
  ctx.setLineDash([]);ctx.globalAlpha=1;ctx.fillStyle="#304b53";ctx.font="12px Inter, sans-serif";ctx.textAlign="center";ctx.textBaseline="bottom";ctx.fillText("Potential vs reference (V)",pad.left+plotW/2,height-7);ctx.save();ctx.translate(16,pad.top+plotH/2);ctx.rotate(-Math.PI/2);ctx.fillText(`Current (${unit.label})`,0,0);ctx.restore();
  $(legendId).innerHTML=series.map(trace=>`<span class="legend-item"><i class="legend-line ${trace.dashed?"fit-line":""}" style="background:${trace.color};color:${trace.color}"></i>${escapeHTML(trace.name)}</span>`).join("");
}

function drawFitCharts(result) {
  const fitSeries=[],residualSeries=[];
  experimentalDatasets.forEach((dataset,index)=>{
    const color=colors[index%colors.length],name=dataset.name||`Dataset ${index+1}`,fitted=result.fitted_current[index]||[];
    fitSeries.push({name:`${name} · experiment`,potential:dataset.potential,current:dataset.current.map(displayedCurrent),color,dashed:false});
    fitSeries.push({name:`${name} · fit`,potential:dataset.potential,current:fitted.map(displayedCurrent),color,dashed:true});
    residualSeries.push({name:`${name} · data − fit`,potential:dataset.potential,current:dataset.current.map((value,point)=>displayedCurrent(value-(fitted[point]||0))),color,dashed:false});
  });
  drawFitCanvas("#fit-overlay-chart","#fit-overlay-legend",fitSeries);
  drawFitCanvas("#fit-residual-chart","#fit-residual-legend",residualSeries);
}

function renderFittedBackgrounds(backgrounds=[]) {
  const active=backgrounds.filter(background=>background.model!=="none");if(!active.length)return "";
  const capacitance=Number(active[0].charging_capacitance_F);
  const area=Number($('[data-key="electrode_area"]')?.value||0);
  const arealCapacitance=area>0?capacitance/area:null;
  const capacitanceReview=arealCapacitance!==null&&arealCapacitance>1e-3?`<div class="model-warning"><strong>Review charging capacitance:</strong> ${(1e6*arealCapacitance).toPrecision(4)} μF cm⁻² is unusually large for a compact electrode. Check the electrode area, current units, cycle/history, and whether the background model is absorbing missing faradaic physics.</div>`:"";
  const rows=active.map(background=>{const scanRate=Number(experimentalDatasets[background.dataset-1]?.scan_rate||0);return `<tr><td>${escapeHTML(experimentalDatasets[background.dataset-1]?.name||`Dataset ${background.dataset}`)}</td><td>${Number(background.offset_A).toExponential(4)}</td><td>${Math.abs(capacitance*scanRate).toExponential(4)}</td></tr>`;}).join("");
  return `${capacitanceReview}<details class="advanced-settings"><summary>Fitted charging-current model</summary><div><p class="helper-text">Shared whole-cell capacitance: <b>${capacitance.toExponential(4)} F</b>${arealCapacitance===null?"":` (${(1e6*arealCapacitance).toPrecision(4)} μF cm⁻²)`}. EchemLab uses I<sub>charge</sub> = C<sub>cell</sub>v on the cathodic scan and reverses its sign on the return scan. The constant file offsets and the one shared capacitance are counted in AIC/AICc.</p><table class="result-table"><thead><tr><th>Dataset</th><th>Constant offset (A)</th><th>|C<sub>cell</sub>v| (A)</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function renderFitResult(result) {
  const diagnostics=result.diagnostics;
  const warnings=diagnostics.warnings.length?diagnostics.warnings.map(message=>`<div class="model-warning"><strong>Review:</strong> ${escapeHTML(message)}</div>`).join(""):'<div class="result-badges"><span class="result-badge success">No automatic fit warning triggered</span></div>';
  const estimates=`<table class="result-table"><thead><tr><th>Parameter</th><th>Estimate</th><th>Standard error</th><th>Approx. 95% interval</th></tr></thead><tbody>${result.estimates.map(estimate=>`<tr><td>${escapeHTML(estimate.name)}</td><td>${fitNumber(estimate.value)}</td><td>${fitNumber(estimate.standard_error)}</td><td>${fitNumber(estimate.confidence_lower)} – ${fitNumber(estimate.confidence_upper)}</td></tr>`).join("")}</tbody></table>`;
  const robust=result.loss==="student_t";
  const attempts=`<details class="advanced-settings"><summary>Multistart details</summary><div>${diagnostics.adaptive_fallbacks?`<p class="helper-text">${diagnostics.adaptive_fallbacks} start${diagnostics.adaptive_fallbacks===1?"":"s"} used a bounded derivative-free rescue pass before LM polishing.</p>`:""}<table class="result-table"><thead><tr><th>Start</th><th>Status</th><th>${robust?"Robust objective":"Weighted RSS"}</th><th>Iterations</th></tr></thead><tbody>${result.attempts.map((attempt,index)=>`<tr><td>${index+1}</td><td>${attempt.error?"Failed":attempt.converged?"Converged":"Stopped"}</td><td>${(robust?attempt.objective:attempt.weighted_rss)==null?"—":Number(robust?attempt.objective:attempt.weighted_rss).toExponential(3)}</td><td>${attempt.iterations}</td></tr>`).join("")}</tbody></table></div></details>`;
  const jacobian=result.jacobian_method==="profiled_background_finite_difference"?"Profiled background · finite differences":"Forward-sensitivity Jacobian";
  const plots=`<section class="fit-plot-section"><h4>Experimental data and fitted model</h4><div class="fit-chart-wrap"><canvas id="fit-overlay-chart" aria-label="Experimental voltammograms and fitted model"></canvas></div><div id="fit-overlay-legend" class="legend"></div><h4>Residuals</h4><p class="helper-text">Residual = experimental current − fitted current. Random scatter around zero is the desired pattern.</p><div class="fit-chart-wrap residual"><canvas id="fit-residual-chart" aria-label="Fit residuals"></canvas></div><div id="fit-residual-legend" class="legend"></div></section>`;
  $("#fit-summary").className="";
  $("#fit-summary").innerHTML=`<div class="result-badges"><span class="result-badge ${result.converged?"success":""}">${result.converged?"Best start converged":"Best start stopped"}</span><span class="result-badge">${result.loss==="student_t"?"Robust Student-t":"Least squares"}</span><span class="result-badge">${jacobian}</span><span class="result-badge">${diagnostics.converged_attempts}/${result.attempts.length} starts converged</span><span class="result-badge">${diagnostics.distinct_solutions} competitive solution${diagnostics.distinct_solutions===1?"":"s"}</span><span class="result-badge">AICc ${result.aicc==null?"—":Number(result.aicc).toFixed(2)}</span><span class="result-badge">${Number(result.elapsed_seconds||0).toFixed(2)} s</span></div>${warnings}${estimates}${renderFittedBackgrounds(result.fitted_backgrounds)}${plots}${attempts}${renderOptimizerRobustness(result.optimizer_robustness)}${renderDetailedResidualDiagnostics(result.residual_diagnostics)}${renderBrowserNumericalCertification(result.numerical_certification)}`;
  requestAnimationFrame(()=>drawFitCharts(result));
}

async function runBrowserFit() {
  const error=$("#fit-error"),button=$("#fit-button");error.hidden=true;
  if(!experimentalDatasets.length){error.textContent="Load at least one voltammogram first.";error.hidden=false;return;}
  button.disabled=true;button.textContent="Estimating parameters…";
  try{
    const payload=customFitPayload();
    const engine=window.electrochemBrowserEngine;
    const preflight=await engine.inspectData(payload.datasets);
    latestDataQualityReport=preflight;
    if(!preflight.passed)throw new Error(`Data preflight found ${preflight.error_count} blocking error${preflight.error_count===1?"":"s"}. Review the loaded voltammogram cards before fitting.`);
    if(!engine.supportsCustomFit(payload))throw new Error("Select at least one continuous parameter from the active reaction setup.");
    const result=await engine.fitCustom(payload);
    latestBrowserFit=result;latestBrowserFitPayload=payload;
    latestBrowserUncertaintyTarget={kind:"custom",payload,fitResult:result};
    if(typeof renderKnownInputOptions==="function")renderKnownInputOptions();
    $("#uncertainty-parameter").innerHTML=result.estimates.map(estimate=>`<option value="${escapeHTML(estimate.name)}">${escapeHTML(estimate.name)}</option>`).join("");
    if(typeof renderPosteriorPriorControls==="function")renderPosteriorPriorControls(result.estimates);
    if(typeof updatePosteriorNoiseRecommendation==="function")updatePosteriorNoiseRecommendation(result);
    renderFitResult(result);
  }catch(problem){error.textContent=problem.message;error.hidden=false;}
  finally{button.disabled=!experimentalDatasets.length;button.textContent="Estimate selected parameters";}
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
  experimentalDatasets.push({id:++datasetSequence,name:`${customMechanism.name} simulation`,time:[...latestResult.time],potential:[...latestResult.potential],current:[...latestResult.series[0].current],scan_rate:Number($('[data-key="scan_rate"]').value),initial_concentrations:{},initial_coverages:{},background_model:"none"});
  renderBrowserDatasets();
});
$("#clear-data-button").addEventListener("click",()=>{experimentalDatasets.length=0;renderBrowserDatasets();});
$("#fit-background-model").addEventListener("change",()=>{latestBrowserFit=null;latestBrowserFitPayload=null;});
$("#fit-loss").addEventListener("change",()=>{$$(".robust-fit-setting").forEach(field=>{field.hidden=$("#fit-loss").value!=="student_t";});});
$("#fit-button").addEventListener("click",runBrowserFit);
renderBrowserDatasets();
renderBrowserFitParameters();
