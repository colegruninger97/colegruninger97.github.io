"use strict";

let structuredSpecies = [];
let generatedCandidates = [];
let sparseRateTable = null;
let knownInputMeasurements = [];
let knownInputOptionCache = [];
let posteriorParameterNames = [];
let discoverySequence = 0;

function discoveryTicket(){return {revision:inferenceRevision,sequence:++discoverySequence};}
function discoveryIsCurrent(ticket){return ticket.revision===inferenceRevision&&ticket.sequence===discoverySequence;}

function syncDiscoveryAvailability() {
  const pnp=$("#builder-transport")?.value==="pnp",hasData=experimentalDatasets.length>0;
  const circuit=Number($('[data-key="solution_resistance"]').value)!==0||Number($('[data-key="double_layer_capacitance"]').value)!==0;
  const leastSquares=$("#fit-loss").value==="least_squares";
  const solutionOnly=customMechanism.species.every(species=>species.phase==="solution")&&!customMechanism.film;
  $("#library-discovery-button").disabled=!hasData||pnp||circuit||!leastSquares;
  $("#structured-discovery-button").disabled=!hasData||pnp||circuit||!leastSquares||!generatedCandidates.length;
  $("#voltammetric-rate-button").disabled=!hasData||pnp||!solutionOnly;
  $("#discovery-context").textContent=pnp?"PNP inverse modeling is not available yet. The selected transport will not be silently changed.":
    !hasData?"Load your experiments in Fit data before comparing mechanisms.":
    `${latestBrowserFit?"Rate-law search uses the latest fitted values and refits the parameters selected in Fit data.":"Rate-law search uses the values and fitted/fixed choices in Fit data."} ${$("#fit-multistart").value} optimization starts per candidate. ${circuit||!leastSquares?"Library and structured searches require zero Ru and Cdl and least squares; use parameter fitting or rate-law search to retain other settings.":"Library and structured searches define their own kinetic parameters; review their species, diffusion values, and potential bounds."}${!solutionOnly?" Current-only rate-law search requires a solution-only mechanism without a film.":""}`;
}

function invalidateDiscovery() {
  discoverySequence+=1;
  $("#discovery-results").className="empty-state";
  $("#discovery-results").textContent="Search choices changed. Run the comparison again.";
}

function useCurrentSpeciesForSearch() {
  const payload=latestBrowserFit&&latestBrowserFitPayload?payloadWithFittedEstimates(latestBrowserFitPayload,latestBrowserFit):customFitPayload();
  structuredSpecies=payload.custom_model.species.map(species=>({...structuredClone(species),composition:{},D:species.phase==="surface"?0:payload.shared_diffusion?.value??species.D}));
  generatedCandidates=[];invalidateDiscovery();renderStructuredSpecies();renderCandidates();
}

function standardSearchSettings() {
  requireSupportedInference();
  const settings=fitSettings();
  if(settings.solution_resistance!==0||settings.double_layer_capacitance!==0)throw new Error("Standard-library and structured searches do not yet support nonzero circuit resistance or capacitance. Use parameter fitting or sparse rate-law search to retain those circuit settings; do not set them to zero unless physically justified.");
  if(settings.loss!=="least_squares")throw new Error("Standard-library and structured searches currently compare least-squares fits. Choose least squares in Fit data, or use sparse rate-law search with its explicit loss setting.");
  return settings;
}

function binomial(n,k){let value=1;for(let i=1;i<=Math.min(k,n-k);i++)value=value*(n-i+1)/i;return Math.round(value);}

function updateVoltammetricRateEstimate() {
  const inputs=$$('[data-voltammetric-rate-input]:checked').length;
  const degree=Math.max(1,Number($("#voltammetric-rate-degree").value));
  if(!inputs){$("#voltammetric-rate-estimate").textContent="Select at least one concentration input.";return;}
  const terms=binomial(inputs+degree,degree)-1;
  if(terms>12){$("#voltammetric-rate-estimate").textContent=`This selection creates ${terms} terms. Reduce the inputs or degree to the 12-term browser limit.`;return;}
  const supports=1n<<BigInt(terms);
  const limit=BigInt(Math.max(1,Number($("#voltammetric-rate-limit").value)));
  const mode=$("#voltammetric-rate-search").value;
  const exhaustive=mode==="exhaustive"||(mode==="auto"&&supports<=limit);
  $("#voltammetric-rate-estimate").textContent=`${terms} polynomial terms define ${supports.toLocaleString()} supports including the zero-rate model. ${exhaustive?"Every support will be fitted.":"A bounded beam search will compare up to 50 supports."}`;
}

function renderVoltammetricRateOptions(resetInputs=false) {
  const reactionSelect=$("#voltammetric-rate-reaction"),inputList=$("#voltammetric-rate-inputs");
  if(!reactionSelect||!inputList||typeof customMechanism==="undefined")return;
  const previousReaction=reactionSelect.value;
  const previousInputs=new Map($$('[data-voltammetric-rate-input]').map(input=>[input.value,{checked:input.checked,scale:Number(input.closest("label")?.querySelector('[data-voltammetric-rate-scale]')?.value)}]));
  const homogeneous=customMechanism.reactions.map((reaction,index)=>({reaction,index})).filter(({reaction})=>reaction.type==="bulk_mass_action"||reaction.type==="custom_bulk_rate");
  reactionSelect.innerHTML=homogeneous.map(({reaction,index})=>`<option value="${index+1}">${escapeHTML(reaction.label||`Reaction ${index+1}`)}</option>`).join("");
  if(!homogeneous.length){inputList.innerHTML='<div class="empty-state">Add a homogeneous reaction in the mechanism builder first.</div>';$("#voltammetric-rate-estimate").textContent="";return;}
  if(homogeneous.some(({index})=>String(index+1)===previousReaction))reactionSelect.value=previousReaction;
  const target=customMechanism.reactions[Number(reactionSelect.value)-1];
  const defaultInputs=new Set();
  try{for(const participant of parseReactionSide(target?.reactantsText||""))defaultInputs.add(participant.species);}catch{}
  const reference=Math.max(1e-6,...customMechanism.species.map(species=>Number(species.initial)||0));
  inputList.innerHTML=customMechanism.species.filter(species=>species.phase==="solution").map(species=>{
    const previous=previousInputs.get(species.name),checked=resetInputs?defaultInputs.has(species.name):(previous?.checked??defaultInputs.has(species.name));
    const scale=Number.isFinite(previous?.scale)&&previous.scale>0?previous.scale:(Number(species.initial)>0?Number(species.initial):reference);
    return `<label class="candidate-item rate-input-item"><input data-voltammetric-rate-input type="checkbox" value="${escapeHTML(species.name)}" ${checked?"checked":""}><span>${escapeHTML(species.name)}</span><span class="rate-scale-label">scale</span><input data-voltammetric-rate-scale aria-label="${escapeHTML(species.name)} concentration scale" type="number" min="1e-15" step="any" value="${scale}"></label>`;
  }).join("");
  $$('[data-voltammetric-rate-input],[data-voltammetric-rate-scale]').forEach(input=>input.addEventListener("change",updateVoltammetricRateEstimate));
  updateVoltammetricRateEstimate();
}

function selectVoltammetricRateForUncertainty(result,payload,index) {
  const model=result.models[index],error=$("#uncertainty-error");
  if(!model?.estimates?.length){error.textContent="This support has no fitted coefficients or nuisance parameters to analyze.";error.hidden=false;return;}
  setUncertaintyTarget({kind:"voltammetric_rate_law",discovery:payload,active:[...model.active]},model.estimates,`Selected rate law: ${model.formula} · ${payload.datasets.length} experiment(s)`);
  switchView("uncertainty");
  error.hidden=true;
}

function renderVoltammetricRateResult(result,payload) {
  const best=result.models[0];
  const terms=best.terms.length?best.terms.map(term=>`<tr><td>${escapeHTML(term.label)}</td><td>${Number(term.coefficient).toExponential(6)}</td><td>${term.confidence_lower==null?"—":`${Number(term.confidence_lower).toExponential(3)} – ${Number(term.confidence_upper).toExponential(3)}`}</td></tr>`).join(""):'<tr><td colspan="3">No nonzero rate term was selected.</td></tr>';
  const ranks=result.models.slice(0,12).map((model,index)=>`<div class="rank-row"><strong>${index+1}</strong><div>${escapeHTML(model.formula)}<div class="weight-bar"><i style="width:${100*model.weight}%"></i></div></div><span>Δ${result.criterion} ${Number(model.delta).toFixed(2)}</span><span>${(100*model.weight).toFixed(1)}%</span>${model.estimates?.length?`<button class="button secondary small" data-rate-uq-model="${index}" type="button">Analyze uncertainty</button>`:""}</div>`).join("");
  const inclusion=[...result.inclusion_weights].sort((a,b)=>b.weight-a.weight).map(item=>`<tr><td>${escapeHTML(item.name)}</td><td>${(100*item.weight).toFixed(1)}%</td></tr>`).join("");
  const stability=result.stability?`<details class="advanced-settings"><summary>Whole-experiment stability · ${result.stability.successful_replicates}/${result.stability.requested_replicates} searches completed</summary><div><p class="helper-text">Term frequency is the fraction of successful, whole-voltammogram bootstrap searches whose top-ranked support contained that term. Exact-support frequency requires the complete full-data expression to win unchanged.</p><table class="result-table"><thead><tr><th>Candidate</th><th>Selection frequency</th></tr></thead><tbody><tr><td>Exact full-data support</td><td>${(100*result.stability.full_support_frequency).toFixed(1)}%</td></tr>${result.stability.selection_frequencies.map(item=>`<tr><td>${escapeHTML(item.name)}</td><td>${(100*item.weight).toFixed(1)}%</td></tr>`).join("")}<tr><td>No additional reaction</td><td>${(100*result.stability.null_selection_frequency).toFixed(1)}%</td></tr></tbody></table><p class="helper-text">Seed ${result.stability.seed} · ${result.stability.failed_replicates} failed replicate${result.stability.failed_replicates===1?"":"s"}</p></div></details>`:"";
  const predictive=predictiveValidationHTML(best.predictive_validation,"Top-support held-out validation");
  $("#discovery-results").className="";
  $("#discovery-results").innerHTML=`<div class="result-badges"><span class="result-badge success">Direct voltammetric inference</span><span class="result-badge">${result.criterion}</span><span class="result-badge">${result.attempted_supports}/${result.admissible_supports} supports</span><span class="result-badge">${Number(result.elapsed_seconds||0).toFixed(2)} s</span></div>${discoveryWarningHTML(result.warnings)}<div class="formula-box">rate = ${escapeHTML(best.formula)}</div><table class="result-table"><thead><tr><th>Selected term</th><th>Coefficient</th><th>Approx. 95% interval</th></tr></thead><tbody>${terms}</tbody></table>${predictive}<div class="section-heading compact subheading"><div><h3>Competing rate laws</h3><p>Close scores indicate that the voltammograms do not uniquely identify one expression.</p></div></div>${ranks}<details class="advanced-settings"><summary>Rate-term inclusion weights</summary><div><table class="result-table"><thead><tr><th>Candidate term</th><th>Weight</th></tr></thead><tbody>${inclusion}</tbody></table></div></details>${stability}`;
  $$('[data-rate-uq-model]').forEach(button=>button.addEventListener("click",()=>selectVoltammetricRateForUncertainty(result,payload,Number(button.dataset.rateUqModel))));
  attachComparisonInspector(result.models,payload);
}

async function runVoltammetricRateDiscovery() {
  const error=$("#discovery-error"),button=$("#voltammetric-rate-button");error.hidden=true;
  if(!experimentalDatasets.length){error.textContent="Load experimental voltammograms before inferring a rate law.";error.hidden=false;return;}
  const selected=$$('[data-voltammetric-rate-input]:checked');
  if(!selected.length){error.textContent="Select at least one concentration input.";error.hidden=false;return;}
  button.disabled=true;button.textContent="Fitting candidate rate laws…";
  const ticket=discoveryTicket();
  try{
    const fitted=currentRateSearchFit();
    const payload={...fitted,
      target_reaction:Number($("#voltammetric-rate-reaction").value),input_species:selected.map(input=>input.value),
      concentration_scales:selected.map(input=>Number(input.closest("label").querySelector('[data-voltammetric-rate-scale]').value)),
      maximum_degree:Number($("#voltammetric-rate-degree").value),first_order_guess:Number($("#voltammetric-rate-guess").value),lower_factor:1e-6,upper_factor:1e6,
      criterion:$("#voltammetric-rate-criterion").value,search_mode:$("#voltammetric-rate-search").value,exhaustive_limit:Number($("#voltammetric-rate-limit").value),maximum_evaluations:50,beam_width:3,minimum_terms:0,
      loss:$("#voltammetric-rate-loss").value,student_t_dof:Number($("#voltammetric-rate-dof").value),robust_scale:Number($("#voltammetric-rate-scale").value),
      stability_replicates:Number($("#voltammetric-rate-stability").value),stability_seed:Number($("#voltammetric-rate-stability-seed").value),
      predictive_validation:$("#voltammetric-rate-predictive-validation").checked};
    await validateBuilder(payload.custom_model);
    if(!discoveryIsCurrent(ticket))return;
    const result=await window.electrochemBrowserEngine.discoverVoltammetricRate(payload);
    if(discoveryIsCurrent(ticket))renderVoltammetricRateResult(result,payload);
  }catch(problem){if(discoveryIsCurrent(ticket)){error.textContent=problem.message;error.hidden=false;}}
  finally{button.textContent="Infer rate law from voltammograms";syncDiscoveryAvailability();}
}

function analysisSettings() {
  return {
    solver:$("#fit-solver").value,
    grid_points:Number($("#fit-grid").value),
    temperature:Number($('[data-key="temperature"]').value),
    electrode_area:Number($('[data-key="electrode_area"]').value),
    datasets:browserFitDatasets(),
    minimum_steps:Number($("#fit-steps").value),
    maximum_iterations:Number($("#fit-iterations").value),
    multistart:Number($("#fit-multistart").value)
  };
}

function discoveryWarningHTML(warnings) {
  return (warnings||[]).map(message=>`<div class="model-warning"><strong>Review:</strong> ${escapeHTML(message)}</div>`).join("");
}

function discoveryEstimateHTML(estimates) {
  if(!estimates?.length)return "";
  return `<small>${estimates.map(estimate=>`${escapeHTML(estimate.name)}=${fitNumber(estimate.value,4)}`).join(" · ")}</small>`;
}

function predictiveValidationHTML(validation,title="Held-out predictive validation") {
  if(!validation)return "";
  const rows=validation.fold_scores.map((score,index)=>`<tr><td>${index+1}</td><td>${Number(score).toPrecision(5)}</td><td>${Number(validation.fold_noise_scales[index]).toPrecision(4)}</td><td>${Number(validation.fold_noise_correlations[index]).toPrecision(4)}</td></tr>`).join("");
  return `<details class="advanced-settings"><summary>${escapeHTML(title)} · mean NLL ${Number(validation.mean_negative_log_likelihood).toPrecision(5)}</summary><div><p class="helper-text">Each fold fits all other complete experiments, estimates an AR(1) residual model from those training traces, and predicts the untouched voltammogram.</p><table class="result-table"><thead><tr><th>Held-out experiment</th><th>Predictive NLL</th><th>Noise scale</th><th>AR(1) ρ</th></tr></thead><tbody>${rows}</tbody></table><p class="helper-text">Fold standard error ${Number(validation.standard_error).toPrecision(4)}.</p></div></details>`;
}

function observationalEquivalenceHTML(report) {
  if(!report)return "";
  const exact=report.numerical_groups||[],practical=report.practical_groups||[];
  if(!exact.length&&!practical.length)return "";
  const groupRows=(groups,label)=>groups.map(group=>`<tr><td>${escapeHTML(label)}</td><td>${group.models.map(escapeHTML).join(" · ")}</td><td>${Number(group.maximum_relative_difference).toExponential(2)}</td><td>${Number(group.maximum_noise_distance).toFixed(3)}</td></tr>`).join("");
  return `<details class="advanced-settings" open><summary>Observational equivalence · ${exact.length} numerical, ${practical.length} residual-scale group${practical.length===1?"":"s"}</summary><div><p class="helper-text">These mechanisms make indistinguishable predictions for the supplied waveforms and conditions. This does not mean their chemistry is identical under every experiment. Within numerical-equivalence groups, the ranking favors the simpler parameterization.</p><table class="result-table"><thead><tr><th>Class</th><th>Mechanisms</th><th>Maximum relative difference</th><th>Noise distance</th></tr></thead><tbody>${groupRows(exact,"Numerical")}${groupRows(practical,"Residual scale")}</tbody></table><p class="helper-text">Residual-scale groups use a noise-whitened distance threshold of ${Number(report.practical_threshold).toFixed(2)} (scale ${Number(report.noise_scale).toExponential(2)}, AR(1) ρ ${Number(report.noise_correlation).toFixed(3)}).</p></div></details>`;
}

function renderDiscoveryResult(result,payload) {
  const search=result.admissible_supports===undefined?"":`<div class="result-badges"><span class="result-badge ${result.exhaustive?"success":""}">${result.exhaustive?"Exhaustive":"Heuristic beam"} search</span><span class="result-badge">${result.attempted_supports}/${result.admissible_supports} supports attempted</span>${result.failed_supports?`<span class="result-badge">${result.failed_supports} failed</span>`:""}</div>`;
  const rows=result.models.map((model,index)=>`<div class="rank-row"><strong>${index+1}</strong><div>${escapeHTML(model.name)}${discoveryEstimateHTML(model.estimates)}<div class="weight-bar"><i style="width:${100*model.weight}%"></i></div></div><span>Δ${result.criterion} ${Number(model.delta).toFixed(2)}</span><span>${(100*model.weight).toFixed(1)}%</span></div>${predictiveValidationHTML(model.predictive_validation,`${model.name} held-out validation`)}`).join("");
  const inclusion=result.inclusion_weights?.length?`<details class="advanced-settings"><summary>Reaction inclusion weights</summary><div><table class="result-table"><thead><tr><th>Reaction</th><th>Weight</th></tr></thead><tbody>${[...result.inclusion_weights].sort((a,b)=>b.weight-a.weight).map(item=>`<tr><td>${escapeHTML(item.name)}</td><td>${(100*item.weight).toFixed(1)}%</td></tr>`).join("")}</tbody></table></div></details>`:"";
  const stability=result.stability?`<details class="advanced-settings"><summary>Whole-experiment stability · ${result.stability.successful_replicates}/${result.stability.requested_replicates} searches completed</summary><div><p class="helper-text">Each repeat resamples complete voltammograms, refits every searched support, and records the winning reaction set.</p><table class="result-table"><thead><tr><th>Candidate</th><th>Selection frequency</th></tr></thead><tbody><tr><td>Exact full-data support</td><td>${(100*result.stability.full_support_frequency).toFixed(1)}%</td></tr>${result.stability.selection_frequencies.map(item=>`<tr><td>${escapeHTML(item.name)}</td><td>${(100*item.weight).toFixed(1)}%</td></tr>`).join("")}</tbody></table><p class="helper-text">Seed ${result.stability.seed} · ${result.stability.failed_replicates} failed replicate${result.stability.failed_replicates===1?"":"s"}</p></div></details>`:"";
  $("#discovery-results").className="";
  $("#discovery-results").innerHTML=`<div class="result-badges"><span class="result-badge success">Rust/Wasm model comparison</span><span class="result-badge">${result.criterion}</span><span class="result-badge">${Number(result.elapsed_seconds||0).toFixed(2)} s</span></div>${search}${discoveryWarningHTML(result.warnings)}${observationalEquivalenceHTML(result.observational_equivalence)}${rows}${inclusion}${stability}`;
  const revision=inferenceRevision,sequence=discoverySequence;
  $("#discovery-results").insertAdjacentHTML("beforeend",`<section class="fit-plot-section"><h4>Continue with a mechanism</h4><p class="helper-text">Replace the reaction setup with a ranked model and refit this study from its estimated values. Fitted/fixed choices, linked rates, bounds, and experiment-specific concentrations are preserved. After fitting, choose Analyze uncertainty.</p><label class="field"><span>Mechanism to use</span><select id="discovery-use-model">${result.models.map((model,index)=>`<option value="${index}">${index+1}. ${escapeHTML(model.name)}</option>`).join("")}</select></label><button id="discovery-use-button" class="button primary action-button" type="button">Use model &amp; refit</button></section>`);
  $("#discovery-use-button").addEventListener("click",()=>useDiscoveredModel(result.models[Number($("#discovery-use-model").value)],payload,{revision,sequence}));
}

async function useDiscoveredModel(model,source,ticket) {
  const error=$("#discovery-error"),button=$("#discovery-use-button");error.hidden=true;
  if(!discoveryIsCurrent(ticket))return;
  button.disabled=true;button.textContent="Preparing selected mechanism…";
  try{
    if(!model?.fit_setup)throw new Error("This result does not contain an editable model. Run the search again with the updated browser engine.");
    const setup=structuredClone(model.fit_setup),study=structuredClone(source);
    if(setup.initial_concentrations.length!==study.datasets.length||setup.initial_coverages.length!==study.datasets.length)throw new Error("The selected model's experiments are incomplete. Run the search again.");
    await window.electrochemBrowserEngine.validateCustom(setup.custom_model);
    if(!discoveryIsCurrent(ticket))return;
    experimentalDatasets=experimentalDatasets.map((dataset,index)=>({...dataset,...study.datasets[index],initial_concentrations:setup.initial_concentrations[index],initial_coverages:setup.initial_coverages[index]}));
    for(const key of ["temperature","electrode_area","solution_resistance","double_layer_capacitance"]){$(`[data-key="${key}"]`).value=String(study[key]);}
    for(const [selector,key] of [["#fit-solver","solver"],["#fit-grid","grid_points"],["#fit-steps","minimum_steps"],["#fit-iterations","maximum_iterations"],["#fit-multistart","multistart"],["#fit-loss","loss"]])$(selector).value=String(study[key]);
    $("#fit-background-model").value=study.datasets[0].background_model||"none";
    setBuilderTransport("standard");
    hydrateCustomModel(setup.custom_model);
    currentPreset="custom";$("#preset-select").value="custom";
    $("#template-note").textContent=`Selected from mechanism search: ${model.name}. The simulation waveform is unchanged; review it before a forward run.`;
    renderBrowserDatasets();
    if(setup.shared_diffusion){fitSharedDiffusionEnabled=true;customFitParameterState.shared_D={...setup.shared_diffusion};}
    renderBrowserFitParameters();
    switchView("fit");
    await runBrowserFit();
  }catch(problem){error.textContent=problem.message;error.hidden=false;}
  finally{button.disabled=false;button.textContent="Use model & refit";}
}

function attachComparisonInspector(models,payload) {
  const available=models.map((model,index)=>({model,index})).filter(({model})=>model.fitted_current?.length);
  if(!available.length)return;
  const revision=inferenceRevision,sequence=discoverySequence,datasets=structuredClone(payload.datasets);
  $("#discovery-results").insertAdjacentHTML("beforeend",`<section class="fit-plot-section"><h4>Inspect a candidate fit</h4><p class="helper-text">Compare predicted current and residuals before interpreting the ranking. Traces are available for the top 12 models.</p><label class="field"><span>Ranked model</span><select id="discovery-inspect-model">${available.map(({model,index})=>`<option value="${index}">${index+1}. ${escapeHTML(model.formula||model.name)}</option>`).join("")}</select></label><button id="discovery-inspect-button" class="button secondary action-button" type="button">Show fitted trace and residuals</button><div id="discovery-inspect-plots" hidden><h4>Experimental data and predicted current</h4><div class="fit-chart-wrap"><canvas id="discovery-fit-chart" aria-label="Selected mechanism fit"></canvas></div><div id="discovery-fit-legend" class="legend"></div><h4>Residuals: data minus prediction</h4><div class="fit-chart-wrap residual"><canvas id="discovery-residual-chart" aria-label="Selected mechanism residuals"></canvas></div><div id="discovery-residual-legend" class="legend"></div></div></section>`);
  $("#discovery-inspect-button").addEventListener("click",()=>{
    if(revision!==inferenceRevision||sequence!==discoverySequence)return;
    const model=models[Number($("#discovery-inspect-model").value)],fits=[],residuals=[];
    if(!model?.fitted_current)return;
    const chrono=datasets.every(dataset=>dataset.experiment_type==="chronoamperometry");
    datasets.forEach((dataset,index)=>{
      const coordinate=chrono?dataset.time:dataset.potential,color=colors[index%colors.length],name=dataset.name||`Experiment ${index+1}`,prediction=model.fitted_current[index];
      fits.push({name:`${name} · experiment`,coordinate,current:dataset.current.map(displayedCurrent),color,dashed:false},{name:`${name} · prediction`,coordinate,current:prediction.map(displayedCurrent),color,dashed:true});
      residuals.push({name,coordinate,current:dataset.current.map((value,i)=>displayedCurrent(value-prediction[i])),color,dashed:false});
    });
    $("#discovery-inspect-plots").hidden=false;
    const label=chrono?"Time (s)":"Potential vs reference (V)",reverse=!chrono&&activeVoltammogramConvention().reversePotentialAxis;
    drawFitCanvas("#discovery-fit-chart","#discovery-fit-legend",fits,label,reverse);
    drawFitCanvas("#discovery-residual-chart","#discovery-residual-legend",residuals,label,reverse);
  });
}

function renderCatalyticDatasetOptions() {
  const catalytic=$("#catalytic-trace"),reference=$("#catalytic-reference");
  if(!catalytic||!reference)return;
  const previousCatalytic=catalytic.value,previousReference=reference.value;
  const options=experimentalDatasets.map((dataset,index)=>`<option value="${index}">${escapeHTML(dataset.name)}</option>`).join("");
  catalytic.innerHTML=options;reference.innerHTML=options;
  if(experimentalDatasets[Number(previousCatalytic)])catalytic.value=previousCatalytic;
  if(experimentalDatasets[Number(previousReference)])reference.value=previousReference;
  else if(experimentalDatasets.length>1)reference.value="1";
}

function catalyticIssueLabel(issue) {
  return ({insufficient_substrate_excess:"The declared substrate concentration is not in sufficient excess over catalyst.",insufficient_catalytic_enhancement:"The catalytic enhancement is below the analytical method's threshold.",nonlinear_foot:"The selected foot is not sufficiently linear.",material_foot_intercept:"The foot fit has a material intercept.",nonpositive_foot_slope:"The fitted foot slope is nonpositive.",nonflat_plateau:"The selected kinetic plateau is not sufficiently flat.",nonpositive_plateau_current:"The plateau current does not give a positive rate."})[issue]||issue.replaceAll("_"," ");
}

async function runCatalyticRate() {
  const error=$("#discovery-error"),button=$("#catalytic-rate-button");error.hidden=true;
  renderCatalyticDatasetOptions();
  const catalytic=experimentalDatasets[Number($("#catalytic-trace").value)],reference=experimentalDatasets[Number($("#catalytic-reference").value)];
  if(!catalytic||!reference){error.textContent="Load a catalytic voltammogram and a substrate-free reference in the data workspace first.";error.hidden=false;return;}
  if(catalytic.potential.length!==reference.potential.length||catalytic.potential.some((value,index)=>Math.abs(value-reference.potential[index])>1e-8*Math.max(1,Math.abs(value)))){error.textContent="The catalytic and reference traces must use the same sampled potential grid.";error.hidden=false;return;}
  button.disabled=true;button.textContent="Estimating rate…";
  const ticket=discoveryTicket();
  try{
    const result=await window.electrochemBrowserEngine.analyzeCatalyticRate({method:$("#catalytic-method").value,potential:[...catalytic.potential],current:[...catalytic.current],reference_current:[...reference.current],formal_potential:Number($("#catalytic-e0").value),scan_rate:Number(catalytic.scan_rate),substrate_concentration:Number($("#catalytic-substrate").value),catalyst_concentration:Number($("#catalytic-catalyst").value),temperature:Number($('[data-key="temperature"]').value),electron_count:Number($("#catalytic-electrons").value),minimum_excess_ratio:Number($("#catalytic-excess").value)});
    if(!discoveryIsCurrent(ticket))return;
    const checks=result.issues.length?result.issues.map(issue=>`<div class="model-warning"><strong>Applicability:</strong> ${escapeHTML(catalyticIssueLabel(issue))}</div>`):'<div class="result-badges"><span class="result-badge success">Analytical assumptions passed</span></div>';
    const diagnostics=result.method==="fowa"?`Foot slope ${fitNumber(result.statistic)} · intercept ${fitNumber(result.intercept)} · R² ${Number(result.r_squared).toFixed(4)}`:`Plateau/reference ratio ${fitNumber(result.statistic)} · relative span ${(100*result.relative_signal_span).toFixed(2)}%`;
    $("#discovery-results").className="";
    $("#discovery-results").innerHTML=`<div class="result-badges"><span class="result-badge ${result.applicable?"success":""}">${result.method==="fowa"?"Foot-of-wave":"Plateau-current"} EC′ estimate</span><span class="result-badge">${result.points_used} points</span><span class="result-badge">${Number(result.elapsed_seconds||0).toFixed(3)} s</span></div>${checks}<div class="formula-box">k<sub>obs</sub> = ${Number(result.observed_rate).toExponential(6)} s⁻¹<br>k₂ = ${Number(result.second_order_rate).toExponential(6)} M⁻¹ s⁻¹</div><p class="helper-text">${diagnostics}. Treat this as an ideal-model comparison to the full-wave fit, not as a substitute for it.</p>`;
  }catch(problem){if(discoveryIsCurrent(ticket)){error.textContent=problem.message;error.hidden=false;}}
  finally{button.disabled=false;button.textContent="Estimate catalytic rate";}
}

async function runLibraryDiscovery() {
  const error=$("#discovery-error"),button=$("#library-discovery-button");error.hidden=true;
  if(!experimentalDatasets.length){error.textContent="Load experimental voltammograms before comparing mechanisms.";error.hidden=false;return;}
  button.disabled=true;button.textContent="Fitting candidate mechanisms…";
  const ticket=discoveryTicket();
  try{
    const payload={...standardSearchSettings(),
      bulk_concentration:Number($("#discover-concentration").value),
      diffusion_coefficient:Number($("#discover-diffusion").value),
      substrate_concentration:Number($("#discover-substrate").value),
      formal_potential_lower:Number($("#discover-e0-lower").value),
      formal_potential_upper:Number($("#discover-e0-upper").value),
      candidates:$$('[data-library-candidate]:checked').map(input=>input.dataset.libraryCandidate),
      criterion:$("#discover-criterion").value,predictive_validation:$("#library-predictive-validation").checked};
    if(!payload.candidates.length)throw new Error("Select at least one standard mechanism.");
    const result=await window.electrochemBrowserEngine.discoverLibrary(payload);
    if(discoveryIsCurrent(ticket)){renderDiscoveryResult(result,payload);attachComparisonInspector(result.models,payload);}
  }catch(problem){if(discoveryIsCurrent(ticket)){error.textContent=problem.message;error.hidden=false;}}
  finally{button.textContent="Compare standard mechanisms";syncDiscoveryAvailability();}
}

function parseElementCounts(text) {
  const composition={};
  for(const entry of text.split(/[;,]/).map(value=>value.trim()).filter(Boolean)){
    const match=/^([A-Z][a-z]?)\s*=\s*([1-9]\d*)$/.exec(entry);
    if(!match||!Number.isSafeInteger(Number(match[2])))throw new Error("Use element=count entries, for example Fe=1; C=6; N=6. Counts must be positive whole numbers.");
    if(Object.hasOwn(composition,match[1]))throw new Error(`Element ${match[1]} is listed more than once.`);
    composition[match[1]]=Number(match[2]);
  }
  return composition;
}

function renderStructuredSpecies() {
  $("#species-editor").innerHTML=structuredSpecies.length?structuredSpecies.map((species,index)=>`<article class="structured-species-card"><div class="field-grid">
    <label class="field"><span>Species name</span><input data-structured-species="${index}" data-structured-key="name" value="${escapeHTML(species.name)}"></label>
    <label class="field"><span>Phase</span><select data-structured-species="${index}" data-structured-key="phase"><option value="solution"${species.phase==="solution"?" selected":""}>In solution</option><option value="surface"${species.phase==="surface"?" selected":""}>Surface-bound</option></select></label>
    <label class="field"><span>Charge <b>z</b></span><input data-structured-species="${index}" data-structured-key="charge" type="number" step="1" value="${species.charge}"></label>
    <label class="field"><span>Initial ${species.phase==="surface"?"coverage":"concentration"} <b>${species.phase==="surface"?"mol cm⁻²":"M"}</b></span><input data-structured-species="${index}" data-structured-key="initial" type="number" min="0" step="any" value="${species.initial}"></label>
    <label class="field"><span>Element counts</span><input data-structured-species="${index}" data-structured-key="composition" placeholder="Fe=1; C=6; N=6" value="${escapeHTML(Object.entries(species.composition).map(([element,count])=>`${element}=${count}`).join('; '))}"></label>
    ${species.phase==="solution"?`<label class="field"><span>Fixed diffusion coefficient <b>cm² s⁻¹</b></span><input data-structured-species="${index}" data-structured-key="D" type="number" min="0" step="any" value="${species.D}"></label>`:""}
    </div><button class="button secondary small" data-remove-structured-species="${index}" type="button">Remove ${escapeHTML(species.name)}</button></article>`).join(""):'<p class="empty-state">Use the species from your reaction setup, or add the species you want to consider.</p>';
  $$('[data-structured-key]').forEach(input=>input.addEventListener("change",()=>{
    const species=structuredSpecies[Number(input.dataset.structuredSpecies)],key=input.dataset.structuredKey;
    invalidateDiscovery();generatedCandidates=[];renderCandidates();$("#discovery-error").hidden=true;
    if(key==="composition")species.composition={};
    try{species[key]=["name","phase"].includes(key)?input.value.trim():key==="composition"?parseElementCounts(input.value):Number(input.value);if(key==="phase"){species.initial=0;species.D=species.phase==="surface"?0:(species.D>0?species.D:1e-5);renderStructuredSpecies();}generatedCandidates=[];renderCandidates();}
    catch(problem){const error=$("#discovery-error");error.textContent=`Invalid species value: ${problem.message}`;error.hidden=false;}
  }));
  $$('[data-remove-structured-species]').forEach(button=>button.addEventListener("click",()=>{structuredSpecies.splice(Number(button.dataset.removeStructuredSpecies),1);generatedCandidates=[];invalidateDiscovery();renderStructuredSpecies();renderCandidates();}));
}

function updateStructuredEstimate() {
  const choices=$$('[data-structured-candidate]'),selected=choices.filter(input=>input.value!=="excluded").length,required=choices.filter(input=>input.value==="required").length;
  if(!selected){$("#structured-search-estimate").textContent="Select at least one candidate reaction.";return;}
  const total=(1n<<BigInt(selected-required))-(required?0n:1n),limit=BigInt(Math.max(1,Number($("#structured-exhaustive-limit").value))),budget=BigInt(Math.max(1,Number($("#structured-max-evaluations").value))),mode=$("#structured-search-mode").value;
  const exhaustive=mode==="exhaustive"||(mode==="auto"&&total<=limit);
  $("#structured-search-estimate").textContent=`${required} required and ${selected-required} candidate reactions define up to ${total.toLocaleString()} reaction combinations. ${exhaustive?"All admissible combinations will be fitted.":`The search will attempt up to ${budget.toLocaleString()} combinations.`} Every model must contain electron transfer.`;
}

function renderCandidates() {
  const output=$("#candidate-preview");
  if(!generatedCandidates.length){output.innerHTML="";$("#structured-search-estimate").textContent="Generate candidates, then mark known reactions Required and uncertain reactions Candidate.";syncDiscoveryAvailability();return;}
  output.innerHTML=generatedCandidates.map(candidate=>`<label class="candidate-item"><span>${escapeHTML(candidate.name)}</span><select data-structured-candidate="${candidate.index}" aria-label="Role of ${escapeHTML(candidate.name)}"><option value="candidate">Candidate — test whether needed</option><option value="required">Required — known to occur</option><option value="excluded">Excluded — do not use</option></select></label>`).join("");
  $$('[data-structured-candidate]').forEach(input=>input.addEventListener("change",updateStructuredEstimate));
  updateStructuredEstimate();
  syncDiscoveryAvailability();
}

function structuredDefinitionPayload() {
  // Read the displayed fields at the action boundary too: do not depend on blur
  // events to commit composition, charge, or other scientific inputs.
  const species=structuredClone(structuredSpecies);
  $$('[data-structured-key]').forEach(input=>{
    const definition=species[Number(input.dataset.structuredSpecies)],key=input.dataset.structuredKey;
    if(!definition)return;
    definition[key]=["name","phase"].includes(key)?input.value.trim():key==="composition"?parseElementCounts(input.value):Number(input.value);
  });
  return {species,maximum_molecularity:Number($("#structured-molecularity").value),maximum_electrons:Number($("#structured-electrons").value)};
}

async function generateStructuredCandidates() {
  const error=$("#discovery-error"),button=$("#generate-candidates-button");error.hidden=true;button.disabled=true;
  invalidateDiscovery();
  const ticket=discoveryTicket();
  try{
    const definition=structuredDefinitionPayload();
    if(!definition.species.length||definition.species.some(species=>!Object.keys(species.composition||{}).length))throw new Error("Add your species and their elemental compositions before generating balanced reactions. Composition cannot be inferred from a species label.");
    const candidates=await window.electrochemBrowserEngine.generateCandidates(definition);
    if(discoveryIsCurrent(ticket)){structuredSpecies=definition.species;generatedCandidates=candidates;renderCandidates();}
  }
  catch(problem){if(discoveryIsCurrent(ticket)){error.textContent=problem.message;error.hidden=false;}}
  finally{button.disabled=false;}
}

async function runStructuredDiscovery() {
  const error=$("#discovery-error"),button=$("#structured-discovery-button");error.hidden=true;
  if(!experimentalDatasets.length){error.textContent="Load experimental voltammograms before searching reaction supports.";error.hidden=false;return;}
  if(!generatedCandidates.length){error.textContent="Generate the balanced reaction candidates first.";error.hidden=false;return;}
  button.disabled=true;button.textContent="Searching reaction supports…";
  const ticket=discoveryTicket();
  try{
    const payload={...standardSearchSettings(),...structuredDefinitionPayload(),
      included_candidates:$$('[data-structured-candidate]').filter(input=>input.value!=="excluded").map(input=>Number(input.dataset.structuredCandidate)),
      required_candidates:$$('[data-structured-candidate]').filter(input=>input.value==="required").map(input=>Number(input.dataset.structuredCandidate)),criterion:$("#structured-criterion").value,
      search_mode:$("#structured-search-mode").value,
      exhaustive_limit:Number($("#structured-exhaustive-limit").value),
      maximum_evaluations:Number($("#structured-max-evaluations").value),
      beam_width:3,minimum_reactions:1,
      stability_replicates:Number($("#structured-stability").value),stability_seed:Number($("#structured-stability-seed").value)};
    const result=await window.electrochemBrowserEngine.discoverStructured(payload);
    if(discoveryIsCurrent(ticket)){renderDiscoveryResult(result,payload);attachComparisonInspector(result.models,payload);}
  }catch(problem){if(discoveryIsCurrent(ticket)){error.textContent=problem.message;error.hidden=false;}}
  finally{button.textContent="Run structured search";syncDiscoveryAvailability();}
}

function parseSparseRateTable(text,name) {
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if(lines.length<6)throw new Error(`${name}: at least five numeric samples are required`);
  const delimiter=[",","\t",";"].reduce((best,candidate)=>lines[0].split(candidate).length>lines[0].split(best).length?candidate:best,",");
  const headers=ElectrochemImport.splitCSVLine(lines[0],delimiter).map(value=>value.trim());
  if(headers.length<2||headers.length>7)throw new Error(`${name}: use one to six concentration columns followed by one rate column`);
  const rows=lines.slice(1).map(line=>ElectrochemImport.splitCSVLine(line,delimiter).map(Number)).filter(row=>row.length===headers.length&&row.every(Number.isFinite));
  if(rows.length<5)throw new Error(`${name}: fewer than five complete numeric rows remain`);
  return {name,input_names:headers.slice(0,-1),rate_name:headers.at(-1),inputs:rows.map(row=>row.slice(0,-1)),rates:rows.map(row=>row.at(-1))};
}

function renderSparseRateTable() {
  $("#sparse-rate-summary").className=sparseRateTable?"fit-explainer":"empty-state";
  $("#sparse-rate-summary").innerHTML=sparseRateTable?`<strong>${escapeHTML(sparseRateTable.name)}</strong><span>${sparseRateTable.inputs.length.toLocaleString()} samples · inputs ${sparseRateTable.input_names.map(escapeHTML).join(", ")} · rate ${escapeHTML(sparseRateTable.rate_name)}</span>`:"No concentration–rate table loaded.";
}

async function runSparseDiscovery() {
  const error=$("#discovery-error"),button=$("#sparse-discovery-button");error.hidden=true;
  if(!sparseRateTable){error.textContent="Load a concentration–rate table first.";error.hidden=false;return;}
  button.disabled=true;button.textContent="Selecting sparse terms…";
  const ticket=discoveryTicket();
  try{
    const result=await window.electrochemBrowserEngine.discoverSparseRate({input_names:sparseRateTable.input_names,inputs:sparseRateTable.inputs,rates:sparseRateTable.rates,maximum_degree:Number($("#sparse-degree").value),threshold:Number($("#sparse-threshold").value)});
    if(!discoveryIsCurrent(ticket))return;
    const terms=result.terms.map(term=>`<tr><td>${escapeHTML(term.label)}</td><td>${Number(term.coefficient).toExponential(6)}</td></tr>`).join("");
    $("#discovery-results").className="";
    $("#discovery-results").innerHTML=`<div class="result-badges"><span class="result-badge success">Sparse polynomial selected</span><span class="result-badge">R² ${result.r_squared==null?"—":Number(result.r_squared).toFixed(6)}</span><span class="result-badge">RMSE ${Number(result.root_mean_square_error).toExponential(3)}</span></div>${discoveryWarningHTML(result.warnings)}<div class="formula-box">rate = ${escapeHTML(result.formula)}</div><table class="result-table"><thead><tr><th>Term</th><th>Coefficient</th></tr></thead><tbody>${terms}</tbody></table>`;
  }catch(problem){if(discoveryIsCurrent(ticket)){error.textContent=problem.message;error.hidden=false;}}
  finally{button.disabled=false;button.textContent="Discover sparse rate law";}
}

function uncertaintyWarningHTML(warnings) {
  return (warnings||[]).map(message=>`<div class="model-warning"><strong>Review:</strong> ${escapeHTML(message)}</div>`).join("");
}

function updatePosteriorPriorRow(row) {
  const kind=row.querySelector("[data-posterior-prior-kind]").value;
  const location=row.querySelector("[data-posterior-prior-location]");
  const scale=row.querySelector("[data-posterior-prior-scale]");
  const informative=kind!=="uniform";
  location.disabled=!informative;scale.disabled=!informative;
  location.placeholder=kind==="log_normal"?"median":"mean";
  scale.placeholder=kind==="log_normal"?"log-SD":"SD";
}

function renderPosteriorPriorControls(estimates=[]) {
  const container=$("#posterior-prior-list");if(!container)return;
  posteriorParameterNames=estimates.map(estimate=>estimate.name);
  if(!posteriorParameterNames.length){container.className="empty-state compact";container.textContent="This fit has no continuous parameters to sample.";return;}
  container.className="posterior-prior-table-wrap";
  container.innerHTML=`<table class="result-table posterior-prior-table"><thead><tr><th>Parameter</th><th>Distribution</th><th>Location</th><th>Scale</th></tr></thead><tbody>${posteriorParameterNames.map(name=>`<tr data-posterior-prior-row data-parameter="${escapeHTML(name)}"><td>${escapeHTML(name)}</td><td><select data-posterior-prior-kind aria-label="Prior distribution for ${escapeHTML(name)}"><option value="uniform">Uniform bounds</option><option value="normal">Normal</option><option value="log_normal">Log-normal</option></select></td><td><input data-posterior-prior-location type="number" step="any" aria-label="Prior location for ${escapeHTML(name)}" disabled></td><td><input data-posterior-prior-scale type="number" min="1e-15" step="any" aria-label="Prior scale for ${escapeHTML(name)}" disabled></td></tr>`).join("")}</tbody></table>`;
  $$('[data-posterior-prior-row]').forEach(row=>{row.querySelector("[data-posterior-prior-kind]").addEventListener("change",()=>updatePosteriorPriorRow(row));updatePosteriorPriorRow(row);});
}

function posteriorPriorPayload() {
  return $$('[data-posterior-prior-row]').map(row=>{
    const type=row.querySelector("[data-posterior-prior-kind]").value;
    if(type==="uniform")return {parameter:row.dataset.parameter,type};
    const location=Number(row.querySelector("[data-posterior-prior-location]").value);
    const scale=Number(row.querySelector("[data-posterior-prior-scale]").value);
    if(!Number.isFinite(location)||!Number.isFinite(scale)||scale<=0)throw new Error(`${row.dataset.parameter} needs a finite prior location and a positive prior scale.`);
    if(type==="log_normal"&&location<=0)throw new Error(`${row.dataset.parameter} needs a positive log-normal prior median.`);
    return {parameter:row.dataset.parameter,type,location,scale};
  });
}

function updatePosteriorNoiseRecommendation(fitResult=null) {
  const output=$("#posterior-noise-recommendation");if(!output)return;
  const correlation=Number(fitResult?.residual_diagnostics?.residual_noise?.correlation);
  if(Number.isFinite(correlation)&&Math.abs(correlation)>=0.3){
    output.textContent=`The fitted residuals have lag-one correlation ρ=${correlation.toFixed(3)}. Keep independent Gaussian as the baseline, then compare the optional AR(1) result; do not choose AR(1) solely because it gives a wider or narrower interval.`;
  }else if(Number.isFinite(correlation)){
    output.textContent=`The fitted residuals have lag-one correlation ρ=${correlation.toFixed(3)}. Independent Gaussian is a reasonable starting model; AR(1) remains available for a sensitivity comparison.`;
  }else{
    output.textContent="Start with independent noise. Compare AR(1) only when fitted residuals show substantial lag-one correlation or long runs.";
  }
}

function posteriorNoiseHTML(noise=[],datasets=[]) {
  if(!noise.length)return "";
  const rows=noise.map(item=>{
    const dataset=datasets[item.dataset-1]?.name||`Experiment ${item.dataset}`;
    const correlation=item.correlation_median==null?"—":`${fitNumber(item.correlation_median,3)} (${fitNumber(item.correlation_lower_95,3)} – ${fitNumber(item.correlation_upper_95,3)})`;
    const correlationDiagnostics=item.correlation_r_hat==null?"—":`${Number(item.correlation_r_hat).toFixed(3)} · ${Number(item.correlation_effective_sample_size).toFixed(0)} / ${Number(item.correlation_tail_effective_sample_size).toFixed(0)}`;
    return `<tr><td>${escapeHTML(dataset)}</td><td>${item.model==="ar1_gaussian"?"AR(1) Gaussian":"Independent Gaussian"}</td><td>${fitNumber(item.innovation_scale_median_A)} (${fitNumber(item.innovation_scale_lower_95_A)} – ${fitNumber(item.innovation_scale_upper_95_A)})</td><td>${Number(item.innovation_scale_r_hat).toFixed(3)} · ${Number(item.innovation_scale_effective_sample_size).toFixed(0)} / ${Number(item.innovation_scale_tail_effective_sample_size).toFixed(0)}</td><td>${correlation}</td><td>${correlationDiagnostics}</td></tr>`;
  }).join("");
  return `<h4>Inferred experimental noise</h4><p class="helper-text">Noise SD is reported in amperes for each experiment. Under AR(1), it is the innovation SD; ρ describes correlation between adjacent residuals.</p><table class="result-table"><thead><tr><th>Experiment</th><th>Model</th><th>Noise SD median (95% CrI), A</th><th>SD R̂ · bulk / tail ESS</th><th>ρ median (95% CrI)</th><th>ρ R̂ · bulk / tail ESS</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function posteriorPredictiveHTML(predictive) {
  if(!predictive?.length)return "";
  return `<section class="fit-plot-section"><h4>Posterior predictive check</h4><p class="helper-text">The colored median is the latent model current. The gray 95% bounds also include a fresh draw of the inferred measurement noise, so approximately 95% of comparable observations should fall inside them when the mechanism and noise model are adequate.</p><div class="fit-chart-wrap"><canvas id="posterior-predictive-chart" aria-label="Experimental electrochemical traces, posterior model current, and full posterior predictive bounds"></canvas></div><div id="posterior-predictive-legend" class="legend"></div></section>`;
}

function drawPosteriorPredictive(predictive,datasets) {
  if(!predictive?.length||typeof drawFitCanvas!=="function")return;
  const series=[];
  const chrono=datasets.every(dataset=>dataset.experiment_type==="chronoamperometry");
  predictive.forEach((band,index)=>{
    const dataset=datasets[band.dataset-1],color=colors[index%colors.length];if(!dataset)return;
    const name=dataset.name||`Dataset ${band.dataset}`,coordinate=chrono?dataset.time:dataset.potential;
    series.push({name:`${name} · experiment`,coordinate,current:dataset.current.map(displayedCurrent),color,dashed:false});
    series.push({name:`${name} · latent median`,coordinate,current:band.median.map(displayedCurrent),color,dashed:true});
    series.push({name:`${name} · predictive 95% lower`,coordinate,current:band.observed_lower_95.map(displayedCurrent),color:"#a5b2b8",dashed:true});
    series.push({name:`${name} · predictive 95% upper`,coordinate,current:band.observed_upper_95.map(displayedCurrent),color:"#a5b2b8",dashed:true});
  });
  drawFitCanvas("#posterior-predictive-chart","#posterior-predictive-legend",series,chrono?"Time (s)":"Potential vs reference (V)",!chrono&&activeVoltammogramConvention().reversePotentialAxis);
}

async function runProfileLikelihood() {
  const error=$("#uncertainty-error"),button=$("#profile-button");error.hidden=true;
  const target=latestBrowserUncertaintyTarget;
  if(!target){error.textContent="Complete a parameter fit or choose a discovered rate law first.";error.hidden=false;return;}
  if(uncertaintyBusy)return;
  uncertaintyBusy=true;syncUncertaintyAvailability();
  button.disabled=true;button.textContent="Calculating profile…";
  try{
    const source=target.payload||target.discovery;
    const profile={parameter:$("#uncertainty-parameter").value,points:Number($("#profile-points").value),span_standard_errors:Number($("#profile-span").value),maximum_iterations:source.maximum_iterations,multistart:source.multistart};
    let result;
    if(target.kind==="voltammetric_rate_law")result=await window.electrochemBrowserEngine.profileVoltammetricRate(target.discovery,target.active,profile);
    else if(target.kind==="custom")result=await window.electrochemBrowserEngine.profileCustom(target.payload,profile);
    else result=await window.electrochemBrowserEngine.profileSolutionE(target.payload,profile);
    if(!uncertaintyTargetIsCurrent(target))return;
    const interval=result.region==="interval"?`${fitNumber(result.confidence_lower)} to ${fitNumber(result.confidence_upper)}`:result.region==="lower_bound"?`≥ ${fitNumber(result.confidence_lower)}`:result.region==="upper_bound"?`≤ ${fitNumber(result.confidence_upper)}`:result.region.replaceAll("_"," ");
    $("#uncertainty-results").className="";
    $("#uncertainty-results").innerHTML=`<div class="result-badges"><span class="result-badge">${escapeHTML(profile.parameter)}</span><span class="result-badge ${result.region==="interval"?"success":""}">95% profile: ${escapeHTML(interval)}</span><span class="result-badge">Estimate ${fitNumber(result.estimate)}</span><span class="result-badge">${Number(result.elapsed_seconds||0).toFixed(2)} s</span></div>${uncertaintyWarningHTML(result.warnings)}<table class="result-table"><thead><tr><th>Fixed value</th><th>Likelihood-ratio statistic</th></tr></thead><tbody>${result.values.map((value,index)=>`<tr><td>${fitNumber(value)}</td><td>${Number(result.statistic[index]).toFixed(4)}</td></tr>`).join("")}</tbody></table>`;
  }catch(problem){if(uncertaintyTargetIsCurrent(target)){error.textContent=problem.message;error.hidden=false;}}
  finally{uncertaintyBusy=false;syncUncertaintyAvailability();button.textContent="Calculate profile";}
}

async function runPosterior() {
  const error=$("#uncertainty-error"),button=$("#posterior-button");error.hidden=true;
  const target=latestBrowserUncertaintyTarget;
  if(!target){error.textContent="Complete a parameter fit or choose a discovered rate law first.";error.hidden=false;return;}
  if(uncertaintyBusy)return;
  uncertaintyBusy=true;syncUncertaintyAvailability();
  button.disabled=true;button.textContent="Sampling posterior…";
  try{
    const posterior={samples:Number($("#posterior-samples").value),burn_in:Number($("#posterior-burnin").value),chains:Number($("#posterior-chains").value),proposal_scale:Number($("#posterior-scale").value),seed:Number($("#posterior-seed").value),noise_model:$("#posterior-noise-model").value,priors:posteriorPriorPayload()};
    let result;
    if(target.kind==="voltammetric_rate_law")result=await window.electrochemBrowserEngine.posteriorVoltammetricRate(target.discovery,target.active,posterior);
    else if(target.kind==="custom")result=await window.electrochemBrowserEngine.posteriorCustom(target.payload,posterior);
    else result=await window.electrochemBrowserEngine.posteriorSolutionE(target.payload,posterior);
    if(!uncertaintyTargetIsCurrent(target))return;
    $("#uncertainty-results").className="";
    const noiseDiagnostics=(result.noise||[]).flatMap(noise=>[{r_hat:noise.innovation_scale_r_hat,effective_sample_size:noise.innovation_scale_effective_sample_size,tail_effective_sample_size:noise.innovation_scale_tail_effective_sample_size},...(noise.correlation_r_hat==null?[]:[{r_hat:noise.correlation_r_hat,effective_sample_size:noise.correlation_effective_sample_size,tail_effective_sample_size:noise.correlation_tail_effective_sample_size}])]);
    const allDiagnostics=[...result.parameters,...noiseDiagnostics],maximumRhat=Math.max(...allDiagnostics.map(parameter=>Number(parameter.r_hat))),minimumEss=Math.min(...allDiagnostics.map(parameter=>Math.min(Number(parameter.effective_sample_size),Number(parameter.tail_effective_sample_size))));
    const reliable=maximumRhat<=1.01&&minimumEss>=100;
    const chainRates=result.chain_acceptance_rates.map((rate,index)=>`Chain ${index+1}: ${(100*rate).toFixed(1)}%`).join(" · ");
    $("#uncertainty-results").innerHTML=`<div class="result-badges"><span class="result-badge ${reliable?"success":""}">${reliable?"Chains agree":"Diagnostics need review"}</span><span class="result-badge">R̂ max ${maximumRhat.toFixed(3)}</span><span class="result-badge">${result.chains} chains · ${result.retained_samples} draws</span><span class="result-badge">Acceptance ${(100*result.acceptance_rate).toFixed(1)}%</span><span class="result-badge">Seed ${result.seed}</span><span class="result-badge">${Number(result.elapsed_seconds||0).toFixed(2)} s</span></div>${uncertaintyWarningHTML(result.warnings)}<p class="helper-text">${escapeHTML(result.likelihood)}. ${escapeHTML(result.prior)}.</p><details class="advanced-settings"><summary>Chain acceptance</summary><div><p class="helper-text">${escapeHTML(chainRates)}</p></div></details><table class="result-table"><thead><tr><th>Parameter</th><th>Prior</th><th>Mean ± MCSE</th><th>SD</th><th>Median</th><th>95% credible interval</th><th>R̂</th><th>Bulk / tail ESS</th></tr></thead><tbody>${result.parameters.map(parameter=>`<tr><td>${escapeHTML(parameter.name)}</td><td>${escapeHTML(parameter.prior)}</td><td>${fitNumber(parameter.mean)} ± ${fitNumber(parameter.monte_carlo_standard_error,3)}</td><td>${fitNumber(parameter.standard_deviation)}</td><td>${fitNumber(parameter.median)}</td><td>${fitNumber(parameter.lower_95)} – ${fitNumber(parameter.upper_95)}</td><td>${Number(parameter.r_hat).toFixed(3)}</td><td>${Number(parameter.effective_sample_size).toFixed(0)} / ${Number(parameter.tail_effective_sample_size).toFixed(0)}</td></tr>`).join("")}</tbody></table>${posteriorNoiseHTML(result.noise,(target.payload||target.discovery).datasets)}${posteriorPredictiveHTML(result.predictive)}`;
    const datasets=(target.payload||target.discovery).datasets;
    requestAnimationFrame(()=>{if(uncertaintyTargetIsCurrent(target))drawPosteriorPredictive(result.predictive,datasets);});
  }catch(problem){if(uncertaintyTargetIsCurrent(target)){error.textContent=problem.message;error.hidden=false;}}
  finally{uncertaintyBusy=false;syncUncertaintyAvailability();button.textContent="Sample posterior";}
}

function fixedInputOption(target,name,label,value,unit="",lower=null,upper=null){return {target,name,label,value:Number(value),unit,lower,upper};}

function knownInputOptions() {
  const target=latestBrowserUncertaintyTarget;
  if(!target)return [];
  const payload=target.kind==="voltammetric_rate_law"?target.discovery:target.payload,options=[];
  if(target.kind==="solution_e"){
    const fitted=new Set(payload.parameters.map(parameter=>parameter.name));
    const definitions=[
      ["temperature","Temperature",payload.temperature,"K",0,null],["electrode_area","Electrode area",payload.electrode_area,"cm²",0,null],
      ["solution_resistance","Solution resistance",payload.solution_resistance,"Ω",0,null],["double_layer_capacitance","Double-layer capacitance",payload.double_layer_capacitance,"μF cm⁻²",0,null],
      ["bulk_concentration","Bulk concentration",payload.bulk_concentration,"M",0,null],["diffusion_coefficient","Diffusion coefficient",payload.diffusion_coefficient,"cm² s⁻¹",0,null],
      ["formal_potential","Formal potential",payload.formal_potential,"V",null,null],["electron_transfer_rate","Electron-transfer rate",payload.electron_transfer_rate,"cm s⁻¹",0,null]
    ];
    definitions.filter(([name])=>!fitted.has(name)).forEach(([name,label,value,unit,lower,upper])=>options.push(fixedInputOption(target,name,label,value,unit,lower,upper)));
  }else{
    [["temperature","Temperature",payload.temperature,"K",0,null],["electrode_area","Electrode area",payload.electrode_area,"cm²",0,null],["solution_resistance","Solution resistance",payload.solution_resistance,"Ω",0,null],["double_layer_capacitance","Double-layer capacitance",payload.double_layer_capacitance,"μF cm⁻²",0,null]].forEach(([name,label,value,unit,lower,upper])=>options.push(fixedInputOption(target,name,label,value,unit,lower,upper)));
    if(payload.shared_diffusion&&!payload.shared_diffusion.fit)options.push(fixedInputOption(target,"shared_D","Shared solution diffusion coefficient",payload.shared_diffusion.value,"cm² s⁻¹",0,null));
    const sharedRate=payload.custom_model.shared_electron_transfer;
    if(sharedRate&&!sharedRate.fit)options.push(fixedInputOption(target,"shared_k0","Shared solution electron-transfer rate",sharedRate.value,"cm s⁻¹",0,null));
    payload.custom_model.species.forEach((species,index)=>{
      const override=species.phase==="surface"?"initial_coverages":"initial_concentrations";
      if(!species.fit_initial&&!payload.datasets.every(dataset=>Object.hasOwn(dataset[override]||{},species.name)))options.push(fixedInputOption(target,`species:${index+1}:initial`,`${species.name} shared initial ${species.phase==="surface"?"coverage":"concentration"}`,species.initial,species.phase==="surface"?"mol cm⁻²":"M",0,null));
      if(species.phase==="solution"&&!species.fit_D&&!payload.shared_diffusion)options.push(fixedInputOption(target,`species:${index+1}:D`,`${species.name} diffusion coefficient`,species.D,"cm² s⁻¹",0,null));
    });
    payload.custom_model.reactions.forEach((reaction,index)=>Object.entries(reaction.parameters||{}).forEach(([name,parameter])=>{
      if(target.kind==="voltammetric_rate_law"&&index===Number(payload.target_reaction)-1)return;
      if(parameter.fit||name==="n")return;
      if(sharedRate&&reaction.type==="solution_electron"&&name==="k0")return;
      const positive=["k","k0","k_ads","k_des","Gamma_max"].includes(name),bounded=name==="alpha";
      options.push(fixedInputOption(target,`reaction:${index+1}:${name}`,`${reaction.label||`Reaction ${index+1}`} · ${name}`,parameter.value,name==="E0"?"V":"",positive||bounded?0:null,bounded?1:null));
    }));
  }
  (payload.datasets||[]).forEach((dataset,index)=>{
    if(dataset.experiment_type!=="chronoamperometry")options.push(fixedInputOption(target,`dataset:${index+1}:scan_rate`,`Experiment ${index+1} scan rate`,dataset.scan_rate,"V s⁻¹",0,null));
    Object.entries(dataset.initial_concentrations||{}).forEach(([name,value])=>options.push(fixedInputOption(target,`dataset:${index+1}:concentration:${name}`,`Experiment ${index+1} · ${name} concentration`,value,"M",0,null)));
    Object.entries(dataset.initial_coverages||{}).forEach(([name,value])=>options.push(fixedInputOption(target,`dataset:${index+1}:coverage:${name}`,`Experiment ${index+1} · ${name} coverage`,value,"mol cm⁻²",0,null)));
  });
  return options;
}

function updateKnownInputFields() {
  const option=knownInputOptionCache.find(item=>item.name===$("#known-input-target").value);
  if(!option)return;
  $("#known-input-value").value=option.value;$("#known-input-se").value="";
  $("#known-input-lower").value=option.lower??"";$("#known-input-upper").value=option.upper??"";$("#known-input-unit").value=option.unit;
}

function renderKnownInputList() {
  const output=$("#known-input-list");
  if(!knownInputMeasurements.length){output.innerHTML='<div class="empty-state">No measured-input uncertainties added.</div>';return;}
  output.innerHTML=knownInputMeasurements.map((measurement,index)=>`<div class="candidate-item"><span>${escapeHTML(knownInputOptionCache.find(option=>option.name===measurement.name)?.label||measurement.name)}</span><span>${fitNumber(measurement.value)} ± ${fitNumber(measurement.standard_uncertainty)} ${escapeHTML(measurement.unit||"")}</span><button class="remove-dataset" data-remove-known-input="${index}" type="button" aria-label="Remove measured input">×</button></div>`).join("");
  $$('[data-remove-known-input]').forEach(button=>button.addEventListener("click",()=>{knownInputMeasurements.splice(Number(button.dataset.removeKnownInput),1);renderKnownInputList();}));
}

function renderKnownInputOptions() {
  knownInputOptionCache=knownInputOptions();
  const select=$("#known-input-target"),button=$("#add-known-input-button");
  select.innerHTML=knownInputOptionCache.length?knownInputOptionCache.map(option=>`<option value="${escapeHTML(option.name)}">${escapeHTML(option.label)}</option>`).join(""):'<option value="">Complete a parameter fit first</option>';
  button.disabled=!knownInputOptionCache.length;
  const allowed=new Set(knownInputOptionCache.map(option=>option.name));knownInputMeasurements=knownInputMeasurements.filter(measurement=>allowed.has(measurement.name));
  updateKnownInputFields();renderKnownInputList();
}

function addKnownInput() {
  const name=$("#known-input-target").value,value=Number($("#known-input-value").value),standard_uncertainty=Number($("#known-input-se").value),lowerText=$("#known-input-lower").value.trim(),upperText=$("#known-input-upper").value.trim();
  if(!name||!Number.isFinite(value)||!Number.isFinite(standard_uncertainty)||standard_uncertainty<=0){$("#uncertainty-error").textContent="Enter a positive standard uncertainty from your independent measurement.";$("#uncertainty-error").hidden=false;return;}
  const measurement={name,value,standard_uncertainty,lower:lowerText===""?null:Number(lowerText),upper:upperText===""?null:Number(upperText),unit:$("#known-input-unit").value.trim()};
  const existing=knownInputMeasurements.findIndex(item=>item.name===name);if(existing>=0)knownInputMeasurements[existing]=measurement;else knownInputMeasurements.push(measurement);renderKnownInputList();
}

async function runKnownInputUncertainty() {
  const error=$("#uncertainty-error"),button=$("#known-input-button"),target=latestBrowserUncertaintyTarget;error.hidden=true;
  renderKnownInputOptions();
  if(!target){error.textContent="Select a completed parameter fit or ranked voltammetric rate law first.";error.hidden=false;return;}
  if(!knownInputMeasurements.length){error.textContent="Add at least one measured fixed input and its standard uncertainty.";error.hidden=false;return;}
  if(uncertaintyBusy)return;
  uncertaintyBusy=true;syncUncertaintyAvailability();
  button.disabled=true;button.textContent="Refitting perturbations…";
  try{
    const settings={level:Number($("#known-input-level").value),nonlinear_threshold:Number($("#known-input-nonlinearity").value)};
    const result=target.kind==="custom"?await window.electrochemBrowserEngine.propagateCustomKnown(target.payload,knownInputMeasurements,settings):target.kind==="voltammetric_rate_law"?await window.electrochemBrowserEngine.propagateVoltammetricKnown(target.discovery,target.active,knownInputMeasurements,settings):await window.electrochemBrowserEngine.propagateSolutionKnown(target.payload,knownInputMeasurements,settings);
    if(!uncertaintyTargetIsCurrent(target))return;
    const warnings=uncertaintyWarningHTML(result.warnings),rows=result.parameters.map(parameter=>`<tr><td>${escapeHTML(parameter.name)}</td><td>${fitNumber(parameter.estimate)}</td><td>${fitNumber(parameter.conditional_standard_error)}</td><td>${fitNumber(parameter.propagated_standard_error)}</td><td>${fitNumber(parameter.propagated_lower)} – ${fitNumber(parameter.propagated_upper)}</td><td>${parameter.known_variance_fraction==null?"—":`${(100*parameter.known_variance_fraction).toFixed(1)}%`}</td></tr>`).join("");
    const contributions=result.contributions.map(contribution=>`<tr><td>${escapeHTML(contribution.name)}</td><td>${fitNumber(contribution.value)} ± ${fitNumber(contribution.standard_uncertainty)} ${escapeHTML(contribution.unit)}</td><td>${contribution.maximum_nonlinearity==null?"failed":fitNumber(contribution.maximum_nonlinearity,4)}</td><td>${escapeHTML(contribution.error||"complete")}</td></tr>`).join("");
    $("#uncertainty-results").className="";$("#uncertainty-results").innerHTML=`<div class="result-badges"><span class="result-badge ${result.complete?"success":""}">${result.complete?"Propagation complete":"Incomplete propagation"}</span><span class="result-badge">${(100*result.level).toFixed(1)}% interval</span><span class="result-badge">${Number(result.elapsed_seconds||0).toFixed(2)} s</span></div>${warnings}<table class="result-table"><thead><tr><th>Fitted parameter</th><th>Estimate</th><th>Fit-only SE</th><th>Combined SE</th><th>Combined interval</th><th>Known-input variance</th></tr></thead><tbody>${rows}</tbody></table><details class="advanced-settings"><summary>Measured-input contributions</summary><div><table class="result-table"><thead><tr><th>Input</th><th>Measurement</th><th>Nonlinearity</th><th>Status</th></tr></thead><tbody>${contributions}</tbody></table></div></details>`;
  }catch(problem){if(uncertaintyTargetIsCurrent(target)){error.textContent=problem.message;error.hidden=false;}}
  finally{uncertaintyBusy=false;syncUncertaintyAvailability();button.textContent="Propagate measured uncertainty";}
}

$$('[data-discovery-mode]').forEach(button=>button.addEventListener("click",()=>{
  $$('[data-discovery-mode]').forEach(item=>item.classList.toggle("active",item===button));
  $$(".discovery-mode").forEach(section=>section.classList.toggle("active",section.id===`discovery-${button.dataset.discoveryMode}`));
  if(button.dataset.discoveryMode==="catalytic")renderCatalyticDatasetOptions();
}));
$("#library-discovery-button").addEventListener("click",runLibraryDiscovery);
$("#use-setup-species").addEventListener("click",()=>{try{useCurrentSpeciesForSearch();}catch(problem){$("#discovery-error").textContent=problem.message;$("#discovery-error").hidden=false;}});
$("#add-species-button").addEventListener("click",()=>{structuredSpecies.push({name:`Species_${structuredSpecies.length+1}`,phase:"solution",composition:{},charge:0,initial:0,D:1e-5});generatedCandidates=[];invalidateDiscovery();renderStructuredSpecies();renderCandidates();});
$("#generate-candidates-button").addEventListener("click",generateStructuredCandidates);
$("#structured-discovery-button").addEventListener("click",runStructuredDiscovery);
["#structured-search-mode","#structured-exhaustive-limit","#structured-max-evaluations"].forEach(selector=>$(selector).addEventListener("change",updateStructuredEstimate));
$("#sparse-rate-file").addEventListener("change",async event=>{const error=$("#discovery-error");error.hidden=true;try{const file=event.target.files[0];if(file){if(file.size>20_000_000)throw new Error("Sparse rate table exceeds the 20 MB browser limit");sparseRateTable=parseSparseRateTable(await file.text(),file.name);renderSparseRateTable();}}catch(problem){error.textContent=problem.message;error.hidden=false;}finally{event.target.value="";}});
$("#sparse-discovery-button").addEventListener("click",runSparseDiscovery);
$("#voltammetric-rate-button").addEventListener("click",runVoltammetricRateDiscovery);
$("#catalytic-rate-button").addEventListener("click",runCatalyticRate);
$("#voltammetric-rate-reaction").addEventListener("change",()=>renderVoltammetricRateOptions(true));
$("#voltammetric-rate-loss").addEventListener("change",()=>{$$(".voltammetric-robust-setting").forEach(field=>{field.hidden=$("#voltammetric-rate-loss").value!=="student_t";});});
["#voltammetric-rate-degree","#voltammetric-rate-search","#voltammetric-rate-limit"].forEach(selector=>$(selector).addEventListener("change",updateVoltammetricRateEstimate));
$("#profile-button").addEventListener("click",runProfileLikelihood);
$("#posterior-button").addEventListener("click",runPosterior);
$("#known-input-target").addEventListener("change",updateKnownInputFields);
$("#add-known-input-button").addEventListener("click",addKnownInput);
$("#known-input-button").addEventListener("click",runKnownInputUncertainty);
renderStructuredSpecies();
renderCandidates();
renderSparseRateTable();
renderVoltammetricRateOptions();
renderCatalyticDatasetOptions();
renderKnownInputOptions();
syncUncertaintyAvailability();
syncDiscoveryAvailability();
function onDiscoveryStudyEdit(event) {
  // Result-inspection controls do not change the scientific search.
  if(!event.target.closest?.("#view-discover")||event.target.closest?.("#discovery-results"))return;
  invalidateDiscovery();
  if(event.target.matches?.("[data-structured-key],#structured-molecularity,#structured-electrons")){generatedCandidates=[];renderCandidates();}
}
document.addEventListener("input",onDiscoveryStudyEdit);
document.addEventListener("change",event=>{
  onDiscoveryStudyEdit(event);
  syncDiscoveryAvailability();
});
