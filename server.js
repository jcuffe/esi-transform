const express = require("express");
const axios = require("axios");
const qs = require("qs");
const { encode, decode, trim } = require("url-safe-base64");
const crypto = require("crypto");
const hash = crypto.createHash('sha256');
const endpoints = require("./endpoints");
const { Client } = require("pg");

require("dotenv").config();

const app = express();
const pgClient = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: true
});
const MAX = Number.MAX_SAFE_INTEGER;

//
// Code challenge for ESI
//

const client_id = process.env.CLIENT_ID;
const redirect_uri = process.env.REDIRECT_URI;
const state = "the absolute";

const bytes = trim(encode(crypto.randomBytes(32).toString('base64')));
hash.update(bytes);
const code_challenge = trim(encode(hash.digest().toString('base64'))); 

app.get("/materials", (req, res) => {
  const { type } = req.query;
  createHeirarchyForType(type)
    .then(injectMarketSplit)
    .then(injectTypeName)
    .then(injectAdjustedPrice)
    .then(injectBuildCost(type))
    .then(types => {
      res.json(types);
    });
});

app.get("/market", (req, res) => {
  createTypesContainer(req.query.types.split(","))
    .then(injectTypeName)
    .then(injectMarketSplit)
    .then(types => {
      res.json(types);
    });
});

app.get("/costs", (req, res) => {
  getSystemCosts().then(costs => {
    res.json(costs);
  });
});

app.get("/login", (req, res) => {
  const params = qs.stringify({
    response_type: "code",
    scope: "publicData esi-skills.read_skills.v1 esi-universe.read_structures.v1",
    code_challenge_method: "S256",
    redirect_uri,
    client_id,
    code_challenge,
    state 
  });
  const url = [endpoints.authorize, params].join("?");
  res.redirect(url);
});

app.get("/callback", (req, res) => {
  const { code, state: esi_state } = req.query;
  if (state !== esi_state) {
    res.json({ error: "Invalid state received from ESI" });
  }
  const code_verifier = bytes;
  const data = qs.stringify({
    grant_type: "authorization_code",
    client_id,
    code, 
    code_verifier
  });
  
  axios.post(endpoints.token, data)
    .then(({ data }) => {
      res.send(data);
    });
});

//
// Cache the response of an axios request
//

const inspectResponse = (response) => {
  console.log(`Status: ${response.status}`);
  console.log(response.headers);
  return response;
};

const cacheRequest = request => {
  let cache = {};
  return function() {
    const args = JSON.stringify(arguments);
    cache[args] =
      cache[args] || request.apply(this, arguments).then(({ data }) => data);
    return cache[args];
  };
};

//
// Queries for PSQL
//

const materialsForType = id => `select * from lookup_materials(${id})`;

const namesForTypes = ids => `
  select "typeName" as name, "typeID" as id from "invTypes" where "typeID" in (${ids})
`;

//
// Expensive requests used in multiple calculations
//

const systemCostsRequest = () => axios.get(endpoints.systemCosts);
const getSystemCosts = cacheRequest(systemCostsRequest);

const adjustedPricesRequest = () => axios.get(endpoints.marketPrices);
const getAdjustedPrices = cacheRequest(adjustedPricesRequest);

const marketSplitRequest = id =>
  axios.get(endpoints.regionOrders(10000002, id));
const getJitaSplit = cacheRequest(marketSplitRequest);

const createTypesContainer = ids => {
  return new Promise(resolve => {
    const types = {};
    ids.forEach(id => (types[id] = {}));
    resolve(types);
  });
};

const createHeirarchyForType = type => {
  return new Promise(resolve => {
    pgClient.query(materialsForType(type)).then(({ rows }) => {
      const types = {};
      rows.forEach(
        ({
          output_id,
          output_quantity,
          activity_id,
          input_id,
          input_quantity
        }) => {
          // Non-destructively create or update data for output types
          types[output_id] = {
            ...types[output_id],
            recipe: {
              activity_id,
              quantity: output_quantity
            },
            inputs: {
              ...(types[output_id] || {}).inputs,
              [input_id]: input_quantity
            }
          };

          // Do the same for input types
          types[input_id] = {
            ...types[input_id],
            outputs: {
              ...(types[input_id] || {}).outputs,
              [output_id]: input_quantity
            }
          };
        }
      );
      resolve(types);
    });
  });
};

//
// Add adjusted price for each item for job cost calculation
//

const injectAdjustedPrice = types => {
  return new Promise(resolve => {
    getAdjustedPrices().then(prices => {
      prices.forEach(({ type_id: id, adjusted_price }) => {
        if (types[id] && types[id].outputs) {
          types[id].adjusted_price = adjusted_price;
        }
      });
      resolve(types);
    });
  });
};

//
// Recursively calculates build cost of recipe output
// TODO - Structure bonuses, System Cost Indices, Calculated job times
//      - User configuration
//

const injectBuildCost = root_id => types => {
  return new Promise(resolve => {
    // Recursive function to populate each level with recipe costs
    const recurse = id => {
      const product = types[id];
      const { sell, inputs, recipe } = product;

      if (!inputs) {
        return;
      }

      // Recurse to the bottom level before starting our work
      Object.keys(inputs).forEach(input => recurse(input));

      const { quantity, activity_id } = recipe;

      let base_job_cost = 0;
      let material_cost = 0;

      for (let id in inputs) {
        const { buy, recipe, adjusted_price } = types[id];
        const base_quantity = inputs[id];

        let best_cost = buy;

        if (recipe) {
          best_cost = Math.min(buy, recipe.unit_cost);
        }

        const adjusted_quantity = applyMaterialEfficiency(
          base_quantity,
          activity_id
          );

        material_cost += best_cost * adjusted_quantity;
        base_job_cost += adjusted_price * base_quantity;
      }

        // HARDCODED
        const cost_index = 0.2;
        const tax_rate = 1.1;

        const job_fees = base_job_cost * cost_index * tax_rate;
        const blueprint_cost = material_cost + job_fees;
      const unit_cost = blueprint_cost / quantity;
      const margin = (sell - unit_cost) / sell;
      product.recipe = {
        margin,
        unit_cost,
        material_cost,
        job_fees,
        base_job_cost,
        blueprint_cost,
        ...product.recipe
      };
    };

    // Kick off recursion
    recurse(root_id);

    // Pass control back to caller
    resolve(types);
  });
};

const applyMaterialEfficiency = (input_quantity, activity_id, efficiency_factor = 1.0) => {
  if (activity_id == 1) {
    efficiency_factor = 0.9; // Hardcoded perfection, for now
  }

  const max_job_time = 2592000; // Assume 30 days of production
  const time = 25920; // PLACEHOLDER
  const runs = Math.ceil(Math.max(max_job_time / time, 1));

  // EVE Industry formula
  const reduced_quantity = Math.max(
    runs,
    Math.ceil(runs * efficiency_factor * input_quantity)
  );

  // single run
  return reduced_quantity / runs;
};

//
// Adds buy / sell split to provided object with typeIDs for keys
//

const injectMarketSplit = types => {
  return new Promise(resolve => {
    const requests = [];
    Object.keys(types).forEach(id => {
      const highSec = getJitaSplit(id); // The Forge region
      requests.push(highSec);
    });
    Promise.all(requests)
      .then(responses => {
        responses.forEach(orders => {
          orders = orders.filter(order => order.location_id == 60003760); // Jita 4-4
          if (orders.length == 0) {
            return;
          }

          const buy = orders
            .filter(order => order.is_buy_order)
            .map(order => order.price)
            .reduce((max, curr) => (curr > max ? curr : max), 0);

          const sell = orders
            .filter(order => !order.is_buy_order)
            .map(order => order.price)
            .reduce((min, curr) => (curr < min ? curr : min), MAX);

          const id = orders[0].type_id;

          // attach buy and sell split to existing entry
          types[id] = { buy, sell, ...types[id] };
        })
        resolve(types);
      });
  });
};

const injectTypeName = types => {
  return new Promise(resolve => {
    const ids = Object.keys(types).join(",");
    pgClient.query(namesForTypes(ids)).then(({ rows }) => {
      rows.forEach(({ name, id }) => (types[id] = { name, ...types[id] }));
      resolve(types);
    });
  });
};

const port = process.env.PORT || 5000;

// Connect to postgres first
pgClient
  .connect()
  .then(() => {
    // Initialize the cache for expensive requests
    getAdjustedPrices();
    getSystemCosts();

    // Start the server
    app.listen(port, () => {
      console.log("Server started");
    });
  })
  .catch(err => {
    console.log(err);
  });
