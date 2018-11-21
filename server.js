const express = require("express");
const axios = require("axios");
const util = require("util");
const endpoints = require("./endpoints");
const { Client } = require("pg");

require("dotenv").config();

const app = express();
const pgClient = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: true
});
const MAX = Number.MAX_SAFE_INTEGER;

app.get("/materials", (req, res) => {
  const { type, build_from } = req.query;
  pgClient
    .query(`select * from lookup_materials(${type})`)
    .then(({ rows }) => {
      const types = {};
      rows.forEach(
        ({
          output_id,
          output_name,
          output_quantity,
          input_id,
          input_name,
          input_quantity
        }) => {
          types[output_id] = {
            name: output_name,
            recipe_quantity: output_quantity,
            ...types[output_id]
          };

          types[output_id].inputs = {
            [input_id]: input_quantity,
            ...(types[output_id] && types[output_id].inputs)
          };

          types[input_id] = {
            name: input_name,
            ...types[input_id]
          };

          types[input_id].outputs = {
            [output_id]: input_quantity,
            ...(types[input_id] && types[input_id].outputs)
          };
        }
      );

      injectMarketSplit(types)
        .then(injectAdjustedPrice)
        .then(injectBuildCost(type))
        .then(types => {
          res.json(types);
        });
    })
    .catch(error => {
      console.log(error);
      res.send(error);
    });
});

app.get("/market", (req, res) => {
  const types = {};
  injectTypeNames(req.query.types, types)
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

//
// Cache the response of an axios request
//

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

const namesForTypes = ids => `
  select "typeName" as name, "typeID" as id from "invTypes" where "typeID" in (${
    ids
  })
`;

//
// Expensive requests used in multiple calculations
//

const systemCostsRequest = () => axios.get(endpoints.systemCosts);
const getSystemCosts = cacheRequest(systemCostsRequest);

const adjustedPricesRequest = () => axios.get(endpoints.marketPrices);
const getAdjustedPrices = cacheRequest(adjustedPricesRequest);

const marketSplitRequest = id => axios.get(endpoints.regionOrders(10000002, id));
const getJitaSplit = cacheRequest(marketSplitRequest);

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
//

const injectBuildCost = root_id => types => {
  return new Promise(resolve => {
    // Recursive function to populate each level with recipe costs
    const recurse = output_id => {
      if (!types[output_id].inputs) {
        return;
      }

      // Recurse to the bottom level before starting our work
      Object.keys(types[output_id].inputs).forEach(id => recurse(id, types));

      // Get current type's recipe cost using the items one level lower
      types[output_id].recipe_cost = Object.entries(
        types[output_id].inputs
      ).reduce(
        (sum, [input_id, input_quantity]) => {
          const { buy, recipe_quantity, recipe_cost, adjusted_price } = types[
            input_id
          ];

          let best_cost = buy;
          if (recipe_cost) {
            best_cost = Math.min(buy, recipe_cost.materials / recipe_quantity);
          }

          return {
            materials: sum.materials + best_cost * input_quantity,
            job: sum.job + adjusted_price * input_quantity
          };
        },
        { materials: 0, job: 0 }
      );
      types[output_id].recipe_unit_cost =
        types[output_id].recipe_cost / types[output_id].recipe_quantity;
    };

    // Kick off recursion
    recurse(root_id);

    // Pass control back to caller
    resolve(types);
  });
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
      .then(responses =>
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
      )
      .then(() => resolve(types));
  });
};

const injectTypeNames = (ids, types = {}) => {
  return new Promise(resolve => {
    const ids = Object.keys(types).join(",");
    pgClient.query(namesForTypes(ids)).then(({ rows }) => {
      rows.forEach(({ name, id }) => types[id].name = name);
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
