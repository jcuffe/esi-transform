const express = require('express');
const axios = require('axios');
const endpoints = require('./endpoints');
const knex = require('knex')({
  client: 'sqlite3',
  connection: {
    filename: "./sde.sqlite"
  }
});

const app = express();

const asyncMiddleware = (fn) =>
  (req, res, next) => 
    Promise
      .resolve(fn(req, res, next))
      .catch(next);

app.get('/transactions/:corpId', asyncMiddleware(async (req, res) => {
  const { authorization } = req.headers;
  const { corpId } = req.params;
  const options = { headers: { authorization } };
  const corpTransactions = (await Promise.all(
    (await axios.get(endpoints.corpTransactions(corpId), options))
      .data
      .filter(tx => tx.is_buy) 
      .map(async tx => {
        const { date, quantity, type_id: typeId, unit_price: unitPrice } = tx;
        const { typeName } = await knex.table("invTypes").where({ typeID: typeId }).first("typeName");
        return { typeName, quantity, unitPrice, date, typeId };
      })))
    .reduce((dict, tx) => ({ ...dict, [tx.typeId]: dict[tx.typeId] ? [...dict[tx.typeId], tx ] : [tx] }), {});
  res.json({ corpAssets, corpTransactions });
}));

app.listen(5000, () => console.log("listening..."));