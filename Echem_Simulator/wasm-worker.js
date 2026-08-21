let enginePromise;

async function engine() {
  if (!enginePromise) {
    enginePromise = import("./wasm/pkg/electrochem_wasm.js").then(async module => {
      await module.default();
      return module;
    });
  }
  return enginePromise;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

self.addEventListener("message", async event => {
  const {id, type, payload} = event.data || {};
  try {
    const module = await engine();
    if (type === "health") {
      self.postMessage({id, ok: true, result: {status: "ready", engine: "Rust/WebAssembly"}});
      return;
    }
    const started = performance.now();
    let result;
    if (type === "simulate_solution_e") result = module.simulate_solution_e(payload);
    else if (type === "analyze_catalytic_rate") result = module.analyze_catalytic_rate(payload);
    else if (type === "simulate_pnp") result = module.simulate_pnp(payload);
    else if (type === "inspect_data_quality") result = module.inspect_data_quality(payload);
    else if (type === "screen_supporting_electrolyte") result = module.screen_supporting_electrolyte(payload);
    else if (type === "fit_solution_e") result = module.fit_solution_e(payload);
    else if (type === "fit_custom_mechanism") result = module.fit_custom_mechanism(payload);
    else if (type === "profile_solution_e") result = module.profile_solution_e(payload);
    else if (type === "profile_custom_mechanism") result = module.profile_custom_mechanism(payload);
    else if (type === "sample_solution_e_posterior") result = module.sample_solution_e_posterior(payload);
    else if (type === "sample_custom_mechanism_posterior") result = module.sample_custom_mechanism_posterior(payload);
    else if (type === "propagate_solution_known_uncertainty") result = module.propagate_solution_known_uncertainty(payload);
    else if (type === "propagate_custom_known_uncertainty") result = module.propagate_custom_known_uncertainty(payload);
    else if (type === "discover_candidate_library") result = module.discover_candidate_library(payload);
    else if (type === "generate_reaction_candidates") result = module.generate_reaction_candidates(payload);
    else if (type === "discover_structured_network") result = module.discover_structured_network(payload);
    else if (type === "discover_voltammetric_rate_law") result = module.discover_voltammetric_rate_law(payload);
    else if (type === "profile_voltammetric_rate_law") result = module.profile_voltammetric_rate_law(payload);
    else if (type === "sample_voltammetric_rate_law_posterior") result = module.sample_voltammetric_rate_law_posterior(payload);
    else if (type === "propagate_voltammetric_known_uncertainty") result = module.propagate_voltammetric_known_uncertainty(payload);
    else if (type === "discover_sparse_rate_law") result = module.discover_sparse_rate_law(payload);
    else if (type === "validate_custom_mechanism") result = module.validate_custom_mechanism(payload);
    else if (type === "simulate_custom_mechanism") result = module.simulate_custom_mechanism(payload);
    else throw new Error(`Unknown browser operation: ${type}`);
    if (type !== "health" && !type.startsWith("generate_")) result.elapsed_seconds = (performance.now() - started) / 1000;
    self.postMessage({id, ok: true, result});
  } catch (error) {
    self.postMessage({id, ok: false, error: errorMessage(error)});
  }
});
