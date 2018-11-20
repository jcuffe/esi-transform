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
      getSplitForTypes(types)
        .then(types => res.json(types));
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
      getSplitForTypes(types).then(splits => res.send(splits));
    }); 
});

//
// Adds buy / sell split to provided object with typeIDs for keys
//

const getSplitForTypes = (types) => {
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