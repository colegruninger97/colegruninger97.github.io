"use strict";

let classroomDemoLoaded = false;

function classroomDemoModel() {
  return {
    name: "Cu(TMGqu)₂ · solution E classroom model",
    film: null,
    species: [
      {name:"Ox",phase:"solution",charge:0,initial:1e-3,D:1e-5,fit_D:false,D_lower:1e-7,D_upper:1e-3},
      {name:"Red",phase:"solution",charge:0,initial:0,D:1e-5,fit_D:false,D_lower:1e-7,D_upper:1e-3}
    ],
    reactions: [{
      label: "Cu(II/I) electron transfer",
      type: "solution_electron",
      reactants: [{species:"Ox",stoich:1}],
      products: [{species:"Red",stoich:1}],
      parameters: {
        E0: {value:-0.435,fit:true,transform:"identity",lower:-0.55,upper:-0.30},
        k0: {value:0.01,fit:true,transform:"log",lower:1e-5,upper:1},
        alpha: {value:0.5,fit:false,transform:"logit",lower:0.001,upper:0.999},
        n: {value:1,fit:false,transform:"identity",lower:0.5,upper:1.5}
      }
    }]
  };
}

function setDemoField(selector,value) {
  const field=$(selector);
  if(field)field.value=String(value);
}

function resetDemoAnalysisResults() {
  latestBrowserFit=null;
  latestBrowserFitPayload=null;
  latestBrowserUncertaintyTarget=null;
  latestDataQualityReport=null;
  knownInputMeasurements=[];
  knownInputOptionCache=[];
  posteriorParameterNames=[];
  $("#fit-summary").className="empty-state tall";
  $("#fit-summary").textContent="Estimate the selected parameters to see results.";
  $("#discovery-results").className="empty-state";
  $("#discovery-results").textContent="Run a discovery analysis to compare mechanisms.";
  $("#uncertainty-results").className="empty-state tall";
  $("#uncertainty-results").textContent="Complete the classroom parameter fit before calculating uncertainty.";
  $("#uncertainty-parameter").innerHTML="";
  renderKnownInputOptions();
}

function configureDemoFit() {
  setDemoField("#fit-loss","least_squares");
  setDemoField("#fit-solver","bdf1");
  setDemoField("#fit-multistart",2);
  setDemoField("#fit-steps",200);
  setDemoField("#fit-grid",24);
  setDemoField("#fit-iterations",100);
  $$(".robust-fit-setting").forEach(field=>{field.hidden=true;});

  fitSharedDiffusionEnabled=true;
  renderBrowserFitParameters();
  if(customFitParameterState.shared_D){
    Object.assign(customFitParameterState.shared_D,{fit:true,value:1e-5,lower:1e-7,upper:1e-3,transform:"log"});
  }
  if(customFitParameterState.r1_E0){
    Object.assign(customFitParameterState.r1_E0,{fit:true,value:-0.435,lower:-0.55,upper:-0.30,transform:"identity"});
  }
  if(customFitParameterState.r1_k0){
    Object.assign(customFitParameterState.r1_k0,{fit:true,value:0.01,lower:1e-5,upper:1,transform:"log"});
  }
  renderBrowserFitParameters();
}

function configureDemoDiscovery() {
  setDemoField("#discover-concentration",1e-3);
  setDemoField("#discover-diffusion",1e-5);
  setDemoField("#discover-substrate",0.01);
  setDemoField("#discover-criterion","AICc");
  setDemoField("#discover-e0-lower",-0.55);
  setDemoField("#discover-e0-upper",-0.30);
  const selected=new Set(["reversible_e","quasi_reversible_e","ec","ce"]);
  $$('[data-library-candidate]').forEach(input=>{input.checked=selected.has(input.dataset.libraryCandidate);});
  $("#library-predictive-validation").checked=false;
  document.querySelector('[data-discovery-mode="library"]')?.click();
}

function configureDemoUncertainty() {
  setDemoField("#profile-points",5);
  setDemoField("#profile-span",2);
  setDemoField("#posterior-samples",50);
  setDemoField("#posterior-burnin",50);
  setDemoField("#posterior-chains",2);
  setDemoField("#posterior-scale",0.5);
  setDemoField("#posterior-seed",2026);
  setDemoField("#posterior-noise-model","ar1_gaussian");
}

async function loadClassroomDemo(destination="data") {
  const button=$("#load-classroom-demo"),status=$("#classroom-demo-status");
  button.disabled=true;
  button.textContent="Loading public voltammogram…";
  status.textContent="Loading the bundled Chemotion voltammogram and configuring the analysis screens…";
  try{
    await window.electrochemBrowserEngine.ready();
    const response=await fetch("demo-data/chemotion_cu_tmgqu_cycle.csv");
    if(!response.ok)throw new Error(`The classroom dataset could not be loaded (${response.status}).`);
    const dataset=ElectrochemImport.parseVoltammogram(
      await response.text(),
      "Chemotion Cu(TMGqu)₂ · 0.1001 V s⁻¹",
      ++datasetSequence
    );
    dataset.scan_rate=0.1001;
    dataset.background_model="none";
    dataset.initial_concentrations={};
    dataset.initial_coverages={};

    setBuilderTransport("standard");
    hydrateCustomModel(classroomDemoModel());
    currentPreset="custom";
    $("#preset-select").value="custom";
    $("#mechanism-equation").textContent="Ox (solution) + e⁻ ⇌ Red (solution)";
    $("#template-note").textContent="Classroom model for the public Cu(II/I) voltammogram. Diffusion is linked across both solution species for fitting.";
    $("#interpretation-text").textContent="Use this deliberately simple E model to test which conclusions survive residual, mechanism, and uncertainty analysis.";
    await validateBuilder();

    setDemoField('[data-key="temperature"]',298.15);
    setDemoField('[data-key="start_potential"]',-0.203109);
    setDemoField('[data-key="switching_potential"]',-0.753);
    setDemoField('[data-key="scan_rate"]',0.1001);
    setDemoField('[data-key="electrode_area"]',0.012);
    setDemoField('[data-key="solution_resistance"]',0);
    setDemoField('[data-key="double_layer_capacitance"]',0);
    selectVoltammogramConvention("us");

    experimentalDatasets.length=0;
    experimentalDatasets.push(dataset);
    resetDemoAnalysisResults();
    renderBrowserDatasets();
    configureDemoFit();
    configureDemoDiscovery();
    configureDemoUncertainty();

    classroomDemoLoaded=true;
    $("#classroom-demo-strip").hidden=false;
    button.textContent="Reload classroom demo";
    status.textContent="Ready: begin with the data preflight, then run the configured fit, mechanism comparison, and k⁰ profile yourself.";
    switchView(destination);
  }catch(problem){
    status.textContent=`Demo setup failed: ${problem.message}`;
    button.textContent="Try loading again";
  }finally{
    button.disabled=false;
  }
}

async function openClassroomDemoStep(destination) {
  if(!classroomDemoLoaded){
    await loadClassroomDemo(destination);
    return;
  }
  switchView(destination);
}

$("#load-classroom-demo").addEventListener("click",()=>loadClassroomDemo("data"));
$$('[data-demo-route]').forEach(button=>button.addEventListener("click",()=>openClassroomDemoStep(button.dataset.demoRoute)));
