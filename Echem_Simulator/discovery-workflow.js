"use strict";

let structuredSpecies = [
  {name:"Ox",phase:"solution",composition:{X:1},charge:0,initial:0.001,D:1e-5},
  {name:"Red",phase:"solution",composition:{X:1},charge:-1,initial:0,D:1e-5},
  {name:"Product",phase:"solution",composition:{X:1},charge:-1,initial:0,D:1e-5}
];
let generatedCandidates = [];
let sparseRateTable = null;
let knownInputMeasurements = [];
let knownInputOptionCache = [];

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
  inputList.innerHTML=customMechanism.species.map(species=>{
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
  latestBrowserUncertaintyTarget={kind:"voltammetric_rate_law",discovery:structuredClone(payload),active:[...model.active]};
  renderKnownInputOptions();
  $("#uncertainty-parameter").innerHTML=model.estimates.map(estimate=>`<option value="${escapeHTML(estimate.name)}">${escapeHTML(estimate.name)}</option>`).join("");
  $("#uncertainty-results").className="fit-explainer";
  $("#uncertainty-results").innerHTML=`<strong>Conditional UQ target selected</strong><span>rate = ${escapeHTML(model.formula)}. Profile likelihood and posterior sampling will refit this support through the same Rust transport model.</span>`;
  error.hidden=true;
}

function renderVoltammetricRateResult(result,payload) {
  const best=result.models[0];
  const terms=best.terms.length?best.terms.map(term=>`<tr><td>${escapeHTML(term.label)}</td><td>${Number(term.coefficient).toExponential(6)}</td><td>${term.confidence_lower==null?"—":`${Number(term.confidence_lower).toExponential(3)} – ${Number(term.confidence_upper).toExponential(3)}`}</td></tr>`).join(""):'<tr><td colspan="3">No nonzero rate term was selected.</td></tr>';
  const ranks=result.models.slice(0,12).map((model,index)=>`<div class="rank-row"><strong>${index+1}</strong><div>${escapeHTML(model.formula)}<div class="weight-bar"><i style="width:${100*model.weight}%"></i></div></div><span>Δ${result.criterion} ${Number(model.delta).toFixed(2)}</span><span>${(100*model.weight).toFixed(1)}%</span>${model.estimates?.length?`<button class="button secondary small" data-rate-uq-model="${index}" type="button">Use for UQ</button>`:""}</div>`).join("");
  const inclusion=[...result.inclusion_weights].sort((a,b)=>b.weight-a.weight).map(item=>`<tr><td>${escapeHTML(item.name)}</td><td>${(100*item.weight).toFixed(1)}%</td></tr>`).join("");
  const stability=result.stability?`<details class="advanced-settings"><summary>Whole-experiment stability · ${result.stability.successful_replicates}/${result.stability.requested_replicates} searches completed</summary><div><p class="helper-text">Term frequency is the fraction of successful, whole-voltammogram bootstrap searches whose top-ranked support contained that term. Exact-support frequency requires the complete full-data expression to win unchanged.</p><table class="result-table"><thead><tr><th>Candidate</th><th>Selection frequency</th></tr></thead><tbody><tr><td>Exact full-data support</td><td>${(100*result.stability.full_support_frequency).toFixed(1)}%</td></tr>${result.stability.selection_frequencies.map(item=>`<tr><td>${escapeHTML(item.name)}</td><td>${(100*item.weight).toFixed(1)}%</td></tr>`).join("")}<tr><td>No additional reaction</td><td>${(100*result.stability.null_selection_frequency).toFixed(1)}%</td></tr></tbody></table><p class="helper-text">Seed ${result.stability.seed} · ${result.stability.failed_replicates} failed replicate${result.stability.failed_replicates===1?"":"s"}</p></div></details>`:"";
  const predictive=predictiveValidationHTML(best.predictive_validation,"Top-support held-out validation");
  $("#discovery-results").className="";
  $("#discovery-results").innerHTML=`<div class="result-badges"><span class="result-badge success">Direct voltammetric inference</span><span class="result-badge">${result.criterion}</span><span class="result-badge">${result.attempted_supports}/${result.admissible_supports} supports</span><span class="result-badge">${Number(result.elapsed_seconds||0).toFixed(2)} s</span></div>${discoveryWarningHTML(result.warnings)}<div class="formula-box">rate = ${escapeHTML(best.formula)}</div><table class="result-table"><thead><tr><th>Selected term</th><th>Coefficient</th><th>Approx. 95% interval</th></tr></thead><tbody>${terms}</tbody></table>${predictive}<div class="section-heading compact subheading"><div><h3>Competing rate laws</h3><p>Close scores indicate that the voltammograms do not uniquely identify one expression.</p></div></div>${ranks}<details class="advanced-settings"><summary>Rate-term inclusion weights</summary><div><table class="result-table"><thead><tr><th>Candidate term</th><th>Weight</th></tr></thead><tbody>${inclusion}</tbody></table></div></details>${stability}`;
  $$('[data-rate-uq-model]').forEach(button=>button.addEventListener("click",()=>selectVoltammetricRateForUncertainty(result,payload,Number(button.dataset.rateUqModel))));
}

async function runVoltammetricRateDiscovery() {
  const error=$("#discovery-error"),button=$("#voltammetric-rate-button");error.hidden=true;
  if(!experimentalDatasets.length){error.textContent="Load experimental voltammograms before inferring a rate law.";error.hidden=false;return;}
  const selected=$$('[data-voltammetric-rate-input]:checked');
  if(!selected.length){error.textContent="Select at least one concentration input.";error.hidden=false;return;}
  button.disabled=true;button.textContent="Fitting candidate rate laws…";
  try{
    const model=serializeCustomModel();await validateBuilder(model);
    const form=payloadFromForm();
    const payload={...analysisSettings(),solution_resistance:Number(form.solution_resistance||0),double_layer_capacitance:Number(form.double_layer_capacitance||0),custom_model:model,
      target_reaction:Number($("#voltammetric-rate-reaction").value),input_species:selected.map(input=>input.value),
      concentration_scales:selected.map(input=>Number(input.closest("label").querySelector('[data-voltammetric-rate-scale]').value)),
      maximum_degree:Number($("#voltammetric-rate-degree").value),first_order_guess:Number($("#voltammetric-rate-guess").value),lower_factor:1e-6,upper_factor:1e6,
      criterion:$("#voltammetric-rate-criterion").value,search_mode:$("#voltammetric-rate-search").value,exhaustive_limit:Number($("#voltammetric-rate-limit").value),maximum_evaluations:50,beam_width:3,minimum_terms:0,multistart:Math.min(2,Number($("#fit-multistart").value)),
      loss:$("#voltammetric-rate-loss").value,student_t_dof:Number($("#voltammetric-rate-dof").value),robust_scale:Number($("#voltammetric-rate-scale").value),
      stability_replicates:Number($("#voltammetric-rate-stability").value),stability_seed:Number($("#voltammetric-rate-stability-seed").value),
      predictive_validation:$("#voltammetric-rate-predictive-validation").checked};
    renderVoltammetricRateResult(await window.electrochemBrowserEngine.discoverVoltammetricRate(payload),payload);
  }catch(problem){error.textContent=problem.message;error.hidden=false;}
  finally{button.disabled=false;button.textContent="Infer rate law from voltammograms";}
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
    multistart:Math.min(4,Number($("#fit-multistart").value))
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

function renderDiscoveryResult(result) {
  const search=result.admissible_supports===undefined?"":`<div class="result-badges"><span class="result-badge ${result.exhaustive?"success":""}">${result.exhaustive?"Exhaustive":"Heuristic beam"} search</span><span class="result-badge">${result.attempted_supports}/${result.admissible_supports} supports attempted</span>${result.failed_supports?`<span class="result-badge">${result.failed_supports} failed</span>`:""}</div>`;
  const rows=result.models.map((model,index)=>`<div class="rank-row"><strong>${index+1}</strong><div>${escapeHTML(model.name)}${discoveryEstimateHTML(model.estimates)}<div class="weight-bar"><i style="width:${100*model.weight}%"></i></div></div><span>Δ${result.criterion} ${Number(model.delta).toFixed(2)}</span><span>${(100*model.weight).toFixed(1)}%</span></div>${predictiveValidationHTML(model.predictive_validation,`${model.name} held-out validation`)}`).join("");
  const inclusion=result.inclusion_weights?.length?`<details class="advanced-settings"><summary>Reaction inclusion weights</summary><div><table class="result-table"><thead><tr><th>Reaction</th><th>Weight</th></tr></thead><tbody>${[...result.inclusion_weights].sort((a,b)=>b.weight-a.weight).map(item=>`<tr><td>${escapeHTML(item.name)}</td><td>${(100*item.weight).toFixed(1)}%</td></tr>`).join("")}</tbody></table></div></details>`:"";
  const stability=result.stability?`<details class="advanced-settings"><summary>Whole-experiment stability · ${result.stability.successful_replicates}/${result.stability.requested_replicates} searches completed</summary><div><p class="helper-text">Each repeat resamples complete voltammograms, refits every searched support, and records the winning reaction set.</p><table class="result-table"><thead><tr><th>Candidate</th><th>Selection frequency</th></tr></thead><tbody><tr><td>Exact full-data support</td><td>${(100*result.stability.full_support_frequency).toFixed(1)}%</td></tr>${result.stability.selection_frequencies.map(item=>`<tr><td>${escapeHTML(item.name)}</td><td>${(100*item.weight).toFixed(1)}%</td></tr>`).join("")}</tbody></table><p class="helper-text">Seed ${result.stability.seed} · ${result.stability.failed_replicates} failed replicate${result.stability.failed_replicates===1?"":"s"}</p></div></details>`:"";
  $("#discovery-results").className="";
  $("#discovery-results").innerHTML=`<div class="result-badges"><span class="result-badge success">Rust/Wasm model comparison</span><span class="result-badge">${result.criterion}</span><span class="result-badge">${Number(result.elapsed_seconds||0).toFixed(2)} s</span></div>${search}${discoveryWarningHTML(result.warnings)}${observationalEquivalenceHTML(result.observational_equivalence)}${rows}${inclusion}${stability}`;
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
  try{
    const result=await window.electrochemBrowserEngine.analyzeCatalyticRate({method:$("#catalytic-method").value,potential:[...catalytic.potential],current:[...catalytic.current],reference_current:[...reference.current],formal_potential:Number($("#catalytic-e0").value),scan_rate:Number(catalytic.scan_rate),substrate_concentration:Number($("#catalytic-substrate").value),catalyst_concentration:Number($("#catalytic-catalyst").value),temperature:Number($('[data-key="temperature"]').value),electron_count:Number($("#catalytic-electrons").value),minimum_excess_ratio:Number($("#catalytic-excess").value)});
    const checks=result.issues.length?result.issues.map(issue=>`<div class="model-warning"><strong>Applicability:</strong> ${escapeHTML(catalyticIssueLabel(issue))}</div>`):'<div class="result-badges"><span class="result-badge success">Analytical assumptions passed</span></div>';
    const diagnostics=result.method==="fowa"?`Foot slope ${fitNumber(result.statistic)} · intercept ${fitNumber(result.intercept)} · R² ${Number(result.r_squared).toFixed(4)}`:`Plateau/reference ratio ${fitNumber(result.statistic)} · relative span ${(100*result.relative_signal_span).toFixed(2)}%`;
    $("#discovery-results").className="";
    $("#discovery-results").innerHTML=`<div class="result-badges"><span class="result-badge ${result.applicable?"success":""}">${result.method==="fowa"?"Foot-of-wave":"Plateau-current"} EC′ estimate</span><span class="result-badge">${result.points_used} points</span><span class="result-badge">${Number(result.elapsed_seconds||0).toFixed(3)} s</span></div>${checks}<div class="formula-box">k<sub>obs</sub> = ${Number(result.observed_rate).toExponential(6)} s⁻¹<br>k₂ = ${Number(result.second_order_rate).toExponential(6)} M⁻¹ s⁻¹</div><p class="helper-text">${diagnostics}. Treat this as an ideal-model comparison to the full-wave fit, not as a substitute for it.</p>`;
  }catch(problem){error.textContent=problem.message;error.hidden=false;}
  finally{button.disabled=false;button.textContent="Estimate catalytic rate";}
}

async function runLibraryDiscovery() {
  const error=$("#discovery-error"),button=$("#library-discovery-button");error.hidden=true;
  if(!experimentalDatasets.length){error.textContent="Load experimental voltammograms before comparing mechanisms.";error.hidden=false;return;}
  button.disabled=true;button.textContent="Fitting candidate mechanisms…";
  try{
    const payload={...analysisSettings(),
      bulk_concentration:Number($("#discover-concentration").value),
      diffusion_coefficient:Number($("#discover-diffusion").value),
      substrate_concentration:Number($("#discover-substrate").value),
      formal_potential_lower:Number($("#discover-e0-lower").value),
      formal_potential_upper:Number($("#discover-e0-upper").value),
      candidates:$$('[data-library-candidate]:checked').map(input=>input.dataset.libraryCandidate),
      criterion:$("#discover-criterion").value,predictive_validation:$("#library-predictive-validation").checked};
    if(!payload.candidates.length)throw new Error("Select at least one standard mechanism.");
    renderDiscoveryResult(await window.electrochemBrowserEngine.discoverLibrary(payload));
  }catch(problem){error.textContent=problem.message;error.hidden=false;}
  finally{button.disabled=false;button.textContent="Compare standard mechanisms";}
}

function renderStructuredSpecies() {
  $("#species-editor").innerHTML=structuredSpecies.map((species,index)=>`<div class="species-row browser-structured-species"><input data-structured-species="${index}" data-structured-key="name" aria-label="Species name" value="${escapeHTML(species.name)}"><select data-structured-species="${index}" data-structured-key="phase" aria-label="Species phase"><option value="solution"${species.phase==="solution"?" selected":""}>solution</option><option value="surface"${species.phase==="surface"?" selected":""}>surface</option></select><input data-structured-species="${index}" data-structured-key="composition" aria-label="Elemental composition JSON" value='${escapeHTML(JSON.stringify(species.composition))}'><input data-structured-species="${index}" data-structured-key="charge" aria-label="Charge" type="number" value="${species.charge}"><input data-structured-species="${index}" data-structured-key="initial" aria-label="Initial concentration or coverage" title="mol/L for solution species; mol/cm² for surface species" type="number" step="any" value="${species.initial}"><input data-structured-species="${index}" data-structured-key="D" aria-label="Diffusion coefficient" title="cm²/s; not used for surface species" type="number" step="any" value="${species.D}"${species.phase==="surface"?" disabled":""}><button class="remove-dataset" data-remove-structured-species="${index}" type="button" aria-label="Remove ${escapeHTML(species.name)}">×</button></div>`).join("");
  $$('[data-structured-key]').forEach(input=>input.addEventListener("change",()=>{
    const species=structuredSpecies[Number(input.dataset.structuredSpecies)],key=input.dataset.structuredKey;
    try{species[key]=["name","phase"].includes(key)?input.value.trim():key==="composition"?JSON.parse(input.value):Number(input.value);if(key==="phase"){species.D=species.phase==="surface"?0:(species.D>0?species.D:1e-5);renderStructuredSpecies();}generatedCandidates=[];renderCandidates();}
    catch(problem){const error=$("#discovery-error");error.textContent=`Invalid species value: ${problem.message}`;error.hidden=false;}
  }));
  $$('[data-remove-structured-species]').forEach(button=>button.addEventListener("click",()=>{structuredSpecies.splice(Number(button.dataset.removeStructuredSpecies),1);generatedCandidates=[];renderStructuredSpecies();renderCandidates();}));
}

function updateStructuredEstimate() {
  const selected=$$('[data-structured-candidate]:checked').length;
  if(!selected){$("#structured-search-estimate").textContent="Select at least one candidate reaction.";return;}
  const total=(1n<<BigInt(selected))-1n,limit=BigInt(Math.max(1,Number($("#structured-exhaustive-limit").value))),budget=BigInt(Math.max(1,Number($("#structured-max-evaluations").value))),mode=$("#structured-search-mode").value;
  const exhaustive=mode==="exhaustive"||(mode==="auto"&&total<=limit);
  $("#structured-search-estimate").textContent=`${selected} selected reactions define at most ${total.toLocaleString()} nonempty supports. The ${exhaustive?"exhaustive":"beam"} search will attempt ${exhaustive?"all admissible supports":`up to ${budget.toLocaleString()} supports`}; supports without dissolved or surface electron transfer are excluded.`;
}

function renderCandidates() {
  const output=$("#candidate-preview");
  if(!generatedCandidates.length){output.innerHTML="";$("#structured-search-estimate").textContent="Generate candidates to estimate the number of fitted supports.";return;}
  output.innerHTML=generatedCandidates.map(candidate=>`<label class="candidate-item"><input data-structured-candidate="${candidate.index}" type="checkbox" checked><span class="candidate-kind">${escapeHTML(candidate.kind.replaceAll("_"," "))}</span><span>${escapeHTML(candidate.name)}</span></label>`).join("");
  $$('[data-structured-candidate]').forEach(input=>input.addEventListener("change",updateStructuredEstimate));
  updateStructuredEstimate();
}

function structuredDefinitionPayload() {
  return {species:structuredSpecies.map(species=>({...species,composition:{...species.composition}})),maximum_molecularity:Number($("#structured-molecularity").value),maximum_electrons:Number($("#structured-electrons").value)};
}

async function generateStructuredCandidates() {
  const error=$("#discovery-error"),button=$("#generate-candidates-button");error.hidden=true;button.disabled=true;
  try{generatedCandidates=await window.electrochemBrowserEngine.generateCandidates(structuredDefinitionPayload());renderCandidates();}
  catch(problem){error.textContent=problem.message;error.hidden=false;}
  finally{button.disabled=false;}
}

async function runStructuredDiscovery() {
  const error=$("#discovery-error"),button=$("#structured-discovery-button");error.hidden=true;
  if(!experimentalDatasets.length){error.textContent="Load experimental voltammograms before searching reaction supports.";error.hidden=false;return;}
  if(!generatedCandidates.length){error.textContent="Generate the balanced reaction candidates first.";error.hidden=false;return;}
  button.disabled=true;button.textContent="Searching reaction supports…";
  try{
    const payload={...analysisSettings(),...structuredDefinitionPayload(),
      included_candidates:$$('[data-structured-candidate]:checked').map(input=>Number(input.dataset.structuredCandidate)),
      required_candidates:[],criterion:$("#structured-criterion").value,
      search_mode:$("#structured-search-mode").value,
      exhaustive_limit:Number($("#structured-exhaustive-limit").value),
      maximum_evaluations:Number($("#structured-max-evaluations").value),
      beam_width:3,minimum_reactions:1,multistart:1,
      stability_replicates:Number($("#structured-stability").value),stability_seed:Number($("#structured-stability-seed").value)};
    renderDiscoveryResult(await window.electrochemBrowserEngine.discoverStructured(payload));
  }catch(problem){error.textContent=problem.message;error.hidden=false;}
  finally{button.disabled=false;button.textContent="Run structured search";}
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
  try{
    const result=await window.electrochemBrowserEngine.discoverSparseRate({input_names:sparseRateTable.input_names,inputs:sparseRateTable.inputs,rates:sparseRateTable.rates,maximum_degree:Number($("#sparse-degree").value),threshold:Number($("#sparse-threshold").value)});
    const terms=result.terms.map(term=>`<tr><td>${escapeHTML(term.label)}</td><td>${Number(term.coefficient).toExponential(6)}</td></tr>`).join("");
    $("#discovery-results").className="";
    $("#discovery-results").innerHTML=`<div class="result-badges"><span class="result-badge success">Sparse polynomial selected</span><span class="result-badge">R² ${result.r_squared==null?"—":Number(result.r_squared).toFixed(6)}</span><span class="result-badge">RMSE ${Number(result.root_mean_square_error).toExponential(3)}</span></div>${discoveryWarningHTML(result.warnings)}<div class="formula-box">rate = ${escapeHTML(result.formula)}</div><table class="result-table"><thead><tr><th>Term</th><th>Coefficient</th></tr></thead><tbody>${terms}</tbody></table>`;
  }catch(problem){error.textContent=problem.message;error.hidden=false;}
  finally{button.disabled=false;button.textContent="Discover sparse rate law";}
}

function uncertaintyWarningHTML(warnings) {
  return (warnings||[]).map(message=>`<div class="model-warning"><strong>Review:</strong> ${escapeHTML(message)}</div>`).join("");
}

async function runProfileLikelihood() {
  const error=$("#uncertainty-error"),button=$("#profile-button");error.hidden=true;
  const target=latestBrowserUncertaintyTarget;
  if(!target){error.textContent="Complete a parameter fit or choose a discovered rate law first.";error.hidden=false;return;}
  button.disabled=true;button.textContent="Calculating profile…";
  try{
    const profile={parameter:$("#uncertainty-parameter").value,points:Number($("#profile-points").value),span_standard_errors:Number($("#profile-span").value),maximum_iterations:Number($("#fit-iterations").value),multistart:1};
    let result;
    if(target.kind==="voltammetric_rate_law")result=await window.electrochemBrowserEngine.profileVoltammetricRate(target.discovery,target.active,profile);
    else if(target.kind==="custom")result=await window.electrochemBrowserEngine.profileCustom(target.payload,profile);
    else result=await window.electrochemBrowserEngine.profileSolutionE(target.payload,profile);
    const interval=result.region==="interval"?`${fitNumber(result.confidence_lower)} to ${fitNumber(result.confidence_upper)}`:result.region.replaceAll("_"," ");
    $("#uncertainty-results").className="";
    $("#uncertainty-results").innerHTML=`<div class="result-badges"><span class="result-badge ${result.region==="interval"?"success":""}">95% profile: ${escapeHTML(interval)}</span><span class="result-badge">Estimate ${fitNumber(result.estimate)}</span><span class="result-badge">${Number(result.elapsed_seconds||0).toFixed(2)} s</span></div>${uncertaintyWarningHTML(result.warnings)}<table class="result-table"><thead><tr><th>Fixed value</th><th>Likelihood-ratio statistic</th></tr></thead><tbody>${result.values.map((value,index)=>`<tr><td>${fitNumber(value)}</td><td>${Number(result.statistic[index]).toFixed(4)}</td></tr>`).join("")}</tbody></table>`;
  }catch(problem){error.textContent=problem.message;error.hidden=false;}
  finally{button.disabled=false;button.textContent="Calculate profile";}
}

async function runPosterior() {
  const error=$("#uncertainty-error"),button=$("#posterior-button");error.hidden=true;
  const target=latestBrowserUncertaintyTarget;
  if(!target){error.textContent="Complete a parameter fit or choose a discovered rate law first.";error.hidden=false;return;}
  button.disabled=true;button.textContent="Sampling posterior…";
  try{
    const posterior={samples:Number($("#posterior-samples").value),burn_in:Number($("#posterior-burnin").value),proposal_scale:Number($("#posterior-scale").value),seed:Number($("#posterior-seed").value)};
    let result;
    if(target.kind==="voltammetric_rate_law")result=await window.electrochemBrowserEngine.posteriorVoltammetricRate(target.discovery,target.active,posterior);
    else if(target.kind==="custom")result=await window.electrochemBrowserEngine.posteriorCustom(target.payload,posterior);
    else result=await window.electrochemBrowserEngine.posteriorSolutionE(target.payload,posterior);
    $("#uncertainty-results").className="";
    $("#uncertainty-results").innerHTML=`<div class="result-badges"><span class="result-badge">Acceptance ${(100*result.acceptance_rate).toFixed(1)}%</span><span class="result-badge">${result.retained_samples} retained</span><span class="result-badge">Seed ${result.seed}</span><span class="result-badge">${Number(result.elapsed_seconds||0).toFixed(2)} s</span></div>${uncertaintyWarningHTML(result.warnings)}<p class="helper-text">${escapeHTML(result.prior)}</p><table class="result-table"><thead><tr><th>Parameter</th><th>Mean</th><th>SD</th><th>Median</th><th>95% credible interval</th><th>Effective samples</th></tr></thead><tbody>${result.parameters.map(parameter=>`<tr><td>${escapeHTML(parameter.name)}</td><td>${fitNumber(parameter.mean)}</td><td>${fitNumber(parameter.standard_deviation)}</td><td>${fitNumber(parameter.median)}</td><td>${fitNumber(parameter.lower_95)} – ${fitNumber(parameter.upper_95)}</td><td>${Number(parameter.effective_sample_size).toFixed(0)}</td></tr>`).join("")}</tbody></table>`;
  }catch(problem){error.textContent=problem.message;error.hidden=false;}
  finally{button.disabled=false;button.textContent="Sample posterior";}
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
      ["solution_resistance","Solution resistance",payload.solution_resistance,"Ω",0,null],["double_layer_capacitance","Double-layer capacitance",payload.double_layer_capacitance,"F cm⁻²",0,null],
      ["bulk_concentration","Bulk concentration",payload.bulk_concentration,"M",0,null],["diffusion_coefficient","Diffusion coefficient",payload.diffusion_coefficient,"cm² s⁻¹",0,null],
      ["formal_potential","Formal potential",payload.formal_potential,"V",null,null],["electron_transfer_rate","Electron-transfer rate",payload.electron_transfer_rate,"cm s⁻¹",0,null]
    ];
    definitions.filter(([name])=>!fitted.has(name)).forEach(([name,label,value,unit,lower,upper])=>options.push(fixedInputOption(target,name,label,value,unit,lower,upper)));
  }else{
    [["temperature","Temperature",payload.temperature,"K",0,null],["electrode_area","Electrode area",payload.electrode_area,"cm²",0,null],["solution_resistance","Solution resistance",payload.solution_resistance,"Ω",0,null],["double_layer_capacitance","Double-layer capacitance",payload.double_layer_capacitance,"F cm⁻²",0,null]].forEach(([name,label,value,unit,lower,upper])=>options.push(fixedInputOption(target,name,label,value,unit,lower,upper)));
    payload.custom_model.species.forEach((species,index)=>{
      options.push(fixedInputOption(target,`species:${index+1}:initial`,`${species.name} initial ${species.phase==="surface"?"coverage":"concentration"}`,species.initial,species.phase==="surface"?"mol cm⁻²":"M",0,null));
      if(species.phase==="solution"&&!species.fit_D)options.push(fixedInputOption(target,`species:${index+1}:D`,`${species.name} diffusion coefficient`,species.D,"cm² s⁻¹",0,null));
    });
    payload.custom_model.reactions.forEach((reaction,index)=>Object.entries(reaction.parameters||{}).forEach(([name,parameter])=>{
      if(target.kind==="voltammetric_rate_law"&&index===Number(payload.target_reaction)-1)return;
      if(parameter.fit||name==="n")return;
      const positive=["k","k0","k_ads","k_des","Gamma_max"].includes(name),bounded=name==="alpha";
      options.push(fixedInputOption(target,`reaction:${index+1}:${name}`,`${reaction.label||`Reaction ${index+1}`} · ${name}`,parameter.value,name==="E0"?"V":"",positive||bounded?0:null,bounded?1:null));
    }));
  }
  (payload.datasets||[]).forEach((dataset,index)=>{
    options.push(fixedInputOption(target,`dataset:${index+1}:scan_rate`,`Experiment ${index+1} scan rate`,dataset.scan_rate,"V s⁻¹",0,null));
    Object.entries(dataset.initial_concentrations||{}).forEach(([name,value])=>options.push(fixedInputOption(target,`dataset:${index+1}:concentration:${name}`,`Experiment ${index+1} · ${name} concentration`,value,"M",0,null)));
    Object.entries(dataset.initial_coverages||{}).forEach(([name,value])=>options.push(fixedInputOption(target,`dataset:${index+1}:coverage:${name}`,`Experiment ${index+1} · ${name} coverage`,value,"mol cm⁻²",0,null)));
  });
  return options;
}

function updateKnownInputFields() {
  const option=knownInputOptionCache.find(item=>item.name===$("#known-input-target").value);
  if(!option)return;
  $("#known-input-value").value=option.value;$("#known-input-se").value=Math.max(Math.abs(option.value)*0.05,1e-12);
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
  if(!name||!Number.isFinite(value)||!Number.isFinite(standard_uncertainty)||standard_uncertainty<=0)return;
  const measurement={name,value,standard_uncertainty,lower:lowerText===""?null:Number(lowerText),upper:upperText===""?null:Number(upperText),unit:$("#known-input-unit").value.trim()};
  const existing=knownInputMeasurements.findIndex(item=>item.name===name);if(existing>=0)knownInputMeasurements[existing]=measurement;else knownInputMeasurements.push(measurement);renderKnownInputList();
}

async function runKnownInputUncertainty() {
  const error=$("#uncertainty-error"),button=$("#known-input-button"),target=latestBrowserUncertaintyTarget;error.hidden=true;
  renderKnownInputOptions();
  if(!target){error.textContent="Select a completed parameter fit or ranked voltammetric rate law first.";error.hidden=false;return;}
  if(!knownInputMeasurements.length){error.textContent="Add at least one measured fixed input and its standard uncertainty.";error.hidden=false;return;}
  button.disabled=true;button.textContent="Refitting perturbations…";
  try{
    const settings={level:Number($("#known-input-level").value),nonlinear_threshold:Number($("#known-input-nonlinearity").value)};
    const result=target.kind==="custom"?await window.electrochemBrowserEngine.propagateCustomKnown(target.payload,knownInputMeasurements,settings):target.kind==="voltammetric_rate_law"?await window.electrochemBrowserEngine.propagateVoltammetricKnown(target.discovery,target.active,knownInputMeasurements,settings):await window.electrochemBrowserEngine.propagateSolutionKnown(target.payload,knownInputMeasurements,settings);
    const warnings=uncertaintyWarningHTML(result.warnings),rows=result.parameters.map(parameter=>`<tr><td>${escapeHTML(parameter.name)}</td><td>${fitNumber(parameter.estimate)}</td><td>${fitNumber(parameter.conditional_standard_error)}</td><td>${fitNumber(parameter.propagated_standard_error)}</td><td>${fitNumber(parameter.propagated_lower)} – ${fitNumber(parameter.propagated_upper)}</td><td>${parameter.known_variance_fraction==null?"—":`${(100*parameter.known_variance_fraction).toFixed(1)}%`}</td></tr>`).join("");
    const contributions=result.contributions.map(contribution=>`<tr><td>${escapeHTML(contribution.name)}</td><td>${fitNumber(contribution.value)} ± ${fitNumber(contribution.standard_uncertainty)} ${escapeHTML(contribution.unit)}</td><td>${contribution.maximum_nonlinearity==null?"failed":fitNumber(contribution.maximum_nonlinearity,4)}</td><td>${escapeHTML(contribution.error||"complete")}</td></tr>`).join("");
    $("#uncertainty-results").className="";$("#uncertainty-results").innerHTML=`<div class="result-badges"><span class="result-badge ${result.complete?"success":""}">${result.complete?"Propagation complete":"Incomplete propagation"}</span><span class="result-badge">${(100*result.level).toFixed(1)}% interval</span><span class="result-badge">${Number(result.elapsed_seconds||0).toFixed(2)} s</span></div>${warnings}<table class="result-table"><thead><tr><th>Fitted parameter</th><th>Estimate</th><th>Fit-only SE</th><th>Combined SE</th><th>Combined interval</th><th>Known-input variance</th></tr></thead><tbody>${rows}</tbody></table><details class="advanced-settings"><summary>Measured-input contributions</summary><div><table class="result-table"><thead><tr><th>Input</th><th>Measurement</th><th>Nonlinearity</th><th>Status</th></tr></thead><tbody>${contributions}</tbody></table></div></details>`;
  }catch(problem){error.textContent=problem.message;error.hidden=false;}
  finally{button.disabled=false;button.textContent="Propagate measured uncertainty";}
}

$$('[data-discovery-mode]').forEach(button=>button.addEventListener("click",()=>{
  $$('[data-discovery-mode]').forEach(item=>item.classList.toggle("active",item===button));
  $$(".discovery-mode").forEach(section=>section.classList.toggle("active",section.id===`discovery-${button.dataset.discoveryMode}`));
  if(button.dataset.discoveryMode==="catalytic")renderCatalyticDatasetOptions();
}));
$("#library-discovery-button").addEventListener("click",runLibraryDiscovery);
$("#add-species-button").addEventListener("click",()=>{structuredSpecies.push({name:`Species_${structuredSpecies.length+1}`,phase:"solution",composition:{X:1},charge:0,initial:0,D:1e-5});generatedCandidates=[];renderStructuredSpecies();renderCandidates();});
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
