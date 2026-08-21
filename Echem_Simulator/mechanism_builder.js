const reactionTypeLabels = {
  bulk_mass_action: "Homogeneous mass action",
  solution_electron: "Solution electron transfer",
  custom_bulk_rate: "Custom homogeneous rate law",
  surface_electron: "Surface-confined electron transfer",
  adsorption: "Adsorption / desorption",
  surface_mass_action: "Heterogeneous mass action",
  custom_surface_rate: "Custom heterogeneous rate law"
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
  surface_mass_action: {k:[1,true,1e-12,1e20,"log","heterogeneous rate constant"]}
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
  const species=customMechanism.species.map(s=>({name:String(s.name).trim(),phase:s.phase||"solution",charge:Math.trunc(Number(s.charge||0)),initial:+s.initial,D:s.phase==="surface"?0:+s.D,
    fit_D:s.phase==="solution"&&Boolean(s.fit_D),D_lower:+(s.D_lower||1e-9),D_upper:+(s.D_upper||1e-3)}));
  const reactions=customMechanism.reactions.map(r=>({label:r.label||"Reaction",type:r.type,
    reactants:parseReactionSide(r.reactantsText),products:parseReactionSide(r.productsText),
    parameters:r.type.startsWith("custom_")?structuredClone(syncCustomParameters(r)):structuredClone(r.parameters),
    formula:r.type.startsWith("custom_")?String(r.formula||"").trim():"",
    blocking_species:r.type==="adsorption"?String(r.blockingText||"").split(",").map(name=>name.trim()).filter(Boolean):[]}));
  return {name:customMechanism.name||"Custom mechanism",species,reactions};
}

function hydrateCustomModel(raw) {
  if(!raw||!Array.isArray(raw.species)||!Array.isArray(raw.reactions))throw new Error("That file is not a mechanism-builder model.");
  const invalidPhase=raw.species.find(species=>!["solution","surface"].includes(species.phase||"solution"));
  if(invalidPhase)throw new Error(`Species “${invalidPhase.name||"unnamed"}” has an unsupported phase.`);
  const unsupportedReaction=raw.reactions.find(reaction=>!Object.prototype.hasOwnProperty.call(reactionTypeLabels,reaction.type||"bulk_mass_action"));
  if(unsupportedReaction)throw new Error(`Reaction “${unsupportedReaction.label||"unnamed"}” uses an unsupported surface reaction type.`);
  customMechanism={name:raw.name||"Imported mechanism",
    species:raw.species.map(s=>({name:s.name||"Species",phase:s.phase||"solution",charge:Math.trunc(Number(s.charge||0)),initial:Number(s.initial||0),D:Number(s.D||0),fit_D:Boolean(s.fit_D),D_lower:Number(s.D_lower||1e-9),D_upper:Number(s.D_upper||1e-3)})),
    reactions:raw.reactions.map((r,i)=>({label:r.label||`Reaction ${i+1}`,type:r.type||"bulk_mass_action",
      reactantsText:r.reactantsText??sideToText(r.reactants),productsText:r.productsText??sideToText(r.products),
      parameters:Object.fromEntries(Object.entries(r.parameters||parametersForType(r.type||"bulk_mass_action")).map(([name,parameter])=>[name,{...(typeof parameter==="number"?{value:parameter}:parameter),fit:Boolean(typeof parameter==="object"&&parameter.fit)}])),formula:r.formula||"",
      parameterText:r.parameterText||Object.entries(r.parameters||{}).map(([n,p])=>`${n}=${typeof p==="number"?p:p.value}`).join("; "),blockingText:(r.blocking_species||[]).join(", ")}))};
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
    <select aria-label="Species phase" data-builder-species="${i}" data-builder-species-key="phase"><option value="solution" ${s.phase!=="surface"?"selected":""}>solution</option><option value="surface" ${s.phase==="surface"?"selected":""}>surface</option></select>
    <input aria-label="Species charge" data-builder-species="${i}" data-builder-species-key="charge" type="number" step="1" value="${Number(s.charge||0)}" ${s.phase==="surface"?"disabled title=\"PNP charge applies to mobile species\"":""}>
    <input aria-label="Initial amount" data-builder-species="${i}" data-builder-species-key="initial" type="number" value="${s.initial}" step="any">
    <input aria-label="Diffusion coefficient" data-builder-species="${i}" data-builder-species-key="D" type="number" value="${s.D}" step="any" ${s.phase==="surface"?"disabled title=\"Surface coverage does not diffuse\"":""}>
    <button class="remove-dataset" data-builder-remove-species="${i}" type="button" aria-label="Remove ${escapeHTML(s.name)}">×</button>
  </div>`).join("");
  $$('[data-builder-species-key]').forEach(input=>input.addEventListener("change",()=>{
    const species=customMechanism.species[+input.dataset.builderSpecies],key=input.dataset.builderSpeciesKey;
    species[key]=key==="name"||key==="phase"?input.value:+input.value;
    markMechanismChanged();
    renderBuilderSpecies();
  }));
  $$('[data-builder-remove-species]').forEach(button=>button.addEventListener("click",()=>{customMechanism.species.splice(+button.dataset.builderRemoveSpecies,1);markMechanismChanged();renderBuilderSpecies();}));
  syncTransportControls();
}

function parameterRows(reaction,index) {
  if(reaction.type.startsWith("custom_")){
    try{syncCustomParameters(reaction);}catch{}
    return `<div class="custom-rate-grid">
    <label class="field"><span>Rate formula</span><input data-builder-reaction="${index}" data-builder-reaction-key="formula" value="${escapeHTML(reaction.formula||"")}" placeholder="k*Red/(Km + Red)"></label>
    <label class="field"><span>Parameters <b>name=value; …</b></span><input data-builder-reaction="${index}" data-builder-reaction-key="parameterText" value="${escapeHTML(reaction.parameterText||"")}" placeholder="k=1.0; Km=0.001"></label>
  </div>`;
  }
  const blocking=reaction.type==="adsorption"?`<label class="field"><span>Blocking surface species <b>comma-separated; blank = product</b></span><input data-builder-reaction="${index}" data-builder-reaction-key="blockingText" value="${escapeHTML(reaction.blockingText||"")}" placeholder="Adsorbed, Inhibitor"></label>`:"";
  return `<div class="builder-parameter-head" aria-hidden="true"><span>Parameter</span><span>Simulation value</span></div>`+
    Object.entries(reaction.parameters).map(([name,p])=>`<div class="builder-parameter-row"><span><strong>${escapeHTML(name)}</strong><small>${escapeHTML(reactionParameterMeta[reaction.type]?.[name]?.[5]||"")}</small></span><input aria-label="${name} simulation value" data-builder-param="${index}" data-builder-param-name="${name}" data-builder-param-key="value" type="number" step="any" value="${p.value}"></div>`).join("")+blocking;
}

function renderBuilderReactions() {
  $("#builder-reactions").innerHTML=customMechanism.reactions.map((r,i)=>`<article class="builder-reaction-card">
    <div class="builder-reaction-title"><input aria-label="Reaction label" data-builder-reaction="${i}" data-builder-reaction-key="label" value="${escapeHTML(r.label)}"><select aria-label="Reaction type" data-builder-reaction-type="${i}">${Object.entries(reactionTypeLabels).map(([value,label])=>`<option value="${value}" ${r.type===value?"selected":""}>${label}</option>`).join("")}</select><button class="remove-dataset" data-builder-remove-reaction="${i}" type="button" aria-label="Remove reaction">×</button></div>
    <div class="builder-equation"><label class="field"><span>Reactants</span><input data-builder-reaction="${i}" data-builder-reaction-key="reactantsText" value="${escapeHTML(r.reactantsText)}" placeholder="A + 2 B"></label><span class="reaction-arrow">→</span><label class="field"><span>Products</span><input data-builder-reaction="${i}" data-builder-reaction-key="productsText" value="${escapeHTML(r.productsText)}" placeholder="C"></label></div>
    <div class="builder-parameters">${parameterRows(r,i)}</div>
  </article>`).join("");
  $$('[data-builder-reaction-key]').forEach(input=>input.addEventListener("input",()=>{customMechanism.reactions[+input.dataset.builderReaction][input.dataset.builderReactionKey]=input.value;markMechanismChanged();}));
  $$('[data-builder-reaction-type]').forEach(select=>select.addEventListener("change",()=>{const r=customMechanism.reactions[+select.dataset.builderReactionType];r.type=select.value;r.formula=select.value.startsWith("custom_")?"k*"+(customMechanism.species[0]?.name||"A"):"";r.parameterText=select.value.startsWith("custom_")?"k=1":"";r.parameters=select.value.startsWith("custom_")?inferCustomParameters(r.parameterText):parametersForType(select.value);markMechanismChanged();renderBuilderReactions();}));
  $$('[data-builder-param]').forEach(input=>input.addEventListener("change",()=>{const p=customMechanism.reactions[+input.dataset.builderParam].parameters[input.dataset.builderParamName];p[input.dataset.builderParamKey]=+input.value;markMechanismChanged();}));
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
    if(["solution_electron","surface_electron"].includes(reaction.type)&&name==="n")return;
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
  try{if(!window.electrochemBrowserEngine?.supportsCustomMechanism(model))throw new Error("The browser supports solution and surface species with homogeneous, electron-transfer, adsorption, and heterogeneous rate laws.");const result=await window.electrochemBrowserEngine.validateCustom(model);renderBuilderSummary(result);return result;}
  catch(error){setBuilderError(error.message);throw error;}
}

function exportBuilder(){try{const blob=new Blob([JSON.stringify(serializeCustomModel(),null,2)],{type:"application/json"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`${(customMechanism.name||"mechanism").replace(/[^A-Za-z0-9_-]+/g,"_")}.json`;link.click();URL.revokeObjectURL(link.href);}catch(error){setBuilderError(error.message);}}

$("#builder-add-species").addEventListener("click",()=>{customMechanism.species.push({name:`Species_${customMechanism.species.length+1}`,phase:"solution",charge:0,initial:0,D:1e-5,fit_D:false,D_lower:1e-9,D_upper:1e-3});markMechanismChanged();renderBuilderSpecies();});
$("#builder-add-reaction").addEventListener("click",()=>{customMechanism.reactions.push({label:`Reaction ${customMechanism.reactions.length+1}`,type:"bulk_mass_action",reactantsText:"",productsText:"",parameters:parametersForType("bulk_mass_action"),formula:"",parameterText:""});markMechanismChanged();renderBuilderReactions();});
$("#builder-validate").addEventListener("click",()=>validateBuilder().catch(()=>{}));
$("#builder-export-button").addEventListener("click",exportBuilder);
$("#builder-import-button").addEventListener("click",()=>$("#builder-import-file").click());
$("#builder-import-file").addEventListener("change",async event=>{try{setBuilderTransport("standard");hydrateCustomModel(JSON.parse(await event.target.files[0].text()));markMechanismChanged();await validateBuilder();}catch(error){setBuilderError(error.message);}finally{event.target.value="";}});
$("#builder-transport").addEventListener("change",event=>{setBuilderTransport(event.target.value);markMechanismChanged();});
selectPreset(currentPreset);
