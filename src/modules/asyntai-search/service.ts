import { MedusaService } from "@medusajs/framework/utils"

import { AsyntaiSetting } from "./models/setting"

/**
 * Generated CRUD over the settings table, and nothing else.
 *
 * Everything with an opinion in it lives in `src/lib/state.ts`, which is
 * plain functions over this service. Keeping the service thin means the API
 * routes and the feed can share one set of rules rather than each growing
 * their own.
 */
class AsyntaiSearchModuleService extends MedusaService({
  AsyntaiSetting,
}) {}

export default AsyntaiSearchModuleService
