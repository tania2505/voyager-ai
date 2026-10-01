'use strict';
// Mock travel tools. Each tool has a JSON schema (for LLM tool use) and a run() function.
// Swap run() bodies for real flight/hotel/transport APIs when you are ready.

const rng = seed => { let s = 0; for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
const nightsBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const S = { type: 'string' }, N = { type: 'number' };
const holds = new Map();

const TOOLS = {
  check_missing: {
    description: 'Validate the trip request and list any missing or invalid fields.',
    input_schema: { type: 'object', properties: { origin: S, dest: S, start: S, end: S, travelers: N, budget: N } },
    run(a) {
      const m = [];
      if (!a.origin) m.push('origin city');
      if (!a.dest) m.push('destination');
      if (!a.start) m.push('start date');
      if (!a.end) m.push('end date');
      if (a.start && a.end && a.end <= a.start) m.push('valid dates (end must be after start)');
      if (!(a.travelers > 0)) m.push('number of travelers');
      if (!(a.budget > 0)) m.push('budget');
      return { missing: m };
    },
  },
  search_flights: {
    description: 'Search flights for a route and date. Returns options with per-person and total price.',
    input_schema: { type: 'object', properties: { origin: S, dest: S, start: S, travelers: N, nonstop: { type: 'boolean' } }, required: ['origin', 'dest', 'start', 'travelers'] },
    run(a) {
      const R = rng('f' + a.origin + a.dest + a.start), air = ['SkyJet', 'AirNova', 'Meridian', 'BlueWing'];
      let o = air.map((airline, i) => {
        const stops = i % 2 ? 1 : 0;
        const perPerson = Math.round((420 + R() * 380) * (stops ? 0.8 : 1));
        return { id: 'F' + (i + 1), airline, stops, hours: +(7 + R() * 6 + stops * 2.5).toFixed(1), perPerson, total: perPerson * a.travelers };
      });
      const before = o.length;
      if (a.nonstop) o = o.filter(f => f.stops === 0);
      return { options: o, excluded: before - o.length };
    },
  },
  search_hotels: {
    description: 'Search hotels by destination, dates, travelers, minimum stars and preferred area (Center, Beach, Quiet).',
    input_schema: { type: 'object', properties: { dest: S, start: S, end: S, travelers: N, minStars: N, area: S }, required: ['dest', 'start', 'end', 'travelers'] },
    run(a) {
      const R = rng('h' + a.dest), nights = nightsBetween(a.start, a.end), rooms = Math.ceil(a.travelers / 2);
      const names = ['Grand Plaza', 'Casa Azul', 'Harbor Inn', 'The Atrium', 'Olive Suites'], areas = ['Center', 'Beach', 'Quiet', 'Center', 'Beach'];
      let o = names.map((name, i) => {
        const stars = 3 + (i % 3), perNight = Math.round(70 + stars * 28 + R() * 45);
        return { id: 'H' + (i + 1), name, stars, area: areas[i], perNight, total: perNight * nights * rooms, areaMatch: !a.area || areas[i] === a.area };
      });
      const before = o.length;
      o = o.filter(h => h.stars >= (a.minStars || 0));
      return { options: o, excluded: before - o.length, nights, rooms };
    },
  },
  search_transport: {
    description: 'Search local transport options for the whole trip.',
    input_schema: { type: 'object', properties: { dest: S, days: N, travelers: N }, required: ['dest', 'days', 'travelers'] },
    run(a) {
      const R = rng('t' + a.dest);
      return { options: [
        { id: 'T1', name: 'Transit pass', cost: Math.round((8 + R() * 4) * a.days * a.travelers) },
        { id: 'T2', name: 'Rideshare budget', cost: Math.round((22 + R() * 10) * a.days) },
        { id: 'T3', name: 'Rental car', cost: Math.round((48 + R() * 20) * a.days) },
      ] };
    },
  },
  compare_options: {
    description: 'Score every flight x hotel x transport combination against the budget and return the best plus the top alternatives.',
    input_schema: { type: 'object', properties: { flights: { type: 'array', items: { type: 'object' } }, hotels: { type: 'array', items: { type: 'object' } }, transport: { type: 'array', items: { type: 'object' } }, budget: N }, required: ['flights', 'hotels', 'transport', 'budget'] },
    run(a) {
      const combos = [];
      for (const f of a.flights) for (const h of a.hotels) for (const t of a.transport) {
        const total = f.total + h.total + t.cost;
        const score = -total / a.budget * 10 + (h.areaMatch ? 2 : 0) + h.stars * 0.3 - f.stops * 0.5 - f.hours * 0.1;
        combos.push({ f, h, t, total, score, fits: total <= a.budget });
      }
      if (!combos.length) return { error: 'No valid combinations. Relax nonstop or star constraints.' };
      const fit = combos.filter(c => c.fits);
      const best = fit.length ? fit.sort((x, y) => y.score - x.score)[0] : combos.slice().sort((x, y) => x.total - y.total)[0];
      return { best, fitCount: fit.length, totalCombos: combos.length, overBy: best.fits ? 0 : best.total - a.budget, top: combos.slice().sort((x, y) => y.score - x.score).slice(0, 5) };
    },
  },
  build_itinerary: {
    description: 'Create a day-by-day itinerary from interests and the chosen hotel.',
    input_schema: { type: 'object', properties: { days: N, interests: { type: 'array', items: S }, hotelName: S }, required: ['days', 'hotelName'] },
    run(a) {
      const pool = { food: ['Local market tasting', 'Street-food walk', 'Cooking class'], museums: ['National museum visit', 'Old-town gallery tour', 'History walk'], nature: ['Coastal park hike', 'Botanical garden', 'Sunset viewpoint'], nightlife: ['Live music evening', 'Rooftop bar'], shopping: ['Artisan quarter shopping', 'Flea market'] };
      let keys = (a.interests || []).filter(k => pool[k]); if (!keys.length) keys = ['food', 'museums'];
      const out = [];
      for (let i = 0; i < a.days; i++) {
        const k = keys[i % keys.length], k2 = keys[(i + 1) % keys.length];
        const items = i === 0 ? ['Arrive & check in at ' + a.hotelName, 'Easy evening stroll nearby']
          : i === a.days - 1 ? [pool[k][i % pool[k].length], 'Pack & depart']
          : [pool[k][i % pool[k].length], pool[k2][(i + 1) % pool[k2].length]];
        out.push({ day: i + 1, items });
      }
      return { itinerary: out };
    },
  },
  prepare_booking: {
    description: 'Create a temporary booking hold. Does NOT book or charge anything.',
    input_schema: { type: 'object', properties: { total: N }, required: ['total'] },
    run(a) {
      const id = 'HOLD-' + Math.random().toString(36).slice(2, 7).toUpperCase();
      holds.set(id, { total: a.total, booked: false });
      return { holdId: id, expiresIn: '15 min', total: a.total };
    },
  },
  execute_booking: {
    description: 'Execute a booking for a hold. Requires explicit user confirmation. Never exposed to the LLM.',
    input_schema: { type: 'object', properties: { holdId: S, confirmed: { type: 'boolean' } }, required: ['holdId', 'confirmed'] },
    run(a) {
      if (a.confirmed !== true) throw new Error('Refused: explicit user confirmation required');
      const h = holds.get(a.holdId);
      if (!h) throw new Error('Unknown or expired hold');
      if (h.booked) throw new Error('Hold already booked');
      h.booked = true;
      return { reference: 'VYG-' + Math.random().toString(36).slice(2, 8).toUpperCase(), status: 'CONFIRMED' };
    },
  },
};

const LLM_TOOLS = ['check_missing', 'search_flights', 'search_hotels', 'search_transport', 'compare_options', 'build_itinerary', 'prepare_booking'];
module.exports = { TOOLS, LLM_TOOLS, nightsBetween, holds };
