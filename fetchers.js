const axios = require('axios');
const endpoints = require('./endpoints');
const knex = require('knex')({
  client: 'sqlite3',
  connection: {
    filename: "./sde.sqlite"
  }
});

const fetchCorpTransactions = async (corpId, reqOptions) => {
  return (await Promise.all(
    (await axios.get(endpoints.corpTransactions(corpId), reqOptions))
      .data
      .filter(tx => tx.is_buy) 
      .map(async tx => {
        const { date, quantity, type_id: typeId, unit_price: unitPrice } = tx;
        const { typeName } = await knex.table("invTypes").where({ typeID: typeId }).first("typeName");
        return { typeName, quantity, unitPrice, date, typeId };
      })))
    .reduce((dict, tx) => ({ ...dict, [tx.typeId]: dict[tx.typeId] ? [...dict[tx.typeId], tx ] : [tx] }), {});
};

const fetchBlueprint = async (corpID, typeID, reqOptions) => {
  const blueprintID = await lookupTypeBlueprint(typeID);
  const blueprints = (await axios.get(endpoints.corpBlueprints(corpID), reqOptions))
    .data
    .filter(blueprint => blueprint.type_id == blueprintID)
    .sort((a, b) => a.material_efficiency - b.material_efficiency);

  console.log("Blueprints", blueprints);
  return blueprints[0];
}

const lookupTypeBlueprint = async (productTypeID) => {
  const blueprint = await knex
    .table("industryActivityProducts")
    .where({ productTypeID })
    .first("typeID", "quantity", "activityID");

  return blueprint || null;
};
const lookupTypeName = async (typeID) => (await knex.table("invTypes").where({ typeID }).first("typeName")).typeName;

const lookupTypeMaterials = async (corpID, productTypeID, reqOptions, parentNeeds) => {
  productTypeID = Number(productTypeID);
  const productName = await lookupTypeName(productTypeID);
  const blueprint =  await lookupTypeBlueprint(productTypeID);

  if (!blueprint) {
    return null;
  }
  
  let materials = await knex
    .table("industryActivityMaterials")
    .where({ typeID: blueprint.typeID })
    .select("materialTypeId", "quantity");

  let materialEfficiency = 0;
  if (activityID == 1) {
    materialEfficiency = (await fetchBlueprint(corpID, productTypeID, reqOptions)).material_efficiency;
  }

  materials = await Promise.all(materials.map(async material => {
    const { materialTypeID, quantity } = material;
    const inputs = await lookupTypeMaterials(corpID, material.materialTypeID, reqOptions, quantity);
    if (inputs) {
      return inputs;
    }
    const materialName = await lookupTypeName(material.materialTypeID);
    const ratio = 100 - materialEfficiency;
    return { materialName, materialTypeID, quantity: quantity * ratio / 100 };
  }));

  const data = { productName, productTypeID, blueprintID: blueprint.typeID, outputQuantity };

  if (parentNeeds) {
    data.parentNeeds = parentNeeds;
  }

  if (activityID == 1) {
    data.materialEfficiency = materialEfficiency;
  }

  data.materials = materials;

  return data;
}

module.exports = { 
  fetchCorpTransactions, 
  fetchBlueprint,
  lookupTypeName, 
  lookupTypeBlueprint, 
  lookupTypeMaterials
};