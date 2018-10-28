const express = require('express');
const axios = require('axios');
const cors = require('cors');
const endpoints = require('./endpoints');
const { 
  lookupTypeMaterials, 
  lookupTypes,
} = require('./fetchers');

const app = express();
app.use(cors());

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

app.get('/types', asyncMiddleware(async (req, res) => {
  res.json(await lookupTypes());
}));

const port = process.env.PORT || 5000;
app.listen(port, () => console.log("listening..."));