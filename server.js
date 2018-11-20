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
      const heirarchy = {};
      rows.forEach(({ output_id, output_name, output_quantity, input_id, input_name, input_quantity }) => {
        heirarchy[output_id] = {
          output_name,
          output_quantity,
          inputs: [
            { input_id, input_name, input_quantity },
            ...(heirarchy[output_id] ? heirarchy[output_id].inputs : [])
          ]
        };
      });
      res.json(heirarchy);
    })
    .catch((error) => {
      console.log(error);
      res.send(error);
    });
});

app.get('/market', (req, res) => {
  const types = req.query.types.split(',');
  getSplitForTypes(types)
    .then(response => {
      res.send(response);
    }); 
});

const getSplitForTypes = (types) => {
  return new Promise((resolve, reject) => {
    const requests = [];
    types.forEach(type => {
      const highSec = axios.get(endpoints.regionOrders(10000002, type)); // The Forge region
      requests.push(highSec);
    });
    const splits = {};
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
      .then(types => types.forEach(orders => {
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

        const type = orders[0].type_id;
        splits[type] = { buy, sell };
      }))
      .then(() => resolve(splits));
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