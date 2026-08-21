const reactionTypeLabels = {
  bulk_mass_action: "Homogeneous mass action",
  solution_electron: "Solution electron transfer",
  custom_bulk_rate: "Custom homogeneous rate law",
  surface_electron: "Surface-confined electron transfer",
  adsorption: "Adsorption / desorption",
  electroadsorption: "Concerted electron-transfer adsorption (solution → surface)",
  surface_mass_action: "Interfacial mass action (no electron transfer)",
  custom_surface_rate: "Custom interfacial rate law (no electron transfer)"
};

const reactionParameterMeta = {
  bulk_mass_action: {k:[1,true,1e-12,1e12,"log","rate constant"]},
  solution_electron: {
    E0:[0,true,-2,2,"identity","formal potential (V)"],
    k0:[0.01,true,1e-9,100,"log","standard rate (cm s⁻¹)"],
    alpha:[0.5,false,0.001,0.999,"logit","transfer coefficient"],
    n:[1,false,0.5,12.5,"identity","electron count"]
  },
  surface_electron: {
    E0:[0,true,-2,2,"identity","formal potential (V)"],
    k0:[1000,true,1e-9,1e9,"log","standard rate (s⁻¹)"],
    alpha:[0.5,false,0.001,0.999,"logit","transfer coefficient"],
    n:[1,false,0.5,12.5,"identity","electron count"]
  },
  adsorption: {
    k_ads:[0.001,true,1e-12,1e6,"log","adsorption rate (cm s⁻¹)"],
    k_des:[1,true,1e-12,1e12,"log","desorption rate (s⁻¹)"],
    Gamma_max:[1e-10,false,0,1e-6,"identity","maximum coverage (mol cm⁻²; 0 = Henry)"]
  },
  electroadsorption: {
    E0:[0,true,-2,2,"identity","conditional formal potential (V)"],
    k0:[1e-10,true,1e-20,1e-4,"log","standard exchange flux (mol cm⁻² s⁻¹)"],
    alpha:[0.5,false,0.001,0.999,"logit","transfer coefficient"],
    n:[1,false,0.5,12.5,"identity","electron count"],
    Gamma_max:[1e-10,false,1e-20,1e-6,"log","maximum surface coverage (mol cm⁻²)"]
  },
  surface_mass_action: {k:[1,true,1e-12,1e20,"log","interfacial rate constant (units depend on reactant orders)"]}
};

function parameterDefinition(meta) {
  return {value:meta[0],fit:false,lower:meta[2],upper:meta[3],transform:meta[4]};
}

function parametersForType(type) {
  return Object.fromEntries(Object.entries(reactionParameterMeta[type]||{}).map(([name,meta])=>[name,parameterDefinition(meta)]));
}

function defaultCustomMechanism() {
  return {
    name:"Solution EC mechanism",
    species:[
      {name:"Ox",phase:"solution",charge:0,initial:1e-3,D:1e-5,fit_D:false,D_lower:1e-9,D_upper:1e-3},
      {name:"Red",phase:"solution",charge:0,initial:0,D:1e-5,fit_D:false,D_lower:1e-9,D_upper:1e-3},
      {name:"Product",phase:"solution",charge:0,initial:0,D:1e-5,fit_D:false,D_lower:1e-9,D_upper:1e-3}
    ],
    reactions:[
      {label:"Electron transfer",type:"solution_electron",reactantsText:"Ox",productsText:"Red",parameters:parametersForType("solution_electron"),formula:"",parameterText:""},
      {label:"Follow-up chemistry",type:"bulk_mass_action",reactantsText:"Red",productsText:"Product",parameters:parametersForType("bulk_mass_action"),formula:"",parameterText:""}
    ]
  };
}

function defaultPnpMechanism() {
  return {
    name:"Charged redox couple with supporting electrolyte",
    species:[
      {name:"OxPlus",phase:"solution",charge:1,initial:1e-3,D:1e-5,fit_D:false,D_lower:1e-9,D_upper:1e-3},
      {name:"Red",phase:"solution",charge:0,initial:0,D:1e-5,fit_D:false,D_lower:1e-9,D_upper:1e-3},
      {name:"KPlus",phase:"solution",charge:1,initial:0.1,D:1e-5,fit_D:false,D_lower:1e-9,D_upper:1e-3},
      {name:"Anion",phase:"solution",charge:-1,initial:0.101,D:1e-5,fit_D:false,D_lower:1e-9,D_upper:1e-3}
    ],
    reactions:[
      {label:"Charged electron transfer",type:"solution_electron",reactantsText:"OxPlus",productsText:"Red",parameters:parametersForType("solution_electron"),formula:"",parameterText:""}
    ]
  };
}

let customMechanism = defaultCustomMechanism();
let customMechanismRevision = 0;

function sideToText(side) {
  return (side||[]).map(x=>`${Number(x.stoich||1)===1?"":`${x.stoich} `}${x.species}`).join(" + ");
}

function parseReactionSide(text) {
  const trimmed=String(text||"").trim();
  if(!trimmed||trimmed==="0"||trimmed==="∅")return [];
  const totals=new Map();
  for(const rawPart of trimmed.split("+")){
    const part=rawPart.trim();
    const match=part.match(/^(?:(\d+)\s*\*?\s*)?([A-Za-z_][A-Za-z0-9_]*)$/);
    if(!match)throw new Error(`Cannot read reaction term “${part}”. Use forms such as A, 2 A, or 2*A.`);
    const stoich=Number(match[1]||1),name=match[2];
    if(!customMechanism.species.some(s=>s.name===name))throw new Error(`Reaction references unknown species “${name}”.`);
    totals.set(name,(totals.get(name)||0)+stoich);
  }
  return [...totals].map(([species,stoich])=>({species,stoich}));
}

function surfaceProducts(reaction) {
  try {
    return parseReactionSide(reaction.productsText)
      .map(participant=>participant.species)
      .filter(name=>customMechanism.species.some(species=>species.name===name&&species.phase==="surface"));
  } catch {
    return [];
  }
}

function siteOccupants(reaction) {
  const selected=Array.isArray(reaction.blockingSpecies)?reaction.blockingSpecies:[];
  const names=[...surfaceProducts(reaction),...selected];
  return [...new Set(names)].filter(name=>customMechanism.species.some(species=>species.name===name&&species.phase==="surface"));
}

function reactionEditorReadiness() {
  const names=customMechanism.species.map(species=>String(species.name||"").trim());
  if(names.length<2)return "Add at least two species and assign each one a phase before defining reactions.";
  if(names.some(name=>!name.match(/^[A-Za-z_][A-Za-z0-9_]*$/)))return "Give every species a valid, nonblank name before defining reactions.";
  if(new Set(names).size!==names.length)return "Species names must be unique before defining reactions.";
  if(customMechanism.species.some(species=>!["solution","surface"].includes(species.phase)))return "Choose solution or surface for every species before defining reactions.";
  return "";
}

function reactionTypeState(reaction) {
  let reactants,products;
  try{
    reactants=parseReactionSide(reaction.reactantsText);
    products=parseReactionSide(reaction.productsText);
  }catch(error){return {types:[],guidance:error.message};}
  const participants=[...reactants,...products];
  if(!participants.length)return {types:[],guidance:"Enter the reactant and product species first; compatible reaction types will then appear."};
  const phaseOf=name=>customMechanism.species.find(species=>species.name===name)?.phase||"solution";
  const phases=participants.map(participant=>phaseOf(participant.species));
  const unitPair=reactants.length===1&&products.length===1&&reactants[0].stoich===1&&products[0].stoich===1;
  const allSolution=phases.every(phase=>phase==="solution");
  const allSurface=phases.every(phase=>phase==="surface");
  if(allSolution){
    const types=["bulk_mass_action","custom_bulk_rate"];
    if(unitPair)types.unshift("solution_electron");
    return {types,guidance:unitPair?"All participants are in solution. Choose electron transfer for a redox pair, or homogeneous kinetics for a chemical step.":"All participants are in solution, so only homogeneous chemistry is available for this stoichiometry."};
  }
  if(allSurface){
    const types=["surface_mass_action","custom_surface_rate"];
    if(unitPair)types.unshift("surface_electron");
    return {types,guidance:unitPair?"All participants are surface-bound. Choose surface electron transfer for a redox pair, or interfacial mass action for a chemical step with no electron-transfer current.":"All participants are surface-bound, so only interfacial chemical kinetics are available for this stoichiometry."};
  }
  const solutionToSurface=unitPair&&phaseOf(reactants[0].species)==="solution"&&phaseOf(products[0].species)==="surface";
  if(solutionToSurface)return {types:["electroadsorption","adsorption","surface_mass_action","custom_surface_rate"],guidance:"This is a solution → surface pair. Concerted electron-transfer adsorption includes current; adsorption / desorption includes a finite site pool but no current. Interfacial mass action is an irreversible, nonfaradaic conversion with no vacant-site factor unless you add one through a custom rate law."};
  const surfaceToSolution=unitPair&&phaseOf(reactants[0].species)==="surface"&&phaseOf(products[0].species)==="solution";
  if(surfaceToSolution)return {types:["surface_mass_action","custom_surface_rate"],guidance:"For a reversible adsorption or concerted electron-transfer adsorption step, write the equation in the solution → surface direction. The reverse process is included by its desorption or oxidation rate."};
  return {types:["surface_mass_action","custom_surface_rate"],guidance:"This is an interfacial chemical step, such as a dissolved reactant attacking an adsorbed intermediate. It changes solution concentrations and surface coverages but produces no electron-transfer current."};
}

function prepareReactionType(reaction) {
  const state=reactionTypeState(reaction);
  const compatible=!reaction.type||state.types.includes(reaction.type);
  return {...state,compatible,guidance:compatible?state.guidance:`${reactionTypeLabels[reaction.type]||"The selected reaction type"} is not compatible with these participant phases. ${state.guidance}`};
}

function inferCustomParameters(text) {
  const output={};
  for(const entry of String(text||"").split(/[;,]/).map(x=>x.trim()).filter(Boolean)){
    const match=entry.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)$/);
    if(!match)throw new Error(`Cannot read parameter “${entry}”. Use name=value, separated by semicolons.`);
    const value=Number(match[2]);
    if(!Number.isFinite(value))throw new Error(`Parameter ${match[1]} is not finite.`);
    const positive=value>0;
    output[match[1]]={value,fit:false,transform:positive?"log":"identity",
      lower:positive?Math.max(value*1e-6,1e-15):-1e12,
      upper:positive?Math.max(value*1e6,value+1e-12):1e12};
  }
  return output;
}

function syncCustomParameters(reaction) {
  const inferred=inferCustomParameters(reaction.parameterText);
  for(const [name,parameter] of Object.entries(inferred)){
    const previous=reaction.parameters?.[name];
    if(previous)inferred[name]={...parameter,fit:Boolean(previous.fit),
      lower:Number(previous.lower??parameter.lower),upper:Number(previous.upper??parameter.upper),
      transform:previous.transform||parameter.transform};
  }
  reaction.parameters=inferred;
  return inferred;
}

function serializeCustomModel() {
  const species=customMechanism.species.map((s,index)=>{
    if(!["solution","surface"].includes(s.phase))throw new Error(`Species ${index+1}: choose whether it is in solution or surface-bound.`);
    return {name:String(s.name).trim(),phase:s.phase,charge:Math.trunc(Number(s.charge||0)),initial:+s.initial,D:s.phase==="surface"?0:+s.D,
      fit_D:s.phase==="solution"&&Boolean(s.fit_D),D_lower:+(s.D_lower||1e-9),D_upper:+(s.D_upper||1e-3)};
  });
  const reactions=customMechanism.reactions.map((r,index)=>{
    if(!r.type)throw new Error(`Reaction ${index+1}: enter reactants and products, then choose one of the compatible reaction types.`);
    if(!reactionTypeState(r).types.includes(r.type))throw new Error(`Reaction ${index+1}: ${reactionTypeLabels[r.type]||r.type} is not compatible with the selected participant phases.`);
    const custom=r.type.startsWith("custom_");
    return {label:r.label||"Reaction",type:r.type,
      reactants:parseReactionSide(r.reactantsText),products:parseReactionSide(r.productsText),
      parameters:custom?structuredClone(syncCustomParameters(r)):structuredClone(r.parameters),
      formula:custom?String(r.formula||"").trim():"",
      blocking_species:["adsorption","electroadsorption"].includes(r.type)?siteOccupants(r):[]};
  });
  return {name:customMechanism.name||"Custom mechanism",species,reactions};
}

function hydrateCustomModel(raw) {
  if(!raw||!Array.isArray(raw.species)||!Array.isArray(raw.reactions))throw new Error("That file is not a mechanism-builder model.");
  const invalidPhase=raw.species.find(species=>!["solution","surface"].includes(species.phase||"solution"));
  if(invalidPhase)throw new Error(`Species “${invalidPhase.name||"unnamed"}” has an unsupported phase.`);
  const unsupportedReaction=raw.reactions.find(reaction=>!Object.prototype.hasOwnProperty.call(reactionTypeLabels,reaction.type||"bulk_mass_action"));
  if(unsupportedReaction)throw new Error(`Reaction “${unsupportedReaction.label||"unnamed"}” uses an unsupported surface reaction type.`);
  customMechanism={name:raw.name||"Imported mechanism",
    species:raw.species.map(s=>({name:s.name||"Species",phase:s.phase||"solution",charge:Math.trunc(Number(s.charge||0)),initial:Number(s.initial||0),D:s.phase==="surface"?0:Number(s.D||0),fit_D:s.phase==="solution"&&Boolean(s.fit_D),D_lower:Number(s.D_lower||1e-9),D_upper:Number(s.D_upper||1e-3)})),
    reactions:raw.reactions.map((r,i)=>({label:r.label||`Reaction ${i+1}`,type:r.type||"bulk_mass_action",
      reactantsText:r.reactantsText??sideToText(r.reactants),productsText:r.productsText??sideToText(r.products),
      parameters:Object.fromEntries(Object.entries(r.parameters||parametersForType(r.type||"bulk_mass_action")).map(([name,parameter])=>[name,{...(typeof parameter==="number"?{value:parameter}:parameter),fit:Boolean(typeof parameter==="object"&&parameter.fit)}])),formula:r.formula||"",
      parameterText:r.parameterText||Object.entries(r.parameters||{}).map(([n,p])=>`${n}=${typeof p==="number"?p:p.value}`).join("; "),blockingSpecies:[...(r.blocking_species||[])]}))};
  customMechanismRevision+=1;
  renderCustomMechanism();
  if(typeof renderBrowserFitParameters==="function")renderBrowserFitParameters();
}

function markMechanismChanged() {
  customMechanismRevision+=1;
  currentPreset="custom";
  $("#preset-select").value="custom";
  $("#mechanism-equation").textContent="Custom reaction setup";
  $("#template-note").textContent="Edited from a template. Validate the setup to review its current equations before simulation.";
  $("#interpretation-text").textContent="This editable reaction setup will be used directly for the next simulation.";
  $("#builder-summary").className="empty-state builder-summary";
  $("#builder-summary").textContent="Reaction setup changed. Validate it to review the current equations.";
  setBuilderError();
  if(typeof renderBrowserFitParameters==="function")renderBrowserFitParameters();
}

const pnpReactionTypes=new Set(["bulk_mass_action","solution_electron","custom_bulk_rate"]);

function pnpCompatibilityIssue() {
  if(customMechanism.species.some(species=>!["solution","surface"].includes(species.phase)))return "Choose a phase for every species before selecting PNP.";
  if(customMechanism.species.some(species=>species.phase==="surface"))return "PNP is unavailable while the setup contains surface species.";
  if(customMechanism.reactions.some(reaction=>!pnpReactionTypes.has(reaction.type)))return "PNP is unavailable while the setup contains surface-only reactions.";
  return "";
}

function setControlGroupState(selector,available) {
  const container=$(selector);
  container.hidden=!available;
  container.querySelectorAll("input, select, textarea, button").forEach(control=>{control.disabled=!available;});
}

function syncTransportControls() {
  const transport=$("#builder-transport");
  const issue=pnpCompatibilityIssue();
  const pnpOption=transport.querySelector('option[value="pnp"]');
  pnpOption.disabled=Boolean(issue);
  const unavailable=$("#builder-pnp-unavailable");
  unavailable.textContent=issue;
  unavailable.hidden=!issue;
  if(issue&&transport.value==="pnp")transport.value="standard";
  const pnp=transport.value==="pnp";
  setControlGroupState("#builder-pnp-settings",pnp);
  $("#builder-pnp-note").hidden=!pnp;
  setControlGroupState("#double-layer-field",!pnp);
  setControlGroupState("#time-integrator-field",!pnp);
  $("#electrolyte-screen").hidden=pnp;
  $$('[data-builder-species-key="phase"] option[value="surface"]').forEach(option=>{option.disabled=pnp;});
  $$('[data-builder-reaction-type] option').forEach(option=>{option.disabled=pnp&&!pnpReactionTypes.has(option.value);});
}

function setBuilderTransport(transport) {
  $("#builder-transport").value=transport==="pnp"?"pnp":"standard";
  syncTransportControls();
}

function renderBuilderSpecies() {
  $("#builder-species").innerHTML=customMechanism.species.map((s,i)=>`<div class="builder-species-row">
    <input aria-label="Species name" data-builder-species="${i}" data-builder-species-key="name" value="${escapeHTML(s.name)}">
    <select aria-label="Species phase" data-builder-species="${i}" data-builder-species-key="phase"><option value="" ${!["solution","surface"].includes(s.phase)?"selected":""}>choose phase…</option><option value="solution" ${s.phase==="solution"?"selected":""}>solution</option><option value="surface" ${s.phase==="surface"?"selected":""}>surface</option></select>
    <input aria-label="Species charge" data-builder-species="${i}" data-builder-species-key="charge" type="number" step="1" value="${Number(s.charge||0)}" ${s.phase!=="solution"?`disabled title="${s.phase==="surface"?"PNP charge applies to mobile species":"Choose a phase first"}"`:""}>
    <label class="builder-value-with-unit"><span class="sr-only">Initial ${s.phase==="surface"?"surface coverage":"concentration"}</span><input aria-label="Initial ${s.phase==="surface"?"surface coverage":"concentration"}" data-builder-species="${i}" data-builder-species-key="initial" type="number" value="${s.initial}" step="any"><small>${s.phase==="surface"?"mol cm⁻²":s.phase==="solution"?"M":"choose phase"}</small></label>
    ${s.phase==="solution"?`<label class="builder-value-with-unit"><span class="sr-only">Diffusion coefficient</span><input aria-label="Diffusion coefficient" data-builder-species="${i}" data-builder-species-key="D" type="number" value="${s.D}" step="any"><small>cm² s⁻¹</small></label>`:`<span class="surface-species-na" aria-label="Diffusion coefficient not applicable">${s.phase==="surface"?"Not applicable":"Choose phase"}</span>`}
    <button class="remove-dataset" data-builder-remove-species="${i}" type="button" aria-label="Remove ${escapeHTML(s.name)}">×</button>
  </div>`).join("");
  $$('[data-builder-species-key]').forEach(input=>input.addEventListener("change",()=>{
    const species=customMechanism.species[+input.dataset.builderSpecies],key=input.dataset.builderSpeciesKey;
    const previousPhase=species.phase;
    species[key]=key==="name"||key==="phase"?input.value:+input.value;
    if(key==="phase"&&species.phase!==previousPhase){
      species.initial=0;
      species.D=species.phase==="solution"?1e-5:0;
      species.fit_D=false;
    }
    markMechanismChanged();
    renderBuilderSpecies();
    if(key==="name"||key==="phase"||key==="initial")renderBuilderReactions();
  }));
  $$('[data-builder-remove-species]').forEach(button=>button.addEventListener("click",()=>{customMechanism.species.splice(+button.dataset.builderRemoveSpecies,1);markMechanismChanged();renderBuilderSpecies();renderBuilderReactions();}));
  syncTransportControls();
}

function siteOccupancyRows(reaction,index) {
  const products=surfaceProducts(reaction);
  const productSet=new Set(products);
  const selected=new Set(siteOccupants(reaction));
  const competitors=customMechanism.species
    .filter(species=>species.phase==="surface"&&!productSet.has(species.name));
  const productsMarkup=products.map(name=>`<label class="site-occupant required"><input type="checkbox" checked disabled><span><strong>${escapeHTML(name)}</strong><small>Surface product · always occupies one site</small></span></label>`).join("");
  const competitorsMarkup=competitors.length
    ? competitors.map(species=>`<label class="site-occupant"><input type="checkbox" data-builder-site-occupant="${index}" value="${escapeHTML(species.name)}" ${selected.has(species.name)?"checked":""}><span><strong>${escapeHTML(species.name)}</strong><small>Competes for the same site pool</small></span></label>`).join("")
    : `<p class="helper-text site-occupancy-empty">No other surface species are available to compete for these sites.</p>`;
  return `<fieldset class="site-occupancy-field"><legend>Surface-site occupancy</legend><p>The surface product is counted automatically. Select only additional surface species that occupy the same one-site Langmuir pool.</p><div class="site-occupant-grid">${productsMarkup}${competitorsMarkup}</div></fieldset>`;
}

function unitPower(unit,power) {
  if(power===0)return "";
  return power===1?unit:`${unit}<sup>${power}</sup>`;
}

function interfacialRateUnits(reaction) {
  let solutionOrder=0,surfaceOrder=0;
  try {
    for(const participant of parseReactionSide(reaction.reactantsText)){
      const phase=customMechanism.species.find(species=>species.name===participant.species)?.phase;
      if(phase==="surface")surfaceOrder+=participant.stoich;
      else solutionOrder+=participant.stoich;
    }
  } catch {}
  return [unitPower("mol",1-solutionOrder-surfaceOrder),unitPower("cm",-2+3*solutionOrder+2*surfaceOrder),"s<sup>-1</sup>"].filter(Boolean).join(" ");
}

function electroAdsorptionScale(reaction) {
  const k0=Number(reaction.parameters?.k0?.value),maximum=Number(reaction.parameters?.Gamma_max?.value);
  let reactant;
  try{reactant=parseReactionSide(reaction.reactantsText)[0];}catch{return "";}
  const concentration=Number(customMechanism.species.find(species=>species.name===reactant?.species)?.initial);
  if(!(k0>0&&maximum>0&&concentration>0))return "";
  const flux=k0*concentration;
  if(!(Number.isFinite(flux)&&flux>0))return "";
  const timescale=maximum/flux;
  const timestep=Number(document.querySelector('[data-key="timestep"]')?.value);
  const unresolved=Number.isFinite(timestep)&&timestep/timescale>100;
  const comparison=Number.isFinite(timestep)?` The selected Δt is ${scientific(timestep/timescale,3)} times this estimate.`:"";
  return `<div class="kinetic-scale ${unresolved?"warning":""}"><strong>Initial scale at E = E0:</strong> J<sub>red</sub> ≈ k0(c/1 M) = ${scientific(flux,3)} mol cm⁻² s⁻¹ and Γ<sub>max</sub>/J<sub>red</sub> ≈ ${scientific(timescale,3)} s.${comparison}${unresolved?" This rate is not resolved by the selected timestep; reduce k0 or Δt.":""}</div>`;
}

function reactionMathRows(reaction) {
  if(reaction.type==="surface_mass_action"){
    let phases=[];
    try{phases=[...parseReactionSide(reaction.reactantsText),...parseReactionSide(reaction.productsText)].map(participant=>customMechanism.species.find(species=>species.name===participant.species)?.phase);}catch{}
    const mixed=phases.includes("solution")&&phases.includes("surface");
    const summary=mixed?"Why this mixed-phase reaction is allowed · math and Rust":"Interfacial mass-action math and Rust";
    const explanation=mixed?"This represents an irreversible chemical event at the interface, such as <code>A_sol + B_ads → C_ads</code>.":"This represents an irreversible chemical event among surface-bound species.";
    return `<details class="reaction-math"><summary>${summary}</summary><div><p>${explanation} It is not electron transfer and contributes no faradaic current.</p><div class="math-expression">J = k ∏<sub>solution reactants</sub>(10⁻³ cᵢ)<sup>νᵢ</sup> ∏<sub>surface reactants</sub>Γⱼ<sup>νⱼ</sup></div><p><code>c</code> is entered in M and converted to mol cm⁻³; <code>Γ</code> is mol cm⁻². <code>J</code> is mol cm⁻² s⁻¹, so this reaction’s <code>k</code> has units ${interfacialRateUnits(reaction)}. Products affect the material balances but not this irreversible rate expression. There is no vacant-site factor; use Adsorption / desorption or a custom interfacial law when site saturation matters.</p><pre><code>rate = reactants.fold(k, |r, p| r * value(p).powi(p.stoich));</code></pre></div></details>`;
  }
  if(reaction.type==="electroadsorption")return `<details class="reaction-math"><summary>Concerted adsorption math and Rust</summary><div><div class="math-expression">J = k0[e<sup>−αnFη/RT</sup>a<sub>Ox</sub>(1−θ<sub>occ</sub>) − e<sup>(1−α)nFη/RT</sup>θ<sub>Red</sub>]</div><p>η = E − E0, a<sub>Ox</sub> is represented by the numerical concentration relative to 1 M, θ<sub>Red</sub> = Γ<sub>Red</sub>/Γ<sub>max</sub>, and i<sub>F</sub> = nFAJ. Because <code>k0</code> is an exchange <em>flux</em>, a value of 1 mol cm⁻² s⁻¹ is enormous for a site capacity near 10⁻¹⁰ mol cm⁻².</p><pre><code>flux = k0*reduction*c*(1.0 - occupied)<br>     - k0*oxidation*coverage/Gamma_max;</code></pre>${electroAdsorptionScale(reaction)}</div></details>`;
  if(reaction.type==="adsorption")return `<details class="reaction-math"><summary>Adsorption math and Rust</summary><div><div class="math-expression">J = 10⁻³ k<sub>ads</sub>c(1−θ<sub>occ</sub>) − k<sub>des</sub>Γ</div><p>This step changes the boundary concentration and surface coverage but contributes no faradaic current. Set Γ<sub>max</sub> to zero only for unsaturated Henry behavior.</p><pre><code>flux = 1e-3*k_ads*c*(1.0 - occupied) - k_des*coverage;</code></pre></div></details>`;
  if(reaction.type==="custom_surface_rate")return `<details class="reaction-math"><summary>Custom interfacial-rate contract</summary><div><p>The formula receives solution species in M and surface species in mol cm⁻². It must return an interfacial flux in mol cm⁻² s⁻¹. EchemLab applies that flux to every reactant and product balance; it produces no faradaic current.</p></div></details>`;
  return "";
}

function parameterRows(reaction,index) {
  if(!reaction.type)return `<p class="helper-text reaction-parameter-prompt">Choose a compatible reaction type to enter its kinetic parameters.</p>`;
  if(reaction.type.startsWith("custom_")){
    try{syncCustomParameters(reaction);}catch{}
    return `<div class="custom-rate-grid">
    <label class="field"><span>Rate formula</span><input data-builder-reaction="${index}" data-builder-reaction-key="formula" value="${escapeHTML(reaction.formula||"")}" placeholder="k*Red/(Km + Red)"></label>
    <label class="field"><span>Parameters <b>name=value; …</b></span><input data-builder-reaction="${index}" data-builder-reaction-key="parameterText" value="${escapeHTML(reaction.parameterText||"")}" placeholder="k=1.0; Km=0.001"></label>
  </div>${reactionMathRows(reaction)}`;
  }
  const occupancy=["adsorption","electroadsorption"].includes(reaction.type)?siteOccupancyRows(reaction,index):"";
  return `<div class="builder-parameter-head" aria-hidden="true"><span>Parameter</span><span>Simulation value</span></div>`+
    Object.entries(reaction.parameters).map(([name,p])=>`<div class="builder-parameter-row"><span><strong>${escapeHTML(name)}</strong><small>${escapeHTML(reactionParameterMeta[reaction.type]?.[name]?.[5]||"")}</small></span><input aria-label="${name} simulation value" data-builder-param="${index}" data-builder-param-name="${name}" data-builder-param-key="value" type="number" step="any" value="${p.value}"></div>`).join("")+occupancy+reactionMathRows(reaction);
}

function renderBuilderReactions() {
  const readiness=reactionEditorReadiness();
  const availability=$("#builder-reaction-availability");
  availability.textContent=readiness;
  availability.hidden=!readiness;
  $("#builder-reactions").hidden=Boolean(readiness);
  $("#builder-add-reaction").hidden=Boolean(readiness);
  $("#rate-language-help").hidden=Boolean(readiness);
  if(readiness){$("#builder-reactions").innerHTML="";syncTransportControls();return;}
  $("#builder-reactions").innerHTML=customMechanism.reactions.map((r,i)=>{
    const state=prepareReactionType(r);
    const placeholder=!state.compatible?"Choose a new compatible reaction type":state.types.length?"Choose a compatible reaction type":"Enter valid participants first";
    const options=state.types.map(value=>`<option value="${value}" ${state.compatible&&r.type===value?"selected":""}>${reactionTypeLabels[value]}</option>`).join("");
    const parameters=state.compatible?parameterRows(r,i):`<p class="helper-text reaction-parameter-prompt">Choose a compatible reaction type before editing kinetic parameters.</p>`;
    return `<article class="builder-reaction-card">
    <div class="builder-reaction-title"><input aria-label="Reaction label" data-builder-reaction="${i}" data-builder-reaction-key="label" value="${escapeHTML(r.label)}"><button class="remove-dataset" data-builder-remove-reaction="${i}" type="button" aria-label="Remove reaction">×</button></div>
    <div class="builder-equation"><label class="field"><span>Reactants</span><input data-builder-reaction="${i}" data-builder-reaction-key="reactantsText" value="${escapeHTML(r.reactantsText)}" placeholder="A + 2 B"></label><span class="reaction-arrow">→</span><label class="field"><span>Products</span><input data-builder-reaction="${i}" data-builder-reaction-key="productsText" value="${escapeHTML(r.productsText)}" placeholder="C"></label></div>
    <label class="field reaction-type-field"><span>Compatible reaction type</span><select aria-label="Reaction type" aria-describedby="builder-reaction-guidance-${i}" data-builder-reaction-type="${i}" ${state.types.length?"":"disabled"}><option value="" ${state.compatible&&r.type?"":"selected"}>${placeholder}</option>${options}</select></label>
    <p id="builder-reaction-guidance-${i}" class="reaction-type-guidance">${escapeHTML(state.guidance)}</p>
    <div class="builder-parameters">${parameters}</div>
  </article>`;}).join("");
  $$('[data-builder-reaction-key]').forEach(input=>input.addEventListener("input",()=>{customMechanism.reactions[+input.dataset.builderReaction][input.dataset.builderReactionKey]=input.value;markMechanismChanged();}));
  $$('[data-builder-reaction-key="reactantsText"], [data-builder-reaction-key="productsText"]').forEach(input=>input.addEventListener("change",renderBuilderReactions));
  $$('[data-builder-reaction-type]').forEach(select=>select.addEventListener("change",()=>{const r=customMechanism.reactions[+select.dataset.builderReactionType];r.type=select.value;r.formula=select.value.startsWith("custom_")?"k*"+(customMechanism.species[0]?.name||"A"):"";r.parameterText=select.value.startsWith("custom_")?"k=1":"";r.parameters=select.value.startsWith("custom_")?inferCustomParameters(r.parameterText):parametersForType(select.value);r.blockingSpecies=[];markMechanismChanged();renderBuilderReactions();}));
  $$('[data-builder-param]').forEach(input=>input.addEventListener("change",()=>{const reaction=customMechanism.reactions[+input.dataset.builderParam],p=reaction.parameters[input.dataset.builderParamName];p[input.dataset.builderParamKey]=+input.value;markMechanismChanged();if(reaction.type==="electroadsorption"&&["k0","Gamma_max"].includes(input.dataset.builderParamName))renderBuilderReactions();}));
  $$('[data-builder-site-occupant]').forEach(input=>input.addEventListener("change",()=>{const index=+input.dataset.builderSiteOccupant;customMechanism.reactions[index].blockingSpecies=$$(`[data-builder-site-occupant="${index}"]:checked`).map(checkbox=>checkbox.value);markMechanismChanged();}));
  $$('[data-builder-reaction-key="parameterText"]').forEach(input=>input.addEventListener("change",()=>{const reaction=customMechanism.reactions[+input.dataset.builderReaction];syncCustomParameters(reaction);markMechanismChanged();renderBuilderReactions();}));
  $$('[data-builder-remove-reaction]').forEach(button=>button.addEventListener("click",()=>{customMechanism.reactions.splice(+button.dataset.builderRemoveReaction,1);markMechanismChanged();renderBuilderReactions();}));
  syncTransportControls();
}

function renderCustomMechanism() {
  renderBuilderSpecies(); renderBuilderReactions();
  if(typeof renderVoltammetricRateOptions==="function")renderVoltammetricRateOptions();
}

function customFitParameterEntries() {
  const model=serializeCustomModel(),entries=[];
  model.species.forEach((species,index)=>{if(species.phase==="solution")entries.push({id:`s${index+1}_D`,label:`${species.name} diffusion coefficient`,value:species.D,unit:"cm² s⁻¹",fit:species.fit_D,lower:species.D_lower,upper:species.D_upper,transform:"log",advanced:true});});
  model.reactions.forEach((reaction,index)=>Object.entries(reaction.parameters).forEach(([name,parameter])=>{
    if(["solution_electron","surface_electron","electroadsorption"].includes(reaction.type)&&name==="n")return;
    const meta=reactionParameterMeta[reaction.type]?.[name];
    entries.push({id:`r${index+1}_${name}`,label:`${reaction.label||`Reaction ${index+1}`} · ${name}`,value:parameter.value,unit:meta?.[5]||"model units",fit:Boolean(parameter.fit),lower:Number(parameter.lower??meta?.[2]??-1e12),upper:Number(parameter.upper??meta?.[3]??1e12),transform:parameter.transform||meta?.[4]||"identity",advanced:false});
  }));
  return entries;
}

function applyCustomFitParameter(model,id,settings) {
  const match=String(id).match(/^([sr])(\d+)_(.+)$/);if(!match)return;
  const index=Number(match[2])-1;
  if(match[1]==="s"){
    const species=model.species[index];if(!species)return;
    species.fit_D=Boolean(settings.fit);species.D=Number(settings.value);
    species.D_lower=Number(settings.lower);species.D_upper=Number(settings.upper);
  }else{
    const parameter=model.reactions[index]?.parameters?.[match[3]];if(!parameter)return;
    parameter.fit=Boolean(settings.fit);parameter.value=Number(settings.value);
    parameter.lower=Number(settings.lower);parameter.upper=Number(settings.upper);
    parameter.transform=settings.transform;
  }
}
function setBuilderError(message=""){const box=$("#builder-error");box.textContent=message;box.hidden=!message;}

function renderBuilderSummary(result) {
  $("#builder-summary").className="builder-summary validated-summary";
  $("#builder-summary").innerHTML=`<div class="result-badges"><span class="result-badge success">Valid reaction setup</span><span class="result-badge">${result.species_count} species</span><span class="result-badge">${result.reaction_count} reactions</span><span class="result-badge">Rust/Wasm simulation ready</span></div>${result.warning?`<div class="model-warning">${escapeHTML(result.warning)}</div>`:""}<div class="equation-list">${result.equations.map(e=>`<div><span class="candidate-kind">${escapeHTML(e.type.replaceAll("_"," "))}</span><strong>${escapeHTML(e.equation)}</strong><small>${escapeHTML(e.label)}</small></div>`).join("")}</div>`;
  $("#mechanism-equation").textContent=result.equations.map(e=>e.equation).join("  ·  ");
}

async function validateBuilder(model=serializeCustomModel()) {
  setBuilderError();
  try{if(!window.electrochemBrowserEngine?.supportsCustomMechanism(model))throw new Error("The browser supports solution and surface species with homogeneous, electron-transfer, adsorption, electron-transfer adsorption, and heterogeneous rate laws.");const result=await window.electrochemBrowserEngine.validateCustom(model);renderBuilderSummary(result);return result;}
  catch(error){setBuilderError(error.message);throw error;}
}

function exportBuilder(){try{const blob=new Blob([JSON.stringify(serializeCustomModel(),null,2)],{type:"application/json"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`${(customMechanism.name||"mechanism").replace(/[^A-Za-z0-9_-]+/g,"_")}.json`;link.click();URL.revokeObjectURL(link.href);}catch(error){setBuilderError(error.message);}}

$("#builder-add-species").addEventListener("click",()=>{customMechanism.species.push({name:`Species_${customMechanism.species.length+1}`,phase:"",charge:0,initial:0,D:1e-5,fit_D:false,D_lower:1e-9,D_upper:1e-3});markMechanismChanged();renderBuilderSpecies();renderBuilderReactions();});
$("#builder-add-reaction").addEventListener("click",()=>{customMechanism.reactions.push({label:`Reaction ${customMechanism.reactions.length+1}`,type:"",reactantsText:"",productsText:"",parameters:{},formula:"",parameterText:""});markMechanismChanged();renderBuilderReactions();});
$("#builder-validate").addEventListener("click",()=>validateBuilder().catch(()=>{}));
$("#builder-export-button").addEventListener("click",exportBuilder);
$("#builder-import-button").addEventListener("click",()=>$("#builder-import-file").click());
$("#builder-import-file").addEventListener("change",async event=>{try{setBuilderTransport("standard");hydrateCustomModel(JSON.parse(await event.target.files[0].text()));markMechanismChanged();await validateBuilder();}catch(error){setBuilderError(error.message);}finally{event.target.value="";}});
$("#builder-transport").addEventListener("change",event=>{setBuilderTransport(event.target.value);markMechanismChanged();});
document.querySelector('[data-key="timestep"]').addEventListener("change",renderBuilderReactions);
selectPreset(currentPreset);
