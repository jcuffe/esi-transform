const express = require('express');
const axios = require('axios');
const endpoints = require('./endpoints');

const app = express();

app.get('/', (req, res) => {
  res.json({ "hello": "hello" });
})
app.get('/market', (req, res) => {
  const types = req.query.types.split(',');
  const requests = types.map(type => {
    return axios.get(endpoints.regionOrders(10000060, type))
  });
  const response = {};
  Promise.all(requests)
    .then(responses => responses.map(({ data }) => data))
    .then(types => types.forEach(orders => {
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
app.listen(port, () => "Server started");