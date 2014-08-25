var util = require('util');
var EventEmitter = require('events').EventEmitter;
var errorCode = require('./errorcode');

function JSONRPC(config, scope) {
    EventEmitter.call(this);

    config = config || {};
    this.acao = config.acao ? config.acao : "*";
    this.middleware = this.requestHandler.bind(this);
    this.scope = scope;

    if(!scope || typeof(scope) !== 'object') {
        scope = { };
    }

    scope['rpc.methodList'] = function(callback) {
        callback(null, Object.keys(scope));
    };

    return this;
}

util.inherits(JSONRPC, EventEmitter);

JSONRPC.prototype.requestHandler = function requestHandler(req, res) {
    this.emit('message', req.body);
    this.handleJSON(req, req.body, this.responseHandler.bind(this, res));
};

JSONRPC.prototype.responseHandler = function responseHandler(res, retObj) {
    var outString = JSON.stringify(retObj);
    res.writeHead(/* retObj.error ? 500 : */ 200, {
        "Access-Control-Allow-Origin": this.acao,
        "Content-Length": Buffer.byteLength(outString, 'utf8'),
        "Content-Type": "application/json;charset=utf-8"
    });
    res.end(outString);
};

JSONRPC.prototype.sendParseError = function (res) {
    this.responseHandler(res, {jsonrpc: "2.0", error:{code: errorCode.parseError, message:"Parse error"}, id: null});
};

JSONRPC.prototype.handleJSON = function handleJSON(req, data, callback) {
    function batchCallback(response, size) {
        return function cb(obj) {
            response.push(obj);
            if (response.length === size) {
                callback(response);
            }
        };
    }
    if(Array.isArray(data)) {
        var response = [];
        var len = data.length;
        for (var i = 0; i < len; ++i) {
            var x = data[i];
            this.handleJSON(req, x, batchCallback(response, len));
        }
        return;
    }
    if (!(data instanceof Object)) {
        callback({jsonrpc: "2.0", error:{code: errorCode.parseError, message:"Parse error"}, id: data.hasOwnProperty('id') ? data.id : null});
        return;
    }
    if (!data.method || !data.params) {
        callback({jsonrpc: "2.0", error:{code: errorCode.invalidRequest, message:"Invalid request"}, id: data.hasOwnProperty('id') ? data.id : null});
        return;
    }
    if (!this.scope[data.method]) {
        callback({jsonrpc: "2.0", error:{code: errorCode.methodNotFound, message:"Requested method does not exist."}, id: data.hasOwnProperty('id') ? data.id : null});
        return;
    }

    var next = function(error, result) {
        var outObj = null;
        if(data.id) {
            outObj = {
                "jsonrpc": "2.0",
                "id": data.id
            };
            if(error) {
                if(error instanceof Error) {
                    outObj.error = {code: errorCode.internalError, message: error.message};
                } else {
                    outObj.error = error;
                }
            } else {
                outObj.result = result;
            }
        }
        callback(outObj);
    };

    if(data.params && data.params instanceof Array) {
        data.params.push(next);
    } else if(data.params) {
        data.params = [data.params, next];
    } else {
        data.params = [next];
    }

    var scope = { scope: this.scope, req: req };

    try {
        this.scope[data.method].apply(scope, data.params);
    } catch(e) {
        var outErr = {};
        outErr.code = errorCode.internalError;
        outErr.message = e.message ? e.message : "";
        outErr.stack = e.stack ? e.stack : "";
        var outObj = { jsonrpc: "2.0", error: outErr, id: null };
        if(data.id) outObj.id = data.id;
        callback(outObj);
        throw e;
    }
};

module.exports = JSONRPC;
