# Autotask Client API

This Azure Function can be used to connect individual companies to the Autotask API. It will sandbox the functions to just that individual company. Each company gets configured with their own API Key (in local.settings.json) and then each company is assigned to a company ID (the Autotask company ID, in OrgList.json). Only specific endpoints are allowed, you can see the whitelisted endpoints at the top of index.js.

Currently this will not support any Child API Endpoints nor any endpoints that are not scoped to a specific company. 

### Configuration:
- Setup an Autotask API account with access to all of the whitelisted endpoints. Currently thats is: READ Companies, Locations, Contracts & ConfigurationItems, to READ/WRITE Tickets and to WRITE TicketNotes. Fill in the Autotask configuration with API account details in local.settings.json.
- Create API keys for each company you want to setup in local.settings.json. See the template, replace "STS" with the companies acronym.
- Map each companies acronym to their Autotask Company ID in OrgList.json. See the template, replace "STS" with the companies acronym and 0 with the Autotask Company ID.
- Push the code and settings to an Azure Function.

### Usage:
Send a POST request to the full azure function URL (with the function key), include the following in the request:
- In the Header, set the key `apikey` to the unique API Key for that organization (set in local.settings.json).
- In the Body, a JSON object with the following:
    - `endpoint` (required) - The Autotask endpoint you are connecting to, e.g. Tickets, Companies, etc.
    - `type` (required) - The type of request you are making: `get`, `query`, `count`, `create`, `update`, `delete`, `replace` (delete and replace are not currently implemented).
    - `id` - This is only used when making a `get` type request, the ID of the entity to get.
    - `filters` - This is only used when making a `query` or `count` type request, this is formatted the same as it would be when sending directly to the Autotask API. It should be an array containing 1 object that contains the primary filter, or nested objects with multiple filters. Whatever filters you choose, an additional filter will be added for the company ID. For more info on filters, see: https://www.autotask.net/help/developerhelp/Content/APIs/REST/API_Calls/REST_Basic_Query_Calls.htm#List2  For a basic example: https://www.npmjs.com/package/@apigrate/autotask-restapi#query
    - `includeFields` - This is only used when making a `query` type request, used to limit which fields are returned.
    - `payload` - This is only used when making an `update` or `create` type request. This should be an object containing the new entity to create, or the parameters you wish to update. This updates ONLY the fields you specify. For a creation object example, see: https://www.npmjs.com/package/@apigrate/autotask-restapi#create  For an update object example, see: https://www.npmjs.com/package/@apigrate/autotask-restapi#update