/**
 * Module dependencies.
 */

var util  = require('util');
var https = require('https');
var http  = require('http');
var url   = require('url');
var fs    = require('fs');
var ejs   = require('ejs');
var qs    = require('querystring');
var BaseHttpPoller = require('../http/baseHttpPoller');

// The http module lacks proxy support. Let's monkey-patch it.
require('../../proxy');

/**
 * HTTPS Poller, to check web pages served via SSL
 *
 * @param {Mixed} Poller Target (e.g. URL)
 * @param {Number} Poller timeout in milliseconds. Without response before this duration, the poller stops and executes the error callback.
 * @param {Function} Error/success callback
 * @api   public
 */
function HttpsPoller(target, timeout, callback) {
  HttpsPoller.super_.call(this, target, timeout, callback);
}

util.inherits(HttpsPoller, BaseHttpPoller);

HttpsPoller.type = 'https+oauth';

HttpsPoller.validateTarget = function(target) {
  return url.parse(target).protocol == 'https:';
};

getAccessToken = function(self, oauthEndpoint, params, credentials, onSuccess, onError) {
  try {
    var req = https.request(oauthEndpoint, function(res) {
      res.setEncoding('utf8');

      if(res.statusCode == 200) {
        body="";
        res.on('data', function (chunk) {
          body+=chunk;
        });

        res.on('end', function () {
          try {
            var parsed_body = JSON.parse(body);
            onSuccess(self, parsed_body.accessToken || parsed_body.access_token);
          } catch(err) {
            onError(self, {name: "InvalidResponseData", message: "oauth authentication failed, invalid data in response"});
          }
        });
      } else {
        onError(self, {name: "InvalidResponseStatus", message: "oauth authentication failed, invalid status ("+res.statusCode+") in response"});
      }
    });

    req.on('error', function (err) {
      onError(self, err);
    });
    if (typeof params != 'undefined') {
      req.write(qs.stringify(params), "utf-8");
    } else if (typeof credentials != 'undefined') {
      req.write(JSON.stringify(credentials), "utf-8");
    }
    req.end();
  } catch(err) {
    onError(self, {name: "UnknownError", message: "oauth authentication failed, an unknown error occured ("+err.message+")"}); 
  }
}

/**
 * Launch the actual polling
 *
 * @api   public
 */
HttpsPoller.prototype.poll = function(secure) {
  getAccessToken(this, this.target.endpoint, this.target.params, this.target.credentials, function(self, token) {
    HttpsPoller.super_.prototype.poll.call(self);
    secure = typeof secure !== 'undefined' ? secure : true;
    try {
      console.log(token);
      var options = {
        hostname: self.target.hostname,
        port: self.target.port,
        path: self.target.path,
        method: 'GET',
        headers: {
          "Authorization" : "Bearer " + token
        }
      };

      if (secure) {
        self.request = https.request(options, self.onResponseCallback.bind(self));
      } else {
        self.request = http.request(options, self.onResponseCallback.bind(self));
      }
    } catch(err) {
      return self.onErrorCallback(err);
    }
    self.request.on('error', self.onErrorCallback.bind(self));
    self.request.end();
  }, function(self, err) {
    HttpsPoller.super_.prototype.poll.call(self);
    return self.onErrorCallback(err);
  });
};

// see inherited function BaseHttpPoller.prototype.onResponseCallback
// see inherited function BaseHttpPoller.prototype.onErrorCallback

HttpsPoller.prototype.handleRedirectResponse = function(res) {
  this.debug(this.getTime() + "ms - Got redirect response to " + this.target.href);
  var target = url.parse(res.headers.location);
  if (!target.protocol) {
    // relative location header. This is incorrect but tolerated
    this.target = url.parse('http://' + this.target.hostname + res.headers.location);
    this.poll(false);
    return;
  }
  switch (target.protocol) {
    case 'https:':
      this.target = target;
      this.poll(true);
      break;
    case 'http:':
      this.target = target;
      this.poll(false);
      break;
    default:
      this.request.abort();
      this.onErrorCallback({ name: "WrongRedirectUrl", message: "Received redirection from https: to unsupported protocol " + target.protocol});
  }
  return;
};

module.exports = HttpsPoller;
