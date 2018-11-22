const apiUrl = "https://esi.evetech.net/latest/";

const endpoints = {
  authorize: "https://login.eveonline.com/v2/oauth/authorize/",
  token: "https://login.eveonline.com/v2/oauth/token",
  corpAssets: (corporationId) => apiUrl + `corporations/${corporationId}/assets`,
  corpBlueprints: (corporationId) => apiUrl + `corporations/${corporationId}/blueprints`,
  corpTransactions: (corporationId, walletDivision = 1) => apiUrl + `corporations/${corporationId}/wallets/${walletDivision}/transactions`,
  regionOrders: (regionID, typeID) => apiUrl + `markets/${regionID}/orders/?type_id=${typeID}`,
  marketPrices: apiUrl + "markets/prices",
  names: apiUrl + "universe/names",
  systemCosts: apiUrl + "industry/systems",
  systemIds: apiUrl + "universe/systems",
  structureIds: apiUrl + "universe/structures",
  structureInfo: (id) => apiUrl + `universe/structures/${id}`,
};

module.exports = endpoints;