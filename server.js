const express = require('express');
const basicAuth = require('express-basic-auth');
const axios = require('axios');
const util = require('util');
const endpoints = require('./endpoints');
const { Client } = require('pg');

require('dotenv').config();

const app = express();
const pgClient = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: true
});
const MAX = Number.MAX_SAFE_INTEGER;

app.use(basicAuth({
  users: { 'hivSD': 'noSpiesAllowed' }
}));

app.get('/materials', (req, res) => {
  const { type, build_from } = req.query;
  pgClient
  .query(`select * from lookup_materials(${type})`)
  .then(({ rows }) => {
      const types = {};
      rows.forEach(({ output_id, output_name, output_quantity, input_id, input_name, input_quantity }) => {
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
          ...types[input_id],
        };

        types[input_id].outputs = {
          [output_id]: input_quantity,
          ...(types[input_id] && types[input_id].outputs)
        }
      });

      // Inject price data for types
      addMarketSplitToTypes(types)
        .then(types => {
          addBuildCostToTypes(type, types)
            .then(types => {
              res.json(types);
            });
        });
    })
    .catch((error) => {
      console.log(error);
      res.send(error);
    });
});

app.get('/market', (req, res) => {
  const types = {};
  pgClient
    .query(`select "typeName" as name, "typeID" as id from "invTypes" where "typeID" in (${req.query.types})`)
    .then(({ rows }) => {
      rows.forEach(({ name, id }) => types[id] = { name });
      addMarketSplitToTypes(types)
        .then(types => {
          res.json(types);
        })
    }); 
});

//
// Recursively calculates build cost of recipe output
//

const addBuildCostToTypes = (root_id, types) => {
  return new Promise(resolve => {
    // Recursive function to populate each level with recipe costs
    const recurse = (output_id) => {
      if (!types[output_id].inputs) {
        return;
      }
    
      // Recurse to the bottom level before starting our work
      Object
        .keys(types[output_id].inputs)
        .forEach(id => recurse(id, types));
         
      // Get current type's recipe cost using the items one level lower
      types[output_id].recipe_cost = Object
        .entries(types[output_id].inputs)
        .reduce((sum, [input_id, input_quantity]) => {
          const { buy, recipe_quantity, recipe_cost } = types[input_id];
          const best_cost = Math.min(buy, (recipe_cost / recipe_quantity) || MAX);
          return sum + best_cost * input_quantity;
        }, 0);
      types[output_id].recipe_unit_cost = types[output_id].recipe_cost / types[output_id].recipe_quantity;
    }

    // Kick off recursion
    recurse(root_id);

    // Pass control back to caller
    resolve(types);
  });
}

//
// Adds buy / sell split to provided object with typeIDs for keys
//

const addMarketSplitToTypes = (types) => {
  return new Promise(resolve => {
    const requests = [];
    Object.keys(types).forEach(type => {
      const highSec = axios.get(endpoints.regionOrders(10000002, type)); // The Forge region
      requests.push(highSec);
    });
    Promise.all(requests)
      .then(responses => {
        const maxPages = responses
          .map(response => response.headers['x-pages'])
          .reduce((max, curr) => curr > max ? cur : max);

        if (maxPages > 1) {
          console.error(`===== A request returned multiple pages. x-pages: ${response.headers['x-pages']} =====`);
        }
        
        return responses.map(({ data }) => data)
      })
      .then(responses => responses.forEach(orders => {
        orders = orders.filter(order => order.location_id == 60003760); // Jita 4-4
        if (orders.length == 0) {
          return;
        }

        const buy = orders
          .filter(order => order.is_buy_order)
          .map(order => order.price)
          .reduce((max, curr) => curr > max ? curr : max, 0);

        const sell = orders
          .filter(order => !order.is_buy_order)
          .map(order => order.price)
          .reduce((min, curr) => curr < min ? curr : min, MAX);

        const id = orders[0].type_id;
        types[id] = { buy, sell, ...types[id] };
      }))
      .then(() => resolve(types));
  });
}

const port = process.env.PORT || 5000;

pgClient
  .connect()
  .then(() => {
    app.listen(port, () => {
      console.log("Server started")
    })
  })
  .catch((err) => {
    console.log(err)
  });