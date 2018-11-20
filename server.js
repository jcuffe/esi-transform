const express = require('express');
const basicAuth = require('express-basic-auth');
const axios = require('axios');
const endpoints = require('./endpoints');
const { Client } = require('pg');

require('dotenv').config();

const app = express();
const pgClient = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: true
});

app.use(basicAuth({
  users: { 'hivSD': 'noSpiesAllowed' }
}));

app.get('/materials', (req, res) => {
  const { type } = req.query;
  pgClient.query(`select * from lookup_materials(${type})`)
    .then(({ rows }) => {

      console.log(rows);
      res.send(rows);
    })
    .catch((error) => {
      console.log(error);
      res.send(error);
    });
});

app.get('/market', (req, res) => {
  const types = req.query.types.split(',');
  const requests = [];
  types.forEach(type => {
    const highSec = axios.get(endpoints.regionOrders(10000002, type)); // The Forge region
    // const nullSec = axios.get(endpoints.structureOrders(1022734985679)); // 1st Thetastar of Dickbutt
    requests.push(highSec);
  });
  const response = {};
  Promise.all(requests)
    .then(responses => responses.map(({ data }) => data))
    .then(types => types.forEach(orders => {
      orders = orders.filter(order => order.location_id == 60003760); // Jita 4-4
      if (orders.length == 0) {
        return;
      }

      const buys = orders.filter(order => order.is_buy_order)
      const sells = orders.filter(order => !order.is_buy_order)

      const topBuy = buys.length > 0 
        ? buys.reduce((max, curr) => curr.price > max.price ? curr : max).price
        : -1;

      const bottomSell = sells.length > 0
        ? sells.reduce((min, curr) => curr.price < min.price ? curr : min).price
        : -1;

      const typeID = orders[0].type_id;
      response[typeID] = { topBuy, bottomSell };
    }))
    .then(() => res.json(response));
});

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