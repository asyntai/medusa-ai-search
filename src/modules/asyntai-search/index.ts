import { Module } from "@medusajs/framework/utils"

import AsyntaiSearchModuleService from "./service"

export const ASYNTAI_SEARCH_MODULE = "asyntai_search"

export default Module(ASYNTAI_SEARCH_MODULE, {
  service: AsyntaiSearchModuleService,
})
