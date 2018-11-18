const apiUrl = "https://esi.evetech.net/latest/";

const endpoints = {
  corpAssets: (corporationId) => apiUrl + `corporations/${corporationId}/assets`,
  corpBlueprints: (corporationId) => apiUrl + `corporations/${corporationId}/blueprints`,
  corpTransactions: (corporationId, walletDivision = 1) => apiUrl + `corporations/${corporationId}/wallets/${walletDivision}/transactions`,
  regionOrders: (regionID, typeID) => apiUrl + `markets/${regionID}/orders/?type_id=${typeID}`,
  names: apiUrl + "universe/names",
  systemIds: apiUrl + "universe/systems",
  structureIds: apiUrl + "universe/structures",
  structureInfo: (id) => apiUrl + `universe/structures/${id}`,
};

module.exports = endpoints;