const { app } = require('@azure/functions');
const {AutotaskRestApi} = require('@apigrate/autotask-restapi');

const allowedEndpoints = {
    Companies: ['query', 'get'],
    CompanyLocations: ['query', 'get', 'count'],
    Contacts: ['query', 'get', 'count', 'update'],
    Contracts: ['query', 'get', 'count'],
    ConfigurationItems: ['query', 'get', 'count'],
    Tickets: ['query', 'get', 'count', 'create', 'update'],
    TicketNotes: ['create']
};

app.http('AutotaskPerClientAPI', {
    methods: ['GET', 'POST'],
    authLevel: 'function',
    handler: async (req, context) => {
        const params = new URLSearchParams(req.query);
        const headers = req.headers;
        context.log('JavaScript HTTP trigger function processed a request.');

        let apiKey;
        let companyAcronym;
        let validatedApiKeyName;
        let apiKeyValid = false;
        // validate api key
        if (headers.get("x-api-key")) {
            apiKey = headers.get("x-api-key");
            
            if (apiKey) {
                validatedApiKeyName = Object.keys(process.env).find(key => key.startsWith("APIKey_") && process.env[key] === apiKey);
            }
            if (validatedApiKeyName) {
                companyAcronym = validatedApiKeyName.substring(validatedApiKeyName.indexOf("_") + 1);
            }
            if (validatedApiKeyName && companyAcronym) {
                apiKeyValid = true;
            }
        }

        const endpoint = (params && params.get('endpoint'));
        let id = (params && params.get('id'));
        let filters = params.filters ? params.get('filters') : null;
        if (typeof filters == "string") { filters = JSON.parse(filters); }
        let includeFields = params.includeFields ? params.get('includeFields') : null;
        if (typeof includeFields == "string") { includeFields = JSON.parse(includeFields); }
        const type = (params && params.get('type')); // 'query', 'get', 'count', 'create', 'update'
        let payload = params.payload ? params.get('payload') : null; // for 'create' or 'update'
        if (typeof payload == "string") { payload = JSON.parse(payload); }

        // prelim check to see if endpoint and type are allowed
        if (!Object.keys(allowedEndpoints).includes(endpoint)) {
            return ImmediateFailure(
                context, 
                405, 
                `A request was refused to the endpoint '${endpoint}' from org ${companyAcronym}.`, 
                `That endpoint (${endpoint}) is not allowed.`);
        }
        if (!allowedEndpoints[endpoint].includes(type)) {
            return ImmediateFailure(
                context, 
                405, 
                `A request was refused to the endpoint '${endpoint}' with type '${type}' from org ${companyAcronym}.`, 
                `That endpoint type (${endpoint}, ${type}) is not allowed.`);
        }

        if (apiKeyValid && companyAcronym) {
            const orgList = require("./OrgList.json");
            var orgID = orgList[companyAcronym];

            if (orgID) {
                context.log(`API Key validated, connecting to org ${companyAcronym}, ID: ${orgID}`);
                let responseBody;

                // API Key validated and Org ID found
                // Connect to the Autotask API
                const autotask = new AutotaskRestApi(
                    process.env.AUTOTASK_USER,
                    process.env.AUTOTASK_SECRET, 
                    process.env.AUTOTASK_INTEGRATION_CODE 
                );

                // Verify the Autotask API key works (the library doesn't always provide a nice error message)
                var autotaskTest = await autotask.Companies.get(0); // we need to do a call for the autotask module to get the zone info
                try {
                    let fetchParms = {
                        method: 'GET',
                        headers: {
                        "Content-Type": "application/json",
                        "User-Agent": "Apigrate/1.0 autotask-restapi NodeJS connector"
                        }
                    };
                    fetchParms.headers.ApiIntegrationcode = process.env.AUTOTASK_INTEGRATION_CODE;
                    fetchParms.headers.UserName =  process.env.AUTOTASK_USER;
                    fetchParms.headers.Secret = process.env.AUTOTASK_SECRET;

                    let test_url = `${autotask.zoneInfo ? autotask.zoneInfo.url : autotask.base_url}V${autotask.version}/Companies/entityInformation`;
                    let response = await fetch(`${test_url}`, fetchParms);
                    if(!response.ok){
                        var result = await response.text();
                        if (!result) {
                            result = `${response.status} - ${response.statusText}`;
                        }
                        throw result;
                    } else {
                        context.log(`Successfully connected to Autotask. (${response.status} - ${response.statusText})`)
                    }
                } catch (error) {
                    if (error.toString().startsWith("401")) {
                        error = `API Key Unauthorized. (${error.toString()})`;
                    }
                    context.error(error);
                    
                    return ImmediateFailure(
                        context, 
                        400, 
                        `A request was refused. The Autotask Client API is not currently working due to the error: ${error.toString()}`, 
                        `The Autotask Client API is not currently working.`);
                }

                // Add company ID to included fields so we can filter returned data
                if (includeFields) {
                    if (endpoint == "Companies" && !includeFields.includes("id")) {
                        includeFields.push("id");
                    } else if (!includeFields.includes("companyID")) {
                        includeFields.push("companyID");
                    }
                }

                // Companies "get"
                if (endpoint == "Companies" && type == "get") {
                    id = orgID
                    responseBody = await autotask.Companies.get(id);

                // Any other "get"
                } else if (type == "get") {
                    let tempResponseBody = await autotask[endpoint].get(id);
                    if (!tempResponseBody || !tempResponseBody.item.companyID || tempResponseBody.item.companyID != orgID) {
                        return ImmediateFailure(
                            context, 
                            403, 
                            `A get request was refused for item id '${id}', it is not part of the allowed organization.`, 
                            `Access was denied for get request to '${endpoint}' with id '${id}'.`);
                    }
                    responseBody = tempResponseBody;

                // "Query" or "Count"
                } else if (type == "query" || type == "count") {

                    var queryObj = {
                        filter: [
                            {
                                "op": "and",
                                "items": [
                                    {
                                        "op": "eq",
                                        "field": (endpoint == "Companies" ? "id" : "companyID"),
                                        "value": orgID
                                    },
                                    (filters && filters[0] ? filters[0] : {})
                                ]
                            }
                        ]
                    };

                    if (includeFields) {
                        queryObj.includeFields = includeFields;
                    }
                    let tempResponseBody = await autotask[endpoint][type](queryObj);

                    if (type == "count") {
                        responseBody = tempResponseBody;
                    } else {
                        if (tempResponseBody) {
                            if (endpoint == "Companies") {
                                tempResponseBody.items = tempResponseBody.items.filter(i => i.id == orgID);
                            } else {
                                tempResponseBody.items = tempResponseBody.items.filter(i => i.companyID == orgID);
                            }
                            if (tempResponseBody.pageDetails) {
                                tempResponseBody.pageDetails.count = tempResponseBody.items.length;
                            }
                        }
                        responseBody = tempResponseBody;
                    }

                // "Update"
                } else if (type == "update") {
                    var payloadID = getParameterCaseInsensitive(payload, "id");
                    if (payload && payloadID != undefined && type != "Companies") {
                        let originalAsset = await autotask[endpoint].get(payloadID);

                        if (!originalAsset || !originalAsset.item.companyID || originalAsset.item.companyID != orgID) {
                            return ImmediateFailure(
                                context, 
                                403, 
                                `An update request was refused for item id '${payloadID}', it is not part of the allowed organization.`, 
                                `Access was denied for update request to '${endpoint}' with id '${payloadID}'.`);
                        } else {
                            // looks good, update it
                            responseBody = await autotask[endpoint].update(payload);
                        }
                    } else if (!payload || !payloadID) {
                        return ImmediateFailure(
                            context, 
                            405, 
                            "A bad payload was sent to the 'update' endpoint: " + JSON.stringify(payload), 
                            "Bad payload sent.");
                    } else {
                        return ImmediateFailure(
                            context, 
                            400, 
                            "", 
                            "That endpoint is not available.");
                    }

                // "Create" for TicketNotes (needs to use a child endpoint)
                } else if  (endpoint == "TicketNotes" && type == "create") {
                    var ticketParentId = getParameterCaseInsensitive(payload, "ticketID");
                    if (payload && ticketParentId != undefined && payload) {
                        let ticketBody = await autotask.Tickets.get(ticketParentId);

                        if (ticketBody && ticketBody.item) {
                            var payloadCompanyID = getParameterCaseInsensitive(ticketBody.item, "companyID");
                            if (payloadCompanyID != undefined) {
                                if (payloadCompanyID == orgID) {
                                    responseBody = await autotask.TicketNotes.create(ticketParentId, payload);
                                } else {
                                    return ImmediateFailure(
                                        context, 
                                        403, 
                                        `A create request was refused for company id '${payloadCompanyID}', it is not part of the allowed organization.`, 
                                        `Access was denied for create request to '${endpoint}' with companyID '${payloadCompanyID}'.`);
                                }
                            } else {
                                return ImmediateFailure(
                                    context, 
                                    405, 
                                    "A bad payload was sent to the 'create' endpoint, could not find a ticket with that ID: " + JSON.stringify(payload), 
                                    "Bad payload sent. Could not find a ticket with that Ticket ID.");
                            }
                        } else {
                            return ImmediateFailure(
                                context, 
                                405, 
                                "A bad payload was sent to the 'create' endpoint, could not find a ticket with that ID: " + JSON.stringify(payload), 
                                "Bad payload sent. Could not find a ticket with that Ticket ID.");
                        }
                    } else {
                        return ImmediateFailure(
                            context, 
                            405, 
                            "A bad payload was sent to the 'create' endpoint: " + JSON.stringify(payload), 
                            "Bad payload sent.");
                    }

                // "Create"
                } else if (type == "create") {
                    var payloadCompanyID = getParameterCaseInsensitive(payload, "companyID");
                    if (payload && payloadCompanyID != undefined && type != "Companies") {

                        if (payloadCompanyID == orgID) {
                            responseBody = await autotask[endpoint].create(payload);
                        } else {
                            return ImmediateFailure(
                                context, 
                                403, 
                                `A create request was refused for company id '${payloadCompanyID}', it is not part of the allowed organization.`, 
                                `Access was denied for create request to '${endpoint}' with companyID '${payloadCompanyID}'.`);
                        }
                    } else if (!payload || payloadCompanyID) {
                        return ImmediateFailure(
                            context, 
                            405, 
                            "A bad payload was sent to the 'create' endpoint: " + JSON.stringify(payload), 
                            "Bad payload sent.");
                    } else {
                        return ImmediateFailure(
                            context, 
                            400, 
                            "", 
                            "That endpoint is not available.");
                    }

                // "Delete" and "Replace" are not implemented
                } else if (type == "delete" || type == "replace") {
                    return ImmediateFailure(
                        context, 
                        501, 
                        "", 
                        `The '${type}' endpoint has not been implemented yet.`);
                }


                if (typeof responseBody == "object") {
                    return {
                        // status: 200, /* Defaults to 200 */
                        jsonBody: responseBody
                    };
                } else {
                    return {
                        body: responseBody
                    };
                }
            } else {
                return ImmediateFailure(
                    context, 
                    403, 
                    "API Key validated but a valid Org ID was not found for that key.", 
                    "API Key validated but a valid Org ID was not found for that key.");
            }
        }

        return ImmediateFailure(
            context, 
            401, 
            `API Key could not be validated: ${apiKey}`, 
            "That API Key could not be validated.");

        /**
         * @param {Object} context
         * @param {int} errorCode
         * @param {string} log
         * @param {string} body
         */
        function ImmediateFailure(context, errorCode = 400, log = "", body = "") {
            if (log) {
                context.error(log);
            }
            return {
                status: errorCode,
                body: body
            };
        }

        /**
         * @param {Object} object
         * @param {string} key
         * @return {any} value
         */
        function getParameterCaseInsensitive(object, key) {
            const asLowercase = key.toLowerCase();
            return object[Object.keys(object)
            .find(k => k.toLowerCase() === asLowercase)
            ];
        }
    },
});