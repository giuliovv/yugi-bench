/* The key stays in memory and is sent only to the stateless relay over HTTPS. */
export function createLlmOpponent({ endpoint, provider, model, apiKey, names = {}, fetchImpl = fetch }) {
  if (!/^https:\/\//.test(endpoint)) throw new Error("LLM relay is not configured.");
  if (!apiKey || !model) throw new Error("Choose a model and enter an API key.");
  let calls = 0;
  return {
    async choose(observation) {
      if (++calls > 120) throw new Error("The 120-call duel limit was reached.");
      const visibleIds = [
        ...observation.own_hand,
        ...observation.own_extra,
        ...observation.own_face_down.map(entry => entry[1]),
        ...observation.legal_actions.flatMap(action => action.card_ids),
        ...observation.public.players.flatMap(player => [
          ...player.graveyard,
          ...player.monsters.map(card => card.card_id),
          ...player.spells_traps.map(card => card.card_id),
          ...player.banished.map(card => card.card_id),
        ]),
      ].filter(id => id !== null);
      const card_names = Object.fromEntries([...new Set(visibleIds)]
        .map(id => [id, names[id]?.name ?? `Card #${id}`]));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider, model, apiKey, observation: { ...observation, card_names } }),
          cache: "no-store",
          signal: controller.signal,
        });
      } catch (error) {
        throw new Error(error?.name === "AbortError" ? "The LLM timed out."
          : "Could not reach the LLM relay.");
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(typeof payload.error === "string" ? payload.error : `LLM request failed (${response.status}).`);
      }
      const payload = await response.json();
      const action = observation.legal_actions.find(item => item.id === payload.action_id);
      if (!action) throw new Error("The LLM returned an illegal action.");
      return action;
    },
    get calls() { return calls; },
  };
}
