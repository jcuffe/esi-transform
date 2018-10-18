const express = require('express');
const axios = require('axios');
const endpoints = require('./endpoints');
const { 
  lookupTypeMaterials, 
} = require('./fetchers');

const app = express();

const asyncMiddleware = (fn) =>
  (req, res, next) => 
    Promise
      .resolve(fn(req, res, next))
      .catch(next);

app.get('/transactions/:corpID', asyncMiddleware(async (req, res) => {
  const { authorization } = req.headers;
  const { corpID } = req.params;
  const options = { headers: { authorization } };
  const { data: corpAssets } = await axios.get(endpoints.corpAssets(corpID), options);
  const corpTransactions = fetchCorpTransactions(corpID, options);
  res.json({ corpAssets, corpTransactions });
}));

app.get('/materials/:corpID/:typeID', asyncMiddleware(async (req, res) => {
  const { corpID, typeID } = req.params;
  const { authorization } = req.headers;
  const options = { headers: { authorization } };
  res.json(await lookupTypeMaterials(corpID, typeID, options));
}));

app.listen(5000, () => console.log("listening..."));