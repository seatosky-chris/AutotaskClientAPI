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

module.exports = async function (context, req) {
    const params = new URLSearchParams(req.body);
    const headers = context.req.headers;
    context.log('JavaScript HTTP trigger function processed a request.');

    let apiKey;
    let companyAcronym;
    let validatedApiKeyName;
    let apiKeyValid = false;
    // validate api key
    if (headers.apikey) {
        apiKey = getParameterCaseInsensitive(headers, "apikey");
        
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
    let filters = req.body.filters ? req.body.filters : null;
    if (typeof filters == "string") { filters = JSON.parse(filters); }
    let includeFields = req.body.includeFields ? req.body.includeFields : null;
    if (typeof includeFields == "string") { includeFields = JSON.parse(includeFields); }
    const type = (params && params.get('type')); // 'query', 'get', 'count', 'create', 'update'
    let payload = req.body.payload ? req.body.payload : null; // for 'create' or 'update'
    if (typeof payload == "string") { payload = JSON.parse(payload); }

    // prelim check to see if endpoint and type are allowed
    if (!Object.keys(allowedEndpoints).includes(endpoint)) {
        ImmediateFailure(
            context, 
            405, 
            `A request was refused to the endpoint '${endpoint}' from org ${companyAcronym}.`, 
            `That endpoint (${endpoint}) is not allowed.`);
        return;
    }
    if (!allowedEndpoints[endpoint].includes(type)) {
        ImmediateFailure(
            context, 
            405, 
            `A request was refused to the endpoint '${endpoint}' with type '${type}' from org ${companyAcronym}.`, 
            `That endpoint type (${endpoint}, ${type}) is not allowed.`);
        return;
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
            let api = await autotask.api();

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
                responseBody = await api.Companies.get(id);

            // Any other "get"
            } else if (type == "get") {
                let tempResponseBody = await api[endpoint].get(id);
                if (!tempResponseBody || !tempResponseBody.item.companyID || tempResponseBody.item.companyID != orgID) {
                    ImmediateFailure(
                        context, 
                        403, 
                        `A get request was refused for item id '${id}', it is not part of the allowed organization.`, 
                        `Access was denied for get request to '${endpoint}' with id '${id}'.`);
                    return;
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
                let tempResponseBody = await api[endpoint][type](queryObj);

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
                    let originalAsset = await api[endpoint].get(payloadID);

                    if (!originalAsset || !originalAsset.item.companyID || originalAsset.item.companyID != orgID) {
                        ImmediateFailure(
                            context, 
                            403, 
                            `An update request was refused for item id '${payloadID}', it is not part of the allowed organization.`, 
                            `Access was denied for update request to '${endpoint}' with id '${payloadID}'.`);
                        return;
                    } else {
                        // looks good, update it
                        responseBody = await api[endpoint].update(payload);
                    }
                } else if (!payload || !payloadID) {
                    ImmediateFailure(
                        context, 
                        405, 
                        "A bad payload was sent to the 'update' endpoint: " + JSON.stringify(payload), 
                        "Bad payload sent.");
                    return;
                } else {
                    ImmediateFailure(
                        context, 
                        400, 
                        "", 
                        "That endpoint is not available.");
                    return;
                }

            // "Create" for TicketNotes (needs to use a child endpoint)
            } else if  (endpoint == "TicketNotes" && type == "create") {
                var ticketParentId = getParameterCaseInsensitive(payload, "ticketID");
                if (payload && ticketParentId != undefined && payload) {
                    let ticketBody = await api.Tickets.get(ticketParentId);

                    if (ticketBody && ticketBody.item) {
                        var payloadCompanyID = getParameterCaseInsensitive(ticketBody.item, "companyID");
                        if (payloadCompanyID != undefined) {
                            if (payloadCompanyID == orgID) {
                                responseBody = await api.TicketNotes.create(ticketParentId, payload);
                            } else {
                                ImmediateFailure(
                                    context, 
                                    403, 
                                    `A create request was refused for company id '${payloadCompanyID}', it is not part of the allowed organization.`, 
                                    `Access was denied for create request to '${endpoint}' with companyID '${payloadCompanyID}'.`);
                                return;
                            }
                        } else {
                            ImmediateFailure(
                                context, 
                                405, 
                                "A bad payload was sent to the 'create' endpoint, could not find a ticket with that ID: " + JSON.stringify(payload), 
                                "Bad payload sent. Could not find a ticket with that Ticket ID.");
                            return;
                        }
                    } else {
                        ImmediateFailure(
                            context, 
                            405, 
                            "A bad payload was sent to the 'create' endpoint, could not find a ticket with that ID: " + JSON.stringify(payload), 
                            "Bad payload sent. Could not find a ticket with that Ticket ID.");
                        return;
                    }
                } else {
                    ImmediateFailure(
                        context, 
                        405, 
                        "A bad payload was sent to the 'create' endpoint: " + JSON.stringify(payload), 
                        "Bad payload sent.");
                    return;
                }

            // "Create"
            } else if (type == "create") {
                var payloadCompanyID = getParameterCaseInsensitive(payload, "companyID");
                if (payload && payloadCompanyID != undefined && type != "Companies") {

                    if (payloadCompanyID == orgID) {
                        responseBody = await api[endpoint].create(payload);
                    } else {
                        ImmediateFailure(
                            context, 
                            403, 
                            `A create request was refused for company id '${payloadCompanyID}', it is not part of the allowed organization.`, 
                            `Access was denied for create request to '${endpoint}' with companyID '${payloadCompanyID}'.`);
                        return;
                    }
                } else if (!payload || payloadCompanyID) {
                    ImmediateFailure(
                        context, 
                        405, 
                        "A bad payload was sent to the 'create' endpoint: " + JSON.stringify(payload), 
                        "Bad payload sent.");
                    return;
                } else {
                    ImmediateFailure(
                        context, 
                        400, 
                        "", 
                        "That endpoint is not available.");
                    return;
                }

            // "Delete" and "Replace" are not implemented
            } else if (type == "delete" || type == "replace") {
                ImmediateFailure(
                    context, 
                    501, 
                    "", 
                    `The '${type}' endpoint has not been implemented yet.`);
                return;
            }


            context.res = {
                // status: 200, /* Defaults to 200 */
                body: responseBody
            };
            context.done();
            return;
        } else {
            ImmediateFailure(
                context, 
                403, 
                "API Key validated but a valid Org ID was not found for that key.", 
                "API Key validated but a valid Org ID was not found for that key.");
            return;
        }
    }

    ImmediateFailure(
        context, 
        401, 
        `API Key could not be validated: ${apiKey}`, 
        "That API Key could not be validated.");
    return;
}

/**
  * @param {Object} context
  * @param {int} errorCode
  * @param {string} log
  * @param {string} body
 */
function ImmediateFailure(context, errorCode = 400, log = "", body = "") {
    if (log) {
        context.log.error(log);
    }
    context.res = {
        status: errorCode,
        body: body
    };
    context.done();
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