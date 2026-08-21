(() => {
  "use strict";

  const scriptBase = new URL(".", document.currentScript.src);
  const supportedIntegrators = ["be_fe", "trap_ab2", "bdf1", "bdf2"];

  class ElectrochemBrowserEngine {
    constructor() {
      this.worker = null;
      this.sequence = 0;
      this.pending = new Map();
    }

    ensureWorker() {
      if (this.worker) return;
      this.worker = new Worker(new URL("wasm-worker.js", scriptBase), {type: "module"});
      this.worker.addEventListener("message", event => {
        const message = event.data || {};
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.ok) request.resolve(message.result);
        else request.reject(new Error(message.error || "Browser calculation failed"));
      });
      this.worker.addEventListener("error", event => {
        const error = new Error(event.message || "Browser calculation worker failed");
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      });
    }

    request(type, payload = {}) {
      this.ensureWorker();
      const id = ++this.sequence;
      return new Promise((resolve, reject) => {
        this.pending.set(id, {resolve, reject});
        this.worker.postMessage({id, type, payload});
      });
    }

    ready() {
      return this.request("health");
    }

    simulateElectrografting(payload) {
      return this.request("simulate_electrografting", payload);
    }

    analyzeCatalyticRate(payload) {
      return this.request("analyze_catalytic_rate", payload);
    }

    simulatePnp(payload) {
      return this.request("simulate_pnp", payload);
    }

    pnpPayload(payload) {
      const model=payload?.custom_model;
      const parameterValue=(reaction,name,fallback=0)=>Number(reaction?.parameters?.[name]?.value??fallback);
      const participants=side=>(side||[]).map(item=>({species:item.species,stoich:Number(item.stoich||1)}));
      return {
        grid_points:Number(payload.grid_points),temperature:Number(payload.temperature),
        start_potential:Number(payload.start_potential),switching_potential:Number(payload.switching_potential),
        scan_rate:Number(payload.scan_rate),timestep:Number(payload.timestep),
        electrode_area:Number(payload.electrode_area),solution_resistance:Number(payload.solution_resistance||0),
        species:model.species.map(species=>({name:species.name,charge:Number(species.charge||0),
          bulk_concentration:Number(species.initial),diffusion_coefficient:Number(species.D)})),
        electron_transfer:model.reactions.filter(reaction=>reaction.type==="solution_electron").map(reaction=>({
          label:reaction.label||"Electron transfer",oxidized:reaction.reactants?.[0]?.species,
          reduced:reaction.products?.[0]?.species,electron_count:Math.round(parameterValue(reaction,"n",1)),
          formal_potential:parameterValue(reaction,"E0"),electron_transfer_rate:parameterValue(reaction,"k0"),
          transfer_coefficient:parameterValue(reaction,"alpha",0.5)})),
        bulk_reactions:model.reactions.filter(reaction=>["bulk_mass_action","custom_bulk_rate"].includes(reaction.type)).map(reaction=>({
          label:reaction.label||"Bulk reaction",type:reaction.type==="bulk_mass_action"?"mass_action":"algebraic_rate",
          reactants:participants(reaction.reactants),products:participants(reaction.products),
          rate_constant:parameterValue(reaction,"k"),formula:reaction.formula||"",
          parameters:Object.fromEntries(Object.entries(reaction.parameters||{}).map(([name,value])=>[name,Number(value.value)]))})),
        solver:{stern_capacitance:Number(payload.pnp_stern_capacitance??20),
          potential_of_zero_charge:Number(payload.pnp_pzc??0),
          relative_permittivity:Number(payload.pnp_relative_permittivity??78.4)}
      };
    }

    presetModel(payload) {
      const diffusion = payload?.diffusion_coefficient;
      const species = (name, initial = 0) => ({
        name,
        phase: "solution",
        initial,
        D: diffusion,
        fit_D: false
      });
      const participant = name => ({species: name, stoich: 1});
      const parameter = value => ({value, fit: false});
      const electronTransfer = (label, oxidized, reduced, E0, k0) => ({
        label,
        type: "solution_electron",
        reactants: [participant(oxidized)],
        products: [participant(reduced)],
        parameters: {
          E0: parameter(E0),
          k0: parameter(k0),
          alpha: parameter(0.5),
          n: parameter(1)
        },
        formula: ""
      });
      const massAction = (label, reactants, products, rate) => ({
        label,
        type: "bulk_mass_action",
        reactants: reactants.map(participant),
        products: products.map(participant),
        parameters: {k: parameter(rate)},
        formula: ""
      });

      switch (payload?.preset) {
        case "solution_ec":
          return {
            name: "Solution EC mechanism",
            species: [
              species("Ox", payload.bulk_concentration),
              species("Red"),
              species("Product")
            ],
            reactions: [
              electronTransfer(
                "Electron transfer", "Ox", "Red",
                payload.formal_potential, payload.electron_transfer_rate
              ),
              massAction(
                "Following reaction", ["Red"], ["Product"], payload.chemical_rate
              )
            ]
          };
        case "solution_ce":
          return {
            name: "Solution CE mechanism",
            species: [
              species("Precursor", payload.bulk_concentration),
              species("Ox"),
              species("Red")
            ],
            reactions: [
              massAction(
                "Preceding reaction", ["Precursor"], ["Ox"], payload.preceding_rate
              ),
              electronTransfer(
                "Electron transfer", "Ox", "Red",
                payload.formal_potential, payload.electron_transfer_rate
              )
            ]
          };
        case "solution_ece":
        case "solution_ececprime": {
          const model = {
            name: payload.preset === "solution_ece"
              ? "Solution ECE mechanism"
              : "Solution ECEC-prime mechanism",
            species: [
              species("Ox1", payload.bulk_concentration),
              species("Red1"),
              species("Ox2"),
              species("Red2")
            ],
            reactions: [
              electronTransfer(
                "First electron transfer", "Ox1", "Red1",
                payload.formal_potential_1, payload.electron_transfer_rate_1
              ),
              massAction(
                "Intermediate conversion", ["Red1"], ["Ox2"], payload.chemical_rate
              ),
              electronTransfer(
                "Second electron transfer", "Ox2", "Red2",
                payload.formal_potential_2, payload.electron_transfer_rate_2
              )
            ]
          };
          if (payload.preset === "solution_ececprime") {
            model.species.push(
              species("Substrate", payload.substrate_concentration),
              species("Product")
            );
            model.reactions.push(massAction(
              "Catalytic turnover",
              ["Red2", "Substrate"],
              ["Ox2", "Product"],
              payload.catalytic_rate
            ));
          }
          return model;
        }
        default:
          return null;
      }
    }

    supportsSimulation(payload) {
      if (payload?.preset === "electrografting") return true;
      if (!supportedIntegrators.includes(payload?.solver)) return false;
      if (payload?.preset === "solution_e") return true;
      return this.presetModel(payload) !== null;
    }

    simulate(payload) {
      if (!this.supportsSimulation(payload)) {
        return Promise.reject(new Error(
          "Choose BE/FE, TRAP/AB2, BDF1, or BDF2 for a solution mechanism."
        ));
      }
      if (payload.preset === "electrografting") {
        const duration=Math.abs(payload.switching_potential-payload.start_potential)/payload.scan_rate;
        const halfSteps=Math.max(1,Math.ceil(duration/payload.timestep));
        const stepDt=duration/halfSteps,time=[0],potential=[payload.start_potential];
        for(let step=1;step<=halfSteps;step++){
          time.push(time.at(-1)+stepDt);
          potential.push(payload.start_potential+(payload.switching_potential-payload.start_potential)*step/halfSteps);
        }
        for(let step=1;step<=halfSteps;step++){
          time.push(time.at(-1)+stepDt);
          potential.push(payload.switching_potential+(payload.start_potential-payload.switching_potential)*step/halfSteps);
        }
        const parameters={temperature:payload.temperature,electrode_area:payload.electrode_area,
          diazonium_concentration:payload.diazonium_concentration,
          diazonium_diffusion_coefficient:payload.diazonium_diffusion_coefficient,
          diazonium_formal_potential:payload.diazonium_formal_potential,
          diazonium_electron_transfer_rate:payload.diazonium_electron_transfer_rate,
          diazonium_transfer_coefficient:payload.diazonium_transfer_coefficient,
          double_layer_capacitance_microfarads:payload.double_layer_capacitance,
          maximum_coverage:payload.maximum_coverage,passivation_coefficient:payload.passivation_coefficient,
          aryl_grafting_rate:payload.aryl_grafting_rate,radical_reduction_rate:payload.radical_reduction_rate,
          hydrogen_exchange_current_density:payload.hydrogen_exchange_current_density};
        return this.simulateElectrografting({time,potential,parameters,competition:"both"}).then(result=>{
          const peakIndex=result.current.reduce((best,value,index)=>Math.abs(value)>Math.abs(result.current[best])?index:best,0);
          return {...result,preset:"electrografting",interfacial_potential:result.potential,points:result.current.length,
            series:[{name:"Total current",current:result.current},{name:"Diazonium",current:result.diazonium_current},
              {name:"Radical reduction",current:result.radical_reduction_current},{name:"Hydrogen",current:result.hydrogen_current},
              {name:"Capacitive",current:result.capacitive_current}],
            summary:{peak_current:result.current[peakIndex],peak_potential:result.potential[peakIndex],maximum_absolute_current:Math.abs(result.current[peakIndex])}};
        });
      }
      if (payload.preset === "solution_e") {
        return this.request("simulate_solution_e", payload);
      }
      const preset = payload.preset;
      return this.request("simulate_custom_mechanism", {
        ...payload,
        preset: "custom",
        custom_model: this.presetModel(payload)
      }).then(result => ({...result, preset}));
    }

    supportsFit(payload) {
      return payload?.preset === "solution_e"
        && supportedIntegrators.includes(payload?.solver)
        && Array.isArray(payload?.datasets)
        && payload.datasets.length > 0
        && Array.isArray(payload?.parameters)
        && payload.parameters.length > 0;
    }

    fitSolutionE(payload) {
      if (!this.supportsFit(payload)) {
        return Promise.reject(new Error(
          "Browser fitting requires solution E data, a supported integrator, and at least one fitted parameter."
        ));
      }
      return this.request("fit_solution_e", payload);
    }

    inspectData(datasets) {
      return this.request("inspect_data_quality", {datasets});
    }

    screenSupportingElectrolyte(payload) {
      return this.request("screen_supporting_electrolyte", payload);
    }

    supportsCustomMechanism(model) {
      const allowedReactions=["bulk_mass_action","custom_bulk_rate","solution_electron","surface_electron","adsorption","surface_mass_action","custom_surface_rate"];
      return Array.isArray(model?.species)
        && model.species.length > 0
        && model.species.length <= 12
        && model.species.every(species => ["solution","surface"].includes(species?.phase))
        && Array.isArray(model?.reactions)
        && model.reactions.length > 0
        && model.reactions.every(reaction => allowedReactions.includes(reaction?.type));
    }

    supportsCustomSimulation(payload) {
      if(payload?.preset!=="custom"||!this.supportsCustomMechanism(payload?.custom_model))return false;
      if(payload?.solver==="pnp")return payload.custom_model.species.every(species=>species.phase==="solution")
        &&payload.custom_model.reactions.every(reaction=>["bulk_mass_action","custom_bulk_rate","solution_electron"].includes(reaction.type));
      if(!supportedIntegrators.includes(payload?.solver))return false;
      const nonlinearSurface=payload.custom_model.reactions.some(reaction=>["adsorption","surface_mass_action","custom_surface_rate"].includes(reaction.type));
      return !nonlinearSurface||["bdf1","bdf2"].includes(payload.solver);
    }

    validateCustom(model) {
      if (!this.supportsCustomMechanism(model)) {
        return Promise.reject(new Error(
          "Browser-native custom mechanisms support up to 12 solution or surface species with homogeneous, electron-transfer, adsorption, and heterogeneous rate laws."
        ));
      }
      return this.request("validate_custom_mechanism", {custom_model: model});
    }

    simulateCustom(payload) {
      if (!this.supportsCustomSimulation(payload)) {
        return Promise.reject(new Error(
          "Choose a compatible transport model and reaction mechanism. PNP supports solution species and homogeneous or solution electron-transfer steps."
        ));
      }
      if(payload.solver==="pnp")return this.simulatePnp(this.pnpPayload(payload));
      return this.request("simulate_custom_mechanism", payload);
    }

    supportsCustomFit(payload) {
      const model = payload?.custom_model;
      const fittedSpecies = model?.species?.some(species => species?.fit_D);
      const fittedReaction = model?.reactions?.some(reaction =>
        Object.entries(reaction?.parameters || {}).some(([name, parameter]) =>
          parameter?.fit && !(["solution_electron","surface_electron"].includes(reaction?.type) && name === "n")));
      const nonlinearSurface=model?.reactions?.some(reaction=>
        ["adsorption","surface_mass_action","custom_surface_rate"].includes(reaction?.type));
      return payload?.preset === "custom"
        && supportedIntegrators.includes(payload?.solver)
        && this.supportsCustomMechanism(model)
        && (!nonlinearSurface||["bdf1","bdf2"].includes(payload?.solver))
        && Array.isArray(payload?.datasets)
        && payload.datasets.length > 0
        && (fittedSpecies || fittedReaction);
    }

    fitCustom(payload) {
      if (!this.supportsCustomFit(payload)) {
        return Promise.reject(new Error(
          "Browser-native mechanism fitting requires data, a supported integrator, and at least one continuous parameter marked for fitting."
        ));
      }
      return this.request("fit_custom_mechanism", payload);
    }

    profileSolutionE(fit, profile) {
      if (!this.supportsFit(fit)) return Promise.reject(new Error("Complete a supported solution-E fit first."));
      return this.request("profile_solution_e", {fit, profile});
    }

    profileCustom(fit, profile) {
      if (!this.supportsCustomFit(fit)) return Promise.reject(new Error("Complete a supported custom-mechanism fit first."));
      return this.request("profile_custom_mechanism", {fit, profile});
    }

    posteriorSolutionE(fit, posterior) {
      if (!this.supportsFit(fit)) return Promise.reject(new Error("Complete a supported solution-E fit first."));
      return this.request("sample_solution_e_posterior", {fit, posterior});
    }

    posteriorCustom(fit, posterior) {
      if (!this.supportsCustomFit(fit)) return Promise.reject(new Error("Complete a supported custom-mechanism fit first."));
      return this.request("sample_custom_mechanism_posterior", {fit, posterior});
    }

    propagateSolutionKnown(fit, measurements, settings={}) {
      if (!this.supportsFit(fit)) return Promise.reject(new Error("Complete a supported solution-E fit first."));
      return this.request("propagate_solution_known_uncertainty", {fit, measurements, ...settings});
    }

    propagateCustomKnown(fit, measurements, settings={}) {
      if (!this.supportsCustomFit(fit)) return Promise.reject(new Error("Complete a supported custom-mechanism fit first."));
      return this.request("propagate_custom_known_uncertainty", {fit, measurements, ...settings});
    }

    propagateVoltammetricKnown(discovery, active, measurements, settings={}) {
      return this.request("propagate_voltammetric_known_uncertainty", {discovery, active, measurements, ...settings});
    }

    discoverLibrary(payload) {
      return this.request("discover_candidate_library", payload);
    }

    generateCandidates(payload) {
      return this.request("generate_reaction_candidates", payload);
    }

    discoverStructured(payload) {
      return this.request("discover_structured_network", payload);
    }

    discoverVoltammetricRate(payload) {
      return this.request("discover_voltammetric_rate_law", payload);
    }

    profileVoltammetricRate(discovery, active, profile) {
      return this.request("profile_voltammetric_rate_law", {discovery, active, profile});
    }

    posteriorVoltammetricRate(discovery, active, posterior) {
      return this.request("sample_voltammetric_rate_law_posterior", {discovery, active, posterior});
    }

    discoverSparseRate(payload) {
      return this.request("discover_sparse_rate_law", payload);
    }
  }

  window.electrochemBrowserEngine = new ElectrochemBrowserEngine();
})();
