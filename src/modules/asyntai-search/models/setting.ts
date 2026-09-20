import { model } from "@medusajs/framework/utils"

/**
 * One row per setting, in this plugin's own table.
 *
 * Deliberately NOT the store's `metadata` column, which is where this
 * plugin's chatbot sibling keeps its two fields. `metadata` is one shared
 * JSON blob: any plugin, script or admin call that writes it without merging
 * first wipes everybody else's keys with it. A preview secret and a feed
 * token are not worth that risk, and neither is a connection the merchant
 * would have to make twice.
 */
export const AsyntaiSetting = model.define("asyntai_setting", {
  id: model.id({ prefix: "asyset" }).primaryKey(),
  name: model.text().unique(),
  value: model.text().default(""),
})

